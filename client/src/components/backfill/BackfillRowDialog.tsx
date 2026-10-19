// BackfillRowDialog.tsx
//
// Enter the sessions of a backfill request row.
//  - bulk: the SAME sessions for every picked employee → POST /api/backfill-requests/rows
//    (creates the site/day draft on first use; per-employee added/skipped/failed result).
//  - edit: one existing row → PUT /api/backfill-requests/:id/rows/:employeeId
//    (supervisor while drafting, admin while it awaits approval).

import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { AlertTriangle, CheckCircle2, Loader2, Save, Users } from "lucide-react"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import BackfillSessionsForm from "@/components/backfill/BackfillSessionsForm"
import { api } from "@/lib/api"
import { formatFullDateLabel } from "@/lib/dateUtils"
import type { HolidayReason } from "@/lib/attendanceUtils"
import {
  emptySession,
  holidayReasonFor,
  notifyBackfillUpdated,
  sessionsError,
  toSessionPayload,
  type BackfillRequestDoc,
  type BackfillRow,
  type BackfillSession,
  type CandidateEmployee,
  type RowResultEntry,
  type SiteJob,
} from "@/lib/backfillRequests"

type BulkResult = {
  summary: { addedCount: number; updatedCount: number; skippedCount: number; failedCount: number }
  skipped: RowResultEntry[]
  failed: RowResultEntry[]
  data: BackfillRequestDoc | null
}

export type BackfillRowDialogTarget =
  | { mode: "bulk"; employees: CandidateEmployee[] }
  | { mode: "edit"; requestId: string; row: BackfillRow }

export default function BackfillRowDialog({
  open,
  onClose,
  target,
  date,
  siteId,
  siteName,
  siteJobs,
  holiday,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  target: BackfillRowDialogTarget | null
  date: string
  siteId: string
  siteName: string
  siteJobs: SiteJob[]
  holiday: { isHoliday: boolean; reason: HolidayReason } | null
  onSaved: (doc: BackfillRequestDoc | null) => void
}) {
  const [sessions, setSessions] = useState<BackfillSession[]>([emptySession()])
  const [breaksTaken, setBreaksTaken] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<BulkResult | null>(null)

  useEffect(() => {
    if (!open || !target) return
    if (target.mode === "edit") {
      setSessions(target.row.sessions.length ? target.row.sessions.map((s) => ({ ...s })) : [emptySession()])
      setBreaksTaken(target.row.breaksTaken ?? null)
    } else {
      setSessions([emptySession()])
      setBreaksTaken(null)
    }
    setResult(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open only
  }, [open])

  if (!target) return null

  const jobRequired = siteJobs.length > 0
  const error = sessionsError(sessions, jobRequired)
  const count = target.mode === "bulk" ? target.employees.length : 1
  // A single row previews with that employee's holiday treatment; a bulk apply with the day's.
  const holidayReason =
    target.mode === "edit"
      ? holidayReasonFor(holiday, target.row.employee?.employmentType)
      : holidayReasonFor(holiday, undefined)

  const submit = async () => {
    if (error) {
      toast.error(error)
      return
    }
    setSaving(true)
    try {
      if (target.mode === "bulk") {
        const res = await api.post<BulkResult>("/api/backfill-requests/rows", {
          siteId,
          date,
          employeeIds: target.employees.map((e) => e._id),
          sessions: toSessionPayload(sessions),
          breaksTaken,
        })
        const data = res.data
        onSaved(data.data)
        notifyBackfillUpdated()
        const saved = data.summary.addedCount + data.summary.updatedCount
        if (saved > 0) toast.success(`Added ${saved} employee${saved === 1 ? "" : "s"} to the draft`)
        else toast.error("Nobody was added — see details.")
        if (data.summary.skippedCount === 0 && data.summary.failedCount === 0) onClose()
        else setResult(data)
      } else {
        const res = await api.put<{ data: BackfillRequestDoc }>(
          `/api/backfill-requests/${target.requestId}/rows/${target.row.employee?._id}`,
          { sessions: toSessionPayload(sessions), breaksTaken }
        )
        onSaved(res.data.data)
        notifyBackfillUpdated()
        toast.success("Row updated")
        onClose()
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  const title =
    target.mode === "bulk"
      ? `Backfill ${count} employee${count === 1 ? "" : "s"}`
      : `Edit ${target.row.employee?.name || "row"}`

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onClose() }}>
      <DialogContent className="!w-[95vw] !max-w-[560px] max-h-[90vh] overflow-hidden p-0 flex flex-col rounded-2xl">
        <div className="border-b px-5 py-4 sm:px-6">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
            </div>
          </DialogHeader>
          <p className="mt-2 text-sm text-muted-foreground">
            {siteName} · {formatFullDateLabel(date)}
            {target.mode === "bulk" && " · the same sessions for everyone selected"}
          </p>
          {holiday?.isHoliday && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              This day is a {holiday.reason === "weekly" ? "weekly off day" : "public holiday"} — worked hours
              count as holiday hours (temporary workers: a normal day).
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {result ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border bg-emerald-500/10 p-3">
                  <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                    {result.summary.addedCount + result.summary.updatedCount}
                  </div>
                  <div className="text-xs text-muted-foreground">Added</div>
                </div>
                <div className="rounded-lg border bg-amber-500/10 p-3">
                  <div className="text-xl font-bold text-amber-600 dark:text-amber-400">{result.summary.skippedCount}</div>
                  <div className="text-xs text-muted-foreground">Skipped</div>
                </div>
                <div className="rounded-lg border bg-red-500/10 p-3">
                  <div className="text-xl font-bold text-red-600 dark:text-red-400">{result.summary.failedCount}</div>
                  <div className="text-xs text-muted-foreground">Failed</div>
                </div>
              </div>
              {(result.skipped.length > 0 || result.failed.length > 0) && (
                <ul className="space-y-1.5 text-xs text-muted-foreground">
                  {result.skipped.map((s) => (
                    <li key={`s-${s.employeeId}`} className="flex gap-1.5">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                      <span><span className="font-medium text-foreground">{s.name || s.employeeId}</span> — {s.reason}</span>
                    </li>
                  ))}
                  {result.failed.map((f) => (
                    <li key={`f-${f.employeeId}`} className="flex gap-1.5">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
                      <span><span className="font-medium text-foreground">{f.name || f.employeeId}</span> — {f.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <BackfillSessionsForm
              date={date}
              siteId={siteId}
              siteName={siteName}
              siteJobs={siteJobs}
              sessions={sessions}
              onSessionsChange={setSessions}
              breaksTaken={breaksTaken}
              onBreaksChange={setBreaksTaken}
              holidayReason={holidayReason}
            />
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3 sm:px-6">
          {result ? (
            <Button size="sm" onClick={onClose}>
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              Done
            </Button>
          ) : (
            <>
              {error && (sessions.some((s) => s.checkIn || s.checkOut) || sessions.length > 1) && (
                <span className="mr-auto line-clamp-2 text-xs text-red-500">{error}</span>
              )}
              <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={submit} disabled={saving || !!error}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    {target.mode === "bulk" ? `Add ${count} to draft` : "Save row"}
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
