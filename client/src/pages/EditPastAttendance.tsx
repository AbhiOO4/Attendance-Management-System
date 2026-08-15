import { api } from "@/lib/api"
import { useWorkConfig } from "@/context/WorkConfigContext"
import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import EditRecord from "@/components/EditRecord"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

import {
  Card,
  CardContent,
} from "@/components/ui/card"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  UserPlus,
} from "lucide-react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { getCurrentTargetDateString } from "@/lib/dateUtils"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

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
import { formatLocalTime12h } from "@/lib/dateUtils"

// Add these updated interfaces

export interface AttendanceSession {
  _id: string

  siteId: string

  siteName: string

  jobId?: string | null

  jobName?: string

  jobCode?: string | null

  checkIn?: string | null

  checkOut?: string | null

  workedHours: number

  markedBy: string
}

export interface AttendanceRecord {
  attendanceId: string

  employee: string

  name: string

  employeeId: string

  jobTitle: string

  siteId: string

  siteName: string

  jobId?: string | null

  jobName?: string

  jobCode?: string | null

  date: string

  status: "fullday" | "halfday" | "absent"

  isHoliday: boolean

  holidayReason?: "weekly" | "public" | null

  holidayHours?: number

  totalWorkHours: number

  overtimeHours: number

  sessions: AttendanceSession[]

  breaksTaken?: number | null

  totalRawHours?: number

  isSickLeave?: boolean
}

export interface AttendancePagination {
  currentPage: number;

  totalPages: number;

  totalRecords: number;

  limit: number;
}

export interface AttendanceRecordsResponse {
  success: boolean;

  isHoliday: boolean;

  pagination: AttendancePagination;

  data: AttendanceRecord[];
}

type Site = {
  _id: string
  siteName: string
  locationDetails: string
  isActive: boolean
}

interface Filters {
  name: string
  employeeId: string
  jobTitle: string
  site: string
  page: number
  limit: number
}

const getDisplayStatus = (record: AttendanceRecord) => {
  if (record.isSickLeave) {
    return "sick"
  }
  if (record.status === "absent" && record.sessions && record.sessions.length > 0) {
    const hasCheckInNoCheckOut = record.sessions.some(
      (session) => session && session.checkIn && !session.checkOut
    )
    if (hasCheckInNoCheckOut) {
      return "pending"
    }
  }
  return record.status
}

function EditPastAttendance() {
  const todayDateString = getCurrentTargetDateString()

  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // The initial date can arrive as ?date=YYYY-MM-DD (e.g. returning from the
  // Missing Employees page) so the selected day round-trips; clamp to today.
  const paramDate = searchParams.get("date")
  const [date, setDate] = useState(
    paramDate && paramDate <= todayDateString ? paramDate : todayDateString
  )

  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])

  const [sites, setSites] = useState<Site[]>([])

  const [loading, setLoading] = useState(false)

  const [editingRecord, setEditingRecord] =
  useState<AttendanceRecord | null>(null)

  const [isHoliday, setIsHoliday] = useState<boolean>(false)
  const [isWeeklyHoliday, setIsWeeklyHoliday] = useState<boolean>(false)
  const { config: workConfig } = useWorkConfig()
  const fullDayHours = workConfig?.fullDayHours ?? 8
  const breakDurationMinutes = workConfig?.breakDurationMinutes ?? 60



  const [filters, setFilters] =
    useState<Filters>({
      name: "",
      employeeId: "",
      jobTitle: "",
      site: "all",
      page: 1,
      limit: 10,
    })

  const [totalPages, setTotalPages] = useState(1)

  // Count of employees with no record for the selected date, shown as a badge on
  // the header link to the Missing Employees page.
  const [missingTotalCount, setMissingTotalCount] = useState(0)

  const formattedDate = new Date(date).toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  const [openHolidayDialog, setOpenHolidayDialog] = useState(false)

  const [pendingHolidayValue, setPendingHolidayValue] = useState(false)

  const [holidayReason, setHolidayReason] = useState<string>("")

  const checkHolidayStatus = async () => {
    try {
      const weeklyHolidays = workConfig?.weeklyHolidays || []

      // ---------------- WEEKLY HOLIDAY PRIORITY ----------------
      const [year, month, day] = date.split('-').map(Number)
      const dateDay = new Date(year, month - 1, day)
        .toLocaleDateString("en-US", {
          weekday: "long",
        })
        .toLowerCase()

      if (weeklyHolidays.includes(dateDay)) {
        setHolidayReason("Weekly Holiday")
        setIsHoliday(true)
        setIsWeeklyHoliday(true)
        return
      } else {
        setIsWeeklyHoliday(false)
      }

      // ---------------- CUSTOM HOLIDAY CHECK ----------------
      const holidayRes = await api.get(
        "/api/config/custom-holidays/check",
        {
          params: {
            date: date,
          },
        }
      )

      if (holidayRes.data.isHoliday) {
        setHolidayReason(holidayRes.data.reason)
        setIsHoliday(true)
      } else {
        setHolidayReason("")
        setIsHoliday(false)
      }

    } catch (error) {
      console.log(error)
    }
  }

  const handleHolidayToggle = (checked: boolean) => {
    setPendingHolidayValue(checked)

    setOpenHolidayDialog(true)
  }

  const confirmHolidayToggle = async () => {
    try {
      await api.patch(
        "/api/attendance/update/set-holiday",
        {
          date,
          isHoliday: pendingHolidayValue,
        }
      )

      setIsHoliday(pendingHolidayValue)

      toast.success(
        pendingHolidayValue
          ? "Holiday declared successfully"
          : "Holiday removed successfully"
      )

      setOpenHolidayDialog(false)
    } catch (error) {
      console.log(error)

      toast.error(
        "Failed to update holiday status"
      )
    }
  }

  const fetchSites = async () => {
    try {
      const res = await api.get(
        "/api/site"
      )

      setSites(res.data || [])
    } catch (error) {
      console.log(error)
    }
  }


  const fetchAttendance = async () => {
    try {
      setLoading(true)

      const res = await api.get<AttendanceRecordsResponse>("/api/attendance",
          {
            params: {
              date,
              ...filters,
              site: filters.site === "all" ? "" : filters.site,
            },
          }
        )

      setIsHoliday(res.data.isHoliday || false)

      setAttendance(res.data.data)

      setTotalPages(res.data.pagination.totalPages)
    } catch (error: any) {
      toast.error(
        error?.response?.data
          ?.message ||
          "Failed to fetch attendance"
      )
    } finally {
      setLoading(false)
    }
  }


  // Lightweight count for the header link badge — how many employees have no
  // record for the selected date.
  const fetchMissingCount = async () => {
    try {
      const res = await api.get("/api/attendance/missing", {
        params: { date, limit: 1 },
      })
      setMissingTotalCount(res.data.pagination.totalEmployees)
    } catch {
      // Non-fatal: keep the previous count if the probe fails.
    }
  }

  useEffect(() => {
    fetchSites()
  }, [])

  useEffect(() => {
    checkHolidayStatus()
    fetchAttendance()
  }, [date, filters])

  useEffect(() => {
    fetchMissingCount()
  }, [date])

  const changeDate = ( direction: "prev" | "next" ) => {
    const current = new Date(date)

    if (direction === "prev") {
      current.setDate(
        current.getDate() - 1
      )
    } else {
      current.setDate(
        current.getDate() + 1
      )
    }

    const newDate =
      current.toLocaleDateString("en-CA")

    // prevent going beyond today
    if (newDate > todayDateString) {
      return
    }

    setDate(newDate)
  }

  const handleAttendanceUpdated = (updatedRecord: AttendanceRecord) => {
    setAttendance((prev) =>
      prev.map((record) => record.attendanceId === updatedRecord.attendanceId ? updatedRecord : record)
    )
  }


  
 

  return (
    <div className="min-h-screen bg-muted/30 px-3 py-6 sm:px-4">
      <div className="space-y-6">
              <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("/attendance")}
                  className="w-fit"
              >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
              </Button>
        <Card className="sticky top-0 z-20">
          <CardContent className="space-y-6 p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h1 className="text-3xl font-bold">
                  Edit Attendance
                </h1>

                <p className="text-muted-foreground">
                  {formattedDate}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="mr-1 gap-1.5"
                  onClick={() => navigate(`/attendance/edit/missing?date=${date}`)}
                >
                  <UserPlus className="h-4 w-4 text-muted-foreground" />
                  Missing
                  {missingTotalCount > 0 && (
                    <Badge variant="secondary" className="ml-0.5">
                      {missingTotalCount}
                    </Badge>
                  )}
                </Button>

                <Button
                  variant="outline"
                  size="icon"
                  onClick={() =>changeDate("prev")
                  }
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                <Input
                  type="date"
                  value={date}
                  max={todayDateString}
                  onChange={(e) => { 
                    
                    const selectedDate = e.target.value

                    // prevent selecting future date
                    if (
                      selectedDate > todayDateString
                    ) {
                      toast.error(
                        "Future dates are not allowed"
                      )

                      setDate(todayDateString)

                      return
                    }

                    setDate(selectedDate)
                  }}
                  className="w-[180px]"
                />

                <Button
                  variant="outline"
                  size="icon"
                  onClick={() =>changeDate("next")}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
              <Input
                placeholder="Search name"
                value={filters.name}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    name: e.target.value,
                    page: 1,
                  })
                }
              />

              <Input
                placeholder="Employee ID"
                value={
                  filters.employeeId
                }
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    employeeId:
                      e.target.value,
                    page: 1,
                  })
                }
              />

              <Input
                placeholder="Job Title"
                value={
                  filters.jobTitle
                }
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    jobTitle:
                      e.target.value,
                    page: 1,
                  })
                }
              />

              <Select value={filters.site} onValueChange={(value) => setFilters({...filters, site: value, page: 1,})}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Site" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="all">
                    All Sites
                  </SelectItem>

                  {sites.map(
                    (site) => (
                      <SelectItem
                        key={
                          site._id
                        }
                        value={
                          site._id
                        }
                      >
                        {
                          site.siteName
                        }
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>

              {!isWeeklyHoliday && (
                <div className="flex items-center space-x-2">
                  <Switch
                    id="holiday"
                    checked={isHoliday}
                    onCheckedChange={handleHolidayToggle}
                  />

                  <Label htmlFor="holiday">Holiday</Label>
                </div>
              )}

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

             
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>S.No</TableHead>
                    <TableHead>
                      Employee
                    </TableHead>

                    <TableHead>
                      Employee ID
                    </TableHead>

                    <TableHead>
                      Job Title
                    </TableHead>

                    <TableHead>Site</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead>Check In</TableHead>
                    <TableHead>Check Out</TableHead>
                    <TableHead>Worked</TableHead>

                    <TableHead>
                      Status
                    </TableHead>

                    <TableHead>
                      Total Hours
                    </TableHead>

                    <TableHead>
                      OT Hours
                    </TableHead>

                    <TableHead>
                      Holiday Hours
                    </TableHead>

                    <TableHead>
                      Breaks
                    </TableHead>


                    <TableHead className="text-right">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell
                        colSpan={14}
                        className="h-40 text-center"
                      >
                        <div className="flex items-center justify-center">
                          <Loader2 className="h-6 w-6 animate-spin" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : attendance.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={14}
                        className="h-40 text-center text-muted-foreground"
                      >
                        No attendance records found
                      </TableCell>
                    </TableRow>
                  ) : (
                        attendance.map((record, index) => {
                          const serialNumber =
                            (filters.page - 1) *
                            filters.limit +
                            index +
                            1

                          const sessions =
                            record.sessions.length > 0
                              ? record.sessions
                              : [null]

                          return sessions.map(
                            (session, sessionIndex) => (
                              <TableRow
                                key={`${record.attendanceId}-${sessionIndex}`}
                                className={
                                  index % 2 === 0
                                    ? "bg-white dark:bg-background"
                                    : "bg-slate-200 dark:bg-slate-900/40"
                                }
                              >
                                {sessionIndex === 0 && (
                                  <>
                                    <TableCell
                                      rowSpan={sessions.length}
                                    >
                                      {serialNumber}
                                    </TableCell>

                                    <TableCell
                                      rowSpan={sessions.length}
                                      className="font-medium"
                                    >
                                      {record.name}
                                    </TableCell>

                                    <TableCell
                                      rowSpan={sessions.length}
                                    >
                                      {record.employeeId}
                                    </TableCell>

                                    <TableCell
                                      rowSpan={sessions.length}
                                    >
                                      {record.jobTitle}
                                    </TableCell>
                                  </>
                                )}

                                <TableCell>
                                  {session?.siteName || "-"}
                                </TableCell>

                                <TableCell>
                                  {session?.jobName || "-"}
                                </TableCell>

                                <TableCell>
                                  {session?.checkIn
                                    ? formatLocalTime12h(session.checkIn)
                                    : "-"}
                                </TableCell>

                                <TableCell>
                                  {session?.checkOut
                                    ? formatLocalTime12h(session.checkOut)
                                    : "-"}
                                </TableCell>

                                <TableCell>
                                  {session?.workedHours ??
                                    "-"}{" "}
                                  hrs
                                </TableCell>

                                {sessionIndex === 0 && (
                                  <>
                                    <TableCell
                                      rowSpan={sessions.length}
                                    >
                                      <Badge
                                        variant={
                                          getDisplayStatus(record) === "absent"
                                            ? "destructive"
                                            : "secondary"
                                        }
                                        className={
                                          getDisplayStatus(record) === "fullday"
                                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25 border-transparent"
                                            : getDisplayStatus(record) === "pending"
                                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25 border-transparent"
                                              : getDisplayStatus(record) === "sick"
                                                ? "bg-sky-500/15 text-sky-700 dark:text-sky-400 hover:bg-sky-500/25 border-transparent"
                                                : ""
                                        }
                                      >
                                        {getDisplayStatus(record) === "sick"
                                          ? "Sick Leave"
                                          : getDisplayStatus(record)}
                                      </Badge>
                                    </TableCell>

                                    <TableCell
                                      rowSpan={sessions.length}
                                    >
                                      {
                                        record.totalWorkHours
                                      }{" "}
                                      hrs
                                    </TableCell>

                                    <TableCell
                                      rowSpan={sessions.length}
                                    >
                                      {
                                        typeof record.overtimeHours === "number"
                                          ? Math.round(record.overtimeHours * 100) / 100
                                          : record.overtimeHours
                                      }{" "}
                                      hrs
                                    </TableCell>

                                    <TableCell
                                      rowSpan={sessions.length}
                                    >
                                      {record.isHoliday
                                        ? `${Math.round((record.holidayHours || 0) * 100) / 100} hrs`
                                        : "-"}
                                    </TableCell>

                                    <TableCell
                                      rowSpan={sessions.length}
                                    >
                                       {(() => {
                                         const count = record.breaksTaken !== null && record.breaksTaken !== undefined
                                           ? record.breaksTaken
                                           : Math.floor(record.sessions.reduce((acc, s) => acc + (s.workedHours || 0), 0) / fullDayHours);
                                         const hrs = (count * breakDurationMinutes) / 60;
                                         return `${hrs} ${hrs === 1 ? "hr" : "hrs"}`;
                                       })()}

                                    </TableCell>


                                    <TableCell
                                      rowSpan={sessions.length}
                                      className="text-right"
                                    >
                                      <Button
                                        size="icon"
                                        variant="outline"
                                        onClick={() =>
                                          setEditingRecord(
                                            record
                                          )
                                        }
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                    </TableCell>
                                  </>
                                )}
                              </TableRow>
                            )
                          )
                        })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={
                filters.page === 1
              }
              onClick={() =>
                setFilters({
                  ...filters,
                  page:
                    filters.page - 1,
                })
              }
            >
              Previous
            </Button>

            <Button
              variant="outline"
              disabled={
                filters.page ===
                totalPages
              }
              onClick={() =>
                setFilters({
                  ...filters,
                  page:
                    filters.page + 1,
                })
              }
            >
              Next
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            Page {filters.page} of{" "}
            {totalPages}
          </p>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              Rows per page
            </span>
            <Select
              value={String(filters.limit)}
              onValueChange={(value) =>
                setFilters({
                  ...filters,
                  limit: Number(value),
                  page: 1,
                })
              }
            >
              <SelectTrigger className="w-[80px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <AlertDialog
          open={openHolidayDialog}
          onOpenChange={setOpenHolidayDialog}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {pendingHolidayValue
                  ? "Declare holiday?"
                  : "Remove holiday?"}
              </AlertDialogTitle>

              <AlertDialogDescription>
                {pendingHolidayValue
                  ? "This day will be marked as a holiday for all employees. Are you sure you want to continue?"
                  : "This day will no longer be treated as a holiday. Are you sure you want to continue?"}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter>
              <AlertDialogCancel>
                Cancel
              </AlertDialogCancel>

              <AlertDialogAction
                onClick={confirmHolidayToggle}
              >
                Confirm
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <EditRecord
        open={!!editingRecord}
        onClose={() =>
          setEditingRecord(null)
        }
        record={editingRecord}
        onUpdated={(updatedRecord) =>
          handleAttendanceUpdated(updatedRecord as AttendanceRecord)
        }
      />
    </div>
  )
}

export default EditPastAttendance