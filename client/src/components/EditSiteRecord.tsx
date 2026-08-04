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

import {
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
  Undo,
  Clock,
  MapPin,
  Briefcase,
  Moon,
  Sun,
} from "lucide-react"

import { api } from "@/lib/api"

import toast from "react-hot-toast"
import { isCrossMidnight, validateSessionTimesV2, deriveOffsets, combineFromOffset, isNextDayInstant, formatOffsetDayLabel, toLocalTimeString as toTimeValue, formatLocalTime12h } from "@/lib/dateUtils"
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

  holidayReason?: HolidayReason

  holidayHours?: number

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
  const [, setOverlapInfo] = useState<any>(null)
  const [overlapSessionIds, setOverlapSessionIds] = useState<string[]>([])
  const [record, setRecord] = useState<AttendanceRecord | null>(null)
  const [sessions, setSessions] = useState<AttendanceSession[]>([])
  const [saving, setSaving] = useState(false)

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
  const [initialBreaksTaken, setInitialBreaksTaken] = useState<number | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [sessionToDelete, setSessionToDelete] = useState<number | null>(null)

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
    return new Date(d1).getTime() === new Date(d2).getTime()
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

      const res = await api.get(`/api/attendance/${attendanceId}`, {
        params: { siteId: site._id },
      })

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
      toast.error("Failed to load attendance record")
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

  // --------------------------------------------------
  // HELPERS
  // --------------------------------------------------

  const calculateWorkedHours = (checkIn?: string | null, checkOut?: string | null) => {
    if (!checkIn || !checkOut) return 0
    const hours = (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (1000 * 60 * 60)
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

  const overtimeHours = useMemo(() => {
    // No overtime on holidays — only holiday hours are credited.
    if (record?.isHoliday) return 0
    if (totalWorkHours <= config.overtimeThreshold) return 0
    return Number((totalWorkHours - config.overtimeThreshold).toFixed(2))
  }, [record?.isHoliday, totalWorkHours, config.overtimeThreshold])

  const holidayHours = useMemo(() => {
    if (!record?.isHoliday) return 0
    // Raw-hours status (fullday/halfday/absent), matching the server's calc.
    const rawStatus =
      rawHours >= config.fullDayHours
        ? "fullday"
        : rawHours >= config.halfDayHours
          ? "halfday"
          : "absent"
    return computeHolidayHours(totalWorkHours, rawStatus, record?.holidayReason ?? null)
  }, [record?.isHoliday, record?.holidayReason, rawHours, totalWorkHours, config.fullDayHours, config.halfDayHours])

  const currentSiteSessions = useMemo(() =>
    sessions
      .map((s, i) => ({ session: s, index: i }))
      .filter(({ session }) => String(session.siteId) === String(site._id)),
    [sessions, site._id]
  )

  const otherSiteSessions = useMemo(() =>
    sessions.filter((s) => String(s.siteId) !== String(site._id)),
    [sessions, site._id]
  )

  // --------------------------------------------------
  // HANDLERS
  // --------------------------------------------------

  const updateSessionField = (
    index: number,
    field: keyof AttendanceSession | "isNightShift",
    value: any
  ) => {
    const updated = [...sessions]

    if (field === "isNightShift") return

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
      updated[index].checkIn = checkInVal ? combineFromOffset(record?.date || "", checkInVal, checkInNextDay) : null
      updated[index].checkOut = checkOutVal ? combineFromOffset(record?.date || "", checkOutVal, checkOutNextDay) : null
      updated[index].workedHours = calculateWorkedHours(updated[index].checkIn, updated[index].checkOut)
    } else {
      updated[index] = { ...updated[index], [field as any]: value }
      if (field === "siteId") updated[index].jobId = null
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
    setOverlapInfo(null)
    setOverlapSessionIds([])
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
    setOverlapInfo(null)
    setOverlapSessionIds([])
    setSessions(updated)
  }

  const addSession = () => {
    if (!record) return

    const hasIncomplete = sessions.some((s) => !s.checkIn || !s.checkOut)
    if (hasIncomplete) {
      toast.error("Please complete check-in and check-out for the existing session first.")
      return
    }

    setSessions((prev) => [
      ...prev,
      {
        siteId: site._id,
        siteName: site.siteName,
        jobId: record.jobId || null,
        checkIn: null,
        checkOut: null,
        workedHours: 0,
        isNightShift: false,
      },
    ])
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

  const removeSession = (index: number) => {
    const sessionToRemove = sessions[index]
    if (!sessionToRemove) return

    const siteSessions = sessions.filter((s) => String(s.siteId) === String(site._id))
    if (String(sessionToRemove.siteId) === String(site._id) && siteSessions.length <= 1) {
      return toast.error("Cannot delete the only session for this site. You can leave its times blank instead.")
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

      // A session with a check-out but no check-in is invalid. A FULLY-blank session
      // (both times empty) is allowed on purpose — that's the deliberate "Absent" /
      // cleared-session case (the server stores it with manuallyCleared and the
      // employee reads as absent). It's the only way to undo a mistaken check-in on a
      // single-session record, e.g. an unclosed carryover shift that should have been
      // absent — the session can't be deleted (it's the site's only one), so clearing
      // both times and saving is the escape hatch.
      const danglingCheckout = sessions.find(
        (s) => String(s.siteId) === String(site._id) && !s.checkIn && !!s.checkOut
      )
      if (danglingCheckout) {
        toast.error("A check-out needs a check-in. Add a check-in, or clear both times to mark this session absent.")
        return
      }

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

      const sortedSessions = [...sessions].sort((a, b) => {
        if (!a.checkIn && !b.checkIn) return 0
        if (!a.checkIn) return 1
        if (!b.checkIn) return -1
        return new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime()
      })

      setSessions(sortedSessions)
      setSaving(true)

      const payload = {
        sessions: sortedSessions.map((session) => ({
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
        })),
        breaksTaken,
      }

      const res = await api.patch(
        `/api/attendance/update/${record.attendanceId}?siteId=${site._id}`,
        payload
      )

      const updatedRecord = {
        ...res.data.attendance,
        sessions: res.data.attendance.sessions.filter(
          (session: AttendanceSession) => String(session.siteId) === String(site._id)
        ),
      }

      onUpdated(updatedRecord)
      toast.success("Attendance updated successfully")
      onClose()
    } catch (error: any) {
      console.log(error)

      const overlap = error?.response?.data?.overlap
      if (overlap) {
        setOverlapInfo(overlap)
        setOverlapSessionIds([overlap.sessionA._id, overlap.sessionB._id])
        toast.error(error.response.data.message)
        return
      }

      toast.error(error?.response?.data?.message || "Failed to update attendance")
    } finally {
      setSaving(false)
    }
  }

  // --------------------------------------------------
  // RENDER HELPERS
  // --------------------------------------------------

  const isNightSession = (session: AttendanceSession) => {
    return session.isNightShift || (
      toTimeValue(session.checkIn) &&
      toTimeValue(session.checkOut) &&
      isCrossMidnight(toTimeValue(session.checkIn), toTimeValue(session.checkOut), session.isNightShift)
    )
  }

  const renderReadOnlySession = (session: AttendanceSession, globalIndex: number) => {
    const hasOverlap = session._id && overlapSessionIds.includes(String(session._id))
    const night = isNightSession(session)

    return (
      <div
        key={session._id || `other-${globalIndex}`}
        className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
          hasOverlap ? "border-red-400 bg-red-50 dark:bg-red-950/20" : "bg-muted/30"
        }`}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{session.siteName || "Unknown Site"}</span>
            </div>
            {session.jobName && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Briefcase className="h-3 w-3 shrink-0" />
                <span className="truncate">{session.jobName}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1.5 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              <span>
                {session.checkIn ? formatLocalTime12h(session.checkIn) : "--:--"}
                {" - "}
                {session.checkOut ? formatLocalTime12h(session.checkOut) : "--:--"}
              </span>
            </div>
            {night && (
              <span className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 text-xs font-medium">
                <Moon className="h-3 w-3" /> Night
              </span>
            )}
          </div>

          {hasOverlap && (
            <p className="text-xs text-red-600 font-medium mt-1">Overlaps with another session</p>
          )}
        </div>

        <div className="text-right shrink-0">
          <p className="text-sm font-semibold">{session.workedHours} hrs</p>
        </div>
      </div>
    )
  }

  const renderEditableSession = (session: AttendanceSession, globalIndex: number, localIndex: number) => {
    const hasOverlap = session._id && overlapSessionIds.includes(String(session._id))
    const hasError = !!sessionErrors[globalIndex]
    const night = isNightSession(session)
    const canDelete = currentSiteSessions.length > 1

    return (
      <div
        key={session._id || globalIndex}
        className={`rounded-xl border p-4 space-y-4 ${
          (hasOverlap || hasError)
            ? "border-red-400 bg-red-50 dark:bg-red-950/20"
            : "bg-background"
        }`}
      >
        {/* Session header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold">Session {localIndex + 1}</h4>
            {night ? (
              <Badge variant="secondary" className="text-xs gap-1 font-normal">
                <Moon className="h-3 w-3" /> Night
              </Badge>
            ) : (toTimeValue(session.checkIn) || toTimeValue(session.checkOut)) ? (
              <Badge variant="secondary" className="text-xs gap-1 font-normal">
                <Sun className="h-3 w-3" /> Day
              </Badge>
            ) : null}
            {hasOverlap && (
              <Badge variant="destructive" className="text-xs">Overlap</Badge>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {lastClearedSession && lastClearedSession.index === globalIndex && !session.checkIn && !session.checkOut ? (
              <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={undoClearModalSession}>
                <Undo className="h-3.5 w-3.5" /> Undo
              </Button>
            ) : (session.checkIn || session.checkOut) ? (
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => clearModalSession(globalIndex)}>
                Absent
              </Button>
            ) : null}

            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => {
                  setSessionToDelete(globalIndex)
                  setDeleteDialogOpen(true)
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Job selector */}
        <Select
          value={session.jobId || "not-assigned"}
          onValueChange={(value) =>
            updateSessionField(globalIndex, "jobId", value === "not-assigned" ? null : value)
          }
        >
          <SelectTrigger className="w-full h-10 text-sm">
            <SelectValue placeholder="Select job" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="not-assigned">Not Assigned</SelectItem>
            {site.jobs.map((job) => (
              <SelectItem key={job._id} value={job._id}>{job.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Time inputs */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Check In</label>
            <Input
              className="h-10 text-sm"
              type="time"
              value={toTimeValue(session.checkIn)}
              onChange={(e) => updateSessionField(globalIndex, "checkIn", e.target.value)}
            />
            {toTimeValue(session.checkIn) && (
              <button
                type="button"
                onClick={() => toggleCheckInNextDay(globalIndex)}
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
              onChange={(e) => updateSessionField(globalIndex, "checkOut", e.target.value)}
            />
            {toTimeValue(session.checkIn) && toTimeValue(session.checkOut) && (
              <button
                type="button"
                onClick={() => toggleCheckOutNextDay(globalIndex)}
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

        {sessionErrors[globalIndex] && (
          <p className="text-xs text-red-500 font-medium">{sessionErrors[globalIndex]}</p>
        )}
      </div>
    )
  }

  // --------------------------------------------------
  // RENDER
  // --------------------------------------------------

  return (
    <Dialog open={open} onOpenChange={handleManualClose}>
      <DialogContent className="!w-[95vw] !max-w-[540px] h-[90vh] max-h-[90vh] overflow-hidden p-0 flex flex-col rounded-2xl">

        {/* HEADER */}
        <div className="border-b px-5 py-4 sm:px-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Edit Attendance</DialogTitle>
          </DialogHeader>

          {/* Employee info — compact inline */}
          {record && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium">{record.name}</span>
              <span className="text-muted-foreground">{record.employeeId}</span>
              {record.jobTitle && (
                <Badge variant="secondary" className="text-xs font-normal">{record.jobTitle}</Badge>
              )}
            </div>
          )}
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6 space-y-5">

          {/* OTHER-SITE SESSIONS (read-only, compact) */}
          {otherSiteSessions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Other Sites</p>
              <div className="space-y-2">
                {otherSiteSessions.map((session) => {
                  const globalIndex = sessions.indexOf(session)
                  return renderReadOnlySession(session, globalIndex)
                })}
              </div>
            </div>
          )}

          {/* CURRENT SITE SESSIONS (editable) */}
          <div className="space-y-2">
            {otherSiteSessions.length > 0 && (
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{site.siteName}</p>
            )}

            <div className="space-y-3">
              {currentSiteSessions.map(({ session, index: globalIndex }, localIndex) =>
                renderEditableSession(session, globalIndex, localIndex)
              )}
            </div>

            {/* Add session */}
            <Button
              variant="outline"
              onClick={addSession}
              className="w-full border-dashed h-9 text-sm mt-2"
            >
              <Plus className="mr-2 h-3.5 w-3.5" />
              Add Session
            </Button>
          </div>

          {/* BREAKS + SUMMARY — compact */}
          <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
            {/* Breaks */}
            {config.breakDurationMinutes > 0 && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Breaks</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="h-7 w-7 rounded-md border text-sm font-bold hover:bg-muted transition-colors disabled:opacity-40"
                    disabled={breaksTaken !== null && breaksTaken <= 0}
                    onClick={() => setBreaksTaken((prev) => Math.max(0, (prev ?? autoBreaks) - 1))}
                  >-</button>

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
                    >reset</button>
                  )}
                </div>
              </div>
            )}

            {/* Hours summary */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total Work Hours</span>
              <span className="text-lg font-bold">{totalWorkHours} hrs</span>
            </div>
            {overtimeHours > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Overtime</span>
                <span className="text-lg font-bold">{overtimeHours} hrs</span>
              </div>
            )}
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
          </div>
        </div>

        {/* FOOTER */}
        <div className="border-t px-5 py-3 sm:px-6 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleManualClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={updateARecord} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                Save
              </>
            )}
          </Button>
        </div>
      </DialogContent>

      {/* Delete session dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Session?</AlertDialogTitle>
            <AlertDialogDescription>
              This session will be permanently removed from the attendance record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (sessionToDelete !== null) removeSession(sessionToDelete)
                setDeleteDialogOpen(false)
                setSessionToDelete(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Discard changes dialog */}
      <AlertDialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
        <AlertDialogContent>
          <button
            onClick={handleCancelDiscard}
            className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Are you sure you want to discard them?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={handleConfirmDiscard}>
              Discard
            </Button>
            <Button onClick={async () => {
              setShowDiscardConfirm(false)
              await updateARecord()
            }}>
              Save
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}

export default EditSiteRecord
