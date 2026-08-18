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
import { Loader2, AlertTriangle, CheckCircle2, CalendarClock } from "lucide-react"

interface DaySession {
  siteId: string
  siteName: string
  checkIn: string | null
  checkOut: string | null
  rawCheckIn: string | null
  rawCheckOut: string | null
  isOpen: boolean
}

// Which removal this dialog performs:
//   today-home        — immediate: unassign from the site (+ delete today's session).
//   today-cross-site  — immediate: delete ONLY this site's session (a visitor whose
//                       home is another site); their assignment is untouched.
//   tomorrow-deferred — schedule removal for the day-rollover; undoable before midnight.
export type RemoveMode = "today-home" | "today-cross-site" | "tomorrow-deferred"

interface RemoveEmployeeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  siteId: string
  employee: { _id: string; name: string } | null
  mode: RemoveMode
  // Whether today's attendance is already submitted for this site (today-home only):
  // a submitted day always has a session, so removal deletes it rather than offering
  // an opt-in.
  submitted?: boolean
  // Called after a successful removal so the parent can refresh its roster.
  onRemoved: () => void
}

function RemoveEmployeeDialog({
  open,
  onOpenChange,
  siteId,
  employee,
  mode,
  submitted = false,
  onRemoved,
}: RemoveEmployeeDialogProps) {
  const [checkingSession, setCheckingSession] = useState(false)
  const [siteSession, setSiteSession] = useState<DaySession | null>(null)
  const [deleteAttendance, setDeleteAttendance] = useState(false)
  const [removing, setRemoving] = useState(false)

  // A submitted home-worker removal always deletes the session (no opt-in checkbox).
  const forceSessionDelete = mode === "today-home" && submitted

  // Only the pre-submit home case needs the "did they already work today?" safeguard.
  const needsSessionLookup = mode === "today-home" && !submitted

  // On open, look up today's saved session for this employee on THIS site.
  useEffect(() => {
    if (!open || !employee || !needsSessionLookup) {
      setSiteSession(null)
      setDeleteAttendance(false)
      return
    }

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
        const match = sessions.find((s) => (s.siteId || "").toString() === siteId)
        setSiteSession(match || null)
      })
      .catch((error) => {
        if (cancelled) return
        console.log(error)
        setSiteSession(null)
      })
      .finally(() => {
        if (!cancelled) setCheckingSession(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, employee, siteId, needsSessionLookup])

  async function handleRemove() {
    if (!employee) return
    setRemoving(true)
    try {
      if (mode === "tomorrow-deferred") {
        await api.patch(`/api/site/${siteId}/schedule-removal`, { _id: employee._id })
        toast.success("Removal scheduled for tomorrow")
      } else if (mode === "today-cross-site") {
        // Server deletes only this site's session (currentSite is left untouched).
        await api.patch(`/api/site/${siteId}/remove-employee`, {
          _id: employee._id,
          deleteAttendance: true,
        })
        toast.success("Session removed for this site")
      } else {
        // today-home: unassign; delete the session when submitted or when opted in.
        await api.patch(`/api/site/${siteId}/remove-employee`, {
          _id: employee._id,
          deleteAttendance: forceSessionDelete || (!!siteSession && deleteAttendance),
        })
        toast.success("Employee removed from site")
      }

      // Today's draft cache for this site may now be stale.
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

  const isDeferred = mode === "tomorrow-deferred"
  const isCrossSite = mode === "today-cross-site"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className={isDeferred ? "" : "text-destructive"}>
            {isDeferred ? "Schedule Removal" : "Confirm Removal"}
          </DialogTitle>
          <DialogDescription className="pt-2 text-sm leading-relaxed text-muted-foreground">
            {isDeferred ? (
              <>
                <strong className="font-semibold text-foreground">
                  {employee?.name}
                </strong>{" "}
                will be removed from this site <strong>tomorrow</strong>. They stay
                on today&apos;s roster, and you can undo this any time before midnight.
              </>
            ) : isCrossSite ? (
              <>
                <strong className="font-semibold text-foreground">
                  {employee?.name}
                </strong>{" "}
                is based at another site. This removes only their session at this
                site today — their assignment is not changed.
              </>
            ) : (
              <>
                Remove{" "}
                <strong className="font-semibold text-foreground">
                  {employee?.name}
                </strong>{" "}
                from this site? This takes effect immediately.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Deferred note */}
        {isDeferred && (
          <div className="my-2 flex items-start gap-2 rounded-lg border border-sky-200/60 bg-sky-50 p-3 text-sky-800 dark:border-sky-800/40 dark:bg-sky-950/40 dark:text-sky-200">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="text-sm leading-relaxed">
              Takes effect at the day rollover. Until then they remain assigned and
              can still be marked today.
            </div>
          </div>
        )}

        {/* Cross-site session-only note */}
        {isCrossSite && (
          <div className="my-2 flex items-start gap-2 rounded-lg border border-slate-200/60 bg-slate-50 p-3 text-slate-700 dark:border-slate-700/50 dark:bg-slate-900/40 dark:text-slate-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="text-sm leading-relaxed">
              Only their session here is deleted. Their home-site assignment stays
              intact.
            </div>
          </div>
        )}

        {/* Post-submit home removal: session will be deleted */}
        {forceSessionDelete && (
          <div className="my-2 flex items-start gap-2 rounded-lg border border-amber-200/60 bg-amber-50 p-3 text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="text-sm leading-relaxed">
              This unassigns them and deletes today&apos;s session for this site.
            </div>
          </div>
        )}

        {/* Pre-submit home removal: today's-session safeguard + opt-in */}
        {needsSessionLookup && (
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
                    <span className="font-semibold">saved session</span> on this site
                    today
                    {sessionWindow ? (
                      <span className="font-mono"> ({sessionWindow})</span>
                    ) : null}
                    . Removing them will keep that record unless you choose to delete
                    it below.
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
                      Only if they were assigned here by mistake and did not actually
                      work today.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-200/60 bg-emerald-50 p-3 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-200">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="text-sm leading-relaxed">
                  No attendance recorded today for this site — removing them won&apos;t
                  lose any saved records.
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="mt-2 gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={isDeferred ? "default" : "destructive"}
            disabled={removing || checkingSession}
            onClick={handleRemove}
          >
            {removing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isDeferred ? "Schedule Removal" : "Remove Employee"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default RemoveEmployeeDialog
