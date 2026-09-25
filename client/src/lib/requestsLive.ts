// Live Requests updates: one EventSource per signed-in tab on GET /api/requests/stream
// (server/src/utils/realtime.js). The server sends a bare "requests" event naming WHAT
// changed; we re-emit it as a window REQUESTS_LIVE_EVENT and the sidebar badge / Requests
// page refetch through the normal API. The stream carries no data of its own.

/**
 * - "requests": a transfer request you can see was created / decided / expired
 * - "notifications": a new notification for you
 * - "read": your notifications were marked read (e.g. on another device)
 * - "resync": the stream reconnected, so changes may have been missed
 */
export type LiveScope = "requests" | "notifications" | "read" | "resync"

export const REQUESTS_LIVE_EVENT = "requests:live"

export type RequestsLiveDetail = { scopes: LiveScope[] }

const RETRY_MIN_MS = 5000
const RETRY_MAX_MS = 5 * 60000

function emit(scopes: LiveScope[]) {
  window.dispatchEvent(
    new CustomEvent<RequestsLiveDetail>(REQUESTS_LIVE_EVENT, { detail: { scopes } })
  )
}

/** Open the live stream; returns a function that closes it. */
export function startRequestsLive(): () => void {
  if (typeof EventSource === "undefined") return () => {}

  const base = String(import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "")
  const url = `${base}/api/requests/stream`

  let es: EventSource | null = null
  let retryTimer: number | undefined
  let retryDelay = RETRY_MIN_MS
  let hasConnected = false
  let stopped = false

  const connect = () => {
    if (stopped) return
    const source = new EventSource(url, { withCredentials: true })
    es = source

    source.addEventListener("open", () => {
      retryDelay = RETRY_MIN_MS
      // A REconnect may have missed events while the stream was down — refetch once.
      if (hasConnected) emit(["resync"])
      hasConnected = true
    })

    source.addEventListener("requests", (e) => {
      try {
        const { scopes } = JSON.parse((e as MessageEvent<string>).data) as RequestsLiveDetail
        if (Array.isArray(scopes) && scopes.length) emit(scopes)
      } catch {
        /* malformed event — ignore */
      }
    })

    source.addEventListener("error", () => {
      // A dropped connection is retried by the browser itself (readyState CONNECTING).
      // It only gives up (CLOSED) on an HTTP error such as a 401 — back off and retry.
      if (source.readyState !== EventSource.CLOSED) return
      source.close()
      es = null
      retryTimer = window.setTimeout(connect, retryDelay)
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS)
    })
  }

  // Returning to a backgrounded tab: skip any pending backoff and reconnect now.
  const onVisible = () => {
    if (document.hidden || es || stopped) return
    window.clearTimeout(retryTimer)
    connect()
  }
  document.addEventListener("visibilitychange", onVisible)

  connect()

  return () => {
    stopped = true
    window.clearTimeout(retryTimer)
    document.removeEventListener("visibilitychange", onVisible)
    es?.close()
    es = null
  }
}
