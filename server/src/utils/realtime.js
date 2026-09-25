/**
 * Live updates for the Requests inbox + sidebar badge (server-sent events).
 *
 * Each signed-in tab holds one GET /api/requests/stream open. When a transfer
 * request or a notification changes, the affected users' streams receive a tiny
 * `requests` event naming WHAT changed ({ scopes: [...] }) — never the data itself.
 * The client then refetches through the normal, authorized endpoints, so those stay
 * the single source of truth and the stream can't leak anything.
 *
 * Changes are observed with MongoDB change streams instead of hooks in every write
 * path: that covers every writer (the request controller, the hourly expiry cron,
 * supersedePendingRequests inside other controllers' transactions, midday-transfer
 * push requests), fires only once a transaction COMMITS (a refetch never sees the
 * pre-commit state), and works across several server instances. Change streams need
 * a replica set — which the app's transactions already require (Atlas always is one).
 * If they're unavailable, streams still connect but stay quiet and the client's
 * periodic poll carries on as before.
 *
 * Scopes: "requests" (a request the user can see was created/decided/expired),
 * "notifications" (a new notification for the user), "read" (their notifications
 * were marked read, e.g. on another device), "resync" (events may have been missed).
 */
import notificationModel from "../models/notificationModel.js"
import TransferRequest from "../models/transferRequestModel.js"
import userModel from "../models/userModel.js"

const HEARTBEAT_MS = 25_000 // keeps proxies from closing an idle stream
const FLUSH_MS = 250 // coalesces bursts (e.g. the cron expiring many requests)
const RESTART_MIN_MS = 5_000
const RESTART_MAX_MS = 5 * 60_000

/** userId (string) → Set of open SSE responses (one per tab/device). */
const clients = new Map()
let heartbeat = null

/** Changes waiting for the next flush. */
let pendingRequests = [] // [{ fromSite, toSite, requestedBy }]
let pendingScopes = new Map() // userId → Set<scope>
let flushTimer = null

function write(res, chunk) {
  try {
    res.write(chunk)
  } catch {
    /* the socket closed under us — its "close" handler removes it */
  }
}

function sendEvent(userId, scopes) {
  const set = clients.get(userId)
  if (!set) return
  const chunk = `event: requests\ndata: ${JSON.stringify({ scopes })}\n\n`
  for (const res of set) write(res, chunk)
}

/**
 * Hold `res` open as an SSE stream for the authenticated user (req.user from
 * verifyToken) until the client disconnects.
 */
export function openEventStream(req, res) {
  const userId = String(req.user.id)

  res.status(200)
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no", // don't let a proxy buffer the stream
  })
  res.flushHeaders()
  // How long the browser waits before reconnecting after a drop.
  write(res, "retry: 5000\n\n")

  if (!clients.has(userId)) clients.set(userId, new Set())
  clients.get(userId).add(res)

  if (!heartbeat) {
    heartbeat = setInterval(() => {
      for (const set of clients.values()) for (const r of set) write(r, ": ping\n\n")
    }, HEARTBEAT_MS)
    heartbeat.unref()
  }

  // res (not req) "close" fires when the connection actually goes away.
  res.on("close", () => {
    const set = clients.get(userId)
    if (!set) return
    set.delete(res)
    if (set.size === 0) clients.delete(userId)
    if (clients.size === 0 && heartbeat) {
      clearInterval(heartbeat)
      heartbeat = null
    }
  })
}

function queueScope(userId, scope) {
  if (!clients.has(userId)) return
  if (!pendingScopes.has(userId)) pendingScopes.set(userId, new Set())
  pendingScopes.get(userId).add(scope)
  scheduleFlush()
}

function scheduleFlush() {
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS)
}

/**
 * Who should refetch after a request changes: every admin (they see all requests),
 * the supervisors of both sites (the deciding site's inbox, the other's context),
 * and the requester (their Sent tab). Resolved fresh against CONNECTED users only,
 * so a reassigned supervisor is targeted by their current site.
 */
async function requestAudience(changes) {
  const connected = [...clients.keys()]
  if (connected.length === 0) return []

  const ids = (key) => [...new Set(changes.map((c) => c[key]).filter(Boolean).map(String))]
  const sites = [...new Set([...ids("fromSite"), ...ids("toSite")])]

  const users = await userModel
    .find({
      _id: { $in: connected },
      $or: [
        { role: { $in: ["admin", "superadmin"] } },
        { role: "supervisor", assignedSite: { $in: sites } },
        { _id: { $in: ids("requestedBy") } },
      ],
    })
    .select("_id")
    .lean()
  return users.map((u) => String(u._id))
}

async function flush() {
  flushTimer = null
  const changes = pendingRequests
  const scopes = pendingScopes
  pendingRequests = []
  pendingScopes = new Map()

  if (changes.length) {
    try {
      for (const userId of await requestAudience(changes)) {
        if (!scopes.has(userId)) scopes.set(userId, new Set())
        scopes.get(userId).add("requests")
      }
    } catch (err) {
      console.error("[realtime] failed to resolve request audience:", err.message)
    }
  }

  for (const [userId, set] of scopes) sendEvent(userId, [...set])
}

/** Tell every open stream to refetch — used after a gap in which changes may have been missed. */
function broadcastResync() {
  for (const userId of clients.keys()) sendEvent(userId, ["resync"])
}

/**
 * Keep a change stream on `model` running, restarting with backoff after an error.
 * Gives up quietly when the deployment doesn't support change streams at all.
 */
function watchModel(label, model, pipeline, onChange) {
  let delay = RESTART_MIN_MS

  const start = () => {
    const stream = model.watch(pipeline, { fullDocument: "updateLookup" })

    stream.on("change", (change) => {
      delay = RESTART_MIN_MS
      try {
        onChange(change)
      } catch (err) {
        console.error(`[realtime] ${label} change handler failed:`, err.message)
      }
    })

    stream.on("error", (err) => {
      stream.close().catch(() => {})
      // 40573: "$changeStream is only supported on replica sets" — not recoverable.
      if (err?.code === 40573) {
        console.warn(`[realtime] change streams unsupported (${label}) — live updates off, clients keep polling`)
        return
      }
      console.error(`[realtime] ${label} change stream error, restarting in ${delay / 1000}s:`, err.message)
      setTimeout(() => {
        start()
        // Whatever changed while the stream was down was never announced.
        broadcastResync()
      }, delay)
      delay = Math.min(delay * 2, RESTART_MAX_MS)
    })
  }

  start()
}

/** Start the change-stream watchers (call once, after the DB connects). */
export function startRealtimeWatchers() {
  watchModel(
    "transferrequests",
    TransferRequest,
    [
      { $match: { operationType: { $in: ["insert", "update", "replace"] } } },
      {
        $project: {
          operationType: 1,
          "fullDocument.fromSite": 1,
          "fullDocument.toSite": 1,
          "fullDocument.requestedBy": 1,
        },
      },
    ],
    (change) => {
      const doc = change.fullDocument
      if (!doc || clients.size === 0) return // deleted before the lookup / nobody listening
      pendingRequests.push(doc)
      scheduleFlush()
    }
  )

  watchModel(
    "notifications",
    notificationModel,
    [
      {
        $match: {
          $or: [
            { operationType: "insert" },
            { operationType: "update", "updateDescription.updatedFields.read": { $exists: true } },
          ],
        },
      },
      { $project: { operationType: 1, "fullDocument.user": 1 } },
    ],
    (change) => {
      const user = change.fullDocument?.user
      if (!user) return
      queueScope(String(user), change.operationType === "insert" ? "notifications" : "read")
    }
  )

  console.log("[realtime] Watching transfer requests + notifications for live updates")
}
