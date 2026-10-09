import { useWorkConfig } from "@/context/WorkConfigContext"
import { useAuth } from "@/context/AuthContext"
import { api } from "@/lib/api"
import { clampBreaks, computeAutoBreaks, resolveBreakMinHours } from "@/lib/attendanceUtils"
import { formatLocalTime12h } from "@/lib/dateUtils"
import {
  exportSingleTimesheet,
  getDisplayStatus,
  round2,
} from "@/lib/timesheetExport"
import { saveAs } from "file-saver"
import { currentMonthYear, type MonthYear } from "@/lib/monthYear"
import {
  ABSENT_REASONS,
  emptyAbsentCounts,
} from "@/lib/leaveComposition"
import { classifyPayrollDay, paymentDaysOf } from "@/lib/payrollDay"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import {
  useNavigate,
  useParams,
} from "react-router-dom"

import toast from "react-hot-toast"

import EditRecord from "@/components/EditRecord"
import AttendanceRecordHistory from "@/components/AttendanceRecordHistory"
import EmployeeTimesheetHeader, {
  type LeaveBalance,
} from "@/components/employee/EmployeeTimesheetHeader"
import LeaveHistoryTable, {
  type LeaveGrant,
} from "@/components/employee/LeaveHistoryTable"

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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"

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
  Loader2,
  Pencil,
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

  const [employee, setEmployee] =
    useState<Employee | null>(null)

  const { config: workConfig } = useWorkConfig()
  const breakMinHours = resolveBreakMinHours(workConfig)
  const breakDurationMinutes = workConfig?.breakDurationMinutes ?? 60

  // Supervisors view this timesheet read-only: no per-record edit, export stays.
  const { user } = useAuth()
  const canWrite = user?.role === "admin" || user?.role === "superadmin"
  // Columns: S.No, Date, Site, Job No, Check In, Check Out, Worked, Status,
  // Total Hours, OT Hours, Holiday Hours, Breaks, Remark (+ Actions when canWrite).
  const colCount = canWrite ? 14 : 13



  const [attendance, setAttendance] =
    useState<AttendanceRecord[]>([])

  const [loading, setLoading] =
    useState(false)

  const [editingRecord, setEditingRecord] =
    useState<AttendanceRecord | null>(null)

  // The timesheet month (app timezone), picked like on the Monthly Report.
  const [period, setPeriod] =
    useState<MonthYear>(currentMonthYear)

  const { month, year } = period

  // Only the latest attendance request may update state — stepping months with
  // the ‹ › arrows would otherwise let a slower, older response overwrite the newer.
  const attendanceSeq = useRef(0)

  const [sortOrder, setSortOrder] =
    useState<"asc" | "desc">("asc")

  const [erpBusy, setErpBusy] = useState(false)

  // Annual paid-leave balance (for the selected year) + grant history. Admin-only.
  const [leaveBalance, setLeaveBalance] =
    useState<LeaveBalance | null>(null)

  const [leaves, setLeaves] =
    useState<LeaveGrant[]>([])

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
    const seq = ++attendanceSeq.current
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

      if (seq !== attendanceSeq.current) return
      setAttendance(res.data.data || [])
    } catch (error: any) {
      if (seq !== attendanceSeq.current) return
      console.log(error)

      toast.error(
        error?.response?.data
          ?.message ||
          "Failed to fetch attendance"
      )
    } finally {
      if (seq === attendanceSeq.current) setLoading(false)
    }
  }

  // Balance + grant history are admin-only and scoped to the selected year.
  const fetchLeaveInfo = async () => {
    if (!canWrite || !id) return
    try {
      const [balanceRes, listRes] = await Promise.all([
        api.get(`/api/attendance/leave/balance/${id}`, { params: { year } }),
        api.get(`/api/attendance/leave/employee/${id}`),
      ])
      setLeaveBalance(balanceRes.data.data || null)
      setLeaves(listRes.data.data || [])
    } catch (error) {
      console.log(error)
    }
  }

  // After a grant or cancel, the attendance rows, the balance and the history
  // all change — refetch the three together.
  const refreshAfterLeaveChange = async () => {
    await Promise.all([fetchAttendance(), fetchLeaveInfo()])
  }

  const handleCancelLeave = async (leaveId: string) => {
    try {
      await api.patch(`/api/attendance/leave/${leaveId}/cancel`)
      toast.success("Leave cancelled")
      await refreshAfterLeaveChange()
    } catch (error: any) {
      console.log(error)
      toast.error(
        error?.response?.data?.message || "Failed to cancel leave"
      )
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

  // Download one ERPNext Data Import CSV scoped to THIS employee (hours + status only;
  // rates live in ERPNext). Same server shapers as the bulk Monthly Report export.
  const downloadErp = async (
    type: "attendance" | "timesheet",
    label: string
  ) => {
    try {
      setErpBusy(true)
      const res = await api.get(
        `/api/attendance/employee/${id}/erpnext/${month}/${year}`,
        { params: { type }, responseType: "blob" }
      )
      const mm = String(month).padStart(2, "0")
      const who = employee?.employeeId ?? id
      saveAs(res.data as Blob, `erpnext-${type}-${who}-${year}-${mm}.csv`)
    } catch (error) {
      console.log(error)
      toast.error(`Failed to export ${label}`)
    } finally {
      setErpBusy(false)
    }
  }

  useEffect(() => {
    fetchEmployee()
  }, [id])

  useEffect(() => {
    fetchAttendance()
  }, [id, month, year])

  useEffect(() => {
    fetchLeaveInfo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, year, canWrite])

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
    const sums = attendance.reduce(
      (acc, record) => {
        acc.totalHours += record.totalWorkHours || 0

        acc.otHours += record.overtimeHours || 0

        if (record.isHoliday) {
          acc.holidayHours += record.holidayHours || 0
        }

        // Payroll buckets, classified exactly like the Monthly Report and the ERPNext
        // Attendance CSV (lib/payrollDay.ts), so Payment Days here matches both.
        const day = classifyPayrollDay(record)
        if (day.kind === "annual") acc.daysAnnual += 1
        else if (day.kind === "half") acc.daysHalf += 1
        else if (day.kind === "absent") {
          acc.absent[day.reason] += 1
          // Checked in, no check-out yet: counted as absent until it is closed.
          if (day.reason === "none" && getDisplayStatus(record) === "pending") {
            acc.daysPending += 1
          }
        }
        // "full" deducts nothing; "holiday" is a paid day off or holiday hours.

        return acc
      },
      {
        totalHours: 0,
        otHours: 0,
        holidayHours: 0,
        daysHalf: 0,
        daysAnnual: 0,
        daysPending: 0,
        absent: emptyAbsentCounts(),
      }
    )
    // Working days = every calendar day of the month, holidays included.
    const workingDays = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const daysAbsent = ABSENT_REASONS.reduce(
      (n, reason) => n + sums.absent[reason.key],
      0
    )
    return {
      ...sums,
      workingDays,
      daysAbsent,
      paymentDays: paymentDaysOf(workingDays, daysAbsent, sums.daysHalf),
    }
  }, [attendance, month, year])


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

  const timesheetTable = (
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

                  <TableHead>Total Hours</TableHead>

                  <TableHead>OT Hours</TableHead>

                  <TableHead>Holiday Hours</TableHead>

                  <TableHead>Breaks</TableHead>

                  <TableHead>Remark</TableHead>

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
                                            : getDisplayStatus(record) === "leave"
                                              ? "bg-violet-500/15 text-violet-700 dark:text-violet-400 hover:bg-violet-500/25 border-transparent"
                                              : getDisplayStatus(record) === "emergency"
                                                ? "bg-orange-500/15 text-orange-700 dark:text-orange-400 hover:bg-orange-500/25 border-transparent"
                                                : getDisplayStatus(record) === "lop"
                                                  ? "bg-rose-500/15 text-rose-700 dark:text-rose-400 hover:bg-rose-500/25 border-transparent"
                                                  : ""
                                    }
                                  >
                                    {getDisplayStatus(record) === "sick"
                                      ? "Sick Leave"
                                      : getDisplayStatus(record) === "leave"
                                        ? "Annual Leave"
                                        : getDisplayStatus(record) === "emergency"
                                          ? "Emergency Leave"
                                          : getDisplayStatus(record) === "lop"
                                            ? "LOP"
                                            : getDisplayStatus(record)}
                                  </Badge>
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
                                      ? clampBreaks(record.breaksTaken)
                                      : computeAutoBreaks(record.sessions.reduce((acc, s) => acc + (s.workedHours || 0), 0), breakMinHours);
                                    const hrs = (count * breakDurationMinutes) / 60;
                                    return `${hrs} ${hrs === 1 ? "hr" : "hrs"}`;
                                  })()}

                                </TableCell>

                                {/* Day-level remark — the LOP "Deduct … OMR" auto-remark
                                    or any manual supervisor note (edit via the history icon). */}
                                <TableCell
                                  rowSpan={sessions.length}
                                  className="max-w-[16rem] whitespace-normal break-words text-muted-foreground"
                                >
                                  {record.remark || "-"}
                                </TableCell>


                                {canWrite && (
                                  <TableCell
                                    rowSpan={
                                      sessions.length
                                    }
                                    className="text-right"
                                  >
                                    {/* A granted leave day (annual or emergency) is locked;
                                        cancel the grant (Leave history tab) to edit it. */}
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      disabled={!!record.isPaidLeave || !!record.isEmergencyLeave}
                                      title={
                                        record.isPaidLeave
                                          ? "On annual leave — cancel the leave to edit"
                                          : record.isEmergencyLeave
                                            ? "On emergency leave — cancel the leave to edit"
                                            : undefined
                                      }
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
                      colSpan={8}
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

                    {/* Breaks + Remark (+ Actions when canWrite) */}
                    <TableCell colSpan={canWrite ? 3 : 2} />
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        </CardContent>
      </Card>
  )

  return (
    <div className="min-h-screen bg-muted/30 px-3 py-4 sm:px-4">
      <div className="mx-auto max-w-none space-y-4">

        {/* EMPLOYEE, TOOLBAR (month, sort, grant leave, export) AND MONTH STATS */}
        <EmployeeTimesheetHeader
          employee={employee}
          canWrite={canWrite}
          totals={totals}
          leaveBalance={leaveBalance}
          period={period}
          onPeriodChange={setPeriod}
          sortOrder={sortOrder}
          onSortChange={setSortOrder}
          erpBusy={erpBusy}
          onExportSpreadsheet={exportSpreadsheet}
          onExportErp={downloadErp}
          onLeaveGranted={refreshAfterLeaveChange}
          onBack={() => navigate(-1)}
        />

        {/* ATTENDANCE TABLE — admins also get a Leave history tab (the grant ledger). */}
        {canWrite ? (
          <Tabs defaultValue="timesheet" className="gap-3">
            <TabsList>
              <TabsTrigger value="timesheet">Timesheet</TabsTrigger>
              <TabsTrigger value="leave">
                Leave history
                {leaves.length > 0 && (
                  <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
                    {leaves.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="timesheet">{timesheetTable}</TabsContent>

            <TabsContent value="leave">
              <Card className="py-0">
                <LeaveHistoryTable
                  leaves={leaves}
                  onCancel={handleCancelLeave}
                />
              </Card>
            </TabsContent>
          </Tabs>
        ) : (
          timesheetTable
        )}
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

