import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import toast from "react-hot-toast"
import axios from "axios"
import { useNavigate } from "react-router-dom"

import { api } from "@/lib/api"
import { REQUESTS_LIVE_EVENT, type RequestsLiveDetail } from "@/lib/requestsLive"
import { useAuth } from "@/context/AuthContext"
import {
  getCurrentTargetDateString,
  toLocalDateString,
  toLocalTimeString,
  formatLocalTime12h,
  formatLogicalDateLabel,
} from "@/lib/dateUtils"

import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Loader2,
  Inbox,
  Send,
  Bell,
  Check,
  X,
  MapPin,
  ArrowRight,
  Briefcase,
  Clock3,
  ChevronRight,
} from "lucide-react"

type Ref = { _id: string; name?: string; siteName?: string } | null
type Emp = { _id: string; name: string; employeeId: string; jobTitle: string } | null

type RequestStatus = "pending" | "accepted" | "rejected" | "cancelled" | "expired"

type TransferRequest = {
  _id: string
  employee: Emp
  fromSite: Ref
  toSite: Ref
  fromJob: Ref
  toJob: Ref
  mode: "today" | "permanent"
  // "pull" = a destination asked for this employee (home decides); "push" = a source
  // is sending this employee mid-day into a site (destination decides). Absent on
  // legacy docs → treated as "pull".
  direction?: "pull" | "push"
  // The source check-out carried forward as the destination check-in: set on a push when
  // made, and on a pull accepted as a "split".
  carriedCheckIn?: string | null
  // Incoming pending pull only: the employee's latest check-in at their home site today.
  // Present → accepting needs a choice (move the whole day, or split it).
  sourceDay?: { checkIn: string; checkOut: string | null } | null
  // Pull only, once accepted: how an already-started home day was handled.
  dayHandling?: "move" | "split" | null
  // "push" only: business day of the source record (a night transfer accepted after
  // midnight still lands on the night's own day). null on pull / older requests.
  attendanceDate?: string | null
  status: RequestStatus
  requestedBy: Ref
  approver: Ref
  // Current supervisors of the deciding site (any of them can act). Empty → an
  // admin decides. Computed server-side on each list, fresher than `approver`.
  deciders?: { _id: string; name: string }[]
  dateLocal: string
  note?: string
  createdAt: string
  decidedAt?: string | null
}

type Notification = {
  _id: string
  type: string
  title: string
  body: string
  url: string
  relatedRequest?: string | null
  read: boolean
  createdAt: string
}

type Tab = "incoming" | "sent" | "activity"

const TAB_LABEL: Record<Tab, string> = { incoming: "Incoming", sent: "Sent", activity: "Activity" }

// The tab a notification belongs to. A request's own notifications live with it — a new
// request in the decider's Incoming, its outcome in the requester's Sent; the rest
// (transferred in / out) only appear in Activity.
const NOTIF_TAB: Record<string, Tab> = {
  request_received: "incoming",
  request_accepted: "sent",
  request_rejected: "sent",
  request_expired: "sent",
}
const tabOf = (n: Notification): Tab => NOTIF_TAB[n.type] ?? "activity"

const STATUS_STYLES: Record<RequestStatus, string> = {
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200/60 dark:border-amber-800/30",
  accepted: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-800/30",
  rejected: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-red-200/60 dark:border-red-800/30",
  cancelled: "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300 border-slate-200/60 dark:border-slate-700/40",
  expired: "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300 border-slate-200/60 dark:border-slate-700/40",
}

function StatusBadge({ status }: { status: RequestStatus }) {
  return (
    <Badge variant="outline" className={`capitalize text-[11px] ${STATUS_STYLES[status]}`}>
      {status}
    </Badge>
  )
}

function ModeBadge({ mode }: { mode: "today" | "permanent" }) {
  return (
    <Badge
      variant="outline"
      className={
        mode === "permanent"
          ? "text-[11px] bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300 border-violet-200/60 dark:border-violet-800/30"
          : "text-[11px] bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200/60 dark:border-blue-800/30"
      }
    >
      {mode === "permanent" ? "Permanent" : "For today"}
    </Badge>
  )
}

/** Same red as the sidebar Requests badge, so "red" always means "this is the new thing". */
function NewPill({ label = "New" }: { label?: string }) {
  return (
    <span className="inline-flex items-center h-5 px-2 rounded-full bg-red-500 text-white text-[11px] font-semibold">
      {label}
    </span>
  )
}

function RequestCard({
  req,
  highlight,
  flash = false,
  children,
}: {
  req: TransferRequest
  // Set while a notification about this request is new this visit ("New" / "Updated").
  highlight?: string
  // Briefly ringed after jumping here from an Activity item.
  flash?: boolean
  children?: React.ReactNode
}) {
  return (
    <div
      id={`req-${req._id}`}
      className={`rounded-xl border bg-card p-4 shadow-sm space-y-3 transition-shadow duration-500 ${
        highlight ? "border-primary/40" : "border-border"
      } ${flash ? "ring-2 ring-primary" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-foreground truncate">
            {req.employee?.name || "Employee"}
            <span className="ml-2 font-mono text-xs text-muted-foreground">{req.employee?.employeeId}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{req.employee?.jobTitle}</div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {highlight && <NewPill label={highlight} />}
          <StatusBadge status={req.status} />
          <ModeBadge mode={req.mode} />
          {req.direction === "push" && (
            <Badge
              variant="outline"
              className="text-[11px] bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200/60 dark:border-amber-800/30"
            >
              Mid-day
            </Badge>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <MapPin className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium text-foreground">{req.fromSite?.siteName || "—"}</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium text-foreground">{req.toSite?.siteName || "—"}</span>
        {req.toJob?.name && (
          <span className="inline-flex items-center gap-1 ml-1">
            <Briefcase className="h-3.5 w-3.5" />
            {req.toJob.name}
          </span>
        )}
      </div>

      <RequestTiming req={req} />

      {children}
    </div>
  )
}

/** When the move happens: a mid-day transfer's start time here, and the day if not today. */
function RequestTiming({ req }: { req: TransferRequest }) {
  const day = (req.direction === "push" ? req.attendanceDate : null) || req.dateLocal
  const notToday = !!day && day !== getCurrentTargetDateString()
  const startsAt = req.carriedCheckIn ? formatLocalTime12h(req.carriedCheckIn) : null
  const wholeDay = req.dayHandling === "move"
  if (!startsAt && !notToday && !wholeDay) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Clock3 className="h-3.5 w-3.5 shrink-0" />
      {startsAt && <span>Starts at <span className="font-medium text-foreground">{startsAt}</span></span>}
      {wholeDay && <span className="font-medium text-foreground">Whole day moved</span>}
      {(startsAt || wholeDay) && notToday && <span>·</span>}
      {notToday && <span>For {formatLogicalDateLabel(day)}</span>}
    </div>
  )
}

// How an already-started home day is handled when a pull request is accepted.
type AcceptChoice = { dayHandling: "move" | "split"; splitAt?: string }

const choiceTileCls = (selected: boolean) =>
  `block cursor-pointer rounded-xl border p-3 text-left transition-colors ${
    selected ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border bg-muted/30 hover:border-primary/20"
  }`

/**
 * Accept / Reject for a pending incoming request. Reject asks for an optional reason (the
 * requester sees it); accepting a PERMANENT request asks for a second tap, since it moves the
 * employee's home site. Accepting a pull for an employee who already checked in here today
 * asks how that day is handled — moved whole, or split at the time they left — folding in
 * the permanent confirmation.
 */
function IncomingActions({
  req,
  busy,
  onAct,
}: {
  req: TransferRequest
  busy: boolean
  onAct: (action: "accept" | "reject", note?: string, choice?: AcceptChoice) => void
}) {
  const [stage, setStage] = useState<"idle" | "rejecting" | "confirming" | "day">("idle")
  const [note, setNote] = useState("")
  const [dayChoice, setDayChoice] = useState<"move" | "split" | null>(null)
  const [splitAt, setSplitAt] = useState("")

  const sourceDay = req.direction !== "push" ? req.sourceDay : null

  const openDayStage = () => {
    if (!sourceDay) return
    setDayChoice(null)
    // Default "until" time: their check-out here if they have one, else now.
    setSplitAt(toLocalTimeString(sourceDay.checkOut || new Date()))
    setStage("day")
  }

  if (stage === "day" && sourceDay) {
    const name = req.employee?.name || "The employee"
    const toName = req.toSite?.siteName || "the other site"
    const checkInStr = toLocalTimeString(sourceDay.checkIn)
    // Same-day HH:mm strings compare in time order; the server re-validates.
    const splitValid = /^\d{2}:\d{2}$/.test(splitAt) && splitAt > checkInStr
    const canConfirm = dayChoice === "move" || (dayChoice === "split" && splitValid)
    return (
      <div className="space-y-3 pt-1">
        <p className="text-xs text-foreground">
          {name} checked in here today at{" "}
          <span className="font-medium">{formatLocalTime12h(sourceDay.checkIn)}</span>
          {sourceDay.checkOut ? <> (until {formatLocalTime12h(sourceDay.checkOut)})</> : " (still checked in)"}.
          How should today be handled?
        </p>
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
          <label className={choiceTileCls(dayChoice === "move")}>
            <input
              type="radio"
              name={`day-${req._id}`}
              className="sr-only"
              checked={dayChoice === "move"}
              onChange={() => setDayChoice("move")}
            />
            <div className="font-semibold text-sm text-foreground">Didn't work here</div>
            <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">
              Their session here is removed; {toName} records the whole day.
            </div>
          </label>
          <label className={choiceTileCls(dayChoice === "split")}>
            <input
              type="radio"
              name={`day-${req._id}`}
              className="sr-only"
              checked={dayChoice === "split"}
              onChange={() => setDayChoice("split")}
            />
            <div className="font-semibold text-sm text-foreground">Worked here until</div>
            <Input
              type="time"
              value={splitAt}
              onChange={(e) => {
                setSplitAt(e.target.value)
                setDayChoice("split")
              }}
              onFocus={() => setDayChoice("split")}
              className="mt-1.5 h-8 bg-background"
            />
            <div className="text-[11px] text-muted-foreground leading-snug mt-1">
              Their session here ends then; {toName} starts from that time.
            </div>
            {dayChoice === "split" && !splitValid && (
              <div className="text-[11px] text-red-600 dark:text-red-400 mt-1">
                Must be later than their check-in ({formatLocalTime12h(sourceDay.checkIn)}).
              </div>
            )}
          </label>
        </div>
        {req.mode === "permanent" && (
          <p className="text-xs text-foreground">
            This also moves {name}'s home site to <span className="font-medium">{toName}</span> from today.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStage("idle")}>
            Back
          </Button>
          <Button
            size="sm"
            disabled={busy || !canConfirm}
            onClick={() =>
              onAct(
                "accept",
                undefined,
                dayChoice === "move" ? { dayHandling: "move" } : { dayHandling: "split", splitAt }
              )
            }
          >
            {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Check className="h-4 w-4 mr-1.5" />}
            {req.mode === "permanent" ? "Confirm permanent move" : "Accept"}
          </Button>
        </div>
      </div>
    )
  }

  if (stage === "rejecting") {
    return (
      <div className="space-y-2 pt-1">
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Reason (optional) — the requester will see this"
          className="min-h-16 text-sm"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStage("idle")}>
            Back
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onAct("reject", note.trim())}
            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
          >
            {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <X className="h-4 w-4 mr-1.5" />}
            Reject request
          </Button>
        </div>
      </div>
    )
  }

  if (stage === "confirming") {
    return (
      <div className="space-y-2 pt-1">
        <p className="text-xs text-foreground">
          This moves {req.employee?.name || "the employee"}'s home site to{" "}
          <span className="font-medium">{req.toSite?.siteName || "the destination"}</span> from today.
        </p>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStage("idle")}>
            Back
          </Button>
          <Button size="sm" disabled={busy} onClick={() => onAct("accept")}>
            {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Check className="h-4 w-4 mr-1.5" />}
            Confirm permanent move
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
      <span className="text-xs text-muted-foreground">
        Requested by {req.requestedBy?.name || "a supervisor"}
      </span>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => setStage("rejecting")}
          className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
        >
          <X className="h-4 w-4 mr-1.5" />
          Reject
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            sourceDay ? openDayStage() : req.mode === "permanent" ? setStage("confirming") : onAct("accept")
          }
        >
          {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Check className="h-4 w-4 mr-1.5" />}
          Accept
        </Button>
      </div>
    </div>
  )
}

function EmptyState({ icon: Icon, text }: { icon: typeof Inbox; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icon className="h-8 w-8 text-muted-foreground/50 mb-2" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  )
}

/** Who is expected to act on a sent request. Names the deciding site's supervisors —
 * one is enough to reach out to, so we show the first and count the rest. */
function awaitingText(req: TransferRequest): string {
  const names = (req.deciders ?? []).map((d) => d.name).filter(Boolean)
  if (names.length === 0) {
    return req.approver?.name ? `Awaiting ${req.approver.name}` : "Awaiting an admin"
  }
  if (names.length === 1) return `Awaiting ${names[0]}`
  return `Awaiting ${names[0]} +${names.length - 1} more`
}

/**
 * A list that shows only today's items by default and reveals the older ones on
 * demand — keeps the page focused on what's current without losing the history.
 * `visible` is the default (today) subset; `all` is the full list shown once expanded.
 */
function CollapsibleList<T>({
  all,
  visible,
  expanded,
  onToggle,
  emptyIcon,
  emptyText,
  renderItem,
}: {
  all: T[]
  visible: T[]
  expanded: boolean
  onToggle: () => void
  emptyIcon: typeof Inbox
  emptyText: string
  renderItem: (item: T) => React.ReactNode
}) {
  if (all.length === 0) return <EmptyState icon={emptyIcon} text={emptyText} />

  const olderCount = all.length - visible.length
  const items = expanded ? all : visible

  return (
    <>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">Nothing today.</p>
      ) : (
        items.map(renderItem)
      )}
      {olderCount > 0 && (
        <div className="pt-1 flex justify-center">
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onToggle}>
            {expanded ? "Show less" : `Show ${olderCount} older`}
          </Button>
        </div>
      )}
    </>
  )
}

export default function Requests() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [tab, setTab] = useState<Tab>("incoming")
  // The first load opens on the tab holding the newest unread alert; after that (or once
  // the user picks a tab) refreshes never switch tabs under them.
  const tabPicked = useRef(false)
  const selectTab = (key: Tab) => {
    tabPicked.current = true
    setTab(key)
  }
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [incoming, setIncoming] = useState<TransferRequest[]>([])
  const [outgoing, setOutgoing] = useState<TransferRequest[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])

  // Each tab defaults to today's items; older ones are revealed per-tab on demand.
  const [expanded, setExpanded] = useState<Record<Tab, boolean>>({
    incoming: false,
    sent: false,
    activity: false,
  })
  const toggleExpanded = (key: Tab) => setExpanded((e) => ({ ...e, [key]: !e[key] }))

  // Notifications read during this visit. They stay highlighted as new until you leave,
  // although the server copy is already marked read.
  const [seenIds, setSeenIds] = useState<Set<string>>(() => new Set())
  const [pageVisible, setPageVisible] = useState(() => !document.hidden)
  // A request card to scroll to and briefly ring, after jumping from an Activity item.
  const [focusReqId, setFocusReqId] = useState<string | null>(null)

  // Live refreshes can overlap; only the newest fetch may apply its result.
  const fetchSeq = useRef(0)

  const fetchAll = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    const seq = ++fetchSeq.current
    try {
      const [inc, out, notif] = await Promise.all([
        api.get("/api/requests", { params: { box: "incoming" } }),
        api.get("/api/requests", { params: { box: "outgoing" } }),
        api.get("/api/requests/notifications"),
      ])
      if (seq !== fetchSeq.current) return
      const notifList: Notification[] = notif.data?.data ?? []
      setIncoming(inc.data?.data ?? [])
      setOutgoing(out.data?.data ?? [])
      setNotifications(notifList)
      if (!tabPicked.current) {
        tabPicked.current = true
        const newest = notifList.find((n) => !n.read) // the feed is newest-first
        if (newest) setTab(tabOf(newest))
      }
    } catch (error) {
      console.log(error)
      // Background refreshes stay silent — the next event or focus retries.
      if (!quiet) toast.error("Failed to load requests")
    } finally {
      if (seq === fetchSeq.current) setLoading(false)
    }
  }, [])

  // Load, then refetch live the moment a request or notification changes
  // (lib/requestsLive.ts) and whenever the tab comes back into view.
  useEffect(() => {
    fetchAll()
    const onLive = (e: Event) => {
      const { scopes } = (e as CustomEvent<RequestsLiveDetail>).detail
      if (scopes.every((s) => s === "read")) return // read-state only moves the badge
      fetchAll({ quiet: true })
    }
    const onVisible = () => {
      setPageVisible(!document.hidden)
      if (!document.hidden) fetchAll({ quiet: true })
    }
    window.addEventListener(REQUESTS_LIVE_EVENT, onLive)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.removeEventListener(REQUESTS_LIVE_EVENT, onLive)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [fetchAll])

  // Seeing a tab reads its alerts: once the page is on screen, the unread notifications
  // the open tab shows (Activity shows them all) are marked read, including ones that
  // arrive live. Other tabs keep their red counts — and the sidebar badge — until opened.
  const marking = useRef(new Set<string>())
  useEffect(() => {
    if (!pageVisible) return
    const ids = notifications
      .filter(
        (n) =>
          !n.read &&
          !seenIds.has(n._id) &&
          !marking.current.has(n._id) &&
          (tab === "activity" || tabOf(n) === tab)
      )
      .map((n) => n._id)
    if (ids.length === 0) return
    ids.forEach((id) => marking.current.add(id))
    api
      .post("/api/requests/notifications/read", { ids })
      .then(() => {
        setSeenIds((prev) => new Set([...prev, ...ids]))
        window.dispatchEvent(new Event("requests:updated"))
      })
      .catch(() => {
        /* best-effort — retried on the next refresh */
      })
      .finally(() => ids.forEach((id) => marking.current.delete(id)))
  }, [tab, notifications, seenIds, pageVisible])

  // After jumping to a request from Activity: bring its card into view, ring it briefly.
  useEffect(() => {
    if (!focusReqId) return
    document.getElementById(`req-${focusReqId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
    const t = window.setTimeout(() => setFocusReqId(null), 1600)
    return () => window.clearTimeout(t)
  }, [focusReqId])

  const act = async (
    id: string,
    action: "accept" | "reject" | "cancel",
    note?: string,
    choice?: AcceptChoice
  ) => {
    setBusyId(id)
    try {
      const res = await api.post(
        `/api/requests/${id}/${action}`,
        action === "reject" && note ? { note } : action === "accept" && choice ? choice : {}
      )
      toast.success(res.data?.message || "Done")
      await fetchAll()
      window.dispatchEvent(new Event("requests:updated"))
    } catch (error) {
      if (axios.isAxiosError(error)) {
        toast.error(error.response?.data?.message || "Action failed")
        // On a stale/expired request, refresh so the UI reflects reality.
        if (error.response?.status === 409 || error.response?.status === 404) await fetchAll()
      } else {
        toast.error("Action failed")
      }
    } finally {
      setBusyId(null)
    }
  }

  const pendingIncoming = incoming.filter((r) => r.status === "pending")
  const pendingOutgoing = outgoing.filter((r) => r.status === "pending")

  // New this visit = still unread, or read here during this visit.
  const isNew = useCallback((n: Notification) => !n.read || seenIds.has(n._id), [seenIds])

  // Tab alerts. With pending incoming decisions these add up to the sidebar badge
  // (whose unread count leaves out "request_received" — those ARE the pending requests).
  const unseenCount = (key: Tab) =>
    notifications.filter((n) => !n.read && !seenIds.has(n._id) && tabOf(n) === key).length

  // Requests a new notification points at, per tab — their cards get a "New"/"Updated" pill.
  const newRequestIds = useMemo(() => {
    const ids: Record<Tab, Set<string>> = { incoming: new Set(), sent: new Set(), activity: new Set() }
    for (const n of notifications) {
      if (n.relatedRequest && isNew(n)) ids[tabOf(n)].add(n.relatedRequest)
    }
    return ids
  }, [notifications, isNew])

  // "Today" partitioning. A still-pending request stays visible even if older than
  // today — it's actionable and shouldn't hide behind "Show older"; only resolved
  // history collapses. Activity items collapse purely by their date. Anything new
  // stays visible too, so a tab's alert is never hidden behind "Show older".
  const todayLocal = getCurrentTargetDateString()
  const visibleIncoming = useMemo(
    () =>
      incoming.filter(
        (r) => r.dateLocal === todayLocal || r.status === "pending" || newRequestIds.incoming.has(r._id)
      ),
    [incoming, todayLocal, newRequestIds]
  )
  const visibleOutgoing = useMemo(
    () =>
      outgoing.filter(
        (r) => r.dateLocal === todayLocal || r.status === "pending" || newRequestIds.sent.has(r._id)
      ),
    [outgoing, todayLocal, newRequestIds]
  )
  const visibleNotifications = useMemo(
    () => notifications.filter((n) => toLocalDateString(n.createdAt) === todayLocal || isNew(n)),
    [notifications, todayLocal, isNew]
  )

  // Where an Activity item leads: its request's card in Incoming/Sent, else the page the
  // notification links to (a site's attendance for transferred in / out), else nowhere.
  const activityTarget = (n: Notification): string | null => {
    const t = tabOf(n)
    if (t !== "activity" && n.relatedRequest) return `View in ${TAB_LABEL[t]}`
    if (n.url && n.url !== "/requests") return "Open site"
    return null
  }

  const openActivityItem = (n: Notification) => {
    const t = tabOf(n)
    if (t !== "activity" && n.relatedRequest) {
      const id = n.relatedRequest
      const [all, visible] = t === "incoming" ? [incoming, visibleIncoming] : [outgoing, visibleOutgoing]
      if (all.some((r) => r._id === id) && !visible.some((r) => r._id === id)) {
        setExpanded((e) => ({ ...e, [t]: true }))
      }
      selectTab(t)
      setFocusReqId(id)
      return
    }
    if (n.url && n.url !== "/requests") navigate(n.url)
  }

  /** `count` is informational (neutral pill); `alerts` is what needs attention (red, like the badge). */
  const tabButton = (key: Tab, label: string, { count = 0, alerts = 0 }: { count?: number; alerts?: number } = {}) => (
    <button
      onClick={() => selectTab(key)}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors inline-flex items-center gap-2 ${
        tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
      {count > 0 && (
        <span
          className={`inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold ${
            tab === key ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/10 text-primary"
          }`}
        >
          {count}
        </span>
      )}
      {alerts > 0 && (
        <span
          aria-label={`${alerts} new`}
          className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-semibold"
        >
          {alerts}
        </span>
      )}
    </button>
  )

  if (loading) {
    return (
      <div className="flex justify-center items-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <Card>
        <CardHeader>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Inbox className="h-7 w-7 text-primary" />
            Requests
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cross-site transfer requests for today's roster.
            {user?.role !== "supervisor" && " You can see every site's requests and decide any of them."}
          </p>
        </CardHeader>
      </Card>

      <div className="flex flex-wrap gap-2">
        {tabButton("incoming", "Incoming", { alerts: pendingIncoming.length })}
        {tabButton("sent", "Sent", { count: pendingOutgoing.length, alerts: unseenCount("sent") })}
        {tabButton("activity", "Activity", { alerts: unseenCount("activity") })}
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          {tab === "incoming" && (
            <CollapsibleList
              all={incoming}
              visible={visibleIncoming}
              expanded={expanded.incoming}
              onToggle={() => toggleExpanded("incoming")}
              emptyIcon={Inbox}
              emptyText="No incoming requests."
              renderItem={(req) => (
                <RequestCard
                  key={req._id}
                  req={req}
                  highlight={newRequestIds.incoming.has(req._id) ? "New" : undefined}
                  flash={focusReqId === req._id}
                >
                  {req.status === "pending" ? (
                    <IncomingActions
                      req={req}
                      busy={busyId === req._id}
                      onAct={(action, note, choice) => act(req._id, action, note, choice)}
                    />
                  ) : (
                    req.note && <p className="text-xs text-muted-foreground italic pt-1">{req.note}</p>
                  )}
                </RequestCard>
              )}
            />
          )}

          {tab === "sent" && (
            <CollapsibleList
              all={outgoing}
              visible={visibleOutgoing}
              expanded={expanded.sent}
              onToggle={() => toggleExpanded("sent")}
              emptyIcon={Send}
              emptyText="You haven't sent any requests."
              renderItem={(req) => (
                <RequestCard
                  key={req._id}
                  req={req}
                  highlight={newRequestIds.sent.has(req._id) ? "Updated" : undefined}
                  flash={focusReqId === req._id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <span
                      className="text-xs text-muted-foreground"
                      title={(req.deciders ?? []).map((d) => d.name).join(", ") || undefined}
                    >
                      {awaitingText(req)}
                    </span>
                    {req.status === "pending" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === req._id}
                        onClick={() => act(req._id, "cancel")}
                      >
                        {busyId === req._id ? (
                          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        ) : (
                          <X className="h-4 w-4 mr-1.5" />
                        )}
                        Cancel
                      </Button>
                    )}
                  </div>
                </RequestCard>
              )}
            />
          )}

          {tab === "activity" && (
            <CollapsibleList
              all={notifications}
              visible={visibleNotifications}
              expanded={expanded.activity}
              onToggle={() => toggleExpanded("activity")}
              emptyIcon={Bell}
              emptyText="No activity yet."
              renderItem={(n) => {
                const fresh = isNew(n)
                const target = activityTarget(n)
                const cardCls = `block w-full text-left rounded-xl border p-4 shadow-sm ${
                  fresh ? "border-primary/40 bg-primary/5" : "border-border bg-card"
                }`
                const content = (
                  <span className="flex items-start gap-3">
                    <Bell className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-sm text-foreground">{n.title}</span>
                        {fresh && <NewPill />}
                      </span>
                      {n.body && <span className="block text-xs text-muted-foreground mt-0.5">{n.body}</span>}
                      <span className="block text-[11px] text-muted-foreground/70 mt-1">
                        {new Date(n.createdAt).toLocaleString()}
                      </span>
                    </span>
                    {target && (
                      <span className="shrink-0 inline-flex items-center gap-0.5 text-xs font-medium text-primary whitespace-nowrap">
                        {target}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </span>
                )
                return target ? (
                  <button
                    key={n._id}
                    type="button"
                    onClick={() => openActivityItem(n)}
                    className={`${cardCls} transition-colors hover:border-primary/60 hover:bg-muted/40`}
                  >
                    {content}
                  </button>
                ) : (
                  <div key={n._id} className={cardCls}>
                    {content}
                  </div>
                )
              }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
