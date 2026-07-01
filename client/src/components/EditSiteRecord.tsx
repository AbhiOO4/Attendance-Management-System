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

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Badge } from "@/components/ui/badge"

import { Separator } from "@/components/ui/separator"

import {
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
  Undo,
} from "lucide-react"

import { api } from "@/lib/api"

import toast from "react-hot-toast"
import { isCrossMidnight, validateSessionTimes, combineDateAndTime, toLocalTimeString as toTimeValue } from "@/lib/dateUtils"

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

interface AttendanceSession {
  _id?: string

  siteId: string
  siteName?: string

  jobId?: string | null
  jobName?: string

  checkIn?: string | null

  checkOut?: string | null

  workedHours: number

  isNightShift?: boolean

  markedBy?: string
}

export interface AttendanceRecord {
  attendanceId: string

  employee: string

  name: string

  employeeId: string

  jobTitle: string

  siteId?: string

  siteName?: string

  jobId?: string | null

  jobName?: string

  date: string

  status: "fullday" | "halfday" | "absent"

  isHoliday?: boolean

  totalWorkHours: number

  overtimeHours: number

  sessions: AttendanceSession[]
}

interface EditSiteRecordProps {
  open: boolean
  onClose: () => void
  attendanceId: string | null
  site: Site
  onUpdated: (updatedRecord: AttendanceRecord) => void
}

// --------------------------------------------------
// COMPONENT
// --------------------------------------------------

function EditSiteRecord({ open, onClose, attendanceId, site, onUpdated }: EditSiteRecordProps) {
  const [, setOverlapInfo] =
    useState<any>(null)

  const [overlapSessionIds, setOverlapSessionIds] = useState<string[]>([])

  const [record, setRecord] =
    useState<AttendanceRecord | null>(null)

  const [sessions, setSessions] =
    useState<AttendanceSession[]>([])

  const [saving, setSaving] =
    useState(false)

  const [addingSession, setAddingSession] =
    useState(false)

  const [config, setConfig] =
    useState({
      fullDayHours: 8,
      halfDayHours: 4,
      overtimeThreshold: 8,
      nightShiftCutoffHour: 7,
      breakDurationMinutes: 60,
    })

  const [breaksTaken, setBreaksTaken] = useState<number | null>(null)
  const [initialBreaksTaken, setInitialBreaksTaken] = useState<number | null>(null)


const [deleteDialogOpen, setDeleteDialogOpen] =
  useState(false)

  const [sessionToDelete, setSessionToDelete] =
    useState<number | null>(null)

  const [lastClearedSession, setLastClearedSession] = useState<{
    index: number
    checkIn: string | null
    checkOut: string | null
    workedHours: number
    isNightShift: boolean
  } | null>(null)

  const [sessionErrors, setSessionErrors] = useState<Record<number, string>>({})

  const [initialSessions, setInitialSessions] = useState<AttendanceSession[]>([])
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)

  const isSameDateStr = (d1?: string | null, d2?: string | null) => {
    if (!d1 && !d2) return true
    if (!d1 || !d2) return false
    const t1 = new Date(d1).getTime()
    const t2 = new Date(d2).getTime()
    return t1 === t2
  }

  const areSessionsEqual = (s1: AttendanceSession[], s2: AttendanceSession[]) => {
    if (s1.length !== s2.length) return false
    for (let i = 0; i < s1.length; i++) {
      const a = s1[i]
      const b = s2[i]
      if (a.siteId !== b.siteId) return false
      if ((a.jobId || null) !== (b.jobId || null)) return false
      if (!isSameDateStr(a.checkIn, b.checkIn)) return false
      if (!isSameDateStr(a.checkOut, b.checkOut)) return false
    }
    return true
  }

  const isDirty = !areSessionsEqual(sessions, initialSessions) || breaksTaken !== initialBreaksTaken


  const handleManualClose = () => {
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

  // --------------------------------------------------
  // INITIALIZE
  // --------------------------------------------------

  const fetchAttendanceRecord = async () => {
    try {
      if (!attendanceId) return

      const res = await api.get(`/api/attendance/${attendanceId}`)

      const attendance = res.data

      setRecord(attendance)

      const cloned = JSON.parse(JSON.stringify(attendance.sessions || []))
      setSessions(cloned)
      setInitialSessions(JSON.parse(JSON.stringify(attendance.sessions || [])))
      const bt = attendance.breaksTaken ?? null
      setBreaksTaken(bt)
      setInitialBreaksTaken(bt)
    } catch (error) {
      console.log(error)

      toast.error(
        "Failed to load attendance record"
      )
    }
  }

  useEffect(() => {
    setOverlapInfo(null)
    setOverlapSessionIds([])
    setLastClearedSession(null)
    setSessionErrors({})
    if (open && attendanceId) {
      fetchAttendanceRecord()
    } else {
      setSessions([])
      setInitialSessions([])
    }
  }, [open, attendanceId])

  useEffect(() => {
    fetchConfig()
  }, [])

  // --------------------------------------------------
  // FETCHERS
  // --------------------------------------------------


  const fetchConfig = async () => {
    try {
      const res = await api.get(
        "/api/config"
      )

      setConfig({
        fullDayHours:
          res.data.data.fullDayHours,
        halfDayHours:
          res.data.data.halfDayHours,
        overtimeThreshold:
          res.data.data
            .overtimeThreshold,
        nightShiftCutoffHour:
          res.data.data.nightShiftCutoffHour ?? 7,
        breakDurationMinutes:
          res.data.data.breakDurationMinutes ?? 60,
      })
    } catch (error) {
      console.log(error)
    }
  }

  // --------------------------------------------------
  // HELPERS
  // --------------------------------------------------

  const calculateWorkedHours = (
    checkIn?: string | null,
    checkOut?: string | null
  ) => {
    if (!checkIn || !checkOut)
      return 0

    const start = new Date(checkIn)
    const end = new Date(checkOut)

    const hours =
      (end.getTime() -
        start.getTime()) /
      (1000 * 60 * 60)

    if (hours < 0) return 0

    return Number(hours.toFixed(2))
  }

  // --------------------------------------------------
  // DERIVED VALUES
  // --------------------------------------------------

  const rawHours = useMemo(() => {
    return Number(
      sessions
        .reduce(
          (acc, curr) =>
            acc + curr.workedHours,
          0
        )
        .toFixed(2)
    )
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

  const overtimeHours = useMemo(() => {
    if (
      totalWorkHours <=
      config.overtimeThreshold
    )
      return 0

    return Number(
      (
        totalWorkHours -
        config.overtimeThreshold
      ).toFixed(2)
    )
  }, [
    totalWorkHours,
    config.overtimeThreshold,
  ])


  // --------------------------------------------------
  // HANDLERS
  // --------------------------------------------------

 const updateSessionField = (
  index: number,
  field: keyof AttendanceSession | "isNightShift",
  value: any
 ) => {
  const updated = [...sessions]

  if (field === "isNightShift") {
    return
  }

  if (field === "checkIn" || field === "checkOut") {
    const checkInVal = field === "checkIn" ? value : toTimeValue(updated[index].checkIn)
    const checkOutVal = field === "checkOut" ? value : toTimeValue(updated[index].checkOut)

    // Auto-detect and preserve night shift based on original session state, preventing keystroke pollution
    const originalSession = record?.sessions?.find((s: any) => s._id === updated[index]._id)
    const originalIsNight = originalSession?.isNightShift || false
    let nextIsNight = false
    if (checkInVal) {
      const [inH] = checkInVal.split(":").map(Number)
      const isDayOnlyCheckIn = inH >= config.nightShiftCutoffHour && inH < 12 // 7 AM to 12 PM
      if (originalIsNight) {
        nextIsNight = !isDayOnlyCheckIn
      } else {
        const inRange = inH >= 0 && inH < config.nightShiftCutoffHour
        const crossesMidnight = checkOutVal ? isCrossMidnight(checkInVal, checkOutVal, false) : false
        nextIsNight = inRange || crossesMidnight
      }
    } else {
      nextIsNight = originalIsNight
    }

    updated[index].isNightShift = nextIsNight

    // Combine date and time
    updated[index].checkIn = checkInVal ? combineDateAndTime(record?.date || "", checkInVal, undefined, nextIsNight, config.nightShiftCutoffHour) : null
    updated[index].checkOut = checkOutVal ? combineDateAndTime(record?.date || "", checkOutVal, checkInVal, nextIsNight, config.nightShiftCutoffHour) : null
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
  setOverlapSessionIds([])
  setSessions(updated)
 }

const addSession = async () => {
  try {
    if (!record || addingSession) return

    // Check if there is any incomplete session in the current list
    const hasIncomplete = sessions.some((s) => !s.checkIn || !s.checkOut)
    if (hasIncomplete) {
      toast.error("Please complete check-in and check-out for the existing session first.")
      return
    }

    setAddingSession(true)

    const payload = {
      session: {
        siteId: site._id,
        jobId: record.jobId || null,
        checkIn: null,
        checkOut: null,
      }
    }

    const res = await api.post(
      `/api/attendance/${record.attendanceId}/sessions`,
      payload
    )

    setSessions((prev) => [
      ...prev,
      res.data.session,
    ])

    // toast.success("Session added")
  } catch (error) {
    console.log(error)

    toast.error(
      "Failed to create session"
    )
  } finally {
    setAddingSession(false)
  }
}

  const clearModalSession = (index: number) => {
    const session = sessions[index]
    if (session) {
      setLastClearedSession({
        index,
        checkIn: session.checkIn ?? null,
        checkOut: session.checkOut ?? null,
        workedHours: session.workedHours,
        isNightShift: session.isNightShift ?? false,
      })
    }

    const updated = [...sessions]
    updated[index].checkIn = null
    updated[index].checkOut = null
    updated[index].workedHours = 0
    updated[index].isNightShift = session?.isNightShift ?? false
    setSessions(updated)
  }

  const undoClearModalSession = () => {
    if (!lastClearedSession) return
    const index = lastClearedSession.index
    const updated = [...sessions]
    if (updated[index]) {
      updated[index].checkIn = lastClearedSession.checkIn
      updated[index].checkOut = lastClearedSession.checkOut
      updated[index].workedHours = lastClearedSession.workedHours
      updated[index].isNightShift = lastClearedSession.isNightShift
      setSessions(updated)
    }
    setLastClearedSession(null)
  }

  const removeSession = (
    index: number
  ) => {
    const sessionToRemove = sessions[index];
    if (!sessionToRemove) return;

    // Filter sessions to only the ones belonging to the current site
    const currentSiteSessions = sessions.filter(
      (s) => String(s.siteId) === String(site._id)
    );

    if (String(sessionToRemove.siteId) === String(site._id) && currentSiteSessions.length <= 1) {
      return toast.error("Cannot delete the only session for this site. You can leave its times blank instead.");
    }

    const updated = [...sessions]
    updated.splice(index, 1)
    setSessions(updated)
  }

  // --------------------------------------------------
  // SAVE
  // --------------------------------------------------

 const updateARecord = async () => {
  try {
    if (!record) return
    // -------------------------
    // CHECK-IN / CHECK-OUT VALIDATION
    // -------------------------

     // Validate times using helper
     let hasError = false
     const errors: Record<number, string> = {}
     sessions.forEach((session, index) => {
       const inTime = toTimeValue(session.checkIn)
       const outTime = toTimeValue(session.checkOut)
       const err = validateSessionTimes(inTime, outTime, session.isNightShift, config.nightShiftCutoffHour)
       if (err) {
         errors[index] = err
         hasError = true
       }
     })

     if (hasError) {
       setSessionErrors(errors)
       return
     }
     setSessionErrors({})

    // Sort sessions chronologically by checkIn datetime. Empty checkIns go last.
    const sortedSessions = [...sessions].sort((a, b) => {
      if (!a.checkIn && !b.checkIn) return 0
      if (!a.checkIn) return 1
      if (!b.checkIn) return -1
      return new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime()
    })

    setSessions(sortedSessions)

    setSaving(true)

    const payload = {
      sessions: sortedSessions.map(
        (session) => ({
          _id: session._id,
          siteId: session.siteId,
          jobId: session.jobId || null,
          checkIn: session.checkIn || null,
          checkOut: session.checkOut || null,
          isNightShift: session.isNightShift || false,
        })
      ),
      breaksTaken,
    }

      const res = await api.patch(
        `/api/attendance/update/${record.attendanceId}?siteId=${site._id}`,
        payload
      )

    const updatedRecord = {
      ...res.data.attendance,
      sessions: res.data.attendance.sessions.filter(
        (session: AttendanceSession) =>
          String(session.siteId) === String(site._id)
      ),
    }

      onUpdated(updatedRecord)

      toast.success(
        "Attendance updated successfully"
      )

      onClose()
   } catch (error: any) {
     console.log(error)

     const overlap =
       error?.response?.data?.overlap

     if (overlap) {
       setOverlapInfo(overlap)

       setOverlapSessionIds([
         overlap.sessionA._id,
         overlap.sessionB._id,
       ])

       toast.error(
         error.response.data.message
       )

       return
     }

     toast.error(
       error?.response?.data?.message ||
       "Failed to update attendance"
     )
   } finally {
     setSaving(false)
   }
 }

  // --------------------------------------------------
  // UTIL
  // --------------------------------------------------



  // --------------------------------------------------
  // RENDER
  // --------------------------------------------------


  return (
    <Dialog
      open={open}
      onOpenChange={handleManualClose}
    >
      <DialogContent className="!w-[92vw] !max-w-[1000px] h-[92vh] overflow-hidden p-0 flex flex-col rounded-2xl">

        {/* HEADER */}
        <div className="border-b bg-background px-8 py-5">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">
              Edit Attendance Record
            </DialogTitle>
          </DialogHeader>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">

          {/* EMPLOYEE INFO */}
          <div className="rounded-2xl border bg-muted/20 p-6">
            <h2 className="text-2xl font-bold">
              {record?.name}
            </h2>

            <div className="mt-2 space-y-1">
              <p className="text-sm text-muted-foreground">
                Employee ID:{" "}
                <span className="font-medium text-foreground">
                  {record?.employeeId}
                </span>
              </p>

              <p className="text-sm text-muted-foreground">
                Job Title:{" "}
                <span className="font-medium text-foreground">
                  {record?.jobTitle}
                </span>
              </p>
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
                  onClick={() => setBreaksTaken((prev) => Math.max(0, (prev ?? Math.floor(sessions.reduce((s, x) => s + x.workedHours, 0) / config.fullDayHours)) - 1))}
                >−</button>

                <span className="min-w-[60px] text-center text-sm font-medium">
                  {breaksTaken !== null
                    ? `${breaksTaken}`
                    : `Auto · ${Math.floor(sessions.reduce((s, x) => s + x.workedHours, 0) / config.fullDayHours)}`}
                </span>

                <button
                  type="button"
                  className="h-7 w-7 rounded-md border text-sm font-bold hover:bg-muted transition-colors"
                  onClick={() => setBreaksTaken((prev) => (prev ?? Math.floor(sessions.reduce((s, x) => s + x.workedHours, 0) / config.fullDayHours)) + 1)}
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
            {sessions.map((session, index) => {
              const isEditable =
                String(session.siteId) === String(site._id)

              const hasOverlap =
                session._id &&
                overlapSessionIds.includes(
                  String(session._id)
                )

              const hasError = !!sessionErrors[index]

              return (
                <div
                  key={session._id || index}
                  className={`rounded-2xl p-6 shadow-sm space-y-6 transition-colors ${(hasOverlap || hasError)
                      ? "border-red-500 bg-red-50 dark:bg-red-950/20"
                      : isEditable
                        ? "border bg-background"
                        : "border bg-muted/20 opacity-50"
                    }`}
                >
                  {/* TOP */}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold">
                          Session {index + 1}
                        </h3>

                        {!isEditable && (
                          <Badge variant="secondary">
                            Read Only
                          </Badge>
                        )}
                      </div>

                      <p className="text-sm text-muted-foreground">
                        Site:{" "}
                        {session.siteName || isEditable ? site.siteName : "Unknown Site"}
                      </p>

                      {hasOverlap && (
                          <p className="text-sm text-red-600 font-medium mt-2">
                            This session overlaps
                            with another session.
                          </p>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                      {isEditable && (
                        <Button
                          variant="destructive"
                          size="icon"
                          onClick={() => {
                            const currentSiteSessions = sessions.filter(
                              (s) => String(s.siteId) === String(site._id)
                            )
                            if (currentSiteSessions.length <= 1) {
                              toast.error("Cannot delete the only session for this site. You can leave its times blank instead.")
                              return
                            }
                            setSessionToDelete(
                              index
                            )

                            setDeleteDialogOpen(
                              true
                            )
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* FORM */}
                  <div className="space-y-5">

                    {/* JOB */}
                    <div className="space-y-2">
                      <p className="text-sm font-medium">
                        Job
                      </p>

                      {isEditable ? (
                        <Select
                          value={
                            session.jobId ||
                            "not-assigned"
                          }
                          onValueChange={(
                            value
                          ) =>
                            updateSessionField(
                              index,
                              "jobId",
                              value ===
                                "not-assigned"
                                ? null
                                : value
                            )
                          }
                        >
                          <SelectTrigger className="w-full h-11">
                            <SelectValue placeholder="Select job" />
                          </SelectTrigger>

                          <SelectContent>
                            <SelectItem value="not-assigned">
                              Not Assigned
                            </SelectItem>

                            {site.jobs.map(
                              (job) => (
                                <SelectItem
                                  key={job._id}
                                  value={job._id}
                                >
                                  {job.name}
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          readOnly
                          value={
                            session.jobName ||
                            "Not Assigned"
                          }
                        />
                      )}
                    </div>

                    {/* TIMES */}
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">

                      {/* CHECK IN */}
                      <div className="space-y-2">
                        <p className="text-sm font-medium">
                          Check In
                        </p>

                        <Input
                          disabled={!isEditable}
                          className="w-full h-11"
                          type="time"
                          value={toTimeValue(
                            session.checkIn
                          )}
                          onChange={(e) =>
                            updateSessionField(
                              index,
                              "checkIn",
                              e.target.value
                            )
                          }
                        />
                      </div>

                      {/* CHECK OUT */}
                      <div className="space-y-2">
                        <p className="text-sm font-medium">
                          Check Out
                        </p>

                        <Input
                          disabled={!isEditable}
                          className="w-full h-11"
                          type="time"
                          value={toTimeValue(
                            session.checkOut
                          )}
                          onChange={(e) =>
                            updateSessionField(
                              index,
                              "checkOut",
                              e.target.value
                            )
                          }
                        />
                      </div>

                      {/* SHIFT */}
                      <div className="space-y-2">
                        <p className="text-sm font-medium">
                          Shift
                        </p>

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
                        <p className="text-sm font-medium">
                          Worked Hours
                        </p>

                        <Input
                          readOnly
                          className="h-11 font-medium"
                          value={`${session.workedHours} hrs`}
                        />
                      </div>
                    </div>
                    {isEditable && (
                      <div className="flex justify-end pt-4 border-t mt-4">
                        {lastClearedSession && lastClearedSession.index === index && !session.checkIn && !session.checkOut ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex items-center gap-1.5"
                            onClick={undoClearModalSession}
                          >
                            <Undo className="h-4 w-4" />
                            Undo
                          </Button>
                        ) : (session.checkIn || session.checkOut) ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => clearModalSession(index)}
                          >
                            Absent
                          </Button>
                        ) : null}
                      </div>
                    )}
                    {sessionErrors[index] && (
                      <div className="text-red-500 text-sm font-medium mt-2">
                        {sessionErrors[index]}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ADD SESSION */}
          <Button
            variant="outline"
            onClick={addSession}
            disabled={addingSession}
            className="w-full border-dashed h-11"
          >
            {addingSession ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            {addingSession ? "Adding Session..." : "Add New Session"}
          </Button>

          

          {/* SUMMARY */}
          <div className="rounded-2xl border bg-muted/20 p-6 space-y-4">

            <div>
              <p className="text-sm text-muted-foreground">
                Total Work Hours
              </p>

              <p className="text-3xl font-bold">
                {totalWorkHours} hrs
              </p>
            </div>

            <Separator />

            <div>
              <p className="text-sm text-muted-foreground">
                Overtime Hours
              </p>

              <p className="text-3xl font-bold">
                {overtimeHours} hrs
              </p>
            </div>

           

           
          </div>

         
        </div>

        {/* FOOTER */}
        <div className="border-t bg-background px-8 py-5 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={handleManualClose}
          >
            Cancel
          </Button>

          <Button
            onClick={updateARecord}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </DialogContent>
      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete Session?
            </AlertDialogTitle>

            <AlertDialogDescription>
              This session will be permanently removed from the attendance record.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>
              Cancel
            </AlertDialogCancel>

            <AlertDialogAction
              onClick={() => {
                if (
                  sessionToDelete !== null
                ) {
                  removeSession(
                    sessionToDelete
                  )
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
                await updateARecord()
              }}
            >
              Save Changes
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}

export default EditSiteRecord