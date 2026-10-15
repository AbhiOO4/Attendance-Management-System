import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import toast from "react-hot-toast"

import { api } from "@/lib/api"
import {
  apiErrorMessage,
  toDateInput,
  type EmployeeRef,
  type LeaveAllocationRow,
} from "@/lib/leave"
import EmployeePicker from "@/components/leave/EmployeePicker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// Calendar days in an inclusive "YYYY-MM-DD" range (0 when invalid).
const spanDays = (from: string, to: string) => {
  if (!from || !to) return 0
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 86_400_000) + 1 : 0
}

// Create or edit an annual leave allocation: one employee, a from–to period and the
// annual leave days it grants. The employee is fixed once created. The server enforces
// no overlap with the employee's other allocations and never dropping below what's
// already taken; its message is shown inline.
export default function LeaveAllocationDialog({
  open,
  onOpenChange,
  allocation,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The allocation being edited, or null to create one.
  allocation: LeaveAllocationRow | null
  onSaved: () => void | Promise<void>
}) {
  const isEdit = !!allocation
  const [employee, setEmployee] = useState<EmployeeRef | null>(null)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [days, setDays] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (allocation) {
      setEmployee(allocation.employee)
      setFrom(toDateInput(allocation.fromDate))
      setTo(toDateInput(allocation.toDate))
      setDays(String(allocation.days))
      setNote(allocation.note || "")
    } else {
      setEmployee(null)
      setFrom("")
      setTo("")
      setDays("")
      setNote("")
    }
  }, [open, allocation])

  const span = useMemo(() => spanDays(from, to), [from, to])
  const rangeInvalid = !!from && !!to && span === 0
  const daysNum = days.trim() === "" ? NaN : Number(days)
  const daysInvalid =
    days.trim() !== "" && (!Number.isInteger(daysNum) || daysNum < 0 || (span > 0 && daysNum > span))

  const canSave =
    !!employee && span > 0 && Number.isInteger(daysNum) && !daysInvalid && !saving

  const handleSave = async () => {
    if (!canSave || !employee) return
    setError(null)
    try {
      setSaving(true)
      const body = { from, to, days: daysNum, note }
      if (allocation) {
        await api.patch(`/api/attendance/leave/allocations/${allocation._id}`, body)
        toast.success("Allocation updated")
      } else {
        await api.post("/api/attendance/leave/allocations", { ...body, employeeId: employee._id })
        toast.success(`Allocated ${daysNum} day(s) to ${employee.name}`)
      }
      onOpenChange(false)
      await onSaved()
    } catch (err) {
      setError(apiErrorMessage(err, "Failed to save the allocation"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent
        className="sm:max-w-lg"
        // Editing: the employee picker is disabled, so Radix would autofocus the From date
        // input and open the dialog with its focus ring showing. Keep focus on the dialog.
        onOpenAutoFocus={(e) => {
          if (!isEdit) return
          e.preventDefault()
          ;(e.currentTarget as HTMLElement | null)?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit leave allocation" : "New leave allocation"}</DialogTitle>
          <DialogDescription>
            Annual (paid) leave the employee can take between these dates. Allocations for
            the same employee can't overlap.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="alloc-employee">Employee</Label>
            <EmployeePicker
              id="alloc-employee"
              value={employee}
              onChange={setEmployee}
              disabled={isEdit}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="alloc-from">From</Label>
              <Input
                id="alloc-from"
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="alloc-to">To</Label>
              <Input
                id="alloc-to"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
          {rangeInvalid && (
            <p className="text-sm text-destructive">"From" must be on or before "To".</p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="alloc-days">Annual leave days</Label>
            <Input
              id="alloc-days"
              type="number"
              min={0}
              max={span || undefined}
              step={1}
              placeholder="e.g. 30"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
            {daysInvalid ? (
              <p className="text-xs text-destructive">
                Enter a whole number from 0{span > 0 ? ` to ${span}` : ""}.
              </p>
            ) : (
              isEdit &&
              allocation && (
                <p className="text-xs text-muted-foreground">
                  {allocation.used} day(s) already taken against this allocation.
                </p>
              )
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="alloc-note">Note (optional)</Label>
            <Textarea
              id="alloc-note"
              placeholder="e.g. 2026 annual leave"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? "Save changes" : "Allocate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
