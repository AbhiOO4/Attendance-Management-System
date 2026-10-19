// BackfillDocumentView.tsx
//
// One backfill request (site + day): its status and history, then a row per employee with
// their sessions (job · in → out), the day's previewed totals and — after approval — what
// happened to the row. Rows can be edited/removed when the caller may edit (supervisor while
// drafting, admin while it awaits approval; `doc.permissions.editable`). Page-level actions
// (add, send, approve, reject) are passed in by the supervisor/admin pages.

import { useState, type ReactNode } from "react"
import toast from "react-hot-toast"
import { AlertTriangle, CheckCircle2, MoreVertical, Moon, Pencil, Trash2, XCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import BackfillRowDialog, { type BackfillRowDialogTarget } from "@/components/backfill/BackfillRowDialog"
import { StatusBadge } from "@/components/backfill/BackfillSessionsForm"
import { useWorkConfig } from "@/context/WorkConfigContext"
import { api } from "@/lib/api"
import { formatFullDateLabel, formatLocalDateTime12h, formatOffsetDayLabel } from "@/lib/dateUtils"
import {
  holidayReasonFor,
  notifyBackfillUpdated,
  previewDay,
  STATUS_CLASS,
  STATUS_LABEL,
  type BackfillRequestDoc,
  type BackfillRow,
} from "@/lib/backfillRequests"

export default function BackfillDocumentView({
  doc,
  onChanged,
  actions,
  emptyHint,
}: {
  doc: BackfillRequestDoc
  onChanged: (doc: BackfillRequestDoc) => void
  actions?: ReactNode
  emptyHint?: ReactNode
}) {
  const { config: workConfig } = useWorkConfig()
  const [editTarget, setEditTarget] = useState<BackfillRowDialogTarget | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const editable = doc.permissions.editable

  const removeRow = async (row: BackfillRow) => {
    if (!row.employee) return
    setRemoving(row.employee._id)
    try {
      const res = await api.delete<{ data: BackfillRequestDoc }>(
        `/api/backfill-requests/${doc._id}/rows/${row.employee._id}`
      )
      onChanged(res.data.data)
      notifyBackfillUpdated()
      toast.success(`Removed ${row.employee.name}`)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to remove")
    } finally {
      setRemoving(null)
    }
  }

  const totals = doc.rows.reduce(
    (acc, row) => {
      const p = previewDay(row.sessions, row.breaksTaken, workConfig, holidayReasonFor(doc.holiday, row.employee?.employmentType))
      acc.hours += p.netHours
      acc.ot += p.overtimeHours
      return acc
    },
    { hours: 0, ot: 0 }
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="space-y-3 rounded-xl border bg-background p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{doc.siteName}</h1>
              <Badge className={STATUS_CLASS[doc.status]}>{STATUS_LABEL[doc.status]}</Badge>
              {doc.holiday?.isHoliday && (
                <Badge variant="secondary">{doc.holiday.reason === "weekly" ? "Weekly off" : "Public holiday"}</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{formatFullDateLabel(doc.date)}</p>
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span>{doc.rows.length} employee{doc.rows.length === 1 ? "" : "s"}</span>
          <span>{Number(totals.hours.toFixed(2))} hrs total{totals.ot > 0 ? ` · ${Number(totals.ot.toFixed(2))} OT` : ""}</span>
          {doc.createdBy && <span>Drafted by {doc.createdBy.name}</span>}
          {doc.submittedBy && doc.submittedAt && (
            <span>Sent by {doc.submittedBy.name} · {formatLocalDateTime12h(doc.submittedAt)}</span>
          )}
          {doc.reviewedBy && doc.reviewedAt && doc.status !== "submitted" && (
            <span>
              {doc.status === "approved" ? "Approved" : "Reviewed"} by {doc.reviewedBy.name} · {formatLocalDateTime12h(doc.reviewedAt)}
            </span>
          )}
        </div>

        {doc.rejectionReason && (doc.status === "rejected" || doc.status === "draft") && (
          <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-medium">Sent back: </span>
              {doc.rejectionReason}
            </span>
          </div>
        )}

        {doc.status === "approved" && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge className={STATUS_CLASS.approved}>{doc.approvalSummary.createdCount} created</Badge>
            {doc.approvalSummary.skippedCount > 0 && (
              <Badge className={STATUS_CLASS.submitted}>{doc.approvalSummary.skippedCount} skipped</Badge>
            )}
            {doc.approvalSummary.failedCount > 0 && (
              <Badge className={STATUS_CLASS.rejected}>{doc.approvalSummary.failedCount} failed</Badge>
            )}
          </div>
        )}
      </div>

      {/* Rows */}
      {doc.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">
          {emptyHint || "No employees in this backfill yet."}
        </div>
      ) : (
        <div className="divide-y rounded-xl border bg-background">
          {doc.rows.map((row, index) => {
            const p = previewDay(row.sessions, row.breaksTaken, workConfig, holidayReasonFor(doc.holiday, row.employee?.employmentType))
            const key = row.employee?._id || `row-${index}`
            return (
              <div key={key} className="flex gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{row.employee?.name || "Unknown employee"}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.employee?.employeeId} · <span className="capitalize">{row.employee?.jobTitle}</span>
                    </span>
                    {row.offRoster && (
                      <Badge
                        variant="outline"
                        className="border-amber-300 text-[11px] text-amber-700 dark:border-amber-800 dark:text-amber-300"
                        title={row.employee?.currentSite ? `Now at ${row.employee.currentSite.siteName}` : "Not on any site now"}
                      >
                        Not on your site now
                      </Badge>
                    )}
                    <OutcomeChip row={row} />
                  </div>

                  <ul className="space-y-0.5 text-sm">
                    {row.sessions.map((s, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {s.checkIn}
                          {s.checkInNextDay && <sup className="ml-0.5 text-[10px]">+1</sup>} → {s.checkOut}
                          {s.checkOutNextDay && <sup className="ml-0.5 text-[10px]">+1</sup>}
                        </span>
                        {(s.checkInNextDay || s.checkOutNextDay) && (
                          <span className="inline-flex items-center gap-0.5 text-xs text-indigo-600 dark:text-indigo-300" title={`Ends ${formatOffsetDayLabel(doc.date, 1)}`}>
                            <Moon className="h-3 w-3" /> night
                          </span>
                        )}
                        <span className="text-xs">
                          {s.jobId ? [s.jobCode, s.jobName].filter(Boolean).join(" · ") + (s.isGlobalJob ? " (global)" : "") : "No job"}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <StatusBadge status={p.status} />
                    <span>{p.netHours} hrs</span>
                    {p.overtimeHours > 0 && <span>· {p.overtimeHours} OT</span>}
                    {p.holidayHours > 0 && <span>· {p.holidayHours} holiday</span>}
                    <span>· break {p.breaks ? "taken" : "none"}{row.breaksTaken === null ? " (auto)" : ""}</span>
                  </div>
                </div>

                {editable && row.employee && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={removing === row.employee._id}>
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditTarget({ mode: "edit", requestId: doc._id, row })}>
                        <Pencil className="h-4 w-4" />
                        Edit sessions
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => removeRow(row)}>
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            )
          })}
        </div>
      )}

      <BackfillRowDialog
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        target={editTarget}
        date={doc.date}
        siteId={doc.siteId}
        siteName={doc.siteName}
        siteJobs={doc.siteJobs}
        holiday={doc.holiday}
        onSaved={(next) => next && onChanged(next)}
      />
    </div>
  )
}

function OutcomeChip({ row }: { row: BackfillRow }) {
  if (!row.outcome) return null
  if (row.outcome === "created") {
    return (
      <Badge className={`${STATUS_CLASS.approved} gap-1 text-[11px]`}>
        <CheckCircle2 className="h-3 w-3" /> Created
      </Badge>
    )
  }
  return (
    <Badge
      className={`${row.outcome === "skipped" ? STATUS_CLASS.submitted : STATUS_CLASS.rejected} gap-1 text-[11px]`}
      title={row.outcomeMessage}
    >
      <AlertTriangle className="h-3 w-3" />
      {row.outcome === "skipped" ? "Skipped" : "Failed"}: {row.outcomeMessage}
    </Badge>
  )
}
