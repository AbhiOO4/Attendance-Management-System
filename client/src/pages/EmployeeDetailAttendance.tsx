
import { useWorkConfig } from "@/context/WorkConfigContext"
import { useAuth } from "@/context/AuthContext"
import { api } from "@/lib/api"
import { computeAutoBreaks } from "@/lib/attendanceUtils"
import { formatLocalTime12h } from "@/lib/dateUtils"
import {
  exportSingleTimesheet,
  getDisplayStatus,
  round2,
} from "@/lib/timesheetExport"

import {
  useEffect,
  useMemo,
  useState,
} from "react"

import {
  useNavigate,
  useParams,
} from "react-router-dom"

import toast from "react-hot-toast"

import EditRecord from "@/components/EditRecord"
import AttendanceRecordHistory from "@/components/AttendanceRecordHistory"

import type {
  AttendanceRecord,
} from "@/pages/EditPastAttendance"

import {
  Card,
  CardContent,
} from "@/components/ui/card"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import {
  ArrowLeft,
  Loader2,
  Pencil,
  Download,
} from "lucide-react"

interface Employee {
  _id: string

  name: string

  employeeId: string

  jobTitle: string

  currentSite: string | null

  currentJob: string | null

  isActive: boolean
}

// `round2` and `getDisplayStatus` now live in @/lib/timesheetExport (shared with
// the bulk export) and are imported above.

function EmployeeAttendanceDetail() {
  const { id } = useParams()

  const navigate = useNavigate()

  const today = new Date()

  const currentMonth =
    today.getMonth() + 1

  const currentYear =
    today.getFullYear()

  const [employee, setEmployee] =
    useState<Employee | null>(null)

  const { config: workConfig } = useWorkConfig()
  const fullDayHours = workConfig?.fullDayHours ?? 8
  const breakDurationMinutes = workConfig?.breakDurationMinutes ?? 60

  // Supervisors view this timesheet read-only: no per-record edit, export stays.
  const { user } = useAuth()
  const canWrite = user?.role === "admin" || user?.role === "superadmin"
  const colCount = canWrite ? 14 : 13



  const [attendance, setAttendance] =
    useState<AttendanceRecord[]>([])

  const [loading, setLoading] =
    useState(false)

  const [editingRecord, setEditingRecord] =
    useState<AttendanceRecord | null>(null)

  const [month, setMonth] =
    useState(String(currentMonth))

  const [year, setYear] =
    useState(String(currentYear))

  const [sortOrder, setSortOrder] =
    useState<"asc" | "desc">("asc")

  const fetchEmployee = async () => {
    try {
      const res = await api.get(
        `/api/employees/${id}`
      )

      setEmployee(res.data)
    } catch (error) {
      console.log(error)

      toast.error(
        "Failed to fetch employee"
      )
    }
  }

  const fetchAttendance = async () => {
    try {
      setLoading(true)

      const res = await api.get(
        `/api/attendance/employee/${id}`,
        {
          params: {
            month,
            year,
          },
        }
      )

      setAttendance(res.data.data || [])
    } catch (error: any) {
      console.log(error)

      toast.error(
        error?.response?.data
          ?.message ||
          "Failed to fetch attendance"
      )
    } finally {
      setLoading(false)
    }
  }

  const exportSpreadsheet = async () => {
    try {
      // The workbook layout lives in the shared @/lib/timesheetExport module so
      // the single-employee sheet stays byte-identical to the bulk export.
      await exportSingleTimesheet({
        employee,
        records: attendance,
        month,
        year,
        workConfig,
        sortOrder,
      })

      toast.success("Spreadsheet exported")
    } catch (error) {
      console.log(error)

      toast.error("Failed to export spreadsheet")
    }
  }

  useEffect(() => {
    fetchEmployee()
  }, [id])

  useEffect(() => {
    fetchAttendance()
  }, [id, month, year])

  const sortedAttendance =
    useMemo(() => {
      return [...attendance].sort(
        (a, b) => {
          const first = new Date(
            a.date
          ).getTime()

          const second = new Date(
            b.date
          ).getTime()

          return sortOrder === "asc"
            ? first - second
            : second - first
        }
      )
    }, [attendance, sortOrder])

  const totals = useMemo(() => {
    return attendance.reduce(
      (acc, record) => {
        acc.totalHours += record.totalWorkHours || 0

        acc.otHours += record.overtimeHours || 0

        // Holidays (a weekly holiday like Friday, or a public holiday) are not
        // working days, so they count toward NEITHER present nor absent — only
        // their holiday hours are tracked. Being absent on a Friday is expected,
        // not an absence. This mirrors the server monthly report, which skips
        // holiday records entirely when tallying present/absent days.
        if (record.isHoliday) {
          acc.holidayHours += record.holidayHours || 0
        }
        // Half-days count as present; sick-leave days carry status "absent",
        // so they fall into the absent bucket alongside plain absences.
        else if (record.status === "fullday" || record.status === "halfday") {
          acc.daysPresent += 1
        } else {
          acc.daysAbsent += 1
        }

        return acc
      },
      {
        totalHours: 0,
        otHours: 0,
        holidayHours: 0,
        daysPresent: 0,
        daysAbsent: 0,
      }
    )
  }, [attendance])

  const handleAttendanceUpdated = (updatedRecord: AttendanceRecord) => {
    setAttendance((prev) =>
      prev.map((record) =>
        record.attendanceId ===
        updatedRecord.attendanceId
          ? updatedRecord
          : record
      )
    )
  }

  return (
    <div className="min-h-screen bg-muted/30 px-3 py-6 sm:px-4">
      <div className="mx-auto max-w-none space-y-6">

        {/* BACK BUTTON */}
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            navigate(-1)
          }
          className="w-fit"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        {/* EMPLOYEE INFO */}
        <Card>
          <CardContent className="space-y-6 p-6">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">

              <div>
                <h1 className="text-3xl font-bold">
                  {employee?.name}
                </h1>

                <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                  <p>
                    Employee ID: {employee?.employeeId}
                  </p>

                  <p>
                    Job Title: {employee?.jobTitle}
                  </p>
                </div>
              </div>

              {/* FILTERS */}
              <div className="flex flex-wrap gap-3">

                {/* MONTH */}
                <Select
                  value={month}
                  onValueChange={setMonth}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Month" />
                  </SelectTrigger>

                  <SelectContent>
                    {Array.from(
                      { length: 12 },
                      (_, i) => (
                        <SelectItem
                          key={i + 1}
                          value={String(i + 1)}
                        >
                          {new Date(
                            0,
                            i
                          ).toLocaleString(
                            "en-IN",
                            {
                              month: "long",
                            }
                          )}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>

                {/* YEAR */}
                <Select
                  value={year}
                  onValueChange={setYear}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue placeholder="Year" />
                  </SelectTrigger>

                  <SelectContent>
                    {Array.from(
                      { length: 5 },
                      (_, i) => {
                        const yr =
                          currentYear - i

                        return (
                          <SelectItem
                            key={yr}
                            value={String(yr)}
                          >
                            {yr}
                          </SelectItem>
                        )
                      }
                    )}
                  </SelectContent>
                </Select>

                {/* SORT */}
                <Select
                  value={sortOrder}
                  onValueChange={(
                    value: "asc" | "desc"
                  ) =>
                    setSortOrder(value)
                  }
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value="asc">
                      Oldest First
                    </SelectItem>

                    <SelectItem value="desc">
                      Latest First
                    </SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  variant="outline"
                  onClick={exportSpreadsheet}
                  className="w-full sm:w-auto"
                >
                  <Download className="mr-2 h-4 w-4" />

                  Export Spreadsheet
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* SUMMARY */}
        {employee && (
          <Card>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">
                    Normal Hours
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {round2(totals.totalHours - totals.otHours)} hrs
                  </p>
                </div>

                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">
                    Total OT Hours
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {round2(totals.otHours + totals.holidayHours)} hrs
                  </p>
                </div>

                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">
                    Days Present
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {totals.daysPresent}
                  </p>
                </div>

                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">
                    Days Absent
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {totals.daysAbsent}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ATTENDANCE TABLE */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>S.No</TableHead>

                    <TableHead>Date</TableHead>

                    <TableHead>Site</TableHead>

                    <TableHead>Job No</TableHead>

                    <TableHead>Check In</TableHead>

                    <TableHead>Check Out</TableHead>

                    <TableHead>Worked</TableHead>

                    <TableHead>Status</TableHead>

                    <TableHead>Sick Leave</TableHead>

                    <TableHead>Total Hours</TableHead>

                    <TableHead>OT Hours</TableHead>

                    <TableHead>Holiday Hours</TableHead>

                    <TableHead>Breaks</TableHead>

                    {canWrite && (
                      <TableHead className="text-right">
                        Actions
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell
                        colSpan={colCount}
                        className="h-40 text-center"
                      >
                        <div className="flex items-center justify-center">
                          <Loader2 className="h-6 w-6 animate-spin" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : sortedAttendance.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={colCount}
                        className="h-40 text-center text-muted-foreground"
                      >
                        No attendance records found
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedAttendance.map(
                      (record, index) => {
                        const sessions =
                          record.sessions.length > 0
                            ? record.sessions
                            : [null]

                        return sessions.map(
                          (session, sessionIndex) => (
                            <TableRow
                              key={`${record.attendanceId}-${sessionIndex}`}
                              className={`${index % 2 === 0
                                  ? "bg-white dark:bg-background"
                                  : "bg-slate-200 dark:bg-slate-900/40"
                                } `}
                            >
                              {/* COMMON CELLS */}
                              {sessionIndex === 0 && (
                                <>
                                  <TableCell
                                    rowSpan={
                                      sessions.length
                                    }
                                  >
                                    {index + 1}
                                  </TableCell>

                                  <TableCell
                                    rowSpan={
                                      sessions.length
                                    }
                                  >
                                    <div className="flex items-center gap-1">
                                      <span>
                                        {(() => {
                                          const d = new Date(record.date)
                                          return (
                                            d.toLocaleDateString("en-IN", {
                                              weekday: "short",
                                            }).slice(0, 3) +
                                            " " +
                                            d.getDate()
                                          )
                                        })()}
                                      </span>
                                      <AttendanceRecordHistory
                                        attendanceId={record.attendanceId}
                                      />
                                    </div>
                                  </TableCell>
                                </>
                              )}

                              {/* SESSION DATA */}
                              <TableCell>
                                {session?.siteName || "-"}
                              </TableCell>

                              <TableCell>
                                {session?.jobCode || "-"}
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

                              {/* COMMON CELLS */}
                              {sessionIndex === 0 && (
                                <>
                                  <TableCell
                                    rowSpan={
                                      sessions.length
                                    }
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
                                    rowSpan={
                                      sessions.length
                                    }
                                  >
                                    {record.isSickLeave
                                      ? "Yes"
                                      : "-"}
                                  </TableCell>

                                  <TableCell
                                    rowSpan={
                                      sessions.length
                                    }
                                  >
                                    {
                                      record.totalWorkHours
                                    }{" "}
                                    hrs
                                  </TableCell>

                                  <TableCell
                                    rowSpan={
                                      sessions.length
                                    }
                                  >
                                    {
                                      typeof record.overtimeHours === "number"
                                        ? Math.round(record.overtimeHours * 100) / 100
                                        : record.overtimeHours
                                    }{" "}
                                    hrs
                                  </TableCell>

                                  <TableCell
                                    rowSpan={
                                      sessions.length
                                    }
                                  >
                                    {record.isHoliday
                                      ? `${Math.round((record.holidayHours || 0) * 100) / 100} hrs`
                                      : "-"}
                                  </TableCell>

                                  <TableCell
                                    rowSpan={
                                      sessions.length
                                    }
                                  >
                                    {(() => {
                                      const count = record.breaksTaken !== null && record.breaksTaken !== undefined
                                        ? record.breaksTaken
                                        : computeAutoBreaks(record.sessions.reduce((acc, s) => acc + (s.workedHours || 0), 0), fullDayHours);
                                      const hrs = (count * breakDurationMinutes) / 60;
                                      return `${hrs} ${hrs === 1 ? "hr" : "hrs"}`;
                                    })()}

                                  </TableCell>


                                  {canWrite && (
                                    <TableCell
                                      rowSpan={
                                        sessions.length
                                      }
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
                                  )}
                                </>
                              )}
                            </TableRow>
                          )
                        )
                      }
                    )
                  )}
                </TableBody>

                {!loading && sortedAttendance.length > 0 && (
                  <TableFooter>
                    <TableRow>
                      <TableCell
                        colSpan={9}
                        className="text-right"
                      >
                        Totals
                      </TableCell>

                      <TableCell>
                        {round2(totals.totalHours)} hrs
                      </TableCell>

                      <TableCell>
                        {round2(totals.otHours)} hrs
                      </TableCell>

                      <TableCell>
                        {round2(totals.holidayHours)} hrs
                      </TableCell>

                      <TableCell colSpan={canWrite ? 2 : 1} />
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* EDIT MODAL (write-only; never mounted for read-only supervisors) */}
      {canWrite && (
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
      )}
    </div>
  )
}

export default EmployeeAttendanceDetail

