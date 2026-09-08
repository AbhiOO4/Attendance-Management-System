import { useEffect, useMemo, useState } from "react"
import { CalendarPlus, Loader2 } from "lucide-react"
import toast from "react-hot-toast"

import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog"

interface Props {
  employeeId: string
  employeeName: string
  // Called after a successful grant so the parent can refresh attendance + balance.
  onGranted: () => void | Promise<void>
  // Optional controlled mode: pass open/onOpenChange to drive the dialog from a
  // parent (e.g. a kebab menu item) and hideTrigger to drop the built-in button.
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}

interface PreviewData {
  workingDays: number
  holidayDays: number
  conflictDays: string[]
  alreadyLeaveDays: string[]
  entitlement: number
  remainingByYear: Record<string, number>
  wouldExceed: boolean
  violations: { year: number; requested: number; remaining: number }[]
}

interface BalanceData {
  year: number
  entitlement: number
  used: number
  remaining: number
  override: number | null
}

// Grant annual PAID leave over a from–to range. Only working days (weekly and
// public holidays excluded, server-side) consume the balance; the live preview
// reports exactly what will be deducted and skipped before the admin commits.
export default function GrantLeaveDialog({ employeeId, employeeName, onGranted, open: controlledOpen, onOpenChange, hideTrigger }: Props) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = (v: boolean) => {
    if (!isControlled) setInternalOpen(v)
    onOpenChange?.(v)
  }
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [note, setNote] = useState("")

  const [balance, setBalance] = useState<BalanceData | null>(null)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Reset the form each time the dialog opens, then load the current-year balance.
  useEffect(() => {
    if (!open) return
    setFrom("")
    setTo("")
    setNote("")
    setPreview(null)
    const loadBalance = async () => {
      try {
        const res = await api.get(`/api/attendance/leave/balance/${employeeId}`)
        setBalance(res.data.data || null)
      } catch {
        setBalance(null)
      }
    }
    loadBalance()
  }, [open, employeeId])

  const rangeValid = useMemo(() => {
    if (!from || !to) return false
    return new Date(from).getTime() <= new Date(to).getTime()
  }, [from, to])

  // Debounced live preview whenever a valid range is set.
  useEffect(() => {
    if (!open || !rangeValid) {
      setPreview(null)
      return
    }
    let cancelled = false
    setPreviewing(true)
    const t = setTimeout(async () => {
      try {
        const res = await api.get("/api/attendance/leave/preview", {
          params: { employeeId, from, to },
        })
        if (!cancelled) setPreview(res.data.data || null)
      } catch (error: any) {
        if (!cancelled) {
          setPreview(null)
          toast.error(error?.response?.data?.message || "Failed to preview leave")
        }
      } finally {
        if (!cancelled) setPreviewing(false)
      }
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [open, rangeValid, from, to, employeeId])

  const canSubmit =
    rangeValid &&
    !!preview &&
    preview.workingDays > 0 &&
    !preview.wouldExceed &&
    !previewing &&
    !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    try {
      setSubmitting(true)
      const res = await api.post("/api/attendance/leave", {
        employeeId,
        from,
        to,
        note,
      })
      const granted = res.data?.data?.granted ?? 0
      toast.success(`Granted ${granted} day(s) of leave`)
      setOpen(false)
      await onGranted()
    } catch (error: any) {
      console.log(error)
      toast.error(error?.response?.data?.message || "Failed to grant leave")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button variant="outline" className="w-full sm:w-auto">
            <CalendarPlus className="mr-2 h-4 w-4" />
            Grant Leave
          </Button>
        </DialogTrigger>
      )}

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant annual leave — {employeeName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {balance && (
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <span className="font-medium">Balance {balance.year}:</span>{" "}
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                {balance.remaining}
              </span>{" "}
              of {balance.entitlement} days remaining
            </div>
          )}

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
              placeholder="Reason for leave"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {/* Live preview */}
          {from && to && !rangeValid && (
            <p className="text-sm text-destructive">
              "From" must be on or before "To".
            </p>
          )}

          {rangeValid && (
            <div className="rounded-lg border px-3 py-2 text-sm">
              {previewing ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Calculating…
                </div>
              ) : preview ? (
                <div className="space-y-1">
                  <p>
                    <span className="font-semibold">{preview.workingDays}</span>{" "}
                    working day(s) will be deducted.
                  </p>
                  {preview.holidayDays > 0 && (
                    <p className="text-muted-foreground">
                      {preview.holidayDays} holiday(s) skipped.
                    </p>
                  )}
                  {preview.conflictDays.length > 0 && (
                    <p className="text-amber-600 dark:text-amber-400">
                      {preview.conflictDays.length} day(s) skipped — the employee
                      already worked.
                    </p>
                  )}
                  {preview.alreadyLeaveDays.length > 0 && (
                    <p className="text-muted-foreground">
                      {preview.alreadyLeaveDays.length} day(s) already on leave.
                    </p>
                  )}
                  {Object.entries(preview.remainingByYear).map(([yr, rem]) => (
                    <p key={yr} className="text-muted-foreground">
                      {yr}: {rem} day(s) remaining before this grant.
                    </p>
                  ))}
                  {preview.wouldExceed && (
                    <p className="font-medium text-destructive">
                      Exceeds the available balance
                      {preview.violations.map(
                        (v) =>
                          ` (${v.year}: requested ${v.requested}, only ${v.remaining} left)`
                      )}
                      .
                    </p>
                  )}
                  {preview.workingDays === 0 && !preview.wouldExceed && (
                    <p className="font-medium text-destructive">
                      No working days to grant in this range.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Grant Leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
