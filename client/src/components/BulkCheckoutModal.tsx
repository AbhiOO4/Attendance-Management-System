// BulkCheckoutModal.tsx
//
// Close MANY open (checked-in, never-checked-out) sessions at once with ONE shared
// check-out time. Opened from the Edit-Past-Attendance page after the user picks
// unclosed rows in bulk-selection mode. It applies the time to EACH selected record's
// LATEST open session only (the server enforces this), on that record's own business day.
//
// Recovery tool for sessions the auto-checkout cron never closed (server was down, or the
// site had no default check-out for the category). By default the check-out auto-rolls to
// the next day when it reads before an employee's check-in (mirrors the cron); the optional
// "+1 next day" pill forces a next-day close for a genuine standalone early-morning tail.
//
// Posts to POST /api/attendance/bulk-checkout, which returns a per-record result
// (closed / skipped / failed) shown here on completion. The live preview flags any row
// whose resulting shift would be non-positive or exceed the 26h max as "will be skipped".

import { useEffect, useMemo, useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  LogOut,
  Moon,
} from "lucide-react"

import { api } from "@/lib/api"
import toast from "react-hot-toast"
import {
  toLocalTimeString,
  formatLocalTime12h,
  deriveOffsets,
  hoursFromOffset,
  formatOffsetDayLabel,
  MAX_SHIFT_HOURS,
} from "@/lib/dateUtils"

interface CheckoutSession {
  _id: string
  checkIn?: string | null
  checkOut?: string | null
  siteName?: string
}

export interface CheckoutRecord {
  attendanceId: string
  name: string
  employeeId: string
  sessions: CheckoutSession[]
}

interface BulkCheckoutResultEntry {
  attendanceId: string
  employeeId: string | null
  name: string | null
  reason?: string
  message?: string
}

export interface BulkCheckoutResult {
  success: boolean
  message: string
  summary: { closedCount: number; skippedCount: number; failedCount: number }
  closed: BulkCheckoutResultEntry[]
  skipped: BulkCheckoutResultEntry[]
  failed: BulkCheckoutResultEntry[]
}

interface BulkCheckoutModalProps {
  open: boolean
  onClose: () => void
  date: string // YYYY-MM-DD (the viewed business day)
  records: CheckoutRecord[] // the selected unclosed rows
  onCompleted: (result: BulkCheckoutResult) => void
}

// Latest open session = checked in, no check-out, max check-in.
function latestOpenSession(sessions: CheckoutSession[]): CheckoutSession | null {
  const open = sessions.filter((s) => s.checkIn && !s.checkOut)
  if (open.length === 0) return null
  return open.reduce((latest, s) =>
    new Date(s.checkIn as string).getTime() > new Date(latest.checkIn as string).getTime()
      ? s
      : latest
  )
}

function BulkCheckoutModal({
  open,
  onClose,
  date,
  records,
  onCompleted,
}: BulkCheckoutModalProps) {
  const [checkOut, setCheckOut] = useState("")
  const [forceNextDay, setForceNextDay] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<BulkCheckoutResult | null>(null)

  // Reset the form each time the modal opens.
  useEffect(() => {
    if (open) {
      setCheckOut("")
      setForceNextDay(false)
      setResult(null)
    }
  }, [open])

  // Per-record preview of the resulting close, computed with the same offset math the
  // server uses. When forceNextDay is off, the check-out auto-rolls to the next day only
  // when it reads before the check-in (deriveOffsets) — exactly the cron's rule.
  const previews = useMemo(() => {
    return records.map((record) => {
      const session = latestOpenSession(record.sessions)
      const inTime = session ? toLocalTimeString(session.checkIn) : ""
      let outNextDay = false
      let hours = 0
      if (inTime && checkOut) {
        outNextDay = forceNextDay
          ? true
          : deriveOffsets(inTime, checkOut, false).checkOutNextDay
        hours = hoursFromOffset(inTime, checkOut, false, outNextDay)
      }
      const invalid = !session || !checkOut || hours <= 0 || hours > MAX_SHIFT_HOURS
      return { record, session, inTime, outNextDay, hours, invalid }
    })
  }, [records, checkOut, forceNextDay])

  const skipCount = useMemo(
    () => (checkOut ? previews.filter((p) => p.invalid).length : 0),
    [previews, checkOut]
  )
  const willCloseCount = previews.length - skipCount

  const canSubmit = !!checkOut && records.length > 0

  const submit = async () => {
    if (!canSubmit) {
      if (!checkOut) toast.error("Enter a check-out time")
      return
    }

    setSaving(true)
    try {
      const payload: {
        attendanceIds: string[]
        checkOut: string
        checkOutNextDay?: boolean
      } = {
        attendanceIds: records.map((r) => r.attendanceId),
        checkOut,
      }
      // Only send the flag when the user forces it — otherwise the server auto-derives
      // per record (respecting each session's own check-in offset).
      if (forceNextDay) payload.checkOutNextDay = true

      const res = await api.post<BulkCheckoutResult>("/api/attendance/bulk-checkout", payload)
      const data = res.data

      onCompleted(data)

      const { closedCount, skippedCount, failedCount } = data.summary
      if (closedCount > 0) {
        toast.success(
          `Checked out ${closedCount} employee${closedCount === 1 ? "" : "s"}` +
            (skippedCount || failedCount
              ? ` · ${skippedCount} skipped, ${failedCount} failed`
              : "")
        )
      } else {
        toast.error("No sessions were closed — see details.")
      }

      // Clean run → close; otherwise show the result breakdown so nothing is silent.
      if (skippedCount === 0 && failedCount === 0) {
        onClose()
      } else {
        setResult(data)
      }
    } catch (error: any) {
      console.log(error)
      toast.error(error?.response?.data?.message || "Failed to bulk check out")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="!w-[95vw] !max-w-[540px] max-h-[90vh] overflow-hidden p-0 flex flex-col rounded-2xl">
        {/* HEADER */}
        <div className="border-b px-5 py-4 sm:px-6">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <LogOut className="h-4 w-4 text-primary" />
              </div>
              <DialogTitle className="text-lg font-semibold">Bulk Check-Out</DialogTitle>
            </div>
          </DialogHeader>
          <p className="mt-2 text-sm text-muted-foreground">
            Closing the latest open session of{" "}
            <span className="font-medium text-foreground">
              {records.length} employee{records.length === 1 ? "" : "s"}
            </span>{" "}
            with one check-out time.
          </p>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6 space-y-5">
          {result ? (
            // ---------------- RESULT VIEW ----------------
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border bg-emerald-500/10 p-3">
                  <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                    {result.summary.closedCount}
                  </div>
                  <div className="text-xs text-muted-foreground">Closed</div>
                </div>
                <div className="rounded-lg border bg-amber-500/10 p-3">
                  <div className="text-xl font-bold text-amber-600 dark:text-amber-400">
                    {result.summary.skippedCount}
                  </div>
                  <div className="text-xs text-muted-foreground">Skipped</div>
                </div>
                <div className="rounded-lg border bg-red-500/10 p-3">
                  <div className="text-xl font-bold text-red-600 dark:text-red-400">
                    {result.summary.failedCount}
                  </div>
                  <div className="text-xs text-muted-foreground">Failed</div>
                </div>
              </div>

              {result.skipped.length > 0 && (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4" /> Skipped
                  </p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {result.skipped.map((s) => (
                      <li key={s.attendanceId}>
                        <span className="font-medium text-foreground">{s.name || s.employeeId}</span>
                        {" — "}
                        {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.failed.length > 0 && (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-red-700 dark:text-red-400">
                    <AlertTriangle className="h-4 w-4" /> Failed
                  </p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {result.failed.map((f) => (
                      <li key={f.attendanceId}>
                        <span className="font-medium text-foreground">{f.name || f.employeeId}</span>
                        {" — "}
                        {f.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            // ---------------- FORM VIEW ----------------
            <>
              {/* Check-out time + next-day override */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Check Out <span className="text-red-500">*</span>
                </label>
                <Input
                  className="h-10 text-sm"
                  type="time"
                  value={checkOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                />
                {checkOut && (
                  <button
                    type="button"
                    onClick={() => setForceNextDay((prev) => !prev)}
                    className={`mt-1 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      forceNextDay
                        ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800/50 dark:bg-indigo-950/40 dark:text-indigo-300"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                    title="Force the check-out onto the next day (for a standalone early-morning tail). Off = auto-roll only when the time reads before the check-in."
                  >
                    {forceNextDay
                      ? `🌙 Check-out next day · ${formatOffsetDayLabel(date, 1)}`
                      : `Auto (same day unless it crosses midnight) · ${formatOffsetDayLabel(date, 0)}`}
                  </button>
                )}
              </div>

              {/* Summary line */}
              {checkOut && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{willCloseCount}</span> will be
                  closed
                  {skipCount > 0 && (
                    <>
                      {" · "}
                      <span className="font-medium text-amber-600 dark:text-amber-400">
                        {skipCount} will be skipped
                      </span>
                    </>
                  )}
                  .
                </p>
              )}

              {/* Per-employee preview */}
              <div className="rounded-xl border divide-y">
                {previews.map(({ record, outNextDay, hours, invalid, session }) => (
                  <div
                    key={record.attendanceId}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{record.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {session?.siteName ? `${session.siteName} · ` : ""}
                        in {session ? formatLocalTime12h(session.checkIn) : "—"}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {!checkOut ? (
                        <span className="text-xs text-muted-foreground">enter a time</span>
                      ) : invalid ? (
                        <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                          will be skipped
                        </span>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5">
                          {outNextDay && (
                            <Moon className="h-3 w-3 text-indigo-500" aria-label="next day" />
                          )}
                          <span className="text-xs text-muted-foreground">
                            out {checkOut}
                            {outNextDay ? " (+1)" : ""}
                          </span>
                          <span className="font-semibold">{hours} hrs</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                The time is applied to each employee's latest open session only. Anyone whose
                shift would be non-positive or exceed {MAX_SHIFT_HOURS}h is skipped and reported —
                close those individually.
              </p>
            </>
          )}
        </div>

        {/* FOOTER */}
        <div className="border-t px-5 py-3 sm:px-6 flex justify-end gap-2">
          {result ? (
            <Button size="sm" onClick={onClose}>
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              Done
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={submit} disabled={saving || !canSubmit}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <LogOut className="mr-1.5 h-3.5 w-3.5" />
                    Check out {willCloseCount}
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

export default BulkCheckoutModal
