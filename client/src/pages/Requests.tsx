import { useCallback, useEffect, useState } from "react"
import toast from "react-hot-toast"
import axios from "axios"

import { api } from "@/lib/api"
import { useAuth } from "@/context/AuthContext"

import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
  carriedCheckIn?: string | null
  status: RequestStatus
  requestedBy: Ref
  approver: Ref
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

      {children}
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

export default function Requests() {
  const { user } = useAuth()

  const [tab, setTab] = useState<Tab>("incoming")
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [incoming, setIncoming] = useState<TransferRequest[]>([])
  const [outgoing, setOutgoing] = useState<TransferRequest[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])

  const fetchAll = useCallback(async () => {
    try {
      const [inc, out, notif] = await Promise.all([
        api.get("/api/requests", { params: { box: "incoming" } }),
        api.get("/api/requests", { params: { box: "outgoing" } }),
        api.get("/api/requests/notifications"),
      ])
      setIncoming(inc.data?.data ?? [])
      setOutgoing(out.data?.data ?? [])
      setNotifications(notif.data?.data ?? [])
    } catch (error) {
      console.log(error)
      toast.error("Failed to load requests")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  // Visiting the page counts as "seen" — clear the unread badge.
  useEffect(() => {
    let cancelled = false
    const markRead = async () => {
      try {
        await api.post("/api/requests/notifications/read", {})
        if (!cancelled) window.dispatchEvent(new Event("requests:updated"))
      } catch {
        /* ignore */
      }
    }
    markRead()
    return () => {
      cancelled = true
    }
  }, [])

  const act = async (id: string, action: "accept" | "reject" | "cancel") => {
    setBusyId(id)
    try {
      const res = await api.post(`/api/requests/${id}/${action}`)
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
            {user?.role !== "supervisor" && " You also handle requests for sites without a supervisor."}
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
          {tab === "incoming" &&
            (incoming.length === 0 ? (
              <EmptyState icon={Inbox} text="No incoming requests." />
            ) : (
              incoming.map((req) => (
                <RequestCard key={req._id} req={req}>
                  {req.status === "pending" ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span className="text-xs text-muted-foreground">
                        Requested by {req.requestedBy?.name || "a supervisor"}
                      </span>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === req._id}
                          onClick={() => act(req._id, "reject")}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          <X className="h-4 w-4 mr-1.5" />
                          Reject
                        </Button>
                        <Button size="sm" disabled={busyId === req._id} onClick={() => act(req._id, "accept")}>
                          {busyId === req._id ? (
                            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4 mr-1.5" />
                          )}
                          Accept
                        </Button>
                      </div>
                    </div>
                  ) : (
                    req.note && <p className="text-xs text-muted-foreground italic pt-1">{req.note}</p>
                  )}
                </RequestCard>
              ))
            ))}

          {tab === "sent" &&
            (outgoing.length === 0 ? (
              <EmptyState icon={Send} text="You haven't sent any requests." />
            ) : (
              outgoing.map((req) => (
                <RequestCard key={req._id} req={req}>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <span className="text-xs text-muted-foreground">
                      {req.approver?.name ? `Awaiting ${req.approver.name}` : "Awaiting an admin"}
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
              ))
            ))}

          {tab === "activity" &&
            (notifications.length === 0 ? (
              <EmptyState icon={Bell} text="No activity yet." />
            ) : (
              notifications.map((n) => (
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
              ))
            ))}
        </CardContent>
      </Card>
    </div>
  )
}
