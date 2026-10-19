// BackfillApprovals.tsx — /attendance/edit/backfill-requests
//
// Admin list of supervisor backfill requests (GET /api/backfill-requests), by status, with
// site + date filters. A row opens BackfillRequestDetail to review, edit, approve or reject.

import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import toast from "react-hot-toast"
import { ArrowLeft, ChevronRight, Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/lib/api"
import { formatFullDateLabel, formatLocalDateTime12h } from "@/lib/dateUtils"
import {
  BACKFILL_UPDATED_EVENT,
  STATUS_CLASS,
  STATUS_LABEL,
  type BackfillListItem,
  type BackfillStatus,
} from "@/lib/backfillRequests"

type Site = { _id: string; siteName: string }
type Tab = "submitted" | "approved" | "rejected" | "draft"

const TABS: { value: Tab; label: string }[] = [
  { value: "submitted", label: "Awaiting approval" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Sent back" },
  { value: "draft", label: "Drafts" },
]

export default function BackfillApprovals() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>("submitted")
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<BackfillListItem[]>([])
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .get<Site[]>("/api/site")
      .then((res) => setSites(Array.isArray(res.data) ? res.data : []))
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<{ data: BackfillListItem[]; pagination: { totalPages: number } }>("/api/backfill-requests", {
        params: {
          status: tab,
          siteId: siteId === "all" ? undefined : siteId,
          from: from || undefined,
          to: to || undefined,
          page,
          limit: 20,
        },
      })
      setItems(res.data.data)
      setTotalPages(Math.max(res.data.pagination.totalPages, 1))
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to load backfill requests")
    } finally {
      setLoading(false)
    }
  }, [tab, siteId, from, to, page])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const onUpdate = () => load()
    window.addEventListener(BACKFILL_UPDATED_EVENT, onUpdate)
    return () => window.removeEventListener(BACKFILL_UPDATED_EVENT, onUpdate)
  }, [load])

  return (
    <div className="px-4 py-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <Button variant="ghost" size="sm" className="-ml-2 w-fit text-muted-foreground" onClick={() => navigate("/attendance/edit")}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to past attendance
        </Button>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Backfill approvals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Records supervisors drafted for past days. Nothing is in attendance until you approve it.
          </p>
        </div>

        <Tabs value={tab} onValueChange={(v) => { setTab(v as Tab); setPage(1) }}>
          <TabsList className="flex-wrap">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="grid gap-2 sm:grid-cols-3">
          <Select value={siteId} onValueChange={(v) => { setSiteId(v); setPage(1) }}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Site" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sites</SelectItem>
              {sites.map((s) => (
                <SelectItem key={s._id} value={s._id}>
                  {s.siteName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} aria-label="From date" />
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} aria-label="To date" />
        </div>

        <div className="min-h-[160px] divide-y rounded-xl border bg-background">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-40 items-center justify-center px-4 text-center text-sm text-muted-foreground">
              {tab === "submitted" ? "Nothing waiting for approval." : "No backfill requests here."}
            </div>
          ) : (
            items.map((item) => (
              <button
                key={item._id}
                type="button"
                onClick={() => navigate(`/attendance/edit/backfill-requests/${item._id}`)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {item.siteName} · {formatFullDateLabel(item.date)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.rowCount} employee{item.rowCount === 1 ? "" : "s"}
                    {item.submittedBy && item.submittedAt && ` · sent by ${item.submittedBy} ${formatLocalDateTime12h(item.submittedAt)}`}
                    {!item.submittedBy && item.createdBy && ` · drafted by ${item.createdBy}`}
                    {item.status === "approved" && item.approvalSummary &&
                      ` · ${item.approvalSummary.createdCount} created` +
                        (item.approvalSummary.skippedCount + item.approvalSummary.failedCount > 0
                          ? `, ${item.approvalSummary.skippedCount + item.approvalSummary.failedCount} not`
                          : "")}
                    {item.status === "rejected" && item.rejectionReason && ` · ${item.rejectionReason}`}
                  </p>
                </div>
                <Badge className={STATUS_CLASS[item.status as BackfillStatus]}>{STATUS_LABEL[item.status as BackfillStatus]}</Badge>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
