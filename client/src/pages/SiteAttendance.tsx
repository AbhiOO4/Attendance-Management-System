import { api } from "@/lib/api"
import { useEffect, useMemo, useState, Fragment } from "react"
import toast from "react-hot-toast"
import { useNavigate, useParams } from "react-router-dom"
import EditSiteRecord from "@/components/EditSiteRecord"
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog"
import { getLogicalShiftDate, isInExtendedPeriod, calculateHoursBetween, isCrossMidnight, formatLogicalDateLabel, isValidNightShiftTime, isCheckInInToggleRange } from "@/lib/dateUtils"

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
  UserPlus,
} from "lucide-react"

interface Employee {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
  monthlySalary: number
  currentSite: string | null
  currentJob: Job | null
  user: string | null
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
    user?: string | null
  }, //refering to the employee models object id
  employeeId: string,
  jobTitle: string,
  jobId: string | null,
  sessions: DraftSession[]
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


function SiteAttendance() {
  const {id} = useParams()

  console.log("id", id)

  const navigate = useNavigate()

  const [cutoffHour, setCutoffHour] = useState(7)
  const today = useMemo(() => getLogicalShiftDate(cutoffHour), [cutoffHour])
  const extendedPeriod = useMemo(() => isInExtendedPeriod(cutoffHour), [cutoffHour])

  const formattedDate = new Date().toLocaleDateString(
    "en-IN",
    {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }
  )

  const [showLeaveDialog, setShowLeaveDialog] = useState(false)

  const [pendingPath, setPendingPath] = useState<string | null>(null)

  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])

  const [draftAttendance, setDraftAttendance] = useState<DraftAttendanceRecord[]>([])

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
    useState<{ checkIn: string; checkOut: string; isNightShift: boolean }>({
      checkIn: "",
      checkOut: "",
      isNightShift: false,
    })

  const [rowSaving, setRowSaving] = useState(false)

  const openEditRecord = (
    record: AttendanceRecord
  ) => {
    setSelectedRecord(record)
    setEditOpen(true)
  }

  const handleRecordUpdated = (updatedRecord: AttendanceRecord) => {
    console.log(updatedRecord)
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

const initializeAttendanceFromEmployees = async (siteData: Site) => {
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
        res.data.employees.map((emp) => ({
          employee: {
            _id: emp._id,
            name: emp.name,
            user: emp.user || null,
          },

          employeeId: emp.employeeId,

          jobTitle: emp.jobTitle,

          jobId:
            emp.currentJob?._id || null,

          sessions: [
            {
              siteId: siteData._id,
              job: emp.currentJob,
              checkIn: "",
              checkOut: "",
              workedHours: 0,
              isNightShift: false,
            },
          ],
        }))

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
    const inStr = checkIn ? new Date(checkIn).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : ""
    const outStr = checkOut ? new Date(checkOut).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "Present"
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

      const todayDay = new Date()
        .toLocaleDateString("en-US", {
          weekday: "long",
        })
        .toLowerCase()

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

  const toTimeValue = (
    date?: string | null
  ) => {
    if (!date) return ""

    const d = new Date(date)

    if (isNaN(d.getTime())) return ""

    const hours = String(d.getHours()).padStart(2, "0")

    const minutes = String(d.getMinutes()).padStart(2, "0")

    return `${hours}:${minutes}`
  }

  const combineDateAndTimeLocal = (
    recordDate: string,
    time: string | null,
    referenceCheckIn?: string | null,
    isNightShift: boolean = false
  ): string | null => {
    if (!recordDate || !time) return null

    const [hours, minutes] = time.split(":")

    const date = new Date(recordDate)

    date.setHours(Number(hours))
    date.setMinutes(Number(minutes))
    date.setSeconds(0)
    date.setMilliseconds(0)

    if (isNightShift) {
      // Night shift: AM times before cutoff → next day
      if (Number(hours) < cutoffHour) {
        date.setDate(date.getDate() + 1)
      }
    } else if (referenceCheckIn) {
      // Auto cross-midnight detection
      const [inH, inM] = referenceCheckIn.split(":").map(Number)
      const inMin = inH * 60 + inM
      const outMin = Number(hours) * 60 + Number(minutes)
      if (outMin < inMin) {
        date.setDate(date.getDate() + 1)
      }
    }

    return date.toString()
  }

   const startInlineEdit = (
    record: AttendanceRecord
  ) => {
    const session = record.sessions[0]

    setEditingRowId(record.attendanceId)
    setOverlapError(null)

    setInlineEdit({
      checkIn: toTimeValue(session?.checkIn),
      checkOut: toTimeValue(session?.checkOut),
      isNightShift: session?.isNightShift ?? false,
    })
  }

  const cancelInlineEdit = () => {
    setEditingRowId(null)
    setOverlapError(null)

    setInlineEdit({ checkIn: "", checkOut: "", isNightShift: false })
  }



  const saveInlineEdit = async (
    record: AttendanceRecord
  ) => {
    const { checkIn, checkOut, isNightShift } = inlineEdit

    if (!checkIn && checkOut) {
      toast.error("Check-out cannot exist without check-in")
      return
    }

    if (isNightShift) {
      if (checkIn && !isValidNightShiftTime(checkIn, cutoffHour)) {
        toast.error(`Check-in time must be before the cutoff hour (${cutoffHour}:00 AM) for night shifts.`)
        return
      }
      if (checkOut) {
        const [outH, outM] = checkOut.split(":").map(Number)
        if (outH * 60 + outM > cutoffHour * 60) {
          toast.error(`Check-out time must be before or equal to the cutoff hour (${cutoffHour}:00 AM) for night shifts.`)
          return
        }
      }
    }

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
              isNightShift
            ),
            checkOut: combineDateAndTimeLocal(
              record.date,
              checkOut || null,
              checkIn || null,
              isNightShift
            ),
            isNightShift,
          },
        ],
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

        let nextIsNightShift = false
        if (session.checkIn) {
          const inRange = isCheckInInToggleRange(session.checkIn, cutoffHour)
          if (inRange) {
            nextIsNightShift = true
          }
          if (session.checkOut && isCrossMidnight(session.checkIn, session.checkOut, false)) {
            nextIsNightShift = true
          }
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
        }
      })
    )

    setIsDirty(true)
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

      // Fetch night shift cutoff config
      try {
        const configRes = await api.get("/api/config")
        if (configRes.data?.data?.nightShiftCutoffHour !== undefined) {
          setCutoffHour(configRes.data.data.nightShiftCutoffHour)
        }
      } catch (err) {
        console.error("Failed to fetch config:", err)
      }

      const siteData = await fetchSite()

      const {
        exists,
      } = await checkAttendanceStatus()

      if (exists) {
        await fetchAttendance()
      } else {
        await checkHolidayStatus()
        if (siteData) {
          await initializeAttendanceFromEmployees(
            siteData
          )
      }
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

  return (
    <div className="space-y-6 p-6">

      {/* PAGE HEADER */}
      <Card>
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
                    {attendanceExists 
                      ? `${attendance.length} ${attendance.length === 1 ? 'record' : 'records'}` 
                      : `${draftAttendance.length} ${draftAttendance.length === 1 ? 'employee' : 'employees'}`}
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
              </div>

            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">

              <Button
                variant="default"
                onClick={() =>
                  handleSafeNavigation(`/attendance/${id}/insta-add`)
                }
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Add Employees
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

      {/* HOLIDAY INFO */}
      {isHoliday && (
        <Card className="border-yellow-500">
          <CardContent className="pt-6">

            <div className="flex flex-col gap-2">

              <div>
                <Badge>
                  Holiday
                </Badge>
              </div>

              <p className="font-medium">
                {holidayReason}
              </p>

            </div>

          </CardContent>
        </Card>
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
                    <Card key={record.attendanceId} className={isOverlapRow(record.employee) ? "border-red-500" : ""}>
                      <CardContent className="pt-4 space-y-3">

                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium">
                              {record.name}
                            </p>
                            {record.user && (
                              <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-800/30 text-[10px] px-1.5 py-0 h-4">
                                Supervisor
                              </Badge>
                            )}
                          </div>

                          <p className="text-sm text-muted-foreground">
                            {record.employeeId} • {record.jobTitle}
                          </p>
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
                                  if (val && inlineEdit.checkOut) {
                                    const [inH, inM] = val.split(":").map(Number)
                                    const [outH, outM] = inlineEdit.checkOut.split(":").map(Number)
                                    if (inH >= 0 && inH < cutoffHour && outH * 60 + outM > cutoffHour * 60) {
                                      toast.error(`Check-out time must be before or equal to the cutoff hour (${cutoffHour}:00 AM) if checked in before ${cutoffHour}:00 AM.`)
                                      return
                                    }
                                    const inMin = inH * 60 + inM
                                    const outMin = outH * 60 + outM
                                    if (outMin < inMin && outMin > cutoffHour * 60) {
                                      toast.error(`Check-out time must be before or equal to the cutoff hour (${cutoffHour}:00 AM) for night shifts.`)
                                      return
                                    }
                                  }
                                  const isNight = (val && isCheckInInToggleRange(val, cutoffHour)) || (val && inlineEdit.checkOut && isCrossMidnight(val, inlineEdit.checkOut, false))
                                  setInlineEdit((prev) => ({
                                    ...prev,
                                    checkIn: val,
                                    isNightShift: !!isNight,
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
                                  if (inlineEdit.checkIn && val) {
                                    const [inH, inM] = inlineEdit.checkIn.split(":").map(Number)
                                    const [outH, outM] = val.split(":").map(Number)
                                    if (inH >= 0 && inH < cutoffHour && outH * 60 + outM > cutoffHour * 60) {
                                      toast.error(`Check-out time must be before or equal to the cutoff hour (${cutoffHour}:00 AM) if checked in before ${cutoffHour}:00 AM.`)
                                      return
                                    }
                                    const inMin = inH * 60 + inM
                                    const outMin = outH * 60 + outM
                                    if (outMin < inMin && outMin > cutoffHour * 60) {
                                      toast.error(`Check-out time must be before or equal to the cutoff hour (${cutoffHour}:00 AM) for night shifts.`)
                                      return
                                    }
                                  }
                                  const isNight = (inlineEdit.checkIn && isCheckInInToggleRange(inlineEdit.checkIn, cutoffHour)) || (inlineEdit.checkIn && val && isCrossMidnight(inlineEdit.checkIn, val, false))
                                  setInlineEdit((prev) => ({
                                    ...prev,
                                    checkOut: val,
                                    isNightShift: !!isNight,
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

                            <div className="flex gap-2">
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
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <p className="text-sm font-medium">
                                  Check In
                                </p>

                                {record.sessions.map(
                                  (session) => (
                                    <Input
                                      key={session._id}
                                      type="time"
                                      readOnly
                                      value={toTimeValue(
                                        session.checkIn
                                      )}
                                    />
                                  )
                                )}
                              </div>

                              <div className="space-y-1">
                                <p className="text-sm font-medium">
                                  Check Out
                                </p>

                                {record.sessions.map(
                                  (session) => (
                                    <Input
                                      key={session._id}
                                      type="time"
                                      readOnly
                                      value={toTimeValue(
                                        session.checkOut
                                      )}
                                    />
                                  )
                                )}
                              </div>
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
                                <TableRow className={isOverlapRow(record.employee) ? "bg-red-50 dark:bg-red-950/20 border-red-500" : ""}>
                              {sessionIndex === 0 && (
                                <TableCell rowSpan={sessions.length}>
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                      <p className="font-medium">
                                        {record.name}
                                      </p>
                                      {record.user && (
                                        <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-800/30 text-[10px] px-1.5 py-0 h-4">
                                          Supervisor
                                        </Badge>
                                      )}
                                    </div>

                                    <p className="text-sm text-muted-foreground">
                                      {record.employeeId} • {record.jobTitle}
                                    </p>
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
                                      if (val && inlineEdit.checkOut) {
                                        const [inH, inM] = val.split(":").map(Number)
                                        const [outH, outM] = inlineEdit.checkOut.split(":").map(Number)
                                        if (inH >= 0 && inH < cutoffHour && outH * 60 + outM > cutoffHour * 60) {
                                          toast.error(`Check-out time must be before or equal to the cutoff hour (${cutoffHour}:00 AM) if checked in before ${cutoffHour}:00 AM.`)
                                          return
                                        }
                                        const inMin = inH * 60 + inM
                                        const outMin = outH * 60 + outM
                                        if (outMin < inMin && outMin > cutoffHour * 60) {
                                          toast.error(`Check-out time must be before or equal to the cutoff hour (${cutoffHour}:00 AM) for night shifts.`)
                                          return
                                        }
                                      }
                                      const isNight = (val && isCheckInInToggleRange(val, cutoffHour)) || (val && inlineEdit.checkOut && isCrossMidnight(val, inlineEdit.checkOut, false))
                                      setInlineEdit((prev) => ({
                                        ...prev,
                                        checkIn: val,
                                        isNightShift: !!isNight,
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
                                  <Input
                                    type="time"
                                    value={inlineEdit.checkOut}
                                    onChange={(e) => {
                                      const val = e.target.value
                                      if (inlineEdit.checkIn && val) {
                                        const [inH, inM] = inlineEdit.checkIn.split(":").map(Number)
                                        const [outH, outM] = val.split(":").map(Number)
                                        if (inH >= 0 && inH < cutoffHour && outH * 60 + outM > cutoffHour * 60) {
                                          toast.error(`Check-out time must be before or equal to the cutoff hour (${cutoffHour}:00 AM) if checked in before ${cutoffHour}:00 AM.`)
                                          return
                                        }
                                        const inMin = inH * 60 + inM
                                        const outMin = outH * 60 + outM
                                        if (outMin < inMin && outMin > cutoffHour * 60) {
                                          toast.error(`Check-out time must be before or equal to the cutoff hour (${cutoffHour}:00 AM) for night shifts.`)
                                          return
                                        }
                                      }
                                      const isNight = (inlineEdit.checkIn && isCheckInInToggleRange(inlineEdit.checkIn, cutoffHour)) || (inlineEdit.checkIn && val && isCrossMidnight(inlineEdit.checkIn, val, false))
                                      setInlineEdit((prev) => ({
                                        ...prev,
                                        checkOut: val,
                                        isNightShift: !!isNight,
                                      }))
                                    }}
                                  />
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

                              {/* ACTIONS */}
                              {sessionIndex === 0 && (
                                <TableCell className="text-right" rowSpan={sessions.length}>
                                  {isEditing ? (
                                    <div className="flex justify-end gap-2">
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
                                  ) : complete ? (
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

                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-medium">
                                  {record.employee.name}
                                </p>
                                {record.employee.user && (
                                  <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-800/30 text-[10px] px-1.5 py-0 h-4">
                                    Supervisor
                                  </Badge>
                                )}
                              </div>

                              <p className="text-sm text-muted-foreground">
                                {record.employeeId} • {record.jobTitle}
                              </p>
                            </div>

                            <Input
                              type="time"
                              value={session.checkIn}
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
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <p className="font-medium">
                                      {record.employee.name}
                                    </p>
                                    {record.employee.user && (
                                      <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-800/30 text-[10px] px-1.5 py-0 h-4">
                                        Supervisor
                                      </Badge>
                                    )}
                                  </div>

                                  <p className="text-sm text-muted-foreground">
                                    {record.employeeId} • {record.jobTitle}
                                  </p>
                                </div>
                              </TableCell>

                              <TableCell>
                                <Input
                                  type="time"
                                  value={
                                    session.checkIn
                                  }
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

    </div>
  )
}

export default SiteAttendance
