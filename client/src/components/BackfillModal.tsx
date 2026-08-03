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
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import {
  Loader2,
  Plus,
  Save,
  Trash2,
  UserPlus,
  X,
} from "lucide-react"

import { api } from "@/lib/api"
import toast from "react-hot-toast"
import { isCrossMidnight, combineFromOffset, deriveOffsets, toLocalTimeString as toTimeValue, formatLocalTime12h } from "@/lib/dateUtils"
import { computeHolidayHours, type HolidayReason } from "@/lib/attendanceUtils"
import { useWorkConfig } from "@/context/WorkConfigContext"

// --------------------------------------------------
// TYPES
// --------------------------------------------------

interface Job {
  _id: string
  name: string
}

interface Site {
  _id: string
  siteName: string
  locationDetails: string
  isActive: boolean
  jobs: Job[]
}

interface SessionDraft {
  siteId: string
  siteName?: string
  jobId?: string | null
  jobName?: string
  checkIn?: string | null
  checkOut?: string | null
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
      const res = await api.get("/api/site")
      setSites(res.data || [])
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

  const rawHours = useMemo(() => {
    return Number(sessions.reduce((acc, curr) => acc + curr.workedHours, 0).toFixed(2))
  }, [sessions])

  const autoBreaks = useMemo(() => {
    return config.fullDayHours > 0 ? Math.floor(rawHours / config.fullDayHours) : 0
  }, [rawHours, config.fullDayHours])

  const breaksApplied = useMemo(() => {
    return (breaksTaken !== null && breaksTaken !== undefined) ? breaksTaken : autoBreaks
  }, [breaksTaken, autoBreaks])

  const totalWorkHours = useMemo(() => {
    const breakHrs = breaksApplied * (config.breakDurationMinutes / 60)
    return Number(Math.max(rawHours - breakHrs, 0).toFixed(2))
  }, [rawHours, breaksApplied, config.breakDurationMinutes])

  const status = useMemo(() => {
    if (rawHours >= config.fullDayHours) return "fullday"
    if (rawHours >= config.halfDayHours) return "halfday"
    return "absent"
  }, [rawHours, config.fullDayHours, config.halfDayHours])

  const overtimeHours = useMemo(() => {
    // No overtime on holidays — only holiday hours are credited.
    if (holidayInfo.isHoliday) return 0
    if (totalWorkHours <= config.overtimeThreshold) return 0
    return Number((totalWorkHours - config.overtimeThreshold).toFixed(2))
  }, [holidayInfo.isHoliday, totalWorkHours, config.overtimeThreshold])

  const holidayHours = useMemo(() => {
    if (!holidayInfo.isHoliday) return 0
    return computeHolidayHours(totalWorkHours, status, holidayInfo.reason)
  }, [holidayInfo, totalWorkHours, status])


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

    if (field === "checkIn" || field === "checkOut") {
      const checkInVal = field === "checkIn" ? value : toTimeValue(updated[index].checkIn)
      const checkOutVal = field === "checkOut" ? value : toTimeValue(updated[index].checkOut)

      // Times combine literally with the day being backfilled; a check-out earlier than its
      // check-in rolls to the next calendar day (the standard offset rule).
      const { checkInNextDay, checkOutNextDay } = deriveOffsets(checkInVal, checkOutVal)

      updated[index].isNightShift = checkInNextDay || checkOutNextDay

      updated[index].checkIn = checkInVal ? combineFromOffset(date, checkInVal, checkInNextDay) : null
      updated[index].checkOut = checkOutVal ? combineFromOffset(date, checkOutVal, checkOutNextDay) : null
      updated[index].workedHours = calculateWorkedHours(
        updated[index].checkIn,
        updated[index].checkOut
      )
    } else {
      updated[index] = {
        ...updated[index],
        [field as any]: value,
      }

      if (field === "siteId") {
        updated[index].jobId = null
      }
    }

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
      { siteId: "", jobId: null, checkIn: null, checkOut: null, workedHours: 0 },
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

    // Cutoff-free: the only structural rule left is that a check-out needs a check-in.
    // Cross-day double-pay is caught by the server's overlap check against the
    // neighbouring days' records.
    let hasError = false
    const errors: Record<number, string> = {}
    sessions.forEach((session, index) => {
      const inTime = toTimeValue(session.checkIn)
      const outTime = toTimeValue(session.checkOut)
      if (!inTime && outTime) {
        errors[index] = "Check-out cannot exist without check-in"
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
          jobId: s.jobId || null,
          checkIn: s.checkIn ? toTimeValue(s.checkIn) : null,
          checkOut: s.checkOut ? toTimeValue(s.checkOut) : null,
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
      <DialogContent className="!w-[92vw] !max-w-[1000px] h-[92vh] overflow-hidden p-0 flex flex-col rounded-2xl">

        {/* HEADER */}
        <div className="border-b bg-background px-8 py-5">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
                <UserPlus className="h-5 w-5 text-primary" />
              </div>
              <DialogTitle className="text-2xl font-bold">
                Backfill Attendance Record
              </DialogTitle>
            </div>
          </DialogHeader>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">

          {/* EMPLOYEE INFO */}
          <div className="rounded-2xl border bg-muted/20 p-6">
            <h2 className="text-2xl font-bold">{employee?.name}</h2>
            <div className="mt-2 space-y-1">
              <p className="text-sm text-muted-foreground">
                Employee ID:{" "}
                <span className="font-medium text-foreground">{employee?.employeeId}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                Job Title:{" "}
                <span className="font-medium text-foreground">{employee?.jobTitle}</span>
              </p>
              {employee?.currentSite && (
                <p className="text-sm text-muted-foreground">
                  Assigned Site:{" "}
                  <span className="font-medium text-foreground">{employee.currentSite.siteName}</span>
                </p>
              )}
            </div>
          </div>

          {/* BREAK CONTROL — record-level, above sessions */}
          {config.breakDurationMinutes > 0 && (
            <div className="flex flex-wrap items-center gap-2 md:gap-3 rounded-xl border bg-muted/10 px-4 py-3">
              <span className="text-sm text-muted-foreground shrink-0">☕ Breaks taken:</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="h-7 w-7 rounded-md border text-sm font-bold hover:bg-muted transition-colors disabled:opacity-40"
                  disabled={breaksTaken !== null && breaksTaken <= 0}
                  onClick={() => setBreaksTaken((prev) => Math.max(0, (prev ?? autoBreaks) - 1))}
                >−</button>

                <span className="min-w-[60px] text-center text-sm font-medium">
                  {breaksTaken !== null
                    ? `${breaksTaken}`
                    : `Auto · ${autoBreaks}`}
                </span>

                <button
                  type="button"
                  className="h-7 w-7 rounded-md border text-sm font-bold hover:bg-muted transition-colors"
                  onClick={() => setBreaksTaken((prev) => (prev ?? autoBreaks) + 1)}
                >+</button>

                {breaksTaken !== null && (
                  <button
                    type="button"
                    className="ml-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setBreaksTaken(null)}
                    title="Reset to auto"
                  >✕ auto</button>
                )}
              </div>
              <span className="text-xs text-muted-foreground sm:ml-auto">
                ({config.breakDurationMinutes} min/break)
              </span>
            </div>
          )}

          {/* SESSIONS */}
          <div className="space-y-5">
            {sessions.length === 0 && (
              <div className="rounded-2xl border border-dashed bg-muted/10 p-8 text-center text-muted-foreground">
                <UserPlus className="mx-auto mb-3 h-8 w-8 opacity-40" />
                <p className="text-sm">No sessions added yet.</p>
                <p className="text-xs mt-1">Click "Add New Session" below to add attendance sessions, or save as absent.</p>
              </div>
            )}

            {sessions.map((session, index) => {
              const selectedSite = sites.find((site) => site._id === session.siteId)
              return (
                <div
                  key={index}
                  className={`rounded-2xl p-6 shadow-sm space-y-6 transition-colors ${
                    (overlapIndexes.includes(index) || !!sessionErrors[index])
                      ? "border-red-500 bg-red-50 dark:bg-red-950/20"
                      : "border bg-background"
                  }`}
                >
                  {/* TOP */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">Session {index + 1}</h3>
                      <p className="text-sm text-muted-foreground">Add session details</p>
                      {overlapIndexes.includes(index) && (
                        <p className="text-sm text-red-600 font-medium mt-2">
                          This session overlaps with another session.
                        </p>
                      )}
                    </div>
                    <Button
                      variant="destructive"
                      size="icon"
                      onClick={() => {
                        setSessionToDelete(index)
                        setDeleteDialogOpen(true)
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* FORM */}
                  <div className="space-y-5">
                    {/* TOP ROW — site + job */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                      {/* SITE */}
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Site</p>
                        <Select
                          value={session.siteId}
                          onValueChange={(value) => updateSessionField(index, "siteId", value)}
                        >
                          <SelectTrigger className="w-full h-11">
                            <SelectValue placeholder="Select site" />
                          </SelectTrigger>
                          <SelectContent>
                            {sites.map((site) => (
                              <SelectItem key={site._id} value={site._id}>
                                {site.siteName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* JOB */}
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Job</p>
                        <Select
                          value={session.jobId || ""}
                          onValueChange={(value) => updateSessionField(index, "jobId", value)}
                        >
                          <SelectTrigger className="w-full h-11">
                            <SelectValue placeholder="Select job" />
                          </SelectTrigger>
                          <SelectContent>
                            {selectedSite?.jobs.map((job) => (
                              <SelectItem key={job._id} value={job._id}>
                                {job.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* BOTTOM ROW — check in, out, shift, worked */}
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
                      {/* CHECK IN */}
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Check In</p>
                        <Input
                          className="w-full h-11"
                          type="time"
                          value={toTimeValue(session.checkIn)}
                          onChange={(e) => updateSessionField(index, "checkIn", e.target.value)}
                        />
                      </div>

                      {/* CHECK OUT */}
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Check Out</p>
                        <Input
                          className="w-full h-11"
                          type="time"
                          value={toTimeValue(session.checkOut)}
                          onChange={(e) => updateSessionField(index, "checkOut", e.target.value)}
                        />
                      </div>

                      {/* SHIFT */}
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Shift</p>
                        <div className="flex items-center gap-2 h-11">
                          {(session.isNightShift || (toTimeValue(session.checkIn) && toTimeValue(session.checkOut) && isCrossMidnight(toTimeValue(session.checkIn), toTimeValue(session.checkOut), session.isNightShift))) ? (
                            <span className="inline-flex items-center gap-1.5 text-indigo-600 font-medium text-sm">
                              🌙 Night
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-sm font-medium">☀️ Day</span>
                          )}
                        </div>
                      </div>

                      {/* WORKED HOURS */}
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Worked Hours</p>
                        <Input
                          readOnly
                          className="h-11 font-medium"
                          value={`${session.workedHours} hrs`}
                        />
                      </div>
                    </div>
                  </div>
                  {sessionErrors[index] && (
                    <div className="text-red-500 text-sm font-medium mt-2">
                      {sessionErrors[index]}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ADD SESSION */}
          <Button
            variant="outline"
            onClick={addSession}
            className="w-full border-dashed h-11"
          >
            <Plus className="mr-2 h-4 w-4" />
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
                  {overlapInfo.sessionA.checkIn
                    ? formatLocalTime12h(overlapInfo.sessionA.checkIn)
                    : "-"}
                  <br />
                  Check Out:{" "}
                  {overlapInfo.sessionA.checkOut
                    ? formatLocalTime12h(overlapInfo.sessionA.checkOut)
                    : "-"}
                </div>
                <div>
                  <strong>Session {overlapInfo.secondIndex + 1}</strong>
                  <br />
                  Check In:{" "}
                  {overlapInfo.sessionB.checkIn
                    ? formatLocalTime12h(overlapInfo.sessionB.checkIn)
                    : "-"}
                  <br />
                  Check Out:{" "}
                  {overlapInfo.sessionB.checkOut
                    ? formatLocalTime12h(overlapInfo.sessionB.checkOut)
                    : "-"}
                </div>
              </div>
            </div>
          )}

          {/* SUMMARY */}
          <div className="rounded-2xl border bg-muted/20 p-6 space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Total Work Hours</p>
              <p className="text-3xl font-bold">{totalWorkHours} hrs</p>
            </div>
            <Separator />
            <div>
              <p className="text-sm text-muted-foreground">Overtime Hours</p>
              <p className="text-3xl font-bold">{overtimeHours} hrs</p>
            </div>
            {holidayInfo.isHoliday && (
              <>
                <Separator />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-muted-foreground">Holiday Hours</p>
                    <Badge
                      variant="secondary"
                      className="bg-yellow-100 text-yellow-800 border-yellow-300 text-xs"
                    >
                      {holidayInfo.reason === "weekly" ? "Weekly Holiday" : "Public Holiday"}
                    </Badge>
                  </div>
                  <p className="text-3xl font-bold">{holidayHours} hrs</p>
                </div>
              </>
            )}
            <Separator />
            <div>
              <p className="text-sm text-muted-foreground">Attendance Status</p>
              <Badge className="mt-2 text-sm">{status}</Badge>
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div className="border-t bg-background px-8 py-5 flex justify-end gap-3">
          <Button variant="outline" onClick={handleCloseAttempt}>
            Cancel
          </Button>
          <Button onClick={createRecord} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
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
