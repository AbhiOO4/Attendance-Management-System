import { api } from "@/lib/api"
import { useEffect, useMemo, useState } from "react"
import {
  useNavigate,
  useParams,
} from "react-router-dom"

import toast from "react-hot-toast"

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
  Loader2,
  Pencil,
  Save,
  Search,
} from "lucide-react"

interface Attendance {
  employee: string
  attendanceId?: string
  name: string
  employeeId: string
  jobTitle: string
  status: "present" | "absent" | "halfday"
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

interface DailyReportResponse {
  isHoliday: boolean
  data: Attendance[]
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

  const today =
    new Date().toLocaleDateString("en-CA")

  const formattedDate = new Date().toLocaleDateString(
    "en-IN",
    {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }
  )

  const [attendance, setAttendance] = useState<
    Attendance[]
  >([])

  const [site, setSite] = useState<Site | null>(
    null
  )

  const [loading, setLoading] =
    useState(true)

  const [saving, setSaving] =
    useState(false)

  const [search, setSearch] =
    useState("")

  const [attendanceExists, setAttendanceExists] =
    useState(false)

  const [isLocked, setIsLocked] =
    useState(false)

  const [isHoliday, setIsHoliday] =
    useState(false)

  const [isDirty, setIsDirty] =
    useState(false)

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

  const initializeAttendanceFromEmployees =
    async () => {
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
          res.data.employees.map((emp) => ({
            employee: emp._id,
            name: emp.name,
            employeeId: emp.employeeId,
            jobTitle: emp.jobTitle,
            status: "absent" as const,
            overtimeHours: 0,
          }))

        setAttendance(mappedAttendance)
      } catch (error) {
        console.log(error)

        setAttendance([])
      }
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
                site: id,
              },
            }
          )

        setAttendance(res.data.data)

        setIsHoliday(
          res.data.isHoliday || false
        )
      } catch (error) {
        console.log(error)
      }
    }

  const checkAttendanceStatus =
    async () => {
      try {
        const res = await api.post(
          `/api/site/${id}/check-pending`,
          {
            date: today,
          }
        )

        setAttendanceExists(res.data.exists)
        setIsLocked(res.data.isLocked)

        return res.data.exists
      } catch (error) {
        console.log(error)
        return false
      }
    }

  const initializePage = async () => {
    try {
      setLoading(true)

      await fetchSite()

      const exists =
        await checkAttendanceStatus()

      if (exists) {
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
    const handleBeforeUnload = (
      e: BeforeUnloadEvent
    ) => {
      if (isDirty) {
        e.preventDefault()
        e.returnValue = ""
      }
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

  const cycleStatus = (
    current:
      | "present"
      | "absent"
      | "halfday"
  ) => {
    if (current === "absent")
      return "present"

    if (current === "present")
      return "halfday"

    return "absent"
  }

  const updateStatus = (
    employee: string
  ) => {
    if (isLocked) return

    setAttendance((prev) =>
      prev.map((item) => {
        if (item.employee !== employee)
          return item

        const nextStatus = cycleStatus(
          item.status
        )

        return {
          ...item,
          status: nextStatus,
          overtimeHours:
            nextStatus === "absent"
              ? 0
              : item.overtimeHours,
        }
      })
    )

    setIsDirty(true)
  }

  const updateOvertime = (
    employee: string,
    value: number
  ) => {
    if (isLocked) return

    setAttendance((prev) =>
      prev.map((item) =>
        item.employee === employee
          ? {
              ...item,
              overtimeHours: value,
            }
          : item
      )
    )

    setIsDirty(true)
  }

  const handleSubmit = async () => {
    try {
      setSaving(true)

      if (!attendanceExists) {
        await api.post(
          "/api/attendance/submit",
          {
            siteId: id,
            date: today,
            isHoliday,
            attendance: attendance.map(
              (item) => ({
                employee: item.employee,
                status: item.status,
                overtimeHours:
                  item.overtimeHours,
              })
            ),
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
            updates: attendance.map(
              (item) => ({
                attendanceId:
                  item.attendanceId,
                status: item.status,
                overtimeHours:
                  item.overtimeHours,
              })
            ),
          }
        )

        toast.success(
          "Attendance updated"
        )

        setIsLocked(true)
      }

      setIsDirty(false)
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message ||
          "Failed to save attendance"
      )
    } finally {
      setSaving(false)
    }
  }

  const unlockAttendance =
    async () => {
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

              <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
                <Checkbox
                  checked={isHoliday}
                  disabled={isLocked}
                  onCheckedChange={(
                    checked
                  ) => {
                    setIsHoliday(
                      Boolean(checked)
                    )

                    setIsDirty(true)
                  }}
                />

                <span className="text-sm font-medium">
                  Holiday
                </span>
              </div>

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
              <TableHeader>
                <TableRow>
                  <TableHead>
                    Employee
                  </TableHead>

                  <TableHead>
                    Status
                  </TableHead>

                  <TableHead>
                    OT Hours
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {filteredAttendance.map(
                  (emp) => (
                    <TableRow
                      key={emp.employee}
                    >
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium">
                            {emp.name}
                          </p>

                          <p className="text-sm text-muted-foreground">
                            {
                              emp.employeeId
                            }{" "}
                            •{" "}
                            {
                              emp.jobTitle
                            }
                          </p>
                        </div>
                      </TableCell>

                      <TableCell>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={
                            isLocked
                          }
                          onClick={() =>
                            updateStatus(
                              emp.employee
                            )
                          }
                          className={
                            emp.status ===
                            "present"
                              ? "border-green-500 text-green-600"
                              : emp.status ===
                                  "halfday"
                                ? "border-yellow-500 text-yellow-600"
                                : "border-red-500 text-red-600"
                          }
                        >
                          {emp.status ===
                          "present"
                            ? "Present"
                            : emp.status ===
                                "halfday"
                              ? "Half Day"
                              : "Absent"}
                        </Button>
                      </TableCell>

                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          value={
                            emp.overtimeHours
                          }
                          disabled={
                            isLocked ||
                            emp.status ===
                              "absent"
                          }
                          onChange={(e) =>
                            updateOvertime(
                              emp.employee,
                              Number(
                                e.target
                                  .value
                              )
                            )
                          }
                          className="w-24"
                        />
                      </TableCell>
                    </TableRow>
                  )
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default MarkSiteAttendance