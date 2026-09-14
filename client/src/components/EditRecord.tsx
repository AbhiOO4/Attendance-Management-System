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

import AttendanceRecordHistory from "@/components/AttendanceRecordHistory"

import { Switch } from "@/components/ui/switch"

import { Label } from "@/components/ui/label"

import {
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
  Moon,
  Sun,
} from "lucide-react"

import { api } from "@/lib/api"

import toast from "react-hot-toast"
import { isCrossMidnight, validateSessionTimesV2, deriveOffsets, combineFromOffset, isNextDayInstant, formatOffsetDayLabel, toLocalTimeString as toTimeValue, formatLocalTime12h } from "@/lib/dateUtils"
import { computeAutoBreaks, computeHolidayHours, type HolidayReason } from "@/lib/attendanceUtils"
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

  isLop?: boolean
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
      weeklyHolidayAwardEnabled: workConfig?.weeklyHolidayAwardEnabled ?? true,
      weeklyHolidayAwardHours: workConfig?.weeklyHolidayAwardHours ?? 4,
      weeklyHolidayMinHours: workConfig?.weeklyHolidayMinHours ?? 6,
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
  const [isLop, setIsLop] = useState(false)
  const [initialIsLop, setInitialIsLop] = useState(false)
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

  // Sick leave / LOP only apply to a fully empty day (no worked sessions).
  const allSessionsEmpty = sessions.length === 0 || sessions.every(
    (s) => !s.checkIn && !s.checkOut
  )
  const effectiveSickLeave = isSickLeave && allSessionsEmpty
  // LOP (Loss of Pay) is mutually exclusive with sick leave — sick wins if both are set.
  const effectiveLop = isLop && allSessionsEmpty && !effectiveSickLeave

  const isDirty =
    !areSessionsEqual(sessions, initialSessions) ||
    breaksTaken !== initialBreaksTaken ||
    effectiveSickLeave !== initialIsSickLeave ||
    effectiveLop !== initialIsLop


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
      const lop = record.isLop ?? false
      setIsLop(lop)
      setInitialIsLop(lop)
    } else {
      setSessions([])
      setInitialSessions([])
      setBreaksTaken(null)
      setInitialBreaksTaken(null)
      setIsSickLeave(false)
      setInitialIsSickLeave(false)
      setIsLop(false)
      setInitialIsLop(false)
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
    return computeAutoBreaks(rawHours, config.fullDayHours)
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

    // Weekly gate uses RAW hours; public credits net. Matches the server's calc.
    return computeHolidayHours(rawHours, totalWorkHours, record?.holidayReason ?? null, {
      enabled: config.weeklyHolidayAwardEnabled,
      minHours: config.weeklyHolidayMinHours,
      awardHours: config.weeklyHolidayAwardHours,
    })
  }, [
    record?.isHoliday,
    record?.holidayReason,
    rawHours,
    totalWorkHours,
    config.weeklyHolidayAwardEnabled,
    config.weeklyHolidayMinHours,
    config.weeklyHolidayAwardHours,
  ])

  const status = useMemo(() => {
    if (effectiveSickLeave) {
      return "sick"
    }

    if (effectiveLop) {
      return "lop"
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
    effectiveLop,
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

    // Cutoff-free (cutoff redesign): derive the per-endpoint day offsets from the raw
    // times — a check-out that reads earlier than the check-in rolls to the next day.
    // No cutoff, so an 08:00 night check-out is placed correctly (not clamped to 0h).
    //
    // The check-in's OWN offset is preserved, never re-derived: an early-morning session
    // (01:00→08:00 belonging to the next day) reads exactly like an ordinary morning
    // shift, so re-deriving would silently drag it back 24 hours on any edit.
    const keptCheckInNextDay = isNextDayInstant(updated[index].checkIn, record?.date)
    const { checkInNextDay, checkOutNextDay } = deriveOffsets(checkInVal, checkOutVal, keptCheckInNextDay)

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

  // Flip the check-out's day offset (the "+1 next day" toggle). Needed for the cases the
  // wall clock can't infer — a genuine 24h shift (08:00→08:00) or any check-out that should
  // land on the next day even though it reads later than the check-in. Recombines the ISO
  // from the flipped offset and recomputes worked hours.
  const toggleCheckOutNextDay = (index: number) => {
    const updated = [...sessions]
    const s = updated[index]
    const outTime = toTimeValue(s.checkOut)
    if (!outTime) return
    const nextVal = !isNextDayInstant(s.checkOut, record?.date)
    const newCheckOut = combineFromOffset(record?.date || "", outTime, nextVal)
    updated[index] = {
      ...s,
      checkOut: newCheckOut,
      workedHours: calculateWorkedHours(s.checkIn, newCheckOut),
      isNightShift: isNextDayInstant(s.checkIn, record?.date) || nextVal,
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

  // Flip the CHECK-IN's day offset. This is the one case nothing can infer: a session that
  // lies entirely in the small hours (01:00→08:00) belonging to the day AFTER this record —
  // e.g. the second half of a site switch made at 1am. The server infers it automatically
  // when an earlier session on the record already crossed midnight; this toggle is for a
  // standalone tail, where there is no earlier session to inherit from.
  const toggleCheckInNextDay = (index: number) => {
    const updated = [...sessions]
    const s = updated[index]
    const inTime = toTimeValue(s.checkIn)
    if (!inTime) return
    const nextVal = !isNextDayInstant(s.checkIn, record?.date)
    const outTime = toTimeValue(s.checkOut)
    const { checkInNextDay, checkOutNextDay } = deriveOffsets(inTime, outTime, nextVal)
    const newCheckIn = combineFromOffset(record?.date || "", inTime, checkInNextDay)
    const newCheckOut = outTime
      ? combineFromOffset(record?.date || "", outTime, checkOutNextDay)
      : null
    updated[index] = {
      ...s,
      checkIn: newCheckIn,
      checkOut: newCheckOut,
      workedHours: calculateWorkedHours(newCheckIn, newCheckOut),
      isNightShift: checkInNextDay || checkOutNextDay,
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
      // Offsets read from the combined ISO (which reflects the "+1 next day" toggle),
      // not re-derived from times — so a toggled 24h shift validates as 24h, not 0.
      const checkInNextDay = isNextDayInstant(session.checkIn, record?.date)
      const checkOutNextDay = isNextDayInstant(session.checkOut, record?.date)
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
          // Explicit day offsets from the combined ISO (honours the +1 toggle). The server
          // uses these instead of re-deriving from times, so 24h shifts survive the round-trip.
          checkInNextDay: isNextDayInstant(session.checkIn, record?.date),
          checkOutNextDay: isNextDayInstant(session.checkOut, record?.date),
        })
      ),
      breaksTaken,
      isSickLeave: effectiveSickLeave,
      isLop: effectiveLop,
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
      <DialogContent className="!w-[95vw] !max-w-[540px] h-[90vh] max-h-[90vh] overflow-hidden p-0 flex flex-col rounded-2xl">

        {/* HEADER */}
        <div className="border-b px-5 py-4 sm:px-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              Edit Attendance Record
            </DialogTitle>
          </DialogHeader>

          {/* Employee info — compact inline */}
          {record && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium">{record.name}</span>
              <span className="text-muted-foreground">{record.employeeId}</span>
              {record.jobTitle && (
                <Badge variant="secondary" className="text-xs font-normal">{record.jobTitle}</Badge>
              )}
              <AttendanceRecordHistory attendanceId={record.attendanceId} title={record.name} className="ml-auto" />
            </div>
          )}
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6 space-y-5">

          {/* SESSIONS */}
          <div className="space-y-3">
            {sessions.map((session, index) => {
              const selectedSite = sites.find((site) => site._id === session.siteId)
              const inT = toTimeValue(session.checkIn)
              const outT = toTimeValue(session.checkOut)
              const night = session.isNightShift || (!!inT && !!outT && isCrossMidnight(inT, outT, session.isNightShift))
              const hasIssue = overlapIndexes.includes(index) || !!sessionErrors[index]

              return (
                <div
                  key={session._id || index}
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

                  {/* Site + Job */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Site</label>
                      <Select
                        value={session.siteId}
                        onValueChange={(value) => updateSessionField(index, "siteId", value)}
                      >
                        <SelectTrigger className="w-full h-10 text-sm">
                          <SelectValue placeholder="Select site" />
                        </SelectTrigger>
                        <SelectContent>
                          {sites.map((site) => (
                            <SelectItem key={site._id} value={site._id}>{site.siteName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Job</label>
                      <Select
                        value={session.jobId || ""}
                        onValueChange={(value) => updateSessionField(index, "jobId", value)}
                      >
                        <SelectTrigger className="w-full h-10 text-sm">
                          <SelectValue placeholder="Select job" />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedSite?.jobs.map((job) => (
                            <SelectItem key={job._id} value={job._id}>{job.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Time inputs */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Check In</label>
                      <Input
                        className="h-10 text-sm"
                        type="time"
                        value={toTimeValue(session.checkIn)}
                        onChange={(e) => updateSessionField(index, "checkIn", e.target.value)}
                      />
                      {toTimeValue(session.checkIn) && (
                        <button
                          type="button"
                          onClick={() => toggleCheckInNextDay(index)}
                          className={`mt-1 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                            isNextDayInstant(session.checkIn, record?.date)
                              ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800/50 dark:bg-indigo-950/40 dark:text-indigo-300"
                              : "border-border text-muted-foreground hover:bg-muted"
                          }`}
                          title="Toggle whether this shift STARTS on the next day (an after-midnight session recorded on this day)"
                        >
                          {isNextDayInstant(session.checkIn, record?.date)
                            ? `🌙 Starts next day · ${formatOffsetDayLabel(record?.date, 1)}`
                            : `Starts same day · ${formatOffsetDayLabel(record?.date, 0)}`}
                        </button>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Check Out</label>
                      <Input
                        className="h-10 text-sm"
                        type="time"
                        value={toTimeValue(session.checkOut)}
                        onChange={(e) => updateSessionField(index, "checkOut", e.target.value)}
                      />
                      {toTimeValue(session.checkIn) && toTimeValue(session.checkOut) && (
                        <button
                          type="button"
                          onClick={() => toggleCheckOutNextDay(index)}
                          className={`mt-1 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                            isNextDayInstant(session.checkOut, record?.date)
                              ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800/50 dark:bg-indigo-950/40 dark:text-indigo-300"
                              : "border-border text-muted-foreground hover:bg-muted"
                          }`}
                          title="Toggle whether the check-out is on the next day (for 24h or after-midnight shifts)"
                        >
                          {isNextDayInstant(session.checkOut, record?.date)
                            ? `🌙 Check-out next day · ${formatOffsetDayLabel(record?.date, 1)}`
                            : `Check-out same day · ${formatOffsetDayLabel(record?.date, 0)}`}
                        </button>
                      )}
                    </div>
                  </div>

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
                    className="h-7 w-7 rounded-md border text-sm font-bold hover:bg-muted transition-colors"
                    onClick={() => setBreaksTaken((prev) => (prev ?? autoBreaks) + 1)}
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
            {record?.isHoliday && (
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  Holiday Hours
                  <Badge
                    variant="secondary"
                    className="bg-yellow-100 text-yellow-800 border-yellow-300 text-xs font-normal"
                  >
                    {record.holidayReason === "weekly" ? "Weekly" : "Public"}
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
                    : status === "pending"
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25 border-transparent"
                      : status === "sick"
                        ? "bg-sky-500/15 text-sky-700 dark:text-sky-400 hover:bg-sky-500/25 border-transparent"
                        : status === "lop"
                          ? "bg-rose-500/15 text-rose-700 dark:text-rose-400 hover:bg-rose-500/25 border-transparent"
                          : ""
                }`}
              >
                {status === "sick" ? "Sick Leave" : status === "lop" ? "LOP" : status}
              </Badge>
            </div>

            {/* Sick leave toggle — only valid for a fully empty day. Mutually
                exclusive with LOP (turning one on clears the other). */}
            <div className="flex items-start justify-between gap-4 border-t pt-3">
              <div className="space-y-0.5">
                <Label htmlFor="sick-leave" className="text-sm font-medium">Sick Leave</Label>
                <p className="text-xs text-muted-foreground max-w-[280px]">
                  {allSessionsEmpty
                    ? "Mark this absent day as sick leave. Has no effect on pay."
                    : "Clear all check-in/out times to mark this day as sick leave."}
                </p>
              </div>
              <Switch
                id="sick-leave"
                checked={effectiveSickLeave}
                disabled={!allSessionsEmpty}
                onCheckedChange={(v) => {
                  setIsSickLeave(v)
                  if (v) setIsLop(false)
                }}
              />
            </div>

            {/* LOP (Loss of Pay) toggle — unexcused absence, only valid for a fully
                empty day. Mutually exclusive with sick leave. */}
            <div className="flex items-start justify-between gap-4 border-t pt-3">
              <div className="space-y-0.5">
                <Label htmlFor="lop" className="text-sm font-medium">LOP (Loss of Pay)</Label>
                <p className="text-xs text-muted-foreground max-w-[280px]">
                  {allSessionsEmpty
                    ? "Mark this absent day as loss of pay. Auto-adds a deduction remark."
                    : "Clear all check-in/out times to mark this day as loss of pay."}
                </p>
              </div>
              <Switch
                id="lop"
                checked={effectiveLop}
                disabled={!allSessionsEmpty}
                onCheckedChange={(v) => {
                  setIsLop(v)
                  if (v) setIsSickLeave(false)
                }}
              />
            </div>
          </div>

         
        </div>

        {/* FOOTER */}
        <div className="border-t px-5 py-3 sm:px-6 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleCloseAttempt}>
            Cancel
          </Button>

          <Button size="sm" onClick={updateARecord} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Save className="mr-1.5 h-3.5 w-3.5" />
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