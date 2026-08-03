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

import { Switch } from "@/components/ui/switch"

import { Label } from "@/components/ui/label"

import { Separator } from "@/components/ui/separator"

import {
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react"

import { api } from "@/lib/api"

import toast from "react-hot-toast"
import { isCrossMidnight, validateSessionTimesV2, deriveOffsets, combineFromOffset, toLocalTimeString as toTimeValue, formatLocalTime12h } from "@/lib/dateUtils"
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

interface AttendanceSession {
  _id?: string

  siteId: string

  siteName?: string

  jobId?: string | null

  jobName?: string

  jobCode?: string | null

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

  jobCode?: string | null

  date: string

  status?: "fullday" | "halfday" | "absent"

  isHoliday?: boolean

  holidayReason?: HolidayReason

  holidayHours?: number

  totalWorkHours: number

  overtimeHours: number

  sessions: AttendanceSession[]

  breaksTaken?: number | null

  isSickLeave?: boolean
}


interface EditRecordProps {
  open: boolean

  onClose: () => void

  record: AttendanceRecord | null

  onUpdated: (updatedRecord: AttendanceRecord) => void
}

// --------------------------------------------------
// COMPONENT
// --------------------------------------------------

function EditRecord({ open, onClose, record, onUpdated }: EditRecordProps) {
  const [overlapInfo, setOverlapInfo] =
    useState<any>(null)

  const [overlapIndexes, setOverlapIndexes] =
    useState<number[]>([])

  const [sites, setSites] = useState<Site[]>([])

  const [sessions, setSessions] =
    useState<AttendanceSession[]>([])

  const [sessionErrors, setSessionErrors] = useState<Record<number, string>>({})

  const [saving, setSaving] =
    useState(false)

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



const [deleteDialogOpen, setDeleteDialogOpen] =
  useState(false)

const [sessionToDelete, setSessionToDelete] =
  useState<number | null>(null)

  const [initialSessions, setInitialSessions] = useState<AttendanceSession[]>([])
  const [breaksTaken, setBreaksTaken] = useState<number | null>(null)
  const [initialBreaksTaken, setInitialBreaksTaken] = useState<number | null>(null)
  const [isSickLeave, setIsSickLeave] = useState(false)
  const [initialIsSickLeave, setInitialIsSickLeave] = useState(false)
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

  // Sick leave only applies to a fully empty day (no worked sessions).
  const allSessionsEmpty = sessions.length === 0 || sessions.every(
    (s) => !s.checkIn && !s.checkOut
  )
  const effectiveSickLeave = isSickLeave && allSessionsEmpty

  const isDirty =
    !areSessionsEqual(sessions, initialSessions) ||
    breaksTaken !== initialBreaksTaken ||
    effectiveSickLeave !== initialIsSickLeave


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

  // --------------------------------------------------
  // INITIALIZE
  // --------------------------------------------------

  useEffect(() => {
    setOverlapInfo(null)
    setOverlapIndexes([])
    if (open && record) {
      const cloned = JSON.parse(JSON.stringify(record.sessions || []))
      setSessions(cloned)
      setInitialSessions(JSON.parse(JSON.stringify(record.sessions || [])))
      const bt = record.breaksTaken ?? null
      setBreaksTaken(bt)
      setInitialBreaksTaken(bt)
      const sick = record.isSickLeave ?? false
      setIsSickLeave(sick)
      setInitialIsSickLeave(sick)
    } else {
      setSessions([])
      setInitialSessions([])
      setBreaksTaken(null)
      setInitialBreaksTaken(null)
      setIsSickLeave(false)
      setInitialIsSickLeave(false)
    }
  }, [open, record])


  useEffect(() => {
    fetchSites()
  }, [])

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
    // No overtime on holidays — only holiday hours are credited.
    if (record?.isHoliday) return 0

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
    record?.isHoliday,
    totalWorkHours,
    config.overtimeThreshold,
  ])

  const holidayHours = useMemo(() => {
    if (!record?.isHoliday) return 0

    // The holiday calc uses the raw-hours status (fullday/halfday/absent),
    // matching the server — not display statuses like "sick"/"pending".
    const rawStatus =
      rawHours >= config.fullDayHours
        ? "fullday"
        : rawHours >= config.halfDayHours
          ? "halfday"
          : "absent"

    return computeHolidayHours(totalWorkHours, rawStatus, record?.holidayReason ?? null)
  }, [
    record?.isHoliday,
    record?.holidayReason,
    rawHours,
    totalWorkHours,
    config.fullDayHours,
    config.halfDayHours,
  ])

  const status = useMemo(() => {
    if (effectiveSickLeave) {
      return "sick"
    }

    if (
      rawHours >=
      config.fullDayHours
    ) {
      return "fullday"
    }

    if (
      rawHours >=
      config.halfDayHours
    ) {
      return "halfday"
    }

    const hasCheckInNoCheckOut = sessions && sessions.length > 0 && sessions.some(
      (session) => session && session.checkIn && !session.checkOut
    )
    if (hasCheckInNoCheckOut) {
      return "pending"
    }

    return "absent"
  }, [
    effectiveSickLeave,
    rawHours,
    config.fullDayHours,
    config.halfDayHours,
    sessions,
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

    // Cutoff-free (cutoff redesign): derive day offsets from the raw times — a check-out
    // that reads earlier than the check-in rolls to the next day. No cutoff, so an 08:00
    // night check-out is placed correctly instead of clamping worked hours to 0.
    const { checkInNextDay, checkOutNextDay } = deriveOffsets(checkInVal, checkOutVal)

    updated[index].isNightShift = checkInNextDay || checkOutNextDay

    // Combine date and time from the offsets
    updated[index].checkIn = checkInVal ? combineFromOffset(record?.date || "", checkInVal, checkInNextDay) : null
    updated[index].checkOut = checkOutVal ? combineFromOffset(record?.date || "", checkOutVal, checkOutNextDay) : null
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
      {
        siteId: "",
        jobId: null,
        checkIn: null,
        checkOut: null,
        workedHours: 0,
      },
    ])
  }

  const removeSession = (
    index: number
  ) => {
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
    // SITE VALIDATION
    // -------------------------

    const hasMissingSite =
      sessions.some(
        (session) => !session.siteId
      )

    if (hasMissingSite) {
      toast.error(
        "Every session must have a site selected"
      )

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

    // Validate times using helper
    let hasError = false
    const errors: Record<number, string> = {}
    sessions.forEach((session, index) => {
      const inTime = toTimeValue(session.checkIn)
      const outTime = toTimeValue(session.checkOut)
      const { checkInNextDay, checkOutNextDay } = deriveOffsets(inTime, outTime)
      const err = validateSessionTimesV2(inTime, outTime, checkInNextDay, checkOutNextDay)
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
      isSickLeave: effectiveSickLeave,
    }


      const res = await api.patch(
        `/api/attendance/update/${record.attendanceId}`,
        payload
      )

      onUpdated(res.data.attendance)

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

       setOverlapIndexes([
         overlap.firstIndex,
         overlap.secondIndex,
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
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          handleCloseAttempt()
        }
      }}
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

          {/* SESSIONS */}
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
            {sessions.map(
              (session, index) => {
                const selectedSite =
                  sites.find(
                    (site) =>
                      site._id ===
                      session.siteId
                  )

                return (
                  <div
                    key={
                      session._id ||
                      index
                    }
                    className={`rounded-2xl p-6 shadow-sm space-y-6 transition-colors ${
                      (overlapIndexes.includes(index) || !!sessionErrors[index])
                        ? "border-red-500 bg-red-50 dark:bg-red-950/20"
                        : "border bg-background"
                    }`}
                  >
                    {/* TOP */}
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold">
                          Session{" "}
                          {index + 1}
                        </h3>

                        <p className="text-sm text-muted-foreground">
                          Edit session details
                        </p>

                        {overlapIndexes.includes(index) && (
                          <p className="text-sm text-red-600 font-medium mt-2">
                            This session overlaps with another
                            session.
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

                      {/* TOP ROW */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

                        {/* SITE */}
                        <div className="space-y-2">
                          <p className="text-sm font-medium">
                            Site
                          </p>

                          <Select
                            value={session.siteId}
                            onValueChange={(value) =>
                              updateSessionField(
                                index,
                                "siteId",
                                value
                              )
                            }
                          >
                            <SelectTrigger className="w-full h-11">
                              <SelectValue placeholder="Select site" />
                            </SelectTrigger>

                            <SelectContent>
                              {sites.map((site) => (
                                <SelectItem
                                  key={site._id}
                                  value={site._id}
                                >
                                  {site.siteName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* JOB */}
                        <div className="space-y-2">
                          <p className="text-sm font-medium">
                            Job
                          </p>

                          <Select
                            value={session.jobId || ""}
                            onValueChange={(value) =>
                              updateSessionField(
                                index,
                                "jobId",
                                value
                              )
                            }
                          >
                            <SelectTrigger className="w-full h-11">
                              <SelectValue placeholder="Select job" />
                            </SelectTrigger>

                            <SelectContent>
                              {selectedSite?.jobs.map(
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
                        </div>
                      </div>

                      {/* BOTTOM ROW */}
                      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">

                        {/* CHECK IN */}
                        <div className="space-y-2">
                          <p className="text-sm font-medium">
                            Check In
                          </p>

                          <Input
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

                      {sessionErrors[index] && (
                        <div className="text-red-500 text-sm font-medium mt-2">
                          {sessionErrors[index]}
                        </div>
                      )}
                    </div>
                  </div>
                )
              }
            )}
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

          {overlapInfo && (
            <div className="rounded-xl border border-red-500 bg-red-50 p-4 dark:bg-red-950/20 dark:border-red-800/30">
              <h4 className="font-semibold text-red-700 dark:text-red-200">
                Session Overlap Detected
              </h4>

              <div className="mt-3 text-sm text-red-700 dark:text-red-300 space-y-2">
                <div>
                  <strong>
                    Session{" "}
                    {overlapInfo.firstIndex + 1}
                  </strong>

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
                  <strong>
                    Session{" "}
                    {overlapInfo.secondIndex + 1}
                  </strong>

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

            {record?.isHoliday && (
              <>
                <Separator />

                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-muted-foreground">
                      Holiday Hours
                    </p>

                    <Badge
                      variant="secondary"
                      className="bg-yellow-100 text-yellow-800 border-yellow-300 text-xs"
                    >
                      {record.holidayReason === "weekly"
                        ? "Weekly Holiday"
                        : "Public Holiday"}
                    </Badge>
                  </div>

                  <p className="text-3xl font-bold">
                    {holidayHours} hrs
                  </p>
                </div>
              </>
            )}

            <Separator />

            <div>
              <p className="text-sm text-muted-foreground">
                Attendance Status
              </p>

              <Badge
                variant={
                  status === "absent" ? "destructive" : "secondary"
                }
                className={`mt-2 text-sm ${
                  status === "fullday"
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25 border-transparent"
                    : status === "pending"
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25 border-transparent"
                      : status === "sick"
                        ? "bg-sky-500/15 text-sky-700 dark:text-sky-400 hover:bg-sky-500/25 border-transparent"
                        : ""
                }`}
              >
                {status === "sick" ? "Sick Leave" : status}
              </Badge>
            </div>

            <Separator />

            {/* SICK LEAVE TOGGLE — only valid for a fully empty day */}
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="sick-leave" className="text-sm font-medium">
                  Sick Leave
                </Label>
                <p className="text-xs text-muted-foreground max-w-md">
                  {allSessionsEmpty
                    ? "Mark this absent day as sick leave. Has no effect on pay."
                    : "Clear all check-in/out times to mark this day as sick leave."}
                </p>
              </div>
              <Switch
                id="sick-leave"
                checked={effectiveSickLeave}
                disabled={!allSessionsEmpty}
                onCheckedChange={setIsSickLeave}
              />
            </div>
          </div>

         
        </div>

        {/* FOOTER */}
        <div className="border-t bg-background px-8 py-5 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={handleCloseAttempt}
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

export default EditRecord