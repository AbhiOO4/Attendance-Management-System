import { api } from "@/lib/api"
import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import toast from "react-hot-toast"
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog"
import { Fragment } from "react"


import {
  Card,
  CardContent,
} from "@/components/ui/card"

import { Button } from "@/components/ui/button"

import { Input } from "@/components/ui/input"

import { Badge } from "@/components/ui/badge"

import { Checkbox } from "@/components/ui/checkbox"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import {
  ArrowLeft,
  Loader2,
  Pencil,
  Save,
  Search,
} from "lucide-react"

// ================= TYPES =================

interface Attendance {
  employee: string
  attendanceId?: string

  jobId?: string | null

  name: string
  employeeId: string
  jobTitle: string

  checkIn: string
  checkOut: string

  workHours: number

  status: | "fullday" | "halfday" | "absent"

  overtimeHours: number
}

interface Employee {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
  monthlySalary: number
  currentSite: string | null
  currentJob: string | null
}

interface EmployeesResponse {
  employees: Employee[]
}

type Site = {
  _id: string
  siteName: string
  locationDetails: string
  isActive: boolean
}



function MarkSiteAttendance() {

  const { id } = useParams()

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

  const [attendance, setAttendance] = useState<Attendance[]>([])

  const [site, setSite] = useState<Site | null>(null)

  const [loading, setLoading] = useState(true)

  const [saving, setSaving] = useState(false)

  const [search, setSearch] = useState<string>("")

  const [attendanceExists, setAttendanceExists] = useState(false)

  const [isLocked, setIsLocked] = useState(false)

  const [isDirty, setIsDirty] = useState(false)

  const [isHoliday, setIsHoliday] = useState(false)

  const [holidayReason, setHolidayReason] = useState("")

  const [overlapErrors, setOverlapErrors] =
  useState<
    Record<
      string,
      {
        siteName: string
        checkIn: string
        checkOut: string
      }
    >
  >({})


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
      const res = await api.get(
        `/api/site/${id}`
      )

      setSite(res.data)
    } catch (error) {
      console.log(error)
    }
  }

  const initializeAttendanceFromEmployees = async () => {
      try {
        const res =
          await api.get<EmployeesResponse>(
            "/api/employees",
            {
              params: {
                site: id,
              },
            }
          )

        const mappedAttendance =
          res.data.employees.map(
            (emp) => ({
              employee: emp._id,

              name: emp.name,
              jobId: emp.currentJob,

              employeeId:
                emp.employeeId,

              jobTitle: emp.jobTitle,

              checkIn: "",

              checkOut: "",

              workHours: 0,

              status:
                "absent" as const,

              overtimeHours: 0,
            })
          )

        setAttendance(
          mappedAttendance
        )
      } catch (error) {
        console.log(error)

        setAttendance([])
      }
    }

  interface AttendanceRecord {
    serialNumber: number

    attendanceId: string

    jobId: string | null

    employee: string

    name: string

    employeeId: string

    jobTitle: string

    status:
    | "fullday"
    | "halfday"
    | "absent"

    isHoliday: boolean

    totalWorkHours: number

    overtimeHours: number

    sessions: {
      checkIn: string
      checkOut: string
      workedHours: number
    }[]
  }

  interface DailyReportResponse {
    message: string,
    totalRecords: number,
    isHoliday: boolean,
    filters: {
      date: string,
      site: string | null,
      name: string | null,
      employeeId: string | null
    },
    data: AttendanceRecord[]
  }

  const formatTimeForInput = (dateString: string) => {
    const date = new Date(dateString)

    const hours = String(date.getHours()).padStart(2, "0")
    const minutes = String(date.getMinutes()).padStart(2, "0")

    return `${hours}:${minutes}`
  }



  const fetchExistingAttendance =
    async () => {
      try {
        const res =
          await api.get<DailyReportResponse>(
            "/api/attendance/reports/daily",
            {
              params: {
                date: today,
                siteId: id,
              },
            }
          )

        const fetchedAttendance:
          Attendance[] =
          res.data.data.map((emp) => ({
            employee: emp.employee,

            attendanceId:emp.attendanceId,
            
            jobId: emp.jobId ,
 
            name: emp.name,

            employeeId:
              emp.employeeId,

            jobTitle:
              emp.jobTitle,

            checkIn:
              emp.sessions?.[0]?.checkIn
                ? formatTimeForInput(
                  emp.sessions[0].checkIn
                )
                : "",

            checkOut:
              emp.sessions?.[0]?.checkOut
                ? formatTimeForInput(
                  emp.sessions[0].checkOut
                )
                : "",

            workHours:
              emp.sessions?.[0]?.workedHours,

            status: emp.status,

            overtimeHours:
              emp.overtimeHours,
          }))

        setAttendance(
          fetchedAttendance
        )
      } catch (error) {
        console.log(error)
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

      const locked =
        res.data.lock?.isLocked || false

      setAttendanceExists(exists)

      setIsLocked(locked)

      return {
        exists,
        locked,
      }
    } catch (error) {
      console.log(error)

      setAttendanceExists(false)

      setIsLocked(false)

      return {
        exists: false,
        locked: false,
      }
    }
  }

  const checkHolidayStatus = async () => {
    try {

      // ---------------- GET WORK SCHEDULE ----------------
      const configRes = await api.get("/api/config")

      const weeklyHolidays =
        configRes.data.data.weeklyHolidays || []

      const todayDay = new Date()
        .toLocaleDateString("en-US", {
          weekday: "long",
        })
        .toLowerCase()

      // ---------------- WEEKLY HOLIDAY PRIORITY ----------------
      if (weeklyHolidays.includes(todayDay)) {
        setIsHoliday(true)
        setHolidayReason("Weekly Holiday")
        return
      }

      // ---------------- CUSTOM HOLIDAY CHECK ----------------
      const holidayRes = await api.get(
        "/api/config/custom-holidays/check",
        {
          params: {
            date: today,
          },
        }
      )

      if (holidayRes.data.isHoliday) {
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

  const initializePage = async () => {
  try {
    setLoading(true)

    await fetchSite()

    await checkHolidayStatus()

    const attendanceStatus =
      await checkAttendanceStatus()

    if (attendanceStatus.exists) {
      await fetchExistingAttendance()
    } else {
      await initializeAttendanceFromEmployees()
    }

  } catch (error) {
    console.log(error)
  } finally {
    setLoading(false)
  }
}

  useEffect(() => {
    initializePage()
  }, [])


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
    const handlePopState = ( e: PopStateEvent ) => { 
      if (!isDirty) return
      e.preventDefault()

      window.history.pushState( null, "", window.location.pathname)

      setPendingPath("BACK")
      setShowLeaveDialog(true)
    }

    window.history.pushState( null, "", window.location.pathname)

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


  const filteredAttendance = useMemo(() => {
    return attendance.filter((emp) => {
      const value = search.toLowerCase()

      return (
        emp.name
          .toLowerCase()
          .includes(value) ||
        emp.employeeId
          .toLowerCase()
          .includes(value) ||
        emp.jobTitle
          .toLowerCase()
          .includes(value)
      )
    })
  }, [attendance, search])

const updateAttendanceTime = (employee: string, field:| "checkIn" | "checkOut", value: string ) => {
  if (isLocked) return

  // CLEAR OVERLAP ERROR WHEN USER EDITS
  setOverlapErrors((prev) => {
    const updated = {
      ...prev,
    }

    delete updated[employee]

    return updated
  })

  setAttendance((prev) =>
    prev.map((item) => {
      if (
        item.employee !== employee
      )
        return item

      const updated = {
        ...item,

        [field]: value,
      }

      const workHours =
        calculateHours(
          updated.checkIn,
          updated.checkOut
        )

      return {
        ...updated,

        workHours,

        status:
          calculateStatus(
            workHours
          ),

        overtimeHours:
          calculateOT(
            workHours
          ),
      }
    })
  )

  setIsDirty(true)
}

  const calculateHours = (
    checkIn: string,
    checkOut: string
  ) => {
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

  const calculateStatus = (
    hours: number
  ):
    | "fullday"
    | "halfday"
    | "absent" => {
    if (hours >= 8)
      return "fullday"

    if (hours >= 4)
      return "halfday"

    return "absent"
  }

  const calculateOT = (
    hours: number
  ) => {
    if (hours <= 8) return 0

    return hours - 8
  }

  const handleSubmit = async () => {
  try {
    setSaving(true)

    const payload =
      attendance.map((item) => ({
        employeeId:
          item.employee,

        checkIn: item.checkIn
          ? `${today}T${item.checkIn}`
          : null,

        checkOut:
          item.checkOut
            ? `${today}T${item.checkOut}`
            : null,
      }))

    if (!attendanceExists) {
      await api.post(
        "/api/attendance/submit",
        {
          siteId: id,

          date: today,

          isHoliday,

          attendance: payload,
        }
      )

      toast.success(
        "Attendance submitted"
      )

      setAttendanceExists(true)

      await fetchExistingAttendance()

      setIsLocked(true)
    } else {
      await api.patch(
        "/api/attendance/bulk-update",
        {
          siteId: id,

          date: today,

          isHoliday,

          attendance: payload,
        }
      )

      toast.success(
        "Attendance updated"
      )

      await fetchExistingAttendance()

      setIsLocked(true)
    }

    setIsDirty(false)
  } catch (error: any) {

    const overlap = error?.response?.data?.overlap

    if (overlap) {

      setOverlapErrors({
        [overlap.employeeId]: {
          siteName:
            overlap.siteName,

          checkIn:
            overlap.checkIn,

          checkOut:
            overlap.checkOut,
        },
      })

      toast.error(
        "Attendance overlap detected"
      )

      return
    }

    toast.error(
      error?.response?.data
        ?.message ||
      "Failed to save attendance"
    )
  } finally {
    setSaving(false)
  }
}

  const unlockAttendance = async () => {
    try {
      await api.patch(
        "/api/attendance/unlock",
        {
          siteId: id,
          date: today,
        }
      )

      toast.success(
        "Attendance unlocked"
      )

      setIsLocked(false)
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message ||
        "Failed to unlock attendance"
      )
    }
  }
      

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <Button
            variant="outline"
            onClick={() =>
              handleSafeNavigation("/attendance")
            }
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-5 p-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <h1 className="text-3xl font-bold">
                {site?.siteName}
              </h1>

              <p className="text-muted-foreground">
                {site?.locationDetails}
              </p>

              <p className="text-sm text-muted-foreground">
                {formattedDate}
              </p>

              {isHoliday && (
                <div className="pt-2">
                  <Badge
                    variant="secondary"
                    className="bg-yellow-100 text-yellow-800 border-yellow-300"
                  >
                    Holiday • {holidayReason}
                  </Badge>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Badge
                className={
                  isLocked
                    ? "bg-green-600"
                    : "bg-red-600"
                }
              >
                {isLocked
                  ? "Locked"
                  : "Editable"}
              </Badge>


              {attendanceExists &&
                isLocked && (
                  <Button
                    variant="outline"
                    onClick={
                      unlockAttendance
                    }
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                )}

              <Button
                onClick={handleSubmit}
                disabled={
                  saving || isLocked
                }
              >
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}

                Save Attendance
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />

              <Input
                placeholder="Search employee..."
                value={search}
                onChange={(e) =>
                  setSearch(
                    e.target.value
                  )
                }
                className="pl-9"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="hidden md:table-header-group">
                <TableRow>
                  <TableHead>
                    Employee
                  </TableHead>

                  <TableHead>
                    Check In
                  </TableHead>

                  <TableHead>
                    Check Out
                  </TableHead>

                  <TableHead>
                    Work Hours
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {filteredAttendance.map((emp) => (
                  <Fragment key={emp.employee}>

                    {/* DESKTOP ROW */}
                    <TableRow className="hidden md:table-row">
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium">
                            {emp.name}
                          </p>

                          <p className="text-sm text-muted-foreground">
                            {emp.employeeId} • {emp.jobTitle}
                          </p>

                          {overlapErrors[emp.employee] && (
                            <p className="mt-1 text-sm font-medium text-red-600">
                              Overlap with {
                                overlapErrors[emp.employee]
                                  .siteName
                              }

                              {" "}

                              (
                              {new Date(
                                overlapErrors[emp.employee]
                                  .checkIn
                              ).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}

                              {" - "}

                              {new Date(
                                overlapErrors[emp.employee]
                                  .checkOut
                              ).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                              )
                            </p>
                          )}
                        </div>
                      </TableCell>

                      <TableCell>
                        <Input
                          type="time"
                          value={emp.checkIn}
                          disabled={isLocked}
                          onChange={(e) =>
                            updateAttendanceTime(
                              emp.employee,
                              "checkIn",
                              e.target.value
                            )
                          }
                          className="w-[140px]"
                        />
                      </TableCell>

                      <TableCell>
                        <Input
                          type="time"
                          value={emp.checkOut}
                          disabled={isLocked}
                          onChange={(e) =>
                            updateAttendanceTime(
                              emp.employee,
                              "checkOut",
                              e.target.value
                            )
                          }
                          className="w-[140px]"
                        />
                      </TableCell>

                      <TableCell>
                        <Badge variant="secondary">
                          {emp.workHours.toFixed(1)} hrs
                        </Badge>
                      </TableCell>

                    </TableRow>

                    {/* MOBILE CARD */}
                    <TableRow className="md:hidden">
                      <TableCell colSpan={6} className="p-4">
                        <div className="space-y-4 rounded-lg border p-4">

                          {/* TOP */}
                          <div>
                            <p className="font-medium">
                              {emp.name}
                            </p>

                            <p className="text-sm text-muted-foreground">
                              {emp.employeeId} • {emp.jobTitle}
                            </p>

                            {overlapErrors[emp.employee] && (
                              <p className="mt-2 text-sm font-medium text-red-600">
                                Overlap with {
                                  overlapErrors[emp.employee]
                                    .siteName
                                }

                                {" "}

                                (
                                {new Date(
                                  overlapErrors[emp.employee]
                                    .checkIn
                                ).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}

                                {" - "}

                                {new Date(
                                  overlapErrors[emp.employee]
                                    .checkOut
                                ).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                                )
                              </p>
                            )}
                          </div>

                          {/* TIME INPUTS */}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <p className="mb-1 text-xs text-muted-foreground">
                                Check In
                              </p>

                              <Input
                                type="time"
                                value={emp.checkIn}
                                disabled={isLocked}
                                onChange={(e) =>
                                  updateAttendanceTime(
                                    emp.employee,
                                    "checkIn",
                                    e.target.value
                                  )
                                }
                              />
                            </div>

                            <div>
                              <p className="mb-1 text-xs text-muted-foreground">
                                Check Out
                              </p>

                              <Input
                                type="time"
                                value={emp.checkOut}
                                disabled={isLocked}
                                onChange={(e) =>
                                  updateAttendanceTime(
                                    emp.employee,
                                    "checkOut",
                                    e.target.value
                                  )
                                }
                              />
                            </div>
                          </div>

                          {/* STATS */}
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="secondary">
                              {emp.workHours.toFixed(1)} hrs
                            </Badge>
                          </div>

                        </div>
                      </TableCell>
                    </TableRow>

                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      <UnsavedChangesDialog
        open={showLeaveDialog}
        onStay={() => {
          setShowLeaveDialog(false)
          setPendingPath(null)
        }}
        onLeave={() => {
          setShowLeaveDialog(false)

          if (pendingPath) {
            navigate(pendingPath)
          }
        }}
      />
    </div>
  )
}

export default MarkSiteAttendance