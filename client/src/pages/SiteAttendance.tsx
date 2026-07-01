import { api } from "@/lib/api"
import { useEffect, useMemo, useState, Fragment } from "react"
import toast from "react-hot-toast"
import { useNavigate, useParams } from "react-router-dom"
import EditSiteRecord from "@/components/EditSiteRecord"
import BulkAssignNightShift from "@/components/BulkAssignNightShift"
import UpdateDefaultsDialog, { type DefaultChange } from "@/components/sites/UpdateDefaultsDialog"
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog"
import { getLogicalShiftDate, isInExtendedPeriod, calculateHoursBetween, isCrossMidnight, formatLogicalDateLabel, formatCurrentDateLabel, getCurrentTargetDayName, isCheckInInToggleRange, validateSessionTimes, combineDateAndTime as combineDateAndTimeLocal, toLocalTimeString as toTimeValue, formatLocalTime12h } from "@/lib/dateUtils"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { Button } from "@/components/ui/button"

import { Input } from "@/components/ui/input"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { Badge } from "@/components/ui/badge"

import {
  Loader2,
  Pencil,
  Plus,
  Save,
  X,
  ArrowLeft,
  Clock3,
  Undo,
  Moon,
  Sun,
  Calendar,
  Users,
  MoreVertical,
  Check,
} from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { cn } from "@/lib/utils"

interface Employee {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
  monthlySalary: number
  currentSite: string | null
  currentJob: Job | null
  user: string | null
  employmentType?: 'permanent' | 'temporary'
}

interface EmployeesResponse {
  employees: Employee[]
}

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
  defaultCheckIn?: string
  defaultCheckOut?: string
  nightDefaultCheckIn?: string
  nightDefaultCheckOut?: string
}

export interface AttendanceSession {
  _id?: string

  siteId: string,

  jobId: string | null,

  checkIn: string | null

  checkOut: string | null

  workedHours: number

  isNightShift?: boolean
}

export interface AttendanceRecord {
  attendanceId: string

  employee: string

  name: string

  employeeId: string

  jobTitle: string

  status: "fullday" | "halfday" | "absent"

  totalWorkHours: number

  overtimeHours: number

  date: string

  sessions: AttendanceSession[]

  user?: string | null

  employmentType?: 'permanent' | 'temporary'

  breaksTaken?: number | null

  totalRawHours?: number

  isSickLeave?: boolean
}



interface FetchedAttendance {
  totalRecords: number,
  isHoliday: boolean,
  data: AttendanceRecord[]
}

interface DraftSession {
  siteId: string,
  job: Job | null,
  checkIn: string,
  checkOut: string,
  workedHours: number,
  isNightShift: boolean
}
//siteId, date, isHoliday are common fields
interface DraftAttendanceRecord {
  employee: {
    _id: string,
    name: string,
    user?: string | null,
    employmentType?: 'permanent' | 'temporary'
  }, //refering to the employee models object id
  employeeId: string,
  jobTitle: string,
  jobId: string | null,
  sessions: DraftSession[]
  breaksTaken?: number | null
  isSickLeave?: boolean
  // Snapshot of the first session's times before sick leave cleared them,
  // so toggling sick leave back off restores what was there.
  sickClearedSession?: {
    checkIn: string
    checkOut: string
    isNightShift: boolean
    workedHours: number
  } | null
}


interface DraftAttendancePayload {
  siteId: string,
  date: string,
  isHoliday: boolean
  attendance : DraftAttendanceRecord[]
}

interface Filters {
  name: string
  employeeId: string
  jobTitle: string
}

const isSessionNonEmpty = (session?: { checkIn?: string | null; checkOut?: string | null }) => {
  return !!session?.checkIn || !!session?.checkOut
}

const isEmployeeAbsent = (
  sessions: Array<{ siteId: string; checkIn?: string | null; checkOut?: string | null }>,
  currentSiteId?: string
) => {
  if (!currentSiteId) return false
  const siteSessions = sessions.filter(s => String(s.siteId) === String(currentSiteId))
  return siteSessions.length === 0 || siteSessions.every(s => !s.checkIn && !s.checkOut)
}

const AbsentIndicator = () => (
  <span className="relative flex h-2.5 w-2.5 shrink-0" title="Absent">
    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
  </span>
)

const SickLeaveBadge = () => (
  <Badge
    variant="secondary"
    className="bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300 border border-sky-200/50 dark:border-sky-800/30 text-[10px] px-1.5 py-0 h-4"
  >
    Sick Leave
  </Badge>
)

/**
 * Per-row 3-dot actions menu. Currently only exposes the Sick Leave toggle,
 * but is the home for future row-level actions. The green tick on the left of
 * the item reflects the current sick-leave state.
 */
function RowActionsMenu({
  isSick,
  onToggleSick,
  saving = false,
  showSick = true,
  sickDisabled = false,
  sickDisabledReason,
}: {
  isSick: boolean
  onToggleSick: () => void
  saving?: boolean
  showSick?: boolean
  sickDisabled?: boolean
  sickDisabledReason?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          title="More actions"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {showSick && (
          <DropdownMenuItem
            disabled={saving || sickDisabled}
            title={sickDisabled ? sickDisabledReason : undefined}
            onSelect={(e) => {
              e.preventDefault()
              if (!saving && !sickDisabled) onToggleSick()
            }}
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check
                className={cn(
                  "mr-2 h-4 w-4 text-emerald-600",
                  isSick ? "opacity-100" : "opacity-0"
                )}
              />
            )}
            Sick Leave
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}


function SiteAttendance() {
  const {id} = useParams()

  const navigate = useNavigate()

  const [cutoffHour, setCutoffHour] = useState(7)
  const [breakDurationMinutes, setBreakDurationMinutes] = useState(60)
  const [fullDayHours, setFullDayHours] = useState(8)

  const today = useMemo(() => getLogicalShiftDate(cutoffHour), [cutoffHour])
  const extendedPeriod = useMemo(() => isInExtendedPeriod(cutoffHour), [cutoffHour])

  const formattedDate = formatCurrentDateLabel()

  const [showLeaveDialog, setShowLeaveDialog] = useState(false)

  const [pendingPath, setPendingPath] = useState<string | null>(null)

  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])

  const [draftAttendance, setDraftAttendance] = useState<DraftAttendanceRecord[]>([])

  const [lastCleared, setLastCleared] = useState<{
    employeeId: string
    checkIn: string
    checkOut: string
    isNightShift: boolean
  } | null>(null)

  const [lastClearedSaved, setLastClearedSaved] = useState<{
    attendanceId: string
    checkIn: string
    checkOut: string
    isNightShift: boolean
    breaksTaken?: number | null
  } | null>(null)


  const [site, setSite] = useState<Site | null>(null)

  const [loading, setLoading] = useState(true)

  const [saving, setSaving] = useState(false)

  const [attendanceExists, setAttendanceExists] = useState(false)

  const [isDirty, setIsDirty] = useState(false)

  const [isHoliday, setIsHoliday] = useState(false)

  const [selectedRecord, setSelectedRecord] =
    useState<AttendanceRecord | null>(null)

  const [editOpen, setEditOpen] =
    useState(false)

  // inline editing of a saved record (single incomplete session)
  const [editingRowId, setEditingRowId] =
    useState<string | null>(null)

  const [inlineEdit, setInlineEdit] =
    useState<{ checkIn: string; checkOut: string; isNightShift: boolean; breaksTaken: number | null }>({
      checkIn: "",
      checkOut: "",
      isNightShift: false,
      breaksTaken: null,
    })
  const [inlineEditError, setInlineEditError] = useState<string | null>(null)

  const [rowSaving, setRowSaving] = useState(false)

  // Tracks which saved record is currently having its sick-leave flag toggled.
  const [sickSavingId, setSickSavingId] = useState<string | null>(null)

  const [isEditingDefaults, setIsEditingDefaults] = useState(false)
  const [editDefaultCheckIn, setEditDefaultCheckIn] = useState("")
  const [editDefaultCheckOut, setEditDefaultCheckOut] = useState("")
  const [editNightDefaultCheckIn, setEditNightDefaultCheckIn] = useState("")
  const [editNightDefaultCheckOut, setEditNightDefaultCheckOut] = useState("")
  const [savingDefaults, setSavingDefaults] = useState(false)

  // Update defaults dialog state
  const [updateDefaultsDialogOpen, setUpdateDefaultsDialogOpen] = useState(false)
  const [pendingDefaultChanges, setPendingDefaultChanges] = useState<DefaultChange[]>([])
  const [skippedEmployeeIds, setSkippedEmployeeIds] = useState<Set<string>>(new Set())
  const [skippedReasons, setSkippedReasons] = useState<Map<string, string>>(new Map())

  const [bulkAssignOpen, setBulkAssignOpen] = useState(false)

  useEffect(() => {
    if (site) {
      setEditDefaultCheckIn(site.defaultCheckIn || "")
      setEditDefaultCheckOut(site.defaultCheckOut || "")
      setEditNightDefaultCheckIn(site.nightDefaultCheckIn || "")
      setEditNightDefaultCheckOut(site.nightDefaultCheckOut || "")
    }
  }, [site])

  const openEditRecord = (
    record: AttendanceRecord
  ) => {
    setSelectedRecord(record)
    setEditOpen(true)
  }

  const handleRecordUpdated = (updatedRecord: AttendanceRecord) => {
    setAttendance((prev) =>
      prev.map((record) =>
        record.attendanceId ===
          updatedRecord.attendanceId
          ? updatedRecord
          : record
      )
    )
  }

   const handleSafeNavigation = (path: string) => {
    if (!isDirty) {
      navigate(path)
      return
    }

    setPendingPath(path)
    setShowLeaveDialog(true)
  }

  const fetchSite = async () => {
    try {
      const res = await api.get(`/api/site/${id}`)

      setSite(res.data)

      return res.data
    } catch (error) {
      console.log(error)
    }
  }


  //client side filtering
  const [filters, setFilters] =
    useState<Filters>({
      name: "",
      employeeId: "",
      jobTitle: "",
    })

const initializeAttendanceFromEmployees = async (siteData: Site, cutoffVal = cutoffHour) => {
    try {
      const cached = localStorage.getItem(`attendance_draft_${id}_${today}`)
      if (cached) {
        setDraftAttendance(JSON.parse(cached))
        setIsDirty(true)
        return
      }

      const res =
        await api.get<EmployeesResponse>(
          "/api/employees",
          {
            params: { site: id },
          }
        )

      const mappedDraft =
        res.data.employees.map((emp) => {
          const defaultIn = siteData.defaultCheckIn || ""
          let isNightShift = false
          if (defaultIn) {
            isNightShift = isCheckInInToggleRange(defaultIn, cutoffVal)
          }
          return {
            employee: {
              _id: emp._id,
              name: emp.name,
              user: emp.user || null,
              employmentType: emp.employmentType,
            },

            employeeId: emp.employeeId,

            jobTitle: emp.jobTitle,

            jobId:
              emp.currentJob?._id || null,

            sessions: [
              {
                siteId: siteData._id,
                job: emp.currentJob,
                checkIn: defaultIn,
                checkOut: "",
                workedHours: 0,
                isNightShift,
              },
            ],

            isSickLeave: false,
          }
        })

      setDraftAttendance(mappedDraft)
    } catch (error) {
      console.log(error)
      setDraftAttendance([])
    }
  }

  type OverlapError = {
    employeeId: string

    conflictingSession: {
      siteId: string
      siteName: string
      checkIn: string
      checkOut: string
    }
  }
  const [overlapError, setOverlapError] = useState<OverlapError | null>(null)

  const formatConflictingTime = () => {
    if (!overlapError?.conflictingSession) return ""
    const { checkIn, checkOut } = overlapError.conflictingSession
    const inStr = checkIn ? formatLocalTime12h(checkIn) : ""
    const outStr = checkOut ? formatLocalTime12h(checkOut) : "Present"
    return `${inStr} - ${outStr}`
  }

  const [holidayReason, setHolidayReason] = useState("")

  const checkHolidayStatus = async () => {
    try {

      const configRes =
        await api.get("/api/config")

      const weeklyHolidays =
        configRes.data.data
          .weeklyHolidays || []

      setCutoffHour(configRes.data.data.nightShiftCutoffHour ?? 7)
      setBreakDurationMinutes(configRes.data.data.breakDurationMinutes ?? 60)
      setFullDayHours(configRes.data.data.fullDayHours ?? 8)


      const todayDay = getCurrentTargetDayName()

      if (
        weeklyHolidays.includes(
          todayDay
        )
      ) {
        setIsHoliday(true)

        setHolidayReason(
          "Weekly Holiday"
        )

        return
      }

      const holidayRes =
        await api.get(
          "/api/config/custom-holidays/check",
          {
            params: {
              date: today,
            },
          }
        )

      if (
        holidayRes.data.isHoliday
      ) {
        setIsHoliday(true)

        setHolidayReason(
          holidayRes.data.reason
        )
      } else {
        setIsHoliday(false)

        setHolidayReason("")
      }

    } catch (error) {
      console.log(error)
    }
  }

  const isOverlapRow = (employeeId: string) => {
    return (
      overlapError?.employeeId === employeeId
    )
  }


  ///api/attendance/reports/daily?date=2026-05-29&siteId=69e231212487b777fb7eb7b5

  const fetchAttendance = async () => {
    try {
      const res = await api.get<FetchedAttendance>("/api/attendance/reports/daily",
        {
          params: {
            date: today,
            siteId: id,
          },
        })

      setIsHoliday(res.data.isHoliday)

      setAttendance(res.data.data)

      // Also resolve and set the holidayReason
      await checkHolidayStatus()

    } catch (error) {
      console.log(error)
    }
  }

  const handleSubmit = async () => {
    try {
      setSaving(true)

      setOverlapError(null)

      const payload: DraftAttendancePayload = {
        siteId: id || "",
        date: today,
        isHoliday,
        attendance: draftAttendance,
      }

      // console.log(payload)

      const res = await api.post(
        "/api/attendance/submit",
        payload
      )

      if (res.data.success) {
        toast.success(
          res.data.message ||
          "Attendance submitted successfully"
        )

        // Reconcile sick leave: any employee we requested as sick but who came
        // back not-sick was force-cleared by the backend (they have a filled
        // session at another site). Surface this instead of silently reverting.
        const requestedSick = new Set(
          draftAttendance
            .filter((r) => r.isSickLeave)
            .map((r) => String(r.employee._id))
        )
        if (requestedSick.size > 0) {
          const returned = res.data.data || []
          const revoked = returned.filter(
            (doc: any) =>
              requestedSick.has(String(doc.employee)) && !doc.isSickLeave
          )
          if (revoked.length > 0) {
            toast.error(
              `${revoked.length} employee(s) weren't marked sick — they have attendance at another site today.`,
              { duration: 6000 }
            )
          }
        }

        localStorage.removeItem(`attendance_draft_${id}_${today}`)
        localStorage.removeItem(`active_inline_edit_row_${id}`)
        localStorage.removeItem(`active_inline_edit_data_${id}`)

        setAttendanceExists(true)

        setIsDirty(false)

        await fetchAttendance()
      }
    } catch (error: any) {
      console.log(error)

      const responseData = error?.response?.data

      if (responseData?.overlap) {
        setOverlapError(responseData.overlap)

        toast.error(
          responseData.message ||
          "Attendance sessions overlap"
        )
      } else {
        setOverlapError(null)

        toast.error(
          responseData?.message ||
          "Failed to submit attendance"
        )
      }
    } finally {
      setSaving(false)
    }
  }

  const checkAttendanceStatus = async () => {
    try {
      const res = await api.post(
        `/api/site/${id}/check-pending`,
        {
          date: today,
        }
      )

      const exists = res.data.status || false

      const locked = res.data.lock?.isLocked || false

      setAttendanceExists(exists)

      return {
        exists,
        locked,
      }
    } catch (error) {
      console.log(error)

      setAttendanceExists(false)

      return {
        exists: false,
        locked: false,
      }
    }
  }

  const calculateHours = (checkIn: string, checkOut: string, isNightShift: boolean = false) => {
    return calculateHoursBetween(checkIn, checkOut, isNightShift, cutoffHour)
  }

  const getSiteWorkedHours = (
    record: AttendanceRecord
  ) => {
    return Number(
      record.sessions
        .reduce((total, session) => {
          return total + session.workedHours
        }, 0)
        .toFixed(2)
    )
  }

  // A record routes to the modal (edit + add) once it has a complete
  // session or more than one session. Otherwise it can be edited inline.
  const isRecordComplete = (
    record: AttendanceRecord
  ) => {
    if (record.sessions.length === 0) return false

    if (record.sessions.length > 1) return true

    const session = record.sessions[0]

    return !!session.checkIn && !!session.checkOut
  }



   const startInlineEdit = (
    record: AttendanceRecord
  ) => {
    const session = record.sessions[0]

    setEditingRowId(record.attendanceId)
    setOverlapError(null)
    setLastClearedSaved(null)
    setInlineEditError(null)

    setInlineEdit({
      checkIn: toTimeValue(session?.checkIn),
      checkOut: toTimeValue(session?.checkOut),
      isNightShift: session?.isNightShift ?? false,
      breaksTaken: record.breaksTaken ?? null,
    })
  }

  const cancelInlineEdit = () => {
    setEditingRowId(null)
    setOverlapError(null)
    setInlineEditError(null)

    setInlineEdit({ checkIn: "", checkOut: "", isNightShift: false, breaksTaken: null })
    setLastClearedSaved(null)
  }



  const saveInlineEdit = async (
    record: AttendanceRecord
  ) => {
    const { checkIn, checkOut, isNightShift } = inlineEdit

    const validationError = validateSessionTimes(checkIn, checkOut, isNightShift, cutoffHour);
    if (validationError) {
      setInlineEditError(validationError);
      return;
    }
    setInlineEditError(null);


    try {
      setRowSaving(true)
      setOverlapError(null)

      const existing = record.sessions[0]

      const payload = {
        sessions: [
          {
            _id: existing?._id,
            siteId: existing?.siteId ?? site?._id,
            jobId: existing?.jobId ?? null,
            checkIn: combineDateAndTimeLocal(
              record.date,
              checkIn || null,
              null,
              isNightShift,
              cutoffHour
            ),
            checkOut: combineDateAndTimeLocal(
              record.date,
              checkOut || null,
              checkIn || null,
              isNightShift,
              cutoffHour
            ),
            isNightShift,
          },
        ],
        // Pass the inline edited breaksTaken
        breaksTaken: inlineEdit.breaksTaken,
      }


      const res = await api.patch(
        `/api/attendance/update/${record.attendanceId}?siteId=${site?._id}`,
        payload
      )

      const updatedRecord = {
        ...res.data.attendance,
        sessions: res.data.attendance.sessions.filter(
          (session: AttendanceSession) =>
            String(session.siteId) === String(site?._id)
        ),
      }

      handleRecordUpdated(updatedRecord as AttendanceRecord)

      toast.success("Attendance updated successfully")

      cancelInlineEdit()
    } catch (error: any) {
      console.log(error)
      const responseData = error?.response?.data
      if (responseData?.overlap) {
        setOverlapError(responseData.overlap)
        toast.error(responseData.message || "Attendance sessions overlap")
      } else {
        setOverlapError(null)
        toast.error(
          responseData?.message ||
          "Failed to update attendance"
        )
      }
    } finally {
      setRowSaving(false)
    }
  }

  const updateDraftSession = (
    employeeId: string,
    sessionIndex: number,
    field: "checkIn" | "checkOut",
    value: string
  ) => {
    setDraftAttendance(prev =>
      prev.map(record => {
        if (record.employee._id !== employeeId) {
          return record
        }

        const sessions = [...record.sessions]
        const session = { ...sessions[sessionIndex], [field]: value }

        // Rule check: checkout time cannot be > cutoffHour if checkin was before cutoffHour
        if (session.checkIn && session.checkOut) {
          const [inH, inM] = session.checkIn.split(":").map(Number)
          const [outH, outM] = session.checkOut.split(":").map(Number)
          if (inH >= 0 && inH < cutoffHour && outH * 60 + outM > cutoffHour * 60) {
            toast.error(`Check-out time must be before or equal to the cutoff hour (${cutoffHour}:00 AM) if checked in before ${cutoffHour}:00 AM.`)
            if (field === "checkOut") {
              session.checkOut = ""
            } else {
              session.checkIn = ""
            }
          } else {
            const inMin = inH * 60 + inM
            const outMin = outH * 60 + outM
            if (outMin < inMin && outMin > cutoffHour * 60) {
              toast.error(`Check-out time must be before or equal to the cutoff hour (${cutoffHour}:00 AM) for night shifts.`)
              if (field === "checkOut") {
                session.checkOut = ""
              } else {
                session.checkIn = ""
              }
            }
          }
        }

        const prevIsNight = sessions[sessionIndex].isNightShift || false
        let nextIsNightShift = false
        if (session.checkIn) {
          const [inH] = session.checkIn.split(":").map(Number)
          const isDayOnlyCheckIn = inH >= cutoffHour && inH < 12 // 7 AM to 12 PM
          if (prevIsNight) {
            nextIsNightShift = !isDayOnlyCheckIn
          } else {
            const inRange = inH >= 0 && inH < cutoffHour
            const crossesMidnight = session.checkOut ? isCrossMidnight(session.checkIn, session.checkOut, false) : false
            nextIsNightShift = inRange || crossesMidnight
          }
        } else {
          nextIsNightShift = prevIsNight
        }

        sessions[sessionIndex] = {
          ...session,
          isNightShift: nextIsNightShift,
        }

        sessions[sessionIndex].workedHours =
          calculateHours(
            sessions[sessionIndex].checkIn,
            sessions[sessionIndex].checkOut,
            sessions[sessionIndex].isNightShift
          )

        return {
          ...record,
          sessions,
          // Entering any time means the employee is not on sick leave.
          isSickLeave: value ? false : record.isSickLeave,
        }
      })
    )

    setIsDirty(true)
  }

  // Draft: toggle sick leave locally. Turning it on clears the session times
  // (sick = empty session); the backend remains the arbiter on submit.
  const toggleDraftSickLeave = (employeeId: string) => {
    setDraftAttendance((prev) =>
      prev.map((record) => {
        if (record.employee._id !== employeeId) return record

        const turningOn = !record.isSickLeave

        if (turningOn) {
          // Snapshot the current first-session times, then clear them.
          const s0 = record.sessions[0]
          const snapshot = s0
            ? {
                checkIn: s0.checkIn,
                checkOut: s0.checkOut,
                isNightShift: s0.isNightShift,
                workedHours: s0.workedHours,
              }
            : null

          const sessions = record.sessions.map((s, i) =>
            i === 0 ? { ...s, checkIn: "", checkOut: "", workedHours: 0 } : s
          )

          return {
            ...record,
            isSickLeave: true,
            sessions,
            sickClearedSession: snapshot,
          }
        }

        // Turning off: restore the snapshot the toggle had cleared.
        const snap = record.sickClearedSession
        const sessions = record.sessions.map((s, i) =>
          i === 0 && snap
            ? {
                ...s,
                checkIn: snap.checkIn,
                checkOut: snap.checkOut,
                isNightShift: snap.isNightShift,
                workedHours: snap.workedHours,
              }
            : s
        )

        return {
          ...record,
          isSickLeave: false,
          sessions,
          sickClearedSession: null,
        }
      })
    )
    setIsDirty(true)
  }

  // Saved record: toggle sick leave via the backend, which validates against
  // the full cross-site record. A filled session anywhere → 400 + toast.
  const toggleSavedSickLeave = async (record: AttendanceRecord) => {
    try {
      setSickSavingId(record.attendanceId)
      const nextValue = !record.isSickLeave

      const res = await api.patch(
        `/api/attendance/update/${record.attendanceId}?siteId=${site?._id}`,
        { isSickLeave: nextValue }
      )

      const updatedRecord = {
        ...res.data.attendance,
        sessions: res.data.attendance.sessions.filter(
          (session: AttendanceSession) =>
            String(session.siteId) === String(site?._id)
        ),
      }

      handleRecordUpdated(updatedRecord as AttendanceRecord)

      toast.success(
        nextValue ? "Marked as sick leave" : "Sick leave removed"
      )
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message ||
          "Failed to update sick leave"
      )
    } finally {
      setSickSavingId(null)
    }
  }

  const updateDraftBreaksTaken = (employeeId: string, value: number | null) => {
    setDraftAttendance((prev) =>
      prev.map((record) => {
        if (record.employee._id !== employeeId) return record
        return { ...record, breaksTaken: value }
      })
    )
    setIsDirty(true)
  }

  const clearDraftSession = (employeeId: string, sessionIndex: number) => {

    const record = draftAttendance.find((r) => r.employee._id === employeeId)
    const session = record?.sessions[sessionIndex]
    if (record && session) {
      setLastCleared({
        employeeId,
        checkIn: session.checkIn,
        checkOut: session.checkOut,
        isNightShift: session.isNightShift,
      })
    }

    setDraftAttendance((prev) =>
      prev.map((record) => {
        if (record.employee._id !== employeeId) {
          return record
        }

        const sessions = [...record.sessions]
        sessions[sessionIndex] = {
          ...sessions[sessionIndex],
          checkIn: "",
          checkOut: "",
          workedHours: 0,
          isNightShift: sessions[sessionIndex].isNightShift || false,
        }

        return {
          ...record,
          sessions,
        }
      })
    )
    setIsDirty(true)
  }

  const undoClearDraftSession = () => {
    if (!lastCleared) return

    setDraftAttendance((prev) =>
      prev.map((record) => {
        if (record.employee._id !== lastCleared.employeeId) {
          return record
        }

        const sessions = [...record.sessions]
        sessions[0] = {
          ...sessions[0],
          checkIn: lastCleared.checkIn,
          checkOut: lastCleared.checkOut,
          isNightShift: lastCleared.isNightShift,
          workedHours: calculateHours(
            lastCleared.checkIn,
            lastCleared.checkOut,
            lastCleared.isNightShift
          ),
        }

        return {
          ...record,
          sessions,
        }
      })
    )
    setIsDirty(true)
    setLastCleared(null)
  }

  const clearInlineEdit = (record: AttendanceRecord) => {
    setLastClearedSaved({
      attendanceId: record.attendanceId,
      checkIn: inlineEdit.checkIn,
      checkOut: inlineEdit.checkOut,
      isNightShift: inlineEdit.isNightShift,
      breaksTaken: inlineEdit.breaksTaken,
    })
    setInlineEdit({
      checkIn: "",
      checkOut: "",
      isNightShift: inlineEdit.isNightShift || false,
      breaksTaken: null,
    })
  }

  const undoClearInlineEdit = () => {
    if (!lastClearedSaved) return
    setInlineEdit({
      checkIn: lastClearedSaved.checkIn,
      checkOut: lastClearedSaved.checkOut,
      isNightShift: lastClearedSaved.isNightShift,
      breaksTaken: lastClearedSaved.breaksTaken ?? null,
    })
    setLastClearedSaved(null)
  }

  /**
   * Detect which default shift time fields have actually changed.
   * Returns an array of DefaultChange objects for the confirmation dialog.
   */
  const detectDefaultChanges = (): DefaultChange[] => {
    if (!site) return []
    const changes: DefaultChange[] = []

    const fieldMap: Array<{ key: string; label: string; editVal: string; siteVal: string }> = [
      { key: "defaultCheckIn", label: "Day Shift Check-in", editVal: editDefaultCheckIn, siteVal: site.defaultCheckIn || "" },
      { key: "defaultCheckOut", label: "Day Shift Check-out", editVal: editDefaultCheckOut, siteVal: site.defaultCheckOut || "" },
      { key: "nightDefaultCheckIn", label: "Night Shift Check-in", editVal: editNightDefaultCheckIn, siteVal: site.nightDefaultCheckIn || "" },
      { key: "nightDefaultCheckOut", label: "Night Shift Check-out", editVal: editNightDefaultCheckOut, siteVal: site.nightDefaultCheckOut || "" },
    ]

    for (const { label, editVal, siteVal } of fieldMap) {
      // Only count as a change if old was non-empty, new is non-empty, and they differ
      if (siteVal && editVal && siteVal !== editVal) {
        changes.push({ field: label, oldValue: siteVal, newValue: editVal })
      }
    }

    return changes
  }

  /**
   * Core save logic — called after user decision on whether to propagate.
   */
  const executeSaveDefaults = async (updateTodayRecords: boolean) => {
    if (!site) return

    try {
      setSavingDefaults(true)
      const res = await api.patch(`/api/site/${id}`, {
        defaultCheckIn: editDefaultCheckIn,
        defaultCheckOut: editDefaultCheckOut,
        nightDefaultCheckIn: editNightDefaultCheckIn,
        nightDefaultCheckOut: editNightDefaultCheckOut,
        updateTodayRecords,
      })

      const updatedSite = res.data

      // Handle propagation results
      if (updateTodayRecords && updatedSite.propagation) {
        const { updated, skipped, error } = updatedSite.propagation

        if (error) {
          toast.error(error)
        } else if (skipped && skipped.length > 0) {
          toast.success(`Updated ${updated} record(s). ${skipped.length} record(s) skipped.`)

          // Highlight skipped records
          const newSkippedIds = new Set<string>()
          const newSkippedReasons = new Map<string, string>()
          for (const s of skipped) {
            newSkippedIds.add(s.employeeId)
            const reasonLabel = s.reason === 'overlap'
              ? 'Skipped due to session overlap'
              : 'Skipped due to invalid worked hours'
            newSkippedReasons.set(s.employeeId, reasonLabel)
          }
          setSkippedEmployeeIds(newSkippedIds)
          setSkippedReasons(newSkippedReasons)

          // Auto-clear highlights after 10 seconds
          setTimeout(() => {
            setSkippedEmployeeIds(new Set())
            setSkippedReasons(new Map())
          }, 10000)
        } else {
          toast.success(`Default shift times updated. ${updated} record(s) updated.`)
        }

        // Refresh attendance data to show updated values
        await fetchAttendance()
      } else {
        toast.success("Default shift times updated successfully")
      }

      // Propagate default check-in to unsaved drafts if attendance does not exist yet
      if (!attendanceExists && draftAttendance.length > 0) {
        const oldCheckIn = site.defaultCheckIn || ""
        const newCheckIn = editDefaultCheckIn

        setDraftAttendance(prev =>
          prev.map(record => ({
            ...record,
            sessions: record.sessions.map(session => {
              if (session.checkIn === "" || session.checkIn === oldCheckIn) {
                const prevIsNight = session.isNightShift || false
                let isNightShift = false
                if (newCheckIn) {
                  const [inH] = newCheckIn.split(":").map(Number)
                  const isDayOnlyCheckIn = inH >= cutoffHour && inH < 12 // 7 AM to 12 PM
                  if (prevIsNight) {
                    isNightShift = !isDayOnlyCheckIn
                  } else {
                    const inRange = inH >= 0 && inH < cutoffHour
                    const crossesMidnight = session.checkOut ? isCrossMidnight(newCheckIn, session.checkOut, false) : false
                    isNightShift = inRange || crossesMidnight
                  }
                } else {
                  isNightShift = prevIsNight
                }
                const workedHours = calculateHours(newCheckIn, session.checkOut, isNightShift)
                return {
                  ...session,
                  checkIn: newCheckIn,
                  isNightShift,
                  workedHours,
                }
              }
              return session
            })
          }))
        )
        setIsDirty(true)
      }

      // Remove propagation field before setting site state
      const { propagation: _propagation, ...siteData } = updatedSite
      setSite(siteData)
      setIsEditingDefaults(false)
      setUpdateDefaultsDialogOpen(false)
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to update default shift times")
    } finally {
      setSavingDefaults(false)
    }
  }

  const handleSaveDefaults = async () => {
    if (!site) return

    const toMinutes = (t: string) => {
      const [h, m] = t.split(":").map(Number)
      return h * 60 + m
    }

    // --- DAY SHIFT VALIDATION ---
    if (editDefaultCheckIn) {
      const [inH] = editDefaultCheckIn.split(":").map(Number)
      if (inH < cutoffHour) {
        toast.error(`Default check-in time cannot be before the night shift cutoff hour (${cutoffHour}:00 AM)`)
        return
      }
    }
    if (editDefaultCheckIn && editDefaultCheckOut) {
      if (toMinutes(editDefaultCheckOut) <= toMinutes(editDefaultCheckIn)) {
        toast.error("Day shift check-out must be after check-in (before midnight)")
        return
      }
    }

    // --- NIGHT SHIFT VALIDATION ---
    if (editNightDefaultCheckIn) {
      const inMin = toMinutes(editNightDefaultCheckIn)
      if (inMin < cutoffHour * 60 || inMin > 23 * 60 + 59) {
        toast.error(`Night shift check-in must be between ${cutoffHour}:00 and 23:59`)
        return
      }
    }
    if (editNightDefaultCheckOut) {
      const outMin = toMinutes(editNightDefaultCheckOut)
      if (outMin < 0 || outMin > cutoffHour * 60) {
        toast.error(`Night shift check-out must be between 00:00 and ${cutoffHour}:00`)
        return
      }
    }

    // Detect what changed
    const changes = detectDefaultChanges()

    // If attendance exists and there are meaningful changes (old non-empty → new non-empty),
    // show the confirmation dialog
    if (attendanceExists && changes.length > 0) {
      setPendingDefaultChanges(changes)
      setUpdateDefaultsDialogOpen(true)
      return
    }

    // No changes that need propagation, or drafts only — save directly
    await executeSaveDefaults(false)
  }

  const filteredDraftAttendance = draftAttendance.filter((record) => {
      return (
        record.employee.name
          .toLowerCase()
          .includes(
            filters.name.toLowerCase()
          ) &&
        record.employeeId
          .toLowerCase()
          .includes(
            filters.employeeId.toLowerCase()
          ) &&
        record.jobTitle
          .toLowerCase()
          .includes(
            filters.jobTitle.toLowerCase()
          )
      )
    })

  const filteredAttendance = attendance.filter((record) => {
      return (
        record.name
          .toLowerCase()
          .includes(
            filters.name.toLowerCase()
          ) &&
        record.employeeId
          .toLowerCase()
          .includes(
            filters.employeeId.toLowerCase()
          ) &&
        record.jobTitle
          .toLowerCase()
          .includes(
            filters.jobTitle.toLowerCase()
          )
      )
    })

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty) return

      e.preventDefault()
      e.returnValue = ""
    }

    window.addEventListener(
      "beforeunload",
      handleBeforeUnload
    )

    return () => {
      window.removeEventListener(
        "beforeunload",
        handleBeforeUnload
      )
    }
  }, [isDirty])

  // Sync draft attendance to local storage
  useEffect(() => {
    if (isDirty && draftAttendance && draftAttendance.length > 0 && id) {
      localStorage.setItem(`attendance_draft_${id}_${today}`, JSON.stringify(draftAttendance))
    }
  }, [draftAttendance, isDirty, id, today])

  // Sync inline edits to local storage
  useEffect(() => {
    if (id) {
      if (editingRowId) {
        localStorage.setItem(`active_inline_edit_row_${id}`, editingRowId)
        localStorage.setItem(`active_inline_edit_data_${id}`, JSON.stringify(inlineEdit))
      } else {
        localStorage.removeItem(`active_inline_edit_row_${id}`)
        localStorage.removeItem(`active_inline_edit_data_${id}`)
      }
    }
  }, [editingRowId, inlineEdit, id])

  // Restore inline edits from local storage
  useEffect(() => {
    if (id) {
      const cachedRowId = localStorage.getItem(`active_inline_edit_row_${id}`)
      const cachedData = localStorage.getItem(`active_inline_edit_data_${id}`)
      if (cachedRowId && cachedData) {
        setEditingRowId(cachedRowId)
        setInlineEdit(JSON.parse(cachedData))
      }
    }
  }, [id])

  useEffect(() => {
    if (!isDirty) return

    const handlePopState = () => {
      setPendingPath("BACK")
      setShowLeaveDialog(true)

      window.history.pushState(
        null,
        "",
        window.location.pathname
      )
    }

    window.history.pushState(
      null,
      "",
      window.location.pathname
    )

    window.addEventListener(
      "popstate",
      handlePopState
    )

    return () => {
      window.removeEventListener(
        "popstate",
        handlePopState
      )
    }
  }, [isDirty])

  useEffect(() => {
    const initialize = async () => {
      try {
        setLoading(true)

        // Fetch independent metadata in parallel
        const [configRes, siteData, statusRes] = await Promise.all([
          api.get("/api/config").catch(err => {
            console.error("Failed to fetch config:", err)
            return null
          }),
          fetchSite(),
          checkAttendanceStatus()
        ])

        const cutoffVal = configRes?.data?.data?.nightShiftCutoffHour ?? 0
        setCutoffHour(cutoffVal)

        if (statusRes?.exists) {
          await fetchAttendance()
        } else {
          await Promise.all([
            checkHolidayStatus(),
            siteData ? initializeAttendanceFromEmployees(siteData, cutoffVal) : Promise.resolve()
          ])
        }

      } catch (error) {
        console.log(error)

        toast.error(
          "Failed to load attendance"
        )
      } finally {
        setLoading(false)
      }
    }

    initialize()
  }, [])

  if (loading) {
    return (
      <div className="flex justify-center items-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  // Calculate attendance statistics
  const stats = (() => {
    const records = attendanceExists ? attendance : draftAttendance;
    const totalAssigned = records.length;

    // Filter to sessions belonging to this site
    // An employee is "present" if they have at least one session on this site with a check-in filled.
    const presentRecords = records.filter(rec =>
      rec.sessions.some(s => String(s.siteId) === String(id) && s.checkIn)
    );
    const totalPresent = presentRecords.length;

    // Classify each assigned employee as Day Shift and/or Night Shift.
    // An employee can be assigned to both shifts on the same day.
    const dayShiftAssigned = records.filter(rec =>
      rec.sessions.some(s => String(s.siteId) === String(id) && !s.isNightShift)
    );
    const nightShiftAssigned = records.filter(rec =>
      rec.sessions.some(s => String(s.siteId) === String(id) && s.isNightShift)
    );

    const totalDayShift = dayShiftAssigned.length;
    const totalNightShift = nightShiftAssigned.length;

    const dayShiftPresent = dayShiftAssigned.filter(rec =>
      rec.sessions.some(s => String(s.siteId) === String(id) && !s.isNightShift && s.checkIn)
    ).length;

    const nightShiftPresent = nightShiftAssigned.filter(rec =>
      rec.sessions.some(s => String(s.siteId) === String(id) && s.isNightShift && s.checkIn)
    ).length;

    return {
      totalAssigned,
      totalPresent,
      totalDayShift,
      totalNightShift,
      dayShiftPresent,
      nightShiftPresent,
    };
  })();

  return (
    <div className="space-y-6 p-6">

      {/* PAGE HEADER */}
      <Card className="overflow-hidden">
        {isHoliday && (
          <div className="bg-amber-50 dark:bg-amber-950/20 border-b border-amber-100 dark:border-amber-900/30 px-6 py-2 flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
            <Calendar className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Today is a Holiday: <strong>{holidayReason}</strong></span>
          </div>
        )}
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">

            <div className="flex items-start gap-3">

              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  handleSafeNavigation("/attendance")
                }
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>

              <div>
                <CardTitle className="flex items-center gap-2.5 flex-wrap">
                  <span>{site?.siteName}</span>
                  <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground ring-1 ring-inset ring-muted-foreground/10">
                    {stats.totalPresent} / {stats.totalAssigned} Present
                  </span>
                </CardTitle>

                <p className="text-sm text-muted-foreground mt-1">
                  {formattedDate}
                </p>

                {site?.locationDetails && (
                  <p className="text-sm text-muted-foreground">
                    {site.locationDetails}
                  </p>
                )}

                {/* Day / Night Shift Stats: Slim, mobile-responsive vertical layout */}
                <div className="mt-2.5 space-y-1 text-xs">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Sun className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    <span>
                      Day Shift:{" "}
                      <strong className="text-foreground font-semibold">
                        {stats.dayShiftPresent} / {stats.totalDayShift}
                      </strong>{" "}
                      present
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Moon className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                    <span>
                      Night Shift:{" "}
                      <strong className="text-foreground font-semibold">
                        {stats.nightShiftPresent} / {stats.totalNightShift}
                      </strong>{" "}
                      present
                    </span>
                  </div>
                </div>
              </div>

            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">

              <Button
                variant="default"
                onClick={() =>
                  handleSafeNavigation(`/attendance/${id}/hired-workers`)
                }
              >
                <Users className="h-4 w-4 mr-2" />
                Manage Employees
              </Button>

              {attendanceExists ? (
                <Button disabled>
                  Attendance Submitted
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Save Attendance"
                  )}
                </Button>
              )}

            </div>

          </div>
        </CardHeader>
      </Card>

      {/* DEFAULT SHIFT TIMES CARD */}
      <Card className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-4">

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-md bg-muted text-muted-foreground">
                <Clock3 className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-semibold text-lg text-foreground">Default Shift Times</h3>
                <p className="text-sm text-muted-foreground">Day &amp; night defaults for pre-filling and auto check-in/out</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {!isEditingDefaults && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditingDefaults(true)}
                  className="rounded-md border-muted-foreground/30 hover:bg-accent flex items-center gap-1.5"
                >
                  <Pencil className="h-4 w-4" />
                  Edit
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => setBulkAssignOpen(true)}
                className="rounded-md flex items-center gap-1.5"
                disabled={!attendanceExists}
                title={!attendanceExists ? "Attendance records must be saved first before assigning night shifts" : undefined}
              >
                <Moon className="h-4 w-4" />
                Assign Night Shift
              </Button>
            </div>
          </div>

          {isEditingDefaults ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* DAY SHIFT */}
              <div className="rounded-md border border-muted bg-muted/30 p-4 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Day Shift</div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-muted-foreground uppercase w-7">In</label>
                    <Input
                      type="time"
                      value={editDefaultCheckIn}
                      onChange={(e) => setEditDefaultCheckIn(e.target.value)}
                      className="w-32 rounded-md border-muted bg-background"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-muted-foreground uppercase w-7">Out</label>
                    <Input
                      type="time"
                      value={editDefaultCheckOut}
                      onChange={(e) => setEditDefaultCheckOut(e.target.value)}
                      className="w-32 rounded-md border-muted bg-background"
                    />
                  </div>
                </div>
              </div>

              {/* NIGHT SHIFT */}
              <div className="rounded-md border border-muted bg-muted/30 p-4 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Night Shift</div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-muted-foreground uppercase w-7">In</label>
                    <Input
                      type="time"
                      value={editNightDefaultCheckIn}
                      onChange={(e) => setEditNightDefaultCheckIn(e.target.value)}
                      className="w-32 rounded-md border-muted bg-background"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-muted-foreground uppercase w-7">Out</label>
                    <Input
                      type="time"
                      value={editNightDefaultCheckOut}
                      onChange={(e) => setEditNightDefaultCheckOut(e.target.value)}
                      className="w-32 rounded-md border-muted bg-background"
                    />
                  </div>
                </div>
              </div>

              {/* ACTIONS */}
              <div className="md:col-span-2 flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleSaveDefaults}
                  disabled={savingDefaults}
                  className="rounded-md flex items-center gap-1.5"
                >
                  {savingDefaults ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditDefaultCheckIn(site?.defaultCheckIn || "")
                    setEditDefaultCheckOut(site?.defaultCheckOut || "")
                    setEditNightDefaultCheckIn(site?.nightDefaultCheckIn || "")
                    setEditNightDefaultCheckOut(site?.nightDefaultCheckOut || "")
                    setIsEditingDefaults(false)
                  }}
                  className="rounded-md flex items-center gap-1.5"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* DAY SHIFT (read) */}
              <div className="rounded-md border border-muted bg-muted/30 p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Day Shift</div>
                <div className="flex gap-6">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">In</div>
                    <p className="mt-0.5 font-bold text-foreground">
                      {site?.defaultCheckIn ? site.defaultCheckIn : "--:--"}
                    </p>
                  </div>
                  <div className="border-r border-border h-8 self-center"></div>
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Out</div>
                    <p className="mt-0.5 font-bold text-foreground">
                      {site?.defaultCheckOut ? site.defaultCheckOut : "--:--"}
                    </p>
                  </div>
                </div>
              </div>

              {/* NIGHT SHIFT (read) */}
              <div className="rounded-md border border-muted bg-muted/30 p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Night Shift</div>
                <div className="flex gap-6">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">In</div>
                    <p className="mt-0.5 font-bold text-foreground">
                      {site?.nightDefaultCheckIn ? site.nightDefaultCheckIn : "--:--"}
                    </p>
                  </div>
                  <div className="border-r border-border h-8 self-center"></div>
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Out</div>
                    <p className="mt-0.5 font-bold text-foreground">
                      {site?.nightDefaultCheckOut ? site.nightDefaultCheckOut : "--:--"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* NIGHT SHIFT BANNER */}
      {extendedPeriod && (
        <div className="night-shift-banner" style={{
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
          color: "#e0e0ff",
          padding: "12px 16px",
          borderRadius: "8px",
          marginBottom: "16px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          fontSize: "14px",
          border: "1px solid rgba(100, 100, 255, 0.2)",
        }}>
          <span style={{ fontSize: "20px" }}>🌙</span>
          <div>
            <strong>Logging for {formatLogicalDateLabel(today)} (Night Shift)</strong>
            <div style={{ fontSize: "12px", opacity: 0.8, marginTop: "2px" }}>
              The portal is showing the previous day's roster because it's before {cutoffHour}:00 AM.
            </div>
          </div>
        </div>
      )}



      {/* FILTERS */}
      <Card>
        <CardContent className="pt-6">

          <div className="grid gap-4 md:grid-cols-3">

            <Input
              placeholder="Search name"
              value={filters.name}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  name: e.target.value,
                }))
              }
            />

            <Input
              placeholder="Employee ID"
              value={filters.employeeId}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  employeeId: e.target.value,
                }))
              }
            />

            <Input
              placeholder="Job Title"
              value={filters.jobTitle}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  jobTitle: e.target.value,
                }))
              }
            />

          </div>

        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">

          {attendanceExists ? (
            <>
              {/* MOBILE */}
              <div className="space-y-3 md:hidden">
                {filteredAttendance.map((record) => {
                  const isEditing =
                    editingRowId === record.attendanceId

                  const complete = isRecordComplete(record)

                  return (
                    <Card
                      key={record.attendanceId}
                      className={
                        (isOverlapRow(record.employee) || (isEditing && !!inlineEditError))
                          ? "border-red-500 bg-red-50/50 dark:bg-red-950/10"
                          : skippedEmployeeIds.has(record.employeeId)
                            ? "border-amber-500 bg-amber-50/50 dark:bg-amber-950/10"
                            : ""
                      }
                      title={skippedEmployeeIds.has(record.employeeId) ? skippedReasons.get(record.employeeId) || '' : undefined}
                    >
                      <CardContent className="pt-4 space-y-3">

                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium">
                                {record.name}
                              </p>
                              {record.user && (
                                <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-800/30 text-[10px] px-1.5 py-0 h-4">
                                  Supervisor
                                </Badge>
                              )}
                              {record.employmentType === 'temporary' && (
                                <Badge variant="secondary" className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/30 text-[10px] px-1.5 py-0 h-4">
                                  Temporary
                                </Badge>
                              )}
                              {record.isSickLeave && <SickLeaveBadge />}
                            </div>

                            <p className="text-sm text-muted-foreground">
                              {record.employeeId} • {record.jobTitle}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {isEmployeeAbsent(record.sessions, id) && <AbsentIndicator />}
                            {!isEditing && (
                              <RowActionsMenu
                                isSick={!!record.isSickLeave}
                                saving={sickSavingId === record.attendanceId}
                                sickDisabled={!isEmployeeAbsent(record.sessions, id)}
                                sickDisabledReason="Clear the check-in to mark sick leave"
                                onToggleSick={() => toggleSavedSickLeave(record)}
                              />
                            )}
                          </div>
                        </div>

                        <div>
                          <span className="font-medium">
                            Hours:
                          </span>{" "}
                          {isEditing
                            ? calculateHours(
                                inlineEdit.checkIn,
                                inlineEdit.checkOut,
                                inlineEdit.isNightShift
                              )
                            : getSiteWorkedHours(record)}
                        </div>

                        {breakDurationMinutes > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="font-medium">Breaks:</span>
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  className="h-6 w-6 rounded border text-xs font-bold hover:bg-muted transition-colors disabled:opacity-40"
                                  disabled={inlineEdit.breaksTaken !== null && inlineEdit.breaksTaken <= 0}
                                  onClick={() => {
                                    const currentSessionHours = record.sessions[0]?.workedHours || 0
                                    const otherSessionsHours = (record.totalRawHours || 0) - currentSessionHours
                                    const newTotalRawHours = otherSessionsHours + calculateHours(inlineEdit.checkIn, inlineEdit.checkOut, inlineEdit.isNightShift)
                                    const auto = Math.floor(newTotalRawHours / fullDayHours)
                                    setInlineEdit((prev) => ({
                                      ...prev,
                                      breaksTaken: Math.max(0, (prev.breaksTaken ?? auto) - 1)
                                    }))
                                  }}
                                >−</button>
                                <span className="text-xs">
                                  {inlineEdit.breaksTaken !== null
                                    ? inlineEdit.breaksTaken
                                    : "Auto"}
                                </span>
                                <button
                                  type="button"
                                  className="h-6 w-6 rounded border text-xs font-bold hover:bg-muted transition-colors"
                                  onClick={() => {
                                    const currentSessionHours = record.sessions[0]?.workedHours || 0
                                    const otherSessionsHours = (record.totalRawHours || 0) - currentSessionHours
                                    const newTotalRawHours = otherSessionsHours + calculateHours(inlineEdit.checkIn, inlineEdit.checkOut, inlineEdit.isNightShift)
                                    const auto = Math.floor(newTotalRawHours / fullDayHours)
                                    setInlineEdit((prev) => ({
                                      ...prev,
                                      breaksTaken: (prev.breaksTaken ?? auto) + 1
                                    }))
                                  }}
                                >+</button>
                                {inlineEdit.breaksTaken !== null && (
                                  <button
                                    type="button"
                                    className="text-[10px] text-muted-foreground hover:text-foreground ml-1"
                                    onClick={() => setInlineEdit((prev) => ({ ...prev, breaksTaken: null }))}
                                    title="Reset to auto"
                                  >✕</button>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs">
                                {(() => {
                                  const count = record.breaksTaken !== null && record.breaksTaken !== undefined
                                    ? record.breaksTaken
                                    : Math.floor((record.totalRawHours ?? record.sessions.reduce((acc, s) => acc + (s.workedHours || 0), 0)) / fullDayHours);
                                  return `${count}`;
                                })()}
                              </span>
                            )}
                          </div>
                        )}


                        {isEditing ? (
                          <div className="space-y-3">
                             <div className="space-y-1">
                              <p className="text-sm font-medium">
                                Check In
                              </p>

                              <Input
                                type="time"
                                value={inlineEdit.checkIn}
                               onChange={(e) => {
                                  const val = e.target.value
                                  const originalIsNight = record.sessions[0]?.isNightShift || false
                                  let isNight = false
                                  if (val) {
                                    const [inH] = val.split(":").map(Number)
                                    const isDayOnlyCheckIn = inH >= cutoffHour && inH < 12 // 7 AM to 12 PM
                                    if (originalIsNight) {
                                      isNight = !isDayOnlyCheckIn
                                    } else {
                                      const inRange = inH >= 0 && inH < cutoffHour
                                      const crossesMidnight = inlineEdit.checkOut ? isCrossMidnight(val, inlineEdit.checkOut, false) : false
                                      isNight = inRange || crossesMidnight
                                    }
                                  } else {
                                    isNight = originalIsNight
                                  }
                                  setInlineEdit((prev) => ({
                                    ...prev,
                                    checkIn: val,
                                    isNightShift: isNight,
                                  }))
                                }}
                              />
                            </div>

                            <div className="space-y-1">
                              <p className="text-sm font-medium">
                                Check Out
                              </p>

                              <Input
                                type="time"
                                value={inlineEdit.checkOut}
                                onChange={(e) => {
                                  const val = e.target.value
                                  const originalIsNight = record.sessions[0]?.isNightShift || false
                                  let isNight = false
                                  if (inlineEdit.checkIn) {
                                    const [inH] = inlineEdit.checkIn.split(":").map(Number)
                                    const isDayOnlyCheckIn = inH >= cutoffHour && inH < 12 // 7 AM to 12 PM
                                    if (originalIsNight) {
                                      isNight = !isDayOnlyCheckIn
                                    } else {
                                      const inRange = inH >= 0 && inH < cutoffHour
                                      const crossesMidnight = val ? isCrossMidnight(inlineEdit.checkIn, val, false) : false
                                      isNight = inRange || crossesMidnight
                                    }
                                  } else {
                                    isNight = originalIsNight
                                  }
                                  setInlineEdit((prev) => ({
                                    ...prev,
                                    checkOut: val,
                                    isNightShift: isNight,
                                  }))
                                }}
                              />
                            </div>

                            <div className="text-sm mt-2 font-medium flex items-center gap-1.5">
                              <span>Shift:</span>
                              {(inlineEdit.isNightShift || (inlineEdit.checkIn && inlineEdit.checkOut && isCrossMidnight(inlineEdit.checkIn, inlineEdit.checkOut, inlineEdit.isNightShift))) ? (
                                <span className="inline-flex items-center gap-1 text-indigo-600 font-medium">
                                  🌙 Night
                                </span>
                              ) : (
                                <span className="text-muted-foreground">☀️ Day</span>
                              )}
                            </div>

                            {inlineEditError && (
                              <div className="text-red-500 text-xs mt-1 font-medium max-w-xs">
                                {inlineEditError}
                              </div>
                            )}

                            <div className="flex gap-2 flex-wrap">
                              {lastClearedSaved && lastClearedSaved.attendanceId === record.attendanceId && !inlineEdit.checkIn && !inlineEdit.checkOut ? (
                                <Button
                                  variant="outline"
                                  onClick={undoClearInlineEdit}
                                  className="flex items-center gap-1.5"
                                  disabled={rowSaving}
                                >
                                  <Undo className="h-4 w-4" />
                                  Undo
                                </Button>
                              ) : (inlineEdit.checkIn || inlineEdit.checkOut) ? (
                                <Button
                                  variant="outline"
                                  onClick={() => clearInlineEdit(record)}
                                  disabled={rowSaving}
                                >
                                  Absent
                                </Button>
                              ) : null}
                              <Button
                                onClick={() =>
                                  saveInlineEdit(record)
                                }
                                disabled={rowSaving}
                              >
                                {rowSaving ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <>
                                    <Save className="h-4 w-4 mr-2" />
                                    Save
                                  </>
                                )}
                              </Button>

                              <Button
                                variant="outline"
                                onClick={cancelInlineEdit}
                                disabled={rowSaving}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="space-y-3">
                              {record.sessions.map((session, idx) => (
                                <div key={session._id || idx} className="space-y-2 border-t pt-2 first:border-t-0 first:pt-0">
                                  {record.sessions.length > 1 && (
                                    <p className="text-xs font-semibold text-muted-foreground">
                                      Session #{idx + 1}
                                    </p>
                                  )}
                                  <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                      <p className="text-sm font-medium">
                                        Check In
                                      </p>
                                      <Input
                                        type="time"
                                        readOnly
                                        value={toTimeValue(session.checkIn)}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <p className="text-sm font-medium">
                                        Check Out
                                      </p>
                                      <Input
                                        type="time"
                                        readOnly
                                        value={toTimeValue(session.checkOut)}
                                      />
                                    </div>
                                  </div>
                                  <div className="text-sm font-medium flex items-center gap-1.5 mt-1">
                                    <span>Shift:</span>
                                    {(session.isNightShift || (session.checkIn && session.checkOut && isCrossMidnight(toTimeValue(session.checkIn), toTimeValue(session.checkOut), session.isNightShift))) ? (
                                      <span className="inline-flex items-center gap-1 text-indigo-600 font-medium">
                                        🌙 Night
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground">☀️ Day</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>

                            {complete ? (
                              <Button
                                variant="outline"
                                onClick={() =>
                                  openEditRecord(record)
                                }
                              >
                                <Pencil className="h-4 w-4 mr-2" />
                                <Plus className="h-4 w-4 mr-2" />
                                Edit / Add
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                onClick={() =>
                                  startInlineEdit(record)
                                }
                              >
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit
                              </Button>
                            )}
                          </>
                        )}
                        {isOverlapRow(record.employee) && (
                          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl space-y-1 text-sm text-red-700 dark:bg-red-950/20 dark:border-red-800/30 dark:text-red-200">
                            <div className="font-medium">
                              Conflicts with existing session
                            </div>
                            <div>
                              Site: {overlapError?.conflictingSession?.siteName}
                            </div>
                            <div>
                              Time: {formatConflictingTime()}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
              {/* DESKTOP */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Check In</TableHead>
                      <TableHead>Check Out</TableHead>
                      <TableHead>Shift</TableHead>
                      <TableHead>Hours</TableHead>
                      {breakDurationMinutes > 0 && <TableHead className="text-xs text-muted-foreground">☕ Breaks</TableHead>}
                      <TableHead className="text-right">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>

                    {filteredAttendance.map(
                      (record) => {
                        const isEditing =
                          editingRowId === record.attendanceId

                        const complete = isRecordComplete(record)

                        const sessions =
                          record.sessions.length > 0
                            ? record.sessions
                            : [null]

                        return sessions.map(
                          (session, sessionIndex) => {
                            const isLastSession = sessionIndex === sessions.length - 1
                            return (
                              <Fragment key={`${record.attendanceId}-${sessionIndex}`}>
                                <TableRow
                                  className={
                                    (isOverlapRow(record.employee) || (isEditing && !!inlineEditError))
                                      ? "bg-red-50 dark:bg-red-950/20 border-red-500"
                                      : skippedEmployeeIds.has(record.employeeId)
                                        ? "bg-amber-50 dark:bg-amber-950/20 border-amber-500"
                                        : ""
                                  }
                                  title={skippedEmployeeIds.has(record.employeeId) ? skippedReasons.get(record.employeeId) || '' : undefined}
                                >
                              {sessionIndex === 0 && (
                                <TableCell rowSpan={sessions.length}>
                                  <div className="flex items-center justify-between gap-4">
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <p className="font-medium">
                                          {record.name}
                                        </p>
                                        {record.user && (
                                          <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-800/30 text-[10px] px-1.5 py-0 h-4">
                                            Supervisor
                                          </Badge>
                                        )}
                                        {record.employmentType === 'temporary' && (
                                          <Badge variant="secondary" className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/30 text-[10px] px-1.5 py-0 h-4">
                                            Temporary
                                          </Badge>
                                        )}
                                        {record.isSickLeave && <SickLeaveBadge />}
                                      </div>

                                      <p className="text-sm text-muted-foreground">
                                        {record.employeeId} • {record.jobTitle}
                                      </p>
                                    </div>
                                    {isEmployeeAbsent(record.sessions, id) && <AbsentIndicator />}
                                  </div>
                                </TableCell>
                              )}

                              {/* CHECK IN */}
                              <TableCell>
                                {isEditing ? (
                                  <Input
                                    type="time"
                                    value={inlineEdit.checkIn}
                                    onChange={(e) => {
                                      const val = e.target.value
                                      const originalIsNight = record.sessions[0]?.isNightShift || false
                                      let isNight = false
                                      if (val) {
                                        const [inH] = val.split(":").map(Number)
                                        const isDayOnlyCheckIn = inH >= cutoffHour && inH < 12 // 7 AM to 12 PM
                                        if (originalIsNight) {
                                          isNight = !isDayOnlyCheckIn
                                        } else {
                                          const inRange = inH >= 0 && inH < cutoffHour
                                          const crossesMidnight = inlineEdit.checkOut ? isCrossMidnight(val, inlineEdit.checkOut, false) : false
                                          isNight = inRange || crossesMidnight
                                        }
                                      } else {
                                        isNight = originalIsNight
                                      }
                                      setInlineEdit((prev) => ({
                                        ...prev,
                                        checkIn: val,
                                        isNightShift: isNight,
                                      }))
                                    }}
                                  />
                                ) : (
                                  <Input
                                    type="time"
                                    readOnly
                                    value={toTimeValue(
                                      session?.checkIn
                                    )}
                                  />
                                )}
                              </TableCell>

                              {/* CHECK OUT */}
                              <TableCell>
                                {isEditing ? (
                                  <div className="space-y-1">
                                    <Input
                                      type="time"
                                      value={inlineEdit.checkOut}
                                      onChange={(e) => {
                                        const val = e.target.value
                                        const originalIsNight = record.sessions[0]?.isNightShift || false
                                        let isNight = false
                                        if (inlineEdit.checkIn) {
                                          const [inH] = inlineEdit.checkIn.split(":").map(Number)
                                          const isDayOnlyCheckIn = inH >= cutoffHour && inH < 12 // 7 AM to 12 PM
                                          if (originalIsNight) {
                                            isNight = !isDayOnlyCheckIn
                                          } else {
                                            const inRange = inH >= 0 && inH < cutoffHour
                                            const crossesMidnight = val ? isCrossMidnight(inlineEdit.checkIn, val, false) : false
                                            isNight = inRange || crossesMidnight
                                          }
                                        } else {
                                          isNight = originalIsNight
                                        }
                                        setInlineEdit((prev) => ({
                                          ...prev,
                                          checkOut: val,
                                          isNightShift: isNight,
                                        }))
                                      }}
                                    />
                                    {inlineEditError && (
                                      <div className="text-red-500 text-xs mt-1 font-medium max-w-[180px] break-words">
                                        {inlineEditError}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <Input
                                    type="time"
                                    readOnly
                                    value={toTimeValue(
                                      session?.checkOut
                                    )}
                                  />
                                )}
                              </TableCell>

                              {/* SHIFT */}
                              <TableCell>
                                <span className="text-sm">
                                  {(isEditing ? (inlineEdit.isNightShift || (inlineEdit.checkIn && inlineEdit.checkOut && isCrossMidnight(inlineEdit.checkIn, inlineEdit.checkOut, inlineEdit.isNightShift))) : (session?.isNightShift || (session?.checkIn && session?.checkOut && isCrossMidnight(toTimeValue(session.checkIn), toTimeValue(session.checkOut), session.isNightShift)))) ? (
                                    <span title="Night shift" className="inline-flex items-center gap-1 text-indigo-600 font-medium">
                                      🌙 Night
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">☀️ Day</span>
                                  )}
                                </span>
                              </TableCell>

                              {/* HOURS */}
                              {sessionIndex === 0 && (
                                <TableCell rowSpan={sessions.length}>
                                  {isEditing
                                    ? calculateHours(
                                        inlineEdit.checkIn,
                                        inlineEdit.checkOut,
                                        inlineEdit.isNightShift
                                      )
                                    : getSiteWorkedHours(record)}
                                </TableCell>
                              )}

                              {breakDurationMinutes > 0 && sessionIndex === 0 && (
                                <TableCell rowSpan={sessions.length}>
                                  {isEditing ? (
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        className="h-6 w-6 rounded border text-xs font-bold hover:bg-muted transition-colors disabled:opacity-40"
                                        disabled={inlineEdit.breaksTaken !== null && inlineEdit.breaksTaken <= 0}
                                        onClick={() => {
                                          const currentSessionHours = record.sessions[0]?.workedHours || 0
                                          const otherSessionsHours = (record.totalRawHours || 0) - currentSessionHours
                                          const newTotalRawHours = otherSessionsHours + calculateHours(inlineEdit.checkIn, inlineEdit.checkOut, inlineEdit.isNightShift)
                                          const auto = Math.floor(newTotalRawHours / fullDayHours)
                                          setInlineEdit((prev) => ({
                                            ...prev,
                                            breaksTaken: Math.max(0, (prev.breaksTaken ?? auto) - 1)
                                          }))
                                        }}
                                      >−</button>
                                      <span className="min-w-[44px] text-center text-xs font-medium">
                                        {inlineEdit.breaksTaken !== null
                                          ? inlineEdit.breaksTaken
                                          : "Auto"}
                                      </span>
                                      <button
                                        type="button"
                                        className="h-6 w-6 rounded border text-xs font-bold hover:bg-muted transition-colors"
                                        onClick={() => {
                                          const currentSessionHours = record.sessions[0]?.workedHours || 0
                                          const otherSessionsHours = (record.totalRawHours || 0) - currentSessionHours
                                          const newTotalRawHours = otherSessionsHours + calculateHours(inlineEdit.checkIn, inlineEdit.checkOut, inlineEdit.isNightShift)
                                          const auto = Math.floor(newTotalRawHours / fullDayHours)
                                          setInlineEdit((prev) => ({
                                            ...prev,
                                            breaksTaken: (prev.breaksTaken ?? auto) + 1
                                          }))
                                        }}
                                      >+</button>
                                      {inlineEdit.breaksTaken !== null && (
                                        <button
                                          type="button"
                                          className="text-[10px] text-muted-foreground hover:text-foreground ml-1"
                                          onClick={() => setInlineEdit((prev) => ({ ...prev, breaksTaken: null }))}
                                          title="Reset to auto"
                                        >✕</button>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-xs">
                                      {(() => {
                                        const count = record.breaksTaken !== null && record.breaksTaken !== undefined
                                          ? record.breaksTaken
                                          : Math.floor((record.totalRawHours ?? record.sessions.reduce((acc, s) => acc + (s.workedHours || 0), 0)) / fullDayHours);
                                        return `${count}`;
                                      })()}
                                    </span>
                                  )}
                                </TableCell>
                              )}

                              {/* ACTIONS */}
                              {sessionIndex === 0 && (
                                <TableCell className="text-right" rowSpan={sessions.length}>
                                  {isEditing ? (
                                    <div className="flex justify-end gap-2 items-center">
                                      {lastClearedSaved && lastClearedSaved.attendanceId === record.attendanceId && !inlineEdit.checkIn && !inlineEdit.checkOut ? (
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={undoClearInlineEdit}
                                          className="inline-flex items-center gap-1.5"
                                          disabled={rowSaving}
                                        >
                                          <Undo className="h-4 w-4" />
                                          Undo
                                        </Button>
                                      ) : (inlineEdit.checkIn || inlineEdit.checkOut) ? (
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => clearInlineEdit(record)}
                                          disabled={rowSaving}
                                        >
                                          Absent
                                        </Button>
                                      ) : null}
                                      <Button
                                        size="icon"
                                        variant="outline"
                                        onClick={() =>
                                          saveInlineEdit(record)
                                        }
                                        disabled={rowSaving}
                                      >
                                        {rowSaving ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                          <Save className="h-4 w-4" />
                                        )}
                                      </Button>

                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={cancelInlineEdit}
                                        disabled={rowSaving}
                                      >
                                        <X className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  ) : (
                                    <div className="flex justify-end items-center gap-2">
                                      {complete ? (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          title="Edit & add sessions"
                                          onClick={() =>
                                            openEditRecord(record)
                                          }
                                        >
                                          <Pencil className="h-4 w-4" />
                                          <Plus className="h-4 w-4 ml-1" />
                                        </Button>
                                      ) : (
                                        <Button
                                          size="icon"
                                          variant="outline"
                                          title="Edit attendance"
                                          onClick={() =>
                                            startInlineEdit(record)
                                          }
                                        >
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                      )}
                                      <RowActionsMenu
                                        isSick={!!record.isSickLeave}
                                        saving={sickSavingId === record.attendanceId}
                                        sickDisabled={!isEmployeeAbsent(record.sessions, id)}
                                        sickDisabledReason="Clear the check-in to mark sick leave"
                                        onToggleSick={() => toggleSavedSickLeave(record)}
                                      />
                                    </div>
                                  )}
                                </TableCell>
                              )}
                            </TableRow>
                                {isLastSession && isOverlapRow(record.employee) && (
                                  <TableRow className="border-red-500/30">
                                    <TableCell
                                      colSpan={6}
                                      className="bg-red-50 dark:bg-red-950/20"
                                    >
                                      <div className="space-y-1 text-sm text-red-700 dark:text-red-200">
                                        <div className="font-medium">
                                          Conflicts with existing session
                                        </div>
                                        <div>
                                          Site: {overlapError?.conflictingSession?.siteName}
                                        </div>
                                        <div>
                                          Time: {formatConflictingTime()}
                                        </div>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                )}
                              </Fragment>
                            )
                          }
                        )
                      }
                    )}

                  </TableBody>
                </Table>
              </div>
            </>

          ) : (
              <>
                {/* MOBILE */}
                <div className="space-y-3 md:hidden">
                  {filteredDraftAttendance.map(
                    (record) => {
                      const session = record.sessions[0]

                      return (
                        <Card
                          key={record.employee._id}
                          className={
                            isOverlapRow(record.employee._id)
                              ? "border-red-500"
                              : ""
                          }
                        >
                          <CardContent className="space-y-4 pt-4">

                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="font-medium">
                                    {record.employee.name}
                                  </p>
                                  {record.employee.user && (
                                    <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-800/30 text-[10px] px-1.5 py-0 h-4">
                                      Supervisor
                                    </Badge>
                                  )}
                                  {record.employee.employmentType === 'temporary' && (
                                    <Badge variant="secondary" className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/30 text-[10px] px-1.5 py-0 h-4">
                                      Temporary
                                    </Badge>
                                  )}
                                  {record.isSickLeave && <SickLeaveBadge />}
                                </div>

                                <p className="text-sm text-muted-foreground">
                                  {record.employeeId} • {record.jobTitle}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {isEmployeeAbsent(record.sessions, id) && <AbsentIndicator />}
                                <RowActionsMenu
                                  isSick={!!record.isSickLeave}
                                  onToggleSick={() => toggleDraftSickLeave(record.employee._id)}
                                />
                              </div>
                            </div>

                            <Input
                              type="time"
                              value={session.checkIn}
                              disabled={!!record.isSickLeave}
                              onChange={(e) =>
                                updateDraftSession(
                                  record.employee._id,
                                  0,
                                  "checkIn",
                                  e.target.value
                                )
                              }
                            />

                            <Input
                              type="time"
                              value={session.checkOut}
                              disabled={!!record.isSickLeave}
                              onChange={(e) =>
                                updateDraftSession(
                                  record.employee._id,
                                  0,
                                  "checkOut",
                                  e.target.value
                                )
                              }
                            />

                            <div className="text-sm font-medium flex items-center gap-1.5">
                              <span>Shift:</span>
                              {(session.isNightShift || (session.checkIn && session.checkOut && isCrossMidnight(session.checkIn, session.checkOut, session.isNightShift))) ? (
                                <span className="inline-flex items-center gap-1 text-indigo-600 font-medium">
                                  🌙 Night
                                </span>
                              ) : (
                                <span className="text-muted-foreground">☀️ Day</span>
                              )}
                            </div>

                            {breakDurationMinutes > 0 && (
                              <div className="flex items-center gap-2 text-sm">
                                <span className="font-medium">Breaks:</span>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    className="h-6 w-6 rounded border text-xs font-bold hover:bg-muted transition-colors disabled:opacity-40"
                                    disabled={record.breaksTaken !== null && record.breaksTaken !== undefined && record.breaksTaken <= 0}
                                    onClick={() => {
                                      const auto = Math.floor((record.sessions[0]?.workedHours || 0) / fullDayHours)
                                      updateDraftBreaksTaken(record.employee._id, Math.max(0, (record.breaksTaken ?? auto) - 1))
                                    }}
                                  >−</button>
                                  <span className="min-w-[40px] text-center text-xs">
                                    {record.breaksTaken !== null && record.breaksTaken !== undefined
                                      ? record.breaksTaken
                                      : "Auto"}
                                  </span>
                                  <button
                                    type="button"
                                    className="h-6 w-6 rounded border text-xs font-bold hover:bg-muted transition-colors"
                                    onClick={() => {
                                      const auto = Math.floor((record.sessions[0]?.workedHours || 0) / fullDayHours)
                                      updateDraftBreaksTaken(record.employee._id, (record.breaksTaken ?? auto) + 1)
                                    }}
                                  >+</button>
                                  {record.breaksTaken !== null && record.breaksTaken !== undefined && (
                                    <button
                                      type="button"
                                      className="text-xs text-muted-foreground hover:text-foreground ml-1"
                                      onClick={() => updateDraftBreaksTaken(record.employee._id, null)}
                                      title="Reset to auto"
                                    >✕</button>
                                  )}
                                </div>
                              </div>
                            )}


                            {lastCleared && lastCleared.employeeId === record.employee._id && !session.checkIn && !session.checkOut ? (
                              <div className="flex justify-start">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="w-28 mt-2 flex items-center justify-center gap-1.5 px-3.5 h-8 text-xs font-medium"
                                  onClick={undoClearDraftSession}
                                >
                                  <Undo className="h-4 w-4" />
                                  Undo
                                </Button>
                              </div>
                            ) : isSessionNonEmpty(session) ? (
                              <div className="flex justify-start">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="w-28 mt-2 px-3.5 h-8 text-xs font-medium"
                                  onClick={() => clearDraftSession(record.employee._id, 0)}
                                >
                                  Absent
                                </Button>
                              </div>
                            ) : null}

                            {isOverlapRow(record.employee._id) && (
                              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl space-y-1 text-sm text-red-700 dark:bg-red-950/20 dark:border-red-800/30 dark:text-red-200">
                                <div className="font-medium">
                                  Conflicts with existing session
                                </div>
                                <div>
                                  Site: {overlapError?.conflictingSession?.siteName}
                                </div>
                                <div>
                                  Time: {formatConflictingTime()}
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      )
                    }
                  )}
                </div>

              {/* desktop */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Check In</TableHead>
                      <TableHead>Check Out</TableHead>
                      <TableHead>Shift</TableHead>
                      <TableHead>Hours</TableHead>
                      {breakDurationMinutes > 0 && <TableHead className="text-xs text-muted-foreground">☕ Breaks</TableHead>}
                      <TableHead className="text-right">Actions</TableHead>

                    </TableRow>
                  </TableHeader>

                  <TableBody>

                    {filteredDraftAttendance.map(
                      (record) => {
                        const session =
                          record.sessions[0]

                        return (
                          <>
                            <TableRow
                              key={record.employee._id}
                              className={
                                isOverlapRow(
                                  record.employee._id
                                )
                                  ? "bg-red-50 dark:bg-red-950/20 border-red-500"
                                  : ""
                              }
                            >
                              <TableCell>
                                <div className="flex items-center justify-between gap-4">
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <p className="font-medium">
                                        {record.employee.name}
                                      </p>
                                      {record.employee.user && (
                                        <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-800/30 text-[10px] px-1.5 py-0 h-4">
                                          Supervisor
                                        </Badge>
                                      )}
                                      {record.employee.employmentType === 'temporary' && (
                                        <Badge variant="secondary" className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/30 text-[10px] px-1.5 py-0 h-4">
                                          Temporary
                                        </Badge>
                                      )}
                                      {record.isSickLeave && <SickLeaveBadge />}
                                    </div>

                                    <p className="text-sm text-muted-foreground">
                                      {record.employeeId} • {record.jobTitle}
                                    </p>
                                  </div>
                                  {isEmployeeAbsent(record.sessions, id) && <AbsentIndicator />}
                                </div>
                              </TableCell>

                              <TableCell>
                                <Input
                                  type="time"
                                  value={
                                    session.checkIn
                                  }
                                  disabled={!!record.isSickLeave}
                                  onChange={(e) =>
                                    updateDraftSession(
                                      record.employee._id,
                                      0,
                                      "checkIn",
                                      e.target.value
                                    )
                                  }
                                />
                              </TableCell>

                              <TableCell>
                                <Input
                                  type="time"
                                  value={
                                    session.checkOut
                                  }
                                  disabled={!!record.isSickLeave}
                                  onChange={(e) =>
                                    updateDraftSession(
                                      record.employee._id,
                                      0,
                                      "checkOut",
                                      e.target.value
                                    )
                                  }
                                />
                              </TableCell>

                              <TableCell>
                                {(session.isNightShift || (session.checkIn && session.checkOut && isCrossMidnight(session.checkIn, session.checkOut, session.isNightShift))) ? (
                                  <span className="inline-flex items-center gap-1 text-indigo-600 font-medium">
                                    🌙 Night
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">☀️ Day</span>
                                )}
                              </TableCell>

                              <TableCell>
                                {
                                  session.workedHours
                                }
                              </TableCell>

                              {breakDurationMinutes > 0 && (
                                <TableCell>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      className="h-6 w-6 rounded border text-xs font-bold hover:bg-muted transition-colors disabled:opacity-40"
                                      disabled={record.breaksTaken !== null && record.breaksTaken !== undefined && record.breaksTaken <= 0}
                                      onClick={() => {
                                        const auto = Math.floor((record.sessions[0]?.workedHours || 0) / fullDayHours)
                                        updateDraftBreaksTaken(record.employee._id, Math.max(0, (record.breaksTaken ?? auto) - 1))
                                      }}
                                    >−</button>
                                    <span className="min-w-[44px] text-center text-xs">
                                      {record.breaksTaken !== null && record.breaksTaken !== undefined
                                        ? record.breaksTaken
                                        : "Auto"}
                                    </span>
                                    <button
                                      type="button"
                                      className="h-6 w-6 rounded border text-xs font-bold hover:bg-muted transition-colors"
                                      onClick={() => {
                                        const auto = Math.floor((record.sessions[0]?.workedHours || 0) / fullDayHours)
                                        updateDraftBreaksTaken(record.employee._id, (record.breaksTaken ?? auto) + 1)
                                      }}
                                    >+</button>
                                    {record.breaksTaken !== null && record.breaksTaken !== undefined && (
                                      <button
                                        type="button"
                                        className="text-[10px] text-muted-foreground hover:text-foreground ml-1"
                                        onClick={() => updateDraftBreaksTaken(record.employee._id, null)}
                                        title="Reset to auto"
                                      >✕</button>
                                    )}
                                  </div>
                                </TableCell>
                              )}

                              <TableCell className="text-right">
                                <div className="flex justify-end items-center gap-2">
                                  {lastCleared && lastCleared.employeeId === record.employee._id && !session.checkIn && !session.checkOut ? (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={undoClearDraftSession}
                                      className="inline-flex items-center gap-1.5 px-3.5 h-8 text-xs font-medium"
                                    >
                                      <Undo className="h-4 w-4" />
                                      Undo
                                    </Button>
                                  ) : isSessionNonEmpty(session) ? (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="px-3.5 h-8 text-xs font-medium"
                                      onClick={() => clearDraftSession(record.employee._id, 0)}
                                    >
                                      Absent
                                    </Button>
                                  ) : null}
                                  <RowActionsMenu
                                    isSick={!!record.isSickLeave}
                                    onToggleSick={() => toggleDraftSickLeave(record.employee._id)}
                                  />
                                </div>
                              </TableCell>
                            </TableRow>
                            {isOverlapRow(record.employee._id) && (
                              <TableRow className="border-red-500/30">
                                <TableCell
                                  colSpan={6}
                                  className="bg-red-50 dark:bg-red-950/20"
                                >
                                  <div className="space-y-1 text-sm text-red-700 dark:text-red-200">
                                    <div className="font-medium">
                                      Conflicts with existing session
                                    </div>

                                    <div>
                                      Site:
                                      {" "}
                                      {overlapError?.conflictingSession?.siteName}
                                    </div>

                                    <div>
                                      Time:
                                      {" "}
                                      {formatConflictingTime()}
                                    </div>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </>
                        )
                      }
                    )}

                  </TableBody>
                </Table>
              </div>
              </>

          )}

        </CardContent>
      </Card>
      <EditSiteRecord
        open={editOpen}
        onClose={() => setEditOpen(false)}
        attendanceId={selectedRecord?.attendanceId ?? null}
        site={site!}
        onUpdated={(updatedRecord) =>
          handleRecordUpdated(updatedRecord as AttendanceRecord)
        }
      />

      <BulkAssignNightShift
        open={bulkAssignOpen}
        onClose={() => setBulkAssignOpen(false)}
        siteId={id ?? ""}
        date={today}
        onAssigned={() => {
          fetchAttendance()
        }}
      />

      <UnsavedChangesDialog
        open={showLeaveDialog}
        onStay={() => {
          setShowLeaveDialog(false)
          setPendingPath(null)
        }}
        onLeave={() => {
          setShowLeaveDialog(false)
          setIsDirty(false)

          localStorage.removeItem(`attendance_draft_${id}_${today}`)
          localStorage.removeItem(`active_inline_edit_row_${id}`)
          localStorage.removeItem(`active_inline_edit_data_${id}`)

          if (pendingPath === "BACK") {
            window.history.go(-2)
          } else if (pendingPath) {
            navigate(pendingPath)
          }
        }}
      />

      <UpdateDefaultsDialog
        open={updateDefaultsDialogOpen}
        onOpenChange={setUpdateDefaultsDialogOpen}
        changes={pendingDefaultChanges}
        loading={savingDefaults}
        onConfirm={() => executeSaveDefaults(true)}
        onSkip={() => executeSaveDefaults(false)}
      />

    </div>
  )
}

export default SiteAttendance
