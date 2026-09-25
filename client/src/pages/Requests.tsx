import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import toast from "react-hot-toast"
import axios from "axios"

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
  read: boolean
  createdAt: string
}

type Tab = "incoming" | "sent" | "activity"

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

function RequestCard({
  req,
  children,
}: {
  req: TransferRequest
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-foreground truncate">
            {req.employee?.name || "Employee"}
            <span className="ml-2 font-mono text-xs text-muted-foreground">{req.employee?.employeeId}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{req.employee?.jobTitle}</div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
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

  const [tab, setTab] = useState<Tab>("incoming")
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
      setIncoming(inc.data?.data ?? [])
      setOutgoing(out.data?.data ?? [])
      setNotifications(notif.data?.data ?? [])
    } catch (error) {
      console.log(error)
      // Background refreshes stay silent — the next event or focus retries.
      if (!quiet) toast.error("Failed to load requests")
    } finally {
      if (seq === fetchSeq.current) setLoading(false)
    }
  }, [])

  // Seeing the page counts as "seen" — clear the unread badge.
  const markRead = useCallback(async () => {
    try {
      await api.post("/api/requests/notifications/read", {})
      window.dispatchEvent(new Event("requests:updated"))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    fetchAll()
    markRead()
  }, [fetchAll, markRead])

  // Live: refetch the moment a request or notification changes (lib/requestsLive.ts)
  // and whenever the tab comes back into view. Activity that arrives while the page is
  // on screen counts as seen, just like opening the page.
  useEffect(() => {
    const onLive = (e: Event) => {
      const { scopes } = (e as CustomEvent<RequestsLiveDetail>).detail
      if (scopes.every((s) => s === "read")) return // read-state only moves the badge
      fetchAll({ quiet: true })
      if (!document.hidden && (scopes.includes("notifications") || scopes.includes("resync"))) {
        markRead()
      }
    }
    const onVisible = () => {
      if (document.hidden) return
      fetchAll({ quiet: true })
      markRead()
    }
    window.addEventListener(REQUESTS_LIVE_EVENT, onLive)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.removeEventListener(REQUESTS_LIVE_EVENT, onLive)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [fetchAll, markRead])

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

  // "Today" partitioning. A still-pending request stays visible even if older than
  // today — it's actionable and shouldn't hide behind "Show older"; only resolved
  // history collapses. Activity items collapse purely by their date.
  const todayLocal = getCurrentTargetDateString()
  const visibleIncoming = useMemo(
    () => incoming.filter((r) => r.dateLocal === todayLocal || r.status === "pending"),
    [incoming, todayLocal]
  )
  const visibleOutgoing = useMemo(
    () => outgoing.filter((r) => r.dateLocal === todayLocal || r.status === "pending"),
    [outgoing, todayLocal]
  )
  const visibleNotifications = useMemo(
    () => notifications.filter((n) => toLocalDateString(n.createdAt) === todayLocal),
    [notifications, todayLocal]
  )

  const tabButton = (key: Tab, label: string, count?: number) => (
    <button
      onClick={() => setTab(key)}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors inline-flex items-center gap-2 ${
        tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
      {typeof count === "number" && count > 0 && (
        <span
          className={`inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold ${
            tab === key ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/10 text-primary"
          }`}
        >
          {count}
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
        {tabButton("incoming", "Incoming", pendingIncoming.length)}
        {tabButton("sent", "Sent", pendingOutgoing.length)}
        {tabButton("activity", "Activity")}
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
                <RequestCard key={req._id} req={req}>
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
                <RequestCard key={req._id} req={req}>
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
              renderItem={(n) => (
                <div key={n._id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <Bell className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-sm text-foreground">{n.title}</div>
                      {n.body && <div className="text-xs text-muted-foreground mt-0.5">{n.body}</div>}
                      <div className="text-[11px] text-muted-foreground/70 mt-1">
                        {new Date(n.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
