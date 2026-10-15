import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import toast from "react-hot-toast"

import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  apiErrorMessage,
  dayCount,
  fmtLeaveDay,
  fmtLeaveRange,
  LEAVE_TYPE_LABEL,
  toDateInput,
  type EmployeeRef,
  type LeaveApplication,
  type LeaveBalance,
  type LeaveType,
} from "@/lib/leave"
import EmployeePicker from "@/components/leave/EmployeePicker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface PreviewAllocation {
  _id: string
  fromDate: string
  toDate: string
  days: number
  used: number
  remaining: number
  requested: number
}

interface PreviewData {
  type: LeaveType
  workingDays: number
  holidayDays: number
  conflictDays: string[]
  alreadyLeaveDays: string[]
  // Annual: the allocations this range draws on, usage BEFORE this application.
  allocations: PreviewAllocation[]
  unallocatedDays: string[]
  violations: { allocationId: string; fromDate: string; toDate: string; requested: number; remaining: number }[]
  wouldExceed: boolean
  // Emergency: days already taken in each touched year.
  usedByYear?: Record<string, number>
}

const TYPE_HINT: Record<LeaveType, string> = {
  annual: "Paid. Uses the employee's annual leave allocation.",
  emergency: "Unpaid and excused, like sick leave. No limit and no allocation needed.",
}

// Create or edit a leave application: employee, type (annual | emergency), from–to and
// a note. Only working days are marked (weekly/public holidays and days already worked
// are skipped, server-side); annual days must fit the allocations covering them. The
// live preview shows exactly what will be marked before submitting. When editing, the
// employee is fixed and the application's own days count as free in the preview.
export default function LeaveApplicationDialog({
  open,
  onOpenChange,
  application,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The application being edited, or null to create one.
  application: LeaveApplication | null
  onSaved: () => void | Promise<void>
}) {
  const isEdit = !!application
  const [employee, setEmployee] = useState<EmployeeRef | null>(null)
  const [type, setType] = useState<LeaveType>("annual")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [note, setNote] = useState("")

  const [balance, setBalance] = useState<LeaveBalance | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (!open) return
    setPreview(null)
    setPreviewError(null)
    if (application) {
      setEmployee(
        application.employee && typeof application.employee === "object"
          ? application.employee
          : null
      )
      setType(application.type || "annual")
      setFrom(toDateInput(application.fromDate))
      setTo(toDateInput(application.toDate))
      setNote(application.note || "")
    } else {
      setEmployee(null)
      setType("annual")
      setFrom("")
      setTo("")
      setNote("")
    }
  }, [open, application])

  // The picked employee's balance (allocations + emergency days this year).
  const employeeId = employee?._id
  useEffect(() => {
    if (!open || !employeeId) {
      setBalance(null)
      return
    }
    let cancelled = false
    setBalanceLoading(true)
    api
      .get(`/api/attendance/leave/balance/${employeeId}`)
      .then((res) => {
        if (!cancelled) setBalance(res.data.data || null)
      })
      .catch(() => {
        if (!cancelled) setBalance(null)
      })
      .finally(() => {
        if (!cancelled) setBalanceLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, employeeId])

  const rangeValid = useMemo(() => {
    if (!from || !to) return false
    return new Date(from).getTime() <= new Date(to).getTime()
  }, [from, to])

  // Debounced live preview whenever an employee and a valid range are set. A failure
  // is shown inline (not as a toast): while a year is typed digit by digit the inputs
  // briefly hold dates like 0002-09-30, and those transient ranges shouldn't pop toasts.
  const editingId = application?._id
  useEffect(() => {
    if (!open || !rangeValid || !employeeId) {
      setPreview(null)
      setPreviewError(null)
      return
    }
    let cancelled = false
    setPreviewing(true)
    const t = setTimeout(async () => {
      try {
        const res = await api.get("/api/attendance/leave/preview", {
          params: { employeeId, from, to, type, excludeLeaveId: editingId },
        })
        if (!cancelled) {
          setPreview(res.data.data || null)
          setPreviewError(null)
        }
      } catch (error) {
        if (!cancelled) {
          setPreview(null)
          setPreviewError(apiErrorMessage(error, "Failed to preview leave"))
        }
      } finally {
        if (!cancelled) setPreviewing(false)
      }
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [open, rangeValid, from, to, employeeId, type, editingId])

  const canSubmit =
    !!employee &&
    rangeValid &&
    !!preview &&
    preview.workingDays > 0 &&
    !preview.wouldExceed &&
    !previewing &&
    !submitting

  const handleSubmit = async () => {
    if (!canSubmit || !employee) return
    try {
      setSubmitting(true)
      if (application) {
        const res = await api.put(`/api/attendance/leave/${application._id}`, { from, to, type, note })
        toast.success(res.data?.message || "Leave updated")
      } else {
        const res = await api.post("/api/attendance/leave", {
          employeeId: employee._id,
          from,
          to,
          note,
          type,
        })
        toast.success(res.data?.message || "Leave granted")
      }
      onOpenChange(false)
      await onSaved()
    } catch (error) {
      toast.error(apiErrorMessage(error, "Failed to save leave"))
    } finally {
      setSubmitting(false)
    }
  }

  const isEmergency = type === "emergency"

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit leave application" : "New leave application"}</DialogTitle>
          <DialogDescription>
            The marked days are locked on the attendance sheets until the leave is edited or
            cancelled here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="leave-employee">Employee</Label>
            <EmployeePicker
              id="leave-employee"
              value={employee}
              onChange={setEmployee}
              disabled={isEdit}
            />
          </div>

          {employee && (
            <BalancePanel
              balance={balance}
              loading={balanceLoading}
              type={type}
              ownAnnualDays={
                application?.status === "active" && (application.type || "annual") === "annual"
                  ? application.workingDays
                  : 0
              }
            />
          )}

          <div className="space-y-1.5">
            <Label htmlFor="leave-type">Leave type</Label>
            <Select value={type} onValueChange={(v) => setType(v as LeaveType)}>
              <SelectTrigger id="leave-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="annual">Annual leave (paid)</SelectItem>
                <SelectItem value="emergency">Emergency leave (unpaid)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{TYPE_HINT[type]}</p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="leave-from">From</Label>
              <Input
                id="leave-from"
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="leave-to">To</Label>
              <Input
                id="leave-to"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="leave-note">Note (optional)</Label>
            <Textarea
              id="leave-note"
              placeholder={isEmergency ? "Reason for emergency leave" : "Reason for leave"}
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {from && to && !rangeValid && (
            <p className="text-sm text-destructive">"From" must be on or before "To".</p>
          )}

          {rangeValid && employee && (
            <div className="rounded-lg border px-3 py-2 text-sm">
              {previewing ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Calculating…
                </div>
              ) : preview ? (
                <PreviewSummary preview={preview} />
              ) : previewError ? (
                <p className="text-destructive">{previewError}</p>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? "Save changes" : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// The picked employee's leave balance: annual allocations (the one covering today
// highlighted) or, for emergency leave, the days taken this year. `ownAnnualDays` = the
// annual days of the application being edited, which the figures still count as used.
function BalancePanel({
  balance,
  loading,
  type,
  ownAnnualDays,
}: {
  balance: LeaveBalance | null
  loading: boolean
  type: LeaveType
  ownAnnualDays: number
}) {
  if (loading && !balance) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading leave balance…
      </div>
    )
  }
  if (!balance) return null

  if (type === "emergency") {
    return (
      <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
        <span className="font-medium">Emergency leave {balance.year}:</span>{" "}
        <span className="font-semibold text-orange-700 dark:text-orange-400">
          {balance.emergencyUsed}
        </span>{" "}
        day(s) taken · unpaid, no limit
      </div>
    )
  }

  if (balance.allocations.length === 0) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
        No annual leave allocated to this employee. Add an allocation on the Allocations tab first.
      </div>
    )
  }

  // The current allocation first, then the rest (newest first), at most three.
  const currentId = balance.current?._id
  const rows = [
    ...(balance.current ? [balance.current] : []),
    ...balance.allocations.filter((a) => a._id !== currentId),
  ].slice(0, 3)

  return (
    <div className="space-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
      <p className="font-medium">Annual leave balance</p>
      {rows.map((a) => (
        <div key={a._id} className="flex items-center justify-between gap-3">
          <span className={cn("text-muted-foreground", a._id === currentId && "text-foreground")}>
            {fmtLeaveRange(a.fromDate, a.toDate)}
            {a._id === currentId && " (current)"}
          </span>
          <span>
            <b
              className={cn(
                "font-semibold",
                a.remaining > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"
              )}
            >
              {a.remaining}
            </b>{" "}
            of {a.days} left
          </span>
        </div>
      ))}
      {ownAnnualDays > 0 && (
        <p className="text-xs text-muted-foreground">
          Includes the {dayCount(ownAnnualDays)} of this application.
        </p>
      )}
      {balance.allocations.length > rows.length && (
        <p className="text-xs text-muted-foreground">
          +{balance.allocations.length - rows.length} older allocation(s)
        </p>
      )}
    </div>
  )
}

function PreviewSummary({ preview }: { preview: PreviewData }) {
  const isEmergency = preview.type === "emergency"
  const violationById = new Map(preview.violations.map((v) => [String(v.allocationId), v]))

  return (
    <div className="space-y-1">
      <p>
        <span className="font-semibold">{dayCount(preview.workingDays)}</span> will be marked as{" "}
        {LEAVE_TYPE_LABEL[preview.type].toLowerCase()} leave
        {isEmergency ? " (unpaid)." : " (paid)."}
      </p>
      {preview.holidayDays > 0 && (
        <p className="text-muted-foreground">{preview.holidayDays} holiday(s) skipped.</p>
      )}
      {preview.conflictDays.length > 0 && (
        <p className="text-amber-600 dark:text-amber-400">
          {preview.conflictDays.length} day(s) skipped — the employee already worked.
        </p>
      )}
      {preview.alreadyLeaveDays.length > 0 && (
        <p className="text-muted-foreground">
          {preview.alreadyLeaveDays.length} day(s) already on another leave.
        </p>
      )}

      {!isEmergency &&
        preview.allocations.map((a) => {
          const over = violationById.get(String(a._id))
          return (
            <p key={a._id} className={over ? "font-medium text-destructive" : "text-muted-foreground"}>
              Allocation {fmtLeaveRange(a.fromDate, a.toDate)}: uses {a.requested} of {a.remaining}{" "}
              left
              {over ? ` — exceeds the balance by ${a.requested - a.remaining}.` : "."}
            </p>
          )
        })}
      {!isEmergency && preview.unallocatedDays.length > 0 && (
        <p className="font-medium text-destructive">
          {dayCount(preview.unallocatedDays.length)} not covered by any annual leave allocation (
          {preview.unallocatedDays.slice(0, 3).map((d) => fmtLeaveDay(d)).join(", ")}
          {preview.unallocatedDays.length > 3 ? ", …" : ""}).
        </p>
      )}

      {isEmergency &&
        Object.entries(preview.usedByYear || {}).map(([yr, used]) => (
          <p key={yr} className="text-muted-foreground">
            {yr}: {used} emergency day(s) taken before this application.
          </p>
        ))}

      {preview.workingDays === 0 && (
        <p className="font-medium text-destructive">No working days to mark in this range.</p>
      )}
    </div>
  )
}
