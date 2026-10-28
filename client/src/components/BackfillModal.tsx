import { useEffect, useMemo, useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

import {
  Loader2,
  Plus,
  Save,
  Trash2,
  UserPlus,
  X,
  Moon,
  Sun,
} from "lucide-react"

import { api } from "@/lib/api"
import toast from "react-hot-toast"
import { combineFromOffset, toLocalTimeString as toTimeValue, formatLocalTime12h, validateSessionTimesV2 } from "@/lib/dateUtils"
import SessionTimeFields, { type SessionTimes } from "@/components/backfill/SessionTimeFields"
import {
  computeAutoBreaks,
  computeAttendanceTotals,
  sumRawHours,
  MAX_BREAKS_PER_DAY,
  resolveBreakMinHours,
  type HolidayReason,
} from "@/lib/attendanceUtils"
import { useWorkConfig } from "@/context/WorkConfigContext"
import { useGlobalJobs } from "@/lib/globalJobs"
import { fetchSitesWithDriverPool, isDriverTitle } from "@/lib/driverJobs"
import { driverSessionMissingPlace, type DriverPlace } from "@/lib/jobSplit"
import SessionSiteJobFields, { type PickerSite } from "@/components/SessionSiteJobFields"

// --------------------------------------------------
// TYPES
// --------------------------------------------------

type Site = PickerSite

interface SessionDraft {
  siteId: string
  siteName?: string
  jobId?: string | null
  jobName?: string
  // On "Drivers": the site served + the ticked jobs its hours are split across.
  place?: DriverPlace | null
  checkIn?: string | null
  checkOut?: string | null
  // Day offsets from `date` (as in EditSiteRecord) — sent explicitly so a 24h shift or a
  // standalone after-midnight session can be expressed.
  checkInNextDay?: boolean
  checkOutNextDay?: boolean
  workedHours: number
  isNightShift?: boolean
}

export interface MissingEmployee {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
  currentSite?: { _id: string; siteName: string } | null
  currentJob?: { _id: string; name: string } | null
  employmentType?: 'permanent' | 'temporary'
}

interface BackfillModalProps {
  open: boolean
  onClose: () => void
  employee: MissingEmployee | null
  date: string // YYYY-MM-DD
  onCreated: (newRecord: any) => void
}

// --------------------------------------------------
// COMPONENT
// --------------------------------------------------

function BackfillModal({ open, onClose, employee, date, onCreated }: BackfillModalProps) {
  const [sites, setSites] = useState<Site[]>([])
  const globalJobs = useGlobalJobs(open)
  // A driver's sessions go on "Drivers" (the hidden pool) by default.
  const isDriver = isDriverTitle(employee?.jobTitle)
  const driverPoolId = sites.find((s) => s.isDriverPool)?._id ?? ""
  const [sessions, setSessions] = useState<SessionDraft[]>([])
  const [sessionErrors, setSessionErrors] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [overlapInfo, setOverlapInfo] = useState<any>(null)
  const [overlapIndexes, setOverlapIndexes] = useState<number[]>([])
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [sessionToDelete, setSessionToDelete] = useState<number | null>(null)
  const { config: workConfig } = useWorkConfig()

  const config = useMemo(
    () => ({
      fullDayHours: workConfig?.fullDayHours ?? 8,
      halfDayHours: workConfig?.halfDayHours ?? 4,
      overtimeThreshold: workConfig?.overtimeThreshold ?? 8,
      breakDurationMinutes: workConfig?.breakDurationMinutes ?? 60,
      breakMinHours: resolveBreakMinHours(workConfig),
    }),
    [workConfig]
  )

  const [breaksTaken, setBreaksTaken] = useState<number | null>(null)

  // Holiday state of the day being backfilled. No record exists yet, so this is
  // resolved per date: a CustomHoliday wins ("public"), else a weeklyHolidays
  // weekday match ("weekly") — same priority as the server's checkHolidayForDate.
  // The server recomputes on save and stays the source of truth.
  const [holidayInfo, setHolidayInfo] = useState<{ isHoliday: boolean; reason: HolidayReason }>({
    isHoliday: false,
    reason: null,
  })

  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
  const isDirty = sessions.length > 0

  const handleCloseAttempt = () => {
    if (isDirty) {
      setShowDiscardConfirm(true)
    } else {
      onClose()
    }
  }

  const handleConfirmDiscard = () => {
    setShowDiscardConfirm(false)
    onClose()
  }

  const handleCancelDiscard = () => {
    setShowDiscardConfirm(false)
  }

  // Reset state when modal opens/closes or employee changes
  useEffect(() => {
    setOverlapInfo(null)
    setOverlapIndexes([])
    setSessions([])
    setBreaksTaken(null)
  }, [open, employee])

  useEffect(() => {
    fetchSites()
  }, [])

  // Resolve the backfill date's holiday status whenever the modal opens.
  useEffect(() => {
    if (!open || !date) return

    let cancelled = false

    const resolveHoliday = async () => {
      try {
        // 1. Custom/public holiday wins (mirrors server priority)
        const res = await api.get("/api/config/custom-holidays/check", {
          params: { date },
        })
        if (cancelled) return
        if (res.data?.isHoliday) {
          setHolidayInfo({ isHoliday: true, reason: "public" })
          return
        }
      } catch (error) {
        console.log(error)
      }

      if (cancelled) return

      // 2. Weekly holiday from the work schedule
      const weeklyHolidays = workConfig?.weeklyHolidays || []
      const [year, month, day] = date.split("-").map(Number)
      const dayName = new Date(year, month - 1, day)
        .toLocaleDateString("en-US", { weekday: "long" })
        .toLowerCase()

      if (weeklyHolidays.includes(dayName)) {
        setHolidayInfo({ isHoliday: true, reason: "weekly" })
      } else {
        setHolidayInfo({ isHoliday: false, reason: null })
      }
    }

    resolveHoliday()

    return () => {
      cancelled = true
    }
  }, [open, date, workConfig])

  // --------------------------------------------------
  // FETCHERS
  // --------------------------------------------------

  const fetchSites = async () => {
    try {
      setSites(await fetchSitesWithDriverPool<Site>())
    } catch (error) {
      console.log(error)
    }
  }


  // --------------------------------------------------
  // HELPERS
  // --------------------------------------------------

  const calculateWorkedHours = (checkIn?: string | null, checkOut?: string | null) => {
    if (!checkIn || !checkOut) return 0
    const start = new Date(checkIn)
    const end = new Date(checkOut)
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
    if (hours < 0) return 0
    return Number(hours.toFixed(2))
  }



  // --------------------------------------------------
  // DERIVED VALUES
  // --------------------------------------------------

  // Exact durations summed once (never Σ rounded session hours) — the server's sumRawHours.
  const rawHours = useMemo(() => sumRawHours(sessions), [sessions])

  const autoBreaks = useMemo(() => {
    return computeAutoBreaks(rawHours, config.breakMinHours)
  }, [rawHours, config.breakMinHours])

  // Temporary workers are exempt from holiday treatment — a holiday is a normal
  // working day for them (normal hours + OT, no holiday-hours credit), mirroring
  // the server. Only permanent workers get holiday handling.
  const applyHoliday = holidayInfo.isHoliday && employee?.employmentType !== "temporary"

  // The day's totals exactly as the server will store them (shared mirror of
  // computeAttendanceTotals in lib/attendanceUtils.ts).
  const { netWorkHours: totalWorkHours, status, overtimeHours, holidayHours } = useMemo(
    () => computeAttendanceTotals(rawHours, config, breaksTaken, applyHoliday),
    [rawHours, config, breaksTaken, applyHoliday]
  )


  // --------------------------------------------------
  // HANDLERS
  // --------------------------------------------------

  const updateSessionField = (
    index: number,
    field: keyof SessionDraft | "isNightShift",
    value: any
  ) => {
    const updated = [...sessions]

    if (field === "isNightShift") {
      return
    }

    updated[index] = {
      ...updated[index],
      [field as any]: value,
    }

    if (field === "siteId") {
      updated[index].jobId = null
      updated[index].place = null
    }

    commitSessions(updated, index)
  }

  // Times combine with the day being backfilled at their day offsets. SessionTimeFields rolls
  // a check-out earlier than its check-in to the next day; the pills set either offset by hand.
  const setSessionTimes = (index: number, next: SessionTimes) => {
    const updated = [...sessions]
    const checkIn = next.checkIn ? combineFromOffset(date, next.checkIn, next.checkInNextDay) : null
    const checkOut = next.checkOut ? combineFromOffset(date, next.checkOut, next.checkOutNextDay) : null
    updated[index] = {
      ...updated[index],
      checkIn,
      checkOut,
      checkInNextDay: next.checkInNextDay,
      checkOutNextDay: next.checkOutNextDay,
      isNightShift: next.checkInNextDay || next.checkOutNextDay,
      workedHours: calculateWorkedHours(checkIn, checkOut),
    }
    commitSessions(updated, index)
  }

  const commitSessions = (updated: SessionDraft[], index: number) => {
    setSessionErrors((prev) => {
      const next = { ...prev }
      delete next[index]
      return next
    })

    setOverlapInfo(null)
    setOverlapIndexes([])
    setSessions(updated)
  }

  const addSession = () => {
    // Prevent adding if there is any incomplete session in the list
    const hasIncomplete = sessions.some((s) => !s.siteId || !s.checkIn || !s.checkOut)
    if (hasIncomplete) {
      toast.error("Please complete the existing sessions before adding a new one.")
      return
    }
    setSessions([
      ...sessions,
      {
        siteId: isDriver ? driverPoolId : "",
        jobId: null,
        place: null,
        checkIn: null,
        checkOut: null,
        checkInNextDay: false,
        checkOutNextDay: false,
        workedHours: 0,
      },
    ])
  }

  const removeSession = (index: number) => {
    const updated = [...sessions]
    updated.splice(index, 1)
    setSessions(updated)
  }

  // --------------------------------------------------
  // SAVE
  // --------------------------------------------------

  const createRecord = async () => {
    if (!employee) return

    // Validate: every session must have a site
    const hasMissingSite = sessions.some((s) => !s.siteId)
    if (hasMissingSite) {
      toast.error("Every session must have a site selected")
      return
    }

    if (sessions.some((s) => driverSessionMissingPlace(sites, s))) {
      toast.error("Pick the site for every driver session")
      return
    }

    // -------------------------
    // SESSION COMPLETION VALIDATION
    // -------------------------
    const sessionsBySite: Record<string, typeof sessions> = {}
    sessions.forEach((s) => {
      if (s.siteId) {
        if (!sessionsBySite[s.siteId]) {
          sessionsBySite[s.siteId] = []
        }
        sessionsBySite[s.siteId].push(s)
      }
    })

    let validationErrorMsg = ""
    Object.keys(sessionsBySite).forEach((siteId) => {
      const siteGroup = sessionsBySite[siteId]
      
      const sorted = [...siteGroup].sort((a, b) => {
        if (!a.checkIn && !b.checkIn) return 0
        if (!a.checkIn) return 1
        if (!b.checkIn) return -1
        return new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime()
      })

      for (let i = 0; i < sorted.length; i++) {
        const s = sorted[i]
        const isLast = i === sorted.length - 1
        const isEmpty = !s.checkIn && !s.checkOut
        const isHalfFilled = s.checkIn && !s.checkOut

        if (!isLast) {
          if (isEmpty || isHalfFilled) {
            validationErrorMsg = "All previous sessions at the same site must be fully completed (both check-in and check-out filled)."
            break
          }
        } else {
          if (sorted.length > 1 && isEmpty) {
            validationErrorMsg = "Empty sessions are not allowed when multiple sessions exist for the same site."
            break
          }
        }
      }
    })

    if (validationErrorMsg) {
      toast.error(validationErrorMsg)
      return
    }

    // Cutoff-free: ordering + duration only (a check-out needs a check-in, after it, ≤ 26h).
    // Cross-day double-pay is caught by the server's overlap check against the
    // neighbouring days' records.
    let hasError = false
    const errors: Record<number, string> = {}
    sessions.forEach((session, index) => {
      const error = validateSessionTimesV2(
        toTimeValue(session.checkIn),
        toTimeValue(session.checkOut),
        !!session.checkInNextDay,
        !!session.checkOutNextDay
      )
      if (error) {
        errors[index] = error
        hasError = true
      }
    })

    if (hasError) {
      setSessionErrors(errors)
      return
    }
    setSessionErrors({})

    // Sort sessions chronologically
    const sortedSessions = [...sessions].sort((a, b) => {
      if (!a.checkIn && !b.checkIn) return 0
      if (!a.checkIn) return 1
      if (!b.checkIn) return -1
      return new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime()
    })
    setSessions(sortedSessions)
    setSaving(true)

    try {
      const payload = {
        employeeMongoId: employee._id,
        date,
        sessions: sortedSessions.map((s) => ({
          siteId: s.siteId,
          jobId: s.place?.jobIds.length ? null : s.jobId || null,
          // Drivers: the server keeps the split only for a session on "Drivers".
          splitJobIds: s.place?.jobIds ?? [],
          checkIn: s.checkIn ? toTimeValue(s.checkIn) : null,
          checkOut: s.checkOut ? toTimeValue(s.checkOut) : null,
          checkInNextDay: !!s.checkInNextDay,
          checkOutNextDay: !!s.checkOutNextDay,
          isNightShift: s.isNightShift || false,
        })),
        breaksTaken,
      }

      const res = await api.post("/api/attendance/backfill", payload)
      toast.success("Attendance record created successfully")
      onCreated(res.data.attendance)
      onClose()
    } catch (error: any) {
      console.log(error)
      const overlap = error?.response?.data?.overlap
      if (overlap) {
        setOverlapInfo(overlap)
        setOverlapIndexes([overlap.firstIndex, overlap.secondIndex])
        toast.error(error.response.data.message)
        return
      }
      toast.error(error?.response?.data?.message || "Failed to create attendance record")
    } finally {
      setSaving(false)
    }
  }

  // --------------------------------------------------
  // RENDER
  // --------------------------------------------------

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        handleCloseAttempt()
      }
    }}>
      <DialogContent className="!w-[95vw] !max-w-[540px] h-[90vh] max-h-[90vh] overflow-hidden p-0 flex flex-col rounded-2xl">

        {/* HEADER */}
        <div className="border-b px-5 py-4 sm:px-6">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <UserPlus className="h-4 w-4 text-primary" />
              </div>
              <DialogTitle className="text-lg font-semibold">
                Backfill Attendance Record
              </DialogTitle>
            </div>
          </DialogHeader>

          {/* Employee info — compact inline */}
          {employee && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium">{employee.name}</span>
              <span className="text-muted-foreground">{employee.employeeId}</span>
              {employee.jobTitle && (
                <Badge variant="secondary" className="text-xs font-normal">{employee.jobTitle}</Badge>
              )}
              {employee.currentSite && (
                <span className="text-xs text-muted-foreground">Assigned: {employee.currentSite.siteName}</span>
              )}
            </div>
          )}
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6 space-y-5">

          {/* SESSIONS */}
          <div className="space-y-3">
            {sessions.length === 0 && (
              <div className="rounded-xl border border-dashed bg-muted/10 p-6 text-center text-muted-foreground">
                <UserPlus className="mx-auto mb-2 h-7 w-7 opacity-40" />
                <p className="text-sm">No sessions added yet.</p>
                <p className="text-xs mt-1">Add attendance sessions below, or save as absent.</p>
              </div>
            )}

            {sessions.map((session, index) => {
              const inT = toTimeValue(session.checkIn)
              const outT = toTimeValue(session.checkOut)
              const night = !!session.isNightShift
              const hasIssue = overlapIndexes.includes(index) || !!sessionErrors[index]

              return (
                <div
                  key={index}
                  className={`rounded-xl border p-4 space-y-4 ${
                    hasIssue ? "border-red-400 bg-red-50 dark:bg-red-950/20" : "bg-background"
                  }`}
                >
                  {/* Session header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold">Session {index + 1}</h4>
                      {night ? (
                        <Badge variant="secondary" className="text-xs gap-1 font-normal">
                          <Moon className="h-3 w-3" /> Night
                        </Badge>
                      ) : (inT || outT) ? (
                        <Badge variant="secondary" className="text-xs gap-1 font-normal">
                          <Sun className="h-3 w-3" /> Day
                        </Badge>
                      ) : null}
                      {overlapIndexes.includes(index) && (
                        <Badge variant="destructive" className="text-xs">Overlap</Badge>
                      )}
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        setSessionToDelete(index)
                        setDeleteDialogOpen(true)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {/* Site + Job ("Drivers" for a driver — the site served + its jobs) */}
                  <SessionSiteJobFields
                    sites={sites}
                    siteId={session.siteId}
                    jobId={session.jobId}
                    jobName={session.jobName}
                    allowDrivers={isDriver}
                    globalJobs={globalJobs}
                    hasTimes={!!(session.checkIn || session.checkOut)}
                    place={session.place ?? null}
                    onSiteChange={(value) => updateSessionField(index, "siteId", value)}
                    onJobChange={(value) => updateSessionField(index, "jobId", value)}
                    onPlaceChange={(value) => updateSessionField(index, "place", value)}
                  />

                  {/* Time inputs + next-day pills */}
                  <SessionTimeFields
                    date={date}
                    value={{
                      checkIn: inT,
                      checkOut: outT,
                      checkInNextDay: !!session.checkInNextDay,
                      checkOutNextDay: !!session.checkOutNextDay,
                    }}
                    onChange={(next) => setSessionTimes(index, next)}
                  />

                  {/* Worked hours */}
                  <div className="flex items-center justify-between text-sm pt-1">
                    <span className="text-muted-foreground">Worked</span>
                    <span className="font-semibold">{session.workedHours} hrs</span>
                  </div>

                  {sessionErrors[index] && (
                    <p className="text-xs text-red-500 font-medium">{sessionErrors[index]}</p>
                  )}
                </div>
              )
            })}
          </div>

          {/* ADD SESSION */}
          <Button
            variant="outline"
            onClick={addSession}
            className="w-full border-dashed h-9 text-sm"
          >
            <Plus className="mr-2 h-3.5 w-3.5" />
            Add New Session
          </Button>

          {/* OVERLAP ERROR */}
          {overlapInfo && (
            <div className="rounded-xl border border-red-500 bg-red-50 p-4 dark:bg-red-950/20 dark:border-red-800/30">
              <h4 className="font-semibold text-red-700 dark:text-red-200">Session Overlap Detected</h4>
              <div className="mt-3 text-sm text-red-700 dark:text-red-300 space-y-2">
                <div>
                  <strong>Session {overlapInfo.firstIndex + 1}</strong>
                  <br />
                  Check In:{" "}
                  {overlapInfo.sessionA.checkIn ? formatLocalTime12h(overlapInfo.sessionA.checkIn) : "-"}
                  <br />
                  Check Out:{" "}
                  {overlapInfo.sessionA.checkOut ? formatLocalTime12h(overlapInfo.sessionA.checkOut) : "-"}
                </div>
                <div>
                  <strong>Session {overlapInfo.secondIndex + 1}</strong>
                  <br />
                  Check In:{" "}
                  {overlapInfo.sessionB.checkIn ? formatLocalTime12h(overlapInfo.sessionB.checkIn) : "-"}
                  <br />
                  Check Out:{" "}
                  {overlapInfo.sessionB.checkOut ? formatLocalTime12h(overlapInfo.sessionB.checkOut) : "-"}
                </div>
              </div>
            </div>
          )}

          {/* BREAKS + SUMMARY — compact */}
          <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
            {/* Breaks */}
            {config.breakDurationMinutes > 0 && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">☕ Breaks</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="h-7 w-7 rounded-md border text-sm font-bold hover:bg-muted transition-colors disabled:opacity-40"
                    disabled={breaksTaken !== null && breaksTaken <= 0}
                    onClick={() => setBreaksTaken((prev) => Math.max(0, (prev ?? autoBreaks) - 1))}
                  >−</button>

                  <span className="min-w-[50px] text-center text-sm font-medium">
                    {breaksTaken !== null ? breaksTaken : `${autoBreaks}`}
                  </span>

                  <button
                    type="button"
                    className="h-7 w-7 rounded-md border text-sm font-bold hover:bg-muted transition-colors disabled:opacity-40"
                    disabled={(breaksTaken ?? autoBreaks) >= MAX_BREAKS_PER_DAY}
                    onClick={() => setBreaksTaken((prev) => Math.min(MAX_BREAKS_PER_DAY, (prev ?? autoBreaks) + 1))}
                  >+</button>

                  {breaksTaken !== null && (
                    <button
                      type="button"
                      className="ml-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setBreaksTaken(null)}
                      title="Reset to auto"
                    >reset</button>
                  )}
                </div>
              </div>
            )}

            {/* Total */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total Work Hours</span>
              <span className="text-lg font-bold">{totalWorkHours} hrs</span>
            </div>

            {/* Overtime */}
            {overtimeHours > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Overtime</span>
                <span className="text-lg font-bold">{overtimeHours} hrs</span>
              </div>
            )}

            {/* Holiday */}
            {holidayInfo.isHoliday && (
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  Holiday Hours
                  <Badge
                    variant="secondary"
                    className="bg-yellow-100 text-yellow-800 border-yellow-300 text-xs font-normal"
                  >
                    {holidayInfo.reason === "weekly" ? "Weekly" : "Public"}
                  </Badge>
                </span>
                <span className="text-lg font-bold">{holidayHours} hrs</span>
              </div>
            )}

            {/* Status */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Status</span>
              <Badge
                variant={status === "absent" ? "destructive" : "secondary"}
                className={`text-sm ${
                  status === "fullday"
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25 border-transparent"
                    : ""
                }`}
              >
                {status}
              </Badge>
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div className="border-t px-5 py-3 sm:px-6 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleCloseAttempt}>
            Cancel
          </Button>
          <Button size="sm" onClick={createRecord} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                Create Record
              </>
            )}
          </Button>
        </div>
      </DialogContent>

      {/* DELETE SESSION DIALOG */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Session?</AlertDialogTitle>
            <AlertDialogDescription>
              This session will be removed from the record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (sessionToDelete !== null) {
                  removeSession(sessionToDelete)
                }
                setDeleteDialogOpen(false)
                setSessionToDelete(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={showDiscardConfirm}
        onOpenChange={setShowDiscardConfirm}
      >
        <AlertDialogContent>
          <button
            onClick={handleCancelDiscard}
            className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Unsaved Changes
            </AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Are you sure you want to discard them?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={handleConfirmDiscard}
            >
              Discard Changes
            </Button>
            <Button
              onClick={async () => {
                setShowDiscardConfirm(false)
                await createRecord()
              }}
            >
              Create Record
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}

export default BackfillModal
