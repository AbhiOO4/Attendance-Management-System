import { api } from "@/lib/api"
import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { useNavigate, useParams } from "react-router-dom"
import EditSiteRecord from "@/components/EditSiteRecord"
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog"

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
  ArrowLeft,
} from "lucide-react"

interface Employee {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
  monthlySalary: number
  currentSite: string | null
  currentJob: Job | null
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
  _id: string

  siteId: string,

  jobId: string | null,

  checkIn: string | null

  checkOut: string | null

  workedHours: number
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
  workedHours: number
}
//siteId, date, isHoliday are common fields
interface DraftAttendanceRecord {
  employee: {
    _id: string,
    name: string
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

  const navigate = useNavigate()

  const today = new Date().toLocaleDateString("en-CA")

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

const initializeAttendanceFromEmployees = async (siteData: Site) => {
    try {
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

  const calculateHours = (checkIn: string, checkOut: string) => {
    if (!checkIn || !checkOut)
      return 0

    const start =
      new Date(
        `2000-01-01T${checkIn}`
      )

    const end =
      new Date(
        `2000-01-01T${checkOut}`
      )

    const diff =
      (end.getTime() -
        start.getTime()) /
      (1000 * 60 * 60)

    return diff > 0 ? diff : 0
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

  const updateDraftSession = (
    employeeIndex: number,
    sessionIndex: number,
    field: "checkIn" | "checkOut",
    value: string
  ) => {
    setDraftAttendance((prev) => {
      const updated = [...prev]

      updated[employeeIndex] = {
        ...updated[employeeIndex],
        sessions: [
          ...updated[employeeIndex].sessions,
        ],
      }

      const session =
        updated[employeeIndex]
          .sessions[sessionIndex]

      session[field] = value

      session.workedHours =
        calculateHours(
          session.checkIn,
          session.checkOut
        )

      return updated
    })

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

  const getStatusBadgeVariant = (
    status: AttendanceRecord["status"]
  ) => {
    switch (status) {
      case "fullday":
        return "default"

      case "halfday":
        return "secondary"

      case "absent":
        return "destructive"

      default:
        return "outline"
    }
  }



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
                <CardTitle>
                  {site?.siteName}
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
        </CardHeader>
      </Card>

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

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Employee ID</TableHead>
                  <TableHead>Job Title</TableHead>
                  <TableHead>Total Hours</TableHead>
                  <TableHead>Sessions</TableHead>
                  <TableHead className="text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>

                {filteredAttendance.map(
                  (record) => (
                    <TableRow
                      key={record.attendanceId}
                    >
                      <TableCell>
                        {record.name}
                      </TableCell>

                      <TableCell>
                        {record.employeeId}
                      </TableCell>

                      <TableCell>
                        {record.jobTitle}
                      </TableCell>

                      <TableCell>
                        {getSiteWorkedHours(record)}
                      </TableCell>

                      

                      <TableCell>
                        <div className="space-y-1">

                          {record.sessions.map(
                            (session) => (
                              <div
                                key={session._id}
                                className="text-xs"
                              >
                                {session.checkIn &&
                                  session.checkOut
                                  ? `${new Date(
                                    session.checkIn
                                  ).toLocaleTimeString(
                                    "en-IN",
                                    {
                                      hour: "2-digit",
                                      minute:
                                        "2-digit",
                                    }
                                  )} - ${new Date(
                                    session.checkOut
                                  ).toLocaleTimeString(
                                    "en-IN",
                                    {
                                      hour: "2-digit",
                                      minute:
                                        "2-digit",
                                    }
                                  )}`
                                  : "-"}
                              </div>
                            )
                          )}

                        </div>
                      </TableCell>

                      <TableCell className="text-right">

                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() =>
                            openEditRecord(
                              record
                            )
                          }
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>

                      </TableCell>
                    </TableRow>
                  )
                )}

              </TableBody>
            </Table>

          ) : (

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Employee ID</TableHead>
                  <TableHead>Job Title</TableHead>
                  <TableHead>Check In</TableHead>
                  <TableHead>Check Out</TableHead>
                  <TableHead>Hours</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>

                {filteredDraftAttendance.map(
                  (record, rowIndex) => {
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
                            ? "bg-red-50 border-red-500"
                            : ""
                        }
                      >
                        <TableCell>
                          {
                            record.employee
                              .name
                          }
                        </TableCell>

                        <TableCell>
                          {
                            record.employeeId
                          }
                        </TableCell>

                        <TableCell>
                          {
                            record.jobTitle
                          }
                        </TableCell>

                        <TableCell>
                          <Input
                            type="time"
                            value={
                              session.checkIn
                            }
                            onChange={(e) =>
                              updateDraftSession(
                                rowIndex,
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
                                rowIndex,
                                0,
                                "checkOut",
                                e.target.value
                              )
                            }
                          />
                        </TableCell>

                        <TableCell>
                          {
                            session.workedHours
                          }
                        </TableCell>
                      </TableRow>
                        {isOverlapRow( record.employee._id) && (
                            <TableRow>
                              <TableCell
                                colSpan={6}
                                className="bg-red-50"
                              >
                                <div className="space-y-1 text-sm text-red-700">
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
                                    {new Date(
                                      overlapError!
                                        .conflictingSession
                                        .checkIn
                                    ).toLocaleTimeString(
                                      "en-IN",
                                      {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      }
                                    )}
                                    {" - "}
                                    {new Date(
                                      overlapError!
                                        .conflictingSession
                                        .checkOut
                                    ).toLocaleTimeString(
                                      "en-IN",
                                      {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      }
                                    )}
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

          )}

        </CardContent>
      </Card>
      <EditSiteRecord
        open={editOpen}
        onClose={() => setEditOpen(false)}
        attendanceId={selectedRecord?.attendanceId}
        site={site!}
        onUpdated={handleRecordUpdated}
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
