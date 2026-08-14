import { useEffect, useState } from "react"
import toast from "react-hot-toast"

import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Loader2, AlertTriangle, CheckCircle2 } from "lucide-react"

interface DaySession {
  siteId: string
  siteName: string
  checkIn: string | null
  checkOut: string | null
  rawCheckIn: string | null
  rawCheckOut: string | null
  isOpen: boolean
}

interface RemoveEmployeeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  siteId: string
  employee: { _id: string; name: string } | null
  // Called after a successful removal so the parent can refresh its roster.
  onRemoved: () => void
}

// Confirms removing an employee from a site. Before removing, it asks the server
// whether the employee has a SAVED session on this site today: if so it surfaces
// the session and offers (default-off) to delete it; if not, removal is clearly
// safe. Removal itself is always immediate. See getEmployeeDaySessions on the API.
function RemoveEmployeeDialog({
  open,
  onOpenChange,
  siteId,
  employee,
  onRemoved,
}: RemoveEmployeeDialogProps) {
  const [checkingSession, setCheckingSession] = useState(false)
  const [siteSession, setSiteSession] = useState<DaySession | null>(null)
  const [deleteAttendance, setDeleteAttendance] = useState(false)
  const [removing, setRemoving] = useState(false)

  // On open, look up today's saved session for this employee on THIS site.
  useEffect(() => {
    if (!open || !employee) return

    let cancelled = false
    setSiteSession(null)
    setDeleteAttendance(false)
    setCheckingSession(true)

    api
      .get<{ data: { sessions: DaySession[] } }>(
        "/api/attendance/employee-day-sessions",
        { params: { employeeId: employee._id } }
      )
      .then((res) => {
        if (cancelled) return
        const sessions = res.data?.data?.sessions || []
        const match = sessions.find(
          (s) => (s.siteId || "").toString() === siteId
        )
        setSiteSession(match || null)
      })
      .catch((error) => {
        if (cancelled) return
        console.log(error)
        // On failure, fall back to the safe default (assume no session known).
        setSiteSession(null)
      })
      .finally(() => {
        if (!cancelled) setCheckingSession(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, employee, siteId])

  async function handleRemove() {
    if (!employee) return
    setRemoving(true)
    try {
      await api.patch(`/api/site/${siteId}/remove-employee`, {
        _id: employee._id,
        // Only ever delete when a session actually exists and the admin opted in.
        deleteAttendance: !!siteSession && deleteAttendance,
      })
      toast.success("Employee removed from site")

      // Instant change → today's draft cache for this site is now stale.
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith(`attendance_draft_${siteId}_`)) {
          localStorage.removeItem(key)
        }
      })
      localStorage.removeItem(`active_inline_edit_row_${siteId}`)
      localStorage.removeItem(`active_inline_edit_data_${siteId}`)

      onRemoved()
      onOpenChange(false)
    } catch (error: any) {
      console.log(error)
      toast.error(error.response?.data?.message || "Failed to remove employee")
    } finally {
      setRemoving(false)
    }
  }

  const sessionWindow = siteSession
    ? siteSession.isOpen
      ? `${siteSession.rawCheckIn || "—"} → in progress`
      : `${siteSession.rawCheckIn || "—"} → ${siteSession.rawCheckOut || "—"}`
    : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-destructive">Confirm Removal</DialogTitle>
          <DialogDescription className="pt-2 text-sm leading-relaxed text-muted-foreground">
            Remove{" "}
            <strong className="font-semibold text-foreground">
              {employee?.name}
            </strong>{" "}
            from this site? This takes effect immediately.
          </DialogDescription>
        </DialogHeader>

        {/* Today's-session safeguard */}
        <div className="my-2 border-t border-b py-4">
          {checkingSession ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking today&apos;s attendance…
            </div>
          ) : siteSession ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-amber-200/60 bg-amber-50 p-3 text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="text-sm leading-relaxed">
                  This employee has a{" "}
                  <span className="font-semibold">saved session</span> on this
                  site today
                  {sessionWindow ? (
                    <span className="font-mono"> ({sessionWindow})</span>
                  ) : null}
                  . Removing them will keep that record unless you choose to
                  delete it below.
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <Checkbox
                  id="delete-attendance"
                  checked={deleteAttendance}
                  onCheckedChange={(checked) => setDeleteAttendance(!!checked)}
                />
                <div className="grid gap-1 leading-none">
                  <Label
                    htmlFor="delete-attendance"
                    className="cursor-pointer text-sm font-medium text-foreground"
                  >
                    Also delete today&apos;s session for this site
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Only if they were assigned here by mistake and did not
                    actually work today.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200/60 bg-emerald-50 p-3 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="text-sm leading-relaxed">
                No attendance recorded today for this site — removing them
                won&apos;t lose any saved records.
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="mt-2 gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={removing || checkingSession}
            onClick={handleRemove}
          >
            {removing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Remove Employee
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default RemoveEmployeeDialog
