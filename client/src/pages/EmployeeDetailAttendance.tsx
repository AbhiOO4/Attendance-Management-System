import { useWorkConfig } from "@/context/WorkConfigContext"
import { useAuth } from "@/context/AuthContext"
import { api } from "@/lib/api"
import { erpExportWarning } from "@/lib/erpExportWarnings"
import { resolveBreakMinHours } from "@/lib/attendanceUtils"
import { formatLocalTime12h } from "@/lib/dateUtils"
import { sessionJobLabels, sessionPlaceLabel } from "@/lib/jobSplit"
import {
  exportSingleTimesheet,
  getDisplayStatus,
  recordBreakCount,
  round2,
} from "@/lib/timesheetExport"
import { saveAs } from "file-saver"
import { currentMonthYear, type MonthYear } from "@/lib/monthYear"
import {
  notApprovedFromError,
  type ApprovalView,
  type TimesheetBlockers,
} from "@/lib/timesheetApproval"
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
  useSearchParams,
} from "react-router-dom"

import toast from "react-hot-toast"
import axios from "axios"

import EditRecord from "@/components/EditRecord"
import BackfillModal, { type MissingEmployee } from "@/components/BackfillModal"
import TimesheetApprovalBar from "@/components/employee/TimesheetApprovalBar"
import AttendanceRecordHistory from "@/components/AttendanceRecordHistory"
import EmployeeTimesheetHeader, {
  type LeaveBalance,
} from "@/components/employee/EmployeeTimesheetHeader"
import LeaveHistoryTable from "@/components/employee/LeaveHistoryTable"
import type { LeaveApplication } from "@/lib/leave"

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
  CalendarPlus,
  Loader2,
  Pencil,
} from "lucide-react"

interface Employee {
  _id: string

  name: string

  employeeId: string

  jobTitle: string

  companyId?: string | null

  currentSite: string | null

  currentJob: string | null

  employmentType?: "permanent" | "temporary"

  isActive: boolean
}

// One row of the timesheet table: a record, or a day with none (approval blocker).
type TimesheetItem =
  | { kind: "record"; key: string; record: AttendanceRecord }
  | { kind: "missing"; key: string }

const dayKeyOf = (date: string) => new Date(date).toISOString().slice(0, 10)

const EMPTY_BLOCKERS: TimesheetBlockers = { missing: [], pending: [], noJob: [] }

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
  // Columns: S.No, Date, Site, Job No, Check In, Check Out, Session Hrs, Status,
  // Break, Net Hours, OT Hours, Holiday Hours, Remark (+ Actions when canWrite).
  const colCount = canWrite ? 14 : 13



  const [attendance, setAttendance] =
    useState<AttendanceRecord[]>([])

  // Days before today with no record this month, and whether the work schedule's
  // countUnmarkedAsAbsent deducts them — counted by the server exactly like the
  // Monthly Report, so Payment Days here matches the employee's row there.
  const [unmarked, setUnmarked] = useState({ days: 0, asAbsent: true })

  const [loading, setLoading] =
    useState(false)

  const [editingRecord, setEditingRecord] =
    useState<AttendanceRecord | null>(null)

  // The timesheet month (app timezone), picked like on the Monthly Report. It lives in the
  // URL (?month&year) so the Timesheets page links straight to a month.
  const [searchParams, setSearchParams] = useSearchParams()
  const period = useMemo<MonthYear>(() => {
    const m = Number(searchParams.get("month"))
    const y = Number(searchParams.get("year"))
    return m >= 1 && m <= 12 && y >= 2000 ? { month: m, year: y } : currentMonthYear()
  }, [searchParams])
  const setPeriod = (next: MonthYear) =>
    setSearchParams(
      { month: String(next.month), year: String(next.year) },
      { replace: true }
    )

  const { month, year } = period

  // The month's timesheet approval (utils/timesheetMonth.js on the server): its status,
  // what still blocks it (days to backfill / close / give a job), and whether it's over.
  const [approval, setApproval] = useState<ApprovalView | null>(null)
  const [blockers, setBlockers] = useState<TimesheetBlockers>(EMPTY_BLOCKERS)
  const [monthClosed, setMonthClosed] = useState(false)
  const [approvalBusy, setApprovalBusy] = useState(false)

  // The missing day being backfilled ("YYYY-MM-DD"), or null.
  const [backfillDate, setBackfillDate] = useState<string | null>(null)

  // Only the latest attendance request may update state — stepping months with
  // the ‹ › arrows would otherwise let a slower, older response overwrite the newer.
  const attendanceSeq = useRef(0)

  const [sortOrder, setSortOrder] =
    useState<"asc" | "desc">("asc")

  const [erpBusy, setErpBusy] = useState(false)

  // Leave balance (annual allocations + this year's emergency days) + the leave
  // history. Admin-only and read-only here — leave is managed on the Leave page.
  const [leaveBalance, setLeaveBalance] =
    useState<LeaveBalance | null>(null)

  const [leaves, setLeaves] =
    useState<LeaveApplication[]>([])

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
      setUnmarked({
        days: res.data.payroll?.unmarkedDays ?? 0,
        asAbsent: res.data.payroll?.unmarkedAsAbsent !== false,
      })
      setApproval(res.data.approval ?? null)
      setBlockers(res.data.blockers ?? EMPTY_BLOCKERS)
      setMonthClosed(!!res.data.monthClosed)
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

  // Balance + leave history are admin-only; the emergency count follows the selected year.
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
      // Hours the file could not carry (no Overtime Type, no job / job code).
      const warning = erpExportWarning(res.headers)
      if (warning) toast(`${label}: ${warning}`, { icon: "⚠️", duration: 12000 })
    } catch (error) {
      // Revoked since the page loaded (its records changed): reload to show why.
      if (await notApprovedFromError(error)) {
        toast.error("This timesheet is no longer approved — its records changed")
        fetchAttendance()
      } else {
        console.log(error)
        toast.error(`Failed to export ${label}`)
      }
    } finally {
      setErpBusy(false)
    }
  }

  const approveTimesheet = async () => {
    if (!id) return
    try {
      setApprovalBusy(true)
      const res = await api.post("/api/timesheets/approve", {
        month,
        year,
        employeeIds: [id],
      })
      if (res.data.approved?.length) toast.success("Timesheet approved")
      else toast.error("Not approved — fix the flagged days first")
    } catch (error) {
      console.log(error)
      toast.error(
        (axios.isAxiosError(error) && error.response?.data?.message) ||
          "Failed to approve timesheet"
      )
    } finally {
      setApprovalBusy(false)
      fetchAttendance()
    }
  }

  const revokeTimesheet = async () => {
    if (!id) return
    try {
      setApprovalBusy(true)
      await api.post("/api/timesheets/revoke", { month, year, employeeId: id })
      toast.success("Approval revoked")
    } catch (error) {
      console.log(error)
      toast.error(
        (axios.isAxiosError(error) && error.response?.data?.message) ||
          "Failed to revoke approval"
      )
    } finally {
      setApprovalBusy(false)
      fetchAttendance()
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

  // Records plus a "No record" row for every missing day (each a Backfill target), in
  // date order.
  const timesheetItems =
    useMemo<TimesheetItem[]>(() => {
      const items: TimesheetItem[] = [
        ...attendance.map((record) => ({
          kind: "record" as const,
          key: dayKeyOf(record.date),
          record,
        })),
        ...blockers.missing.map((key) => ({ kind: "missing" as const, key })),
      ]
      return items.sort((a, b) =>
        sortOrder === "asc"
          ? a.key.localeCompare(b.key)
          : b.key.localeCompare(a.key)
      )
    }, [attendance, blockers.missing, sortOrder])

  // Days with a record that still blocks approval: an open check-out, a session with no job.
  const flaggedDays = useMemo(() => {
    const flags = new Map<string, string[]>()
    const add = (key: string, label: string) =>
      flags.set(key, [...(flags.get(key) ?? []), label])
    blockers.pending.forEach((key) => add(key, "Open check-out"))
    blockers.noJob.forEach((key) => add(key, "No job"))
    return flags
  }, [blockers])

  // BackfillModal shows the employee; it only needs the identity fields.
  const backfillEmployee: MissingEmployee | null = employee
    ? {
        _id: employee._id,
        name: employee.name,
        employeeId: employee.employeeId,
        jobTitle: employee.jobTitle,
        currentSite: null,
        currentJob: null,
        employmentType: employee.employmentType,
      }
    : null

  // Only the ERPNext files need an approved month; the spreadsheet exports any time (e.g.
  // printed to check on paper before approving).
  const erpBlockedReason =
    approval?.status === "approved"
      ? null
      : "Only an approved timesheet can be sent to ERPNext — approve this month first"

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
    // Days with no record have nothing to classify; when the work schedule counts them
    // as absent they are plain absences (no reason), like on the Monthly Report.
    if (unmarked.asAbsent) sums.absent.none += unmarked.days
    // Working days = every calendar day of the month, holidays included.
    const workingDays = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const daysAbsent = ABSENT_REASONS.reduce(
      (n, reason) => n + sums.absent[reason.key],
      0
    )
    return {
      ...sums,
      daysUnmarked: unmarked.days,
      unmarkedAsAbsent: unmarked.asAbsent,
      workingDays,
      daysAbsent,
      paymentDays: paymentDaysOf(workingDays, daysAbsent, sums.daysHalf),
    }
  }, [attendance, unmarked, month, year])


  // An edit changes the month's blockers and may revoke its approval — reload both.
  const handleAttendanceUpdated = (updatedRecord: AttendanceRecord) => {
    setAttendance((prev) =>
      prev.map((record) =>
        record.attendanceId ===
        updatedRecord.attendanceId
          ? updatedRecord
          : record
      )
    )
    fetchAttendance()
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

                  <TableHead>Session Hrs</TableHead>

                  <TableHead>Status</TableHead>

                  <TableHead>Break (deducted)</TableHead>

                  <TableHead>Net Hours</TableHead>

                  <TableHead>OT Hours</TableHead>

                  <TableHead>Holiday Hours</TableHead>

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
                ) : timesheetItems.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={colCount}
                      className="h-40 text-center text-muted-foreground"
                    >
                      No attendance records found
                    </TableCell>
                  </TableRow>
                ) : (
                  timesheetItems.map(
                    (item, index) => {
                      // A day with no record: blocks approval until it is backfilled.
                      if (item.kind === "missing") {
                        return (
                          <TableRow
                            key={`missing-${item.key}`}
                            className="bg-rose-50/60 dark:bg-rose-950/20"
                          >
                            <TableCell>{index + 1}</TableCell>
                            <TableCell>
                              {(() => {
                                const d = new Date(`${item.key}T00:00:00Z`)
                                return (
                                  d.toLocaleDateString("en-IN", {
                                    weekday: "short",
                                    timeZone: "UTC",
                                  }).slice(0, 3) +
                                  " " +
                                  d.getUTCDate()
                                )
                              })()}
                            </TableCell>
                            <TableCell
                              colSpan={canWrite ? colCount - 3 : colCount - 2}
                              className="text-sm font-medium text-rose-700 dark:text-rose-400"
                            >
                              No record — missing day
                            </TableCell>
                            {canWrite && (
                              <TableCell className="text-right">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setBackfillDate(item.key)}
                                >
                                  <CalendarPlus className="h-4 w-4" />
                                  Backfill
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        )
                      }

                      const record = item.record
                      const flags = flaggedDays.get(item.key)
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
                                  {/* Blocks approval until fixed (Edit). */}
                                  {flags && (
                                    <div className="mt-0.5 text-xs font-medium text-rose-700 dark:text-rose-400">
                                      {flags.join(" · ")}
                                    </div>
                                  )}
                                </TableCell>
                              </>
                            )}

                            {/* SESSION DATA */}
                            <TableCell>
                              {sessionPlaceLabel(session, session?.siteName || "-")}
                            </TableCell>

                            <TableCell>
                              {/* A driver's split session lists each job its hours were split across. */}
                              <div className="divide-y divide-border/60">
                                {sessionJobLabels(session, session?.jobCode || "-").map((job, jobIndex) => (
                                  <div key={`${jobIndex}-${job}`} className="py-0.5 first:pt-0 last:pb-0">
                                    {job}
                                  </div>
                                ))}
                              </div>
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
                                  {(() => {
                                    const hrs = (recordBreakCount(record, breakMinHours) * breakDurationMinutes) / 60
                                    return `${hrs} ${hrs === 1 ? "hr" : "hrs"}`
                                  })()}
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
                                        edit or cancel the leave on the Leave page. */}
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      disabled={!!record.isPaidLeave || !!record.isEmergencyLeave}
                                      title={
                                        record.isPaidLeave
                                          ? "On annual leave — edit or cancel it on the Leave page"
                                          : record.isEmergencyLeave
                                            ? "On emergency leave — edit or cancel it on the Leave page"
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

              {!loading && attendance.length > 0 && (
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

                    {/* Remark (+ Actions when canWrite) */}
                    <TableCell colSpan={canWrite ? 2 : 1} />
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            Net Hours = total session hours − break deducted.
          </p>
        </CardContent>
      </Card>
  )

  return (
    <div className="min-h-screen bg-muted/30 px-3 py-4 sm:px-4">
      <div className="mx-auto max-w-none space-y-4">

        {/* EMPLOYEE, TOOLBAR (month, sort, export) AND MONTH STATS */}
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
          exportLoading={loading}
          erpBlockedReason={erpBlockedReason}
          approvalSlot={
            employee && (
              <TimesheetApprovalBar
                approval={approval}
                blockers={blockers}
                monthClosed={monthClosed}
                canWrite={canWrite}
                busy={approvalBusy}
                onApprove={approveTimesheet}
                onRevoke={revokeTimesheet}
              />
            )
          }
          onBack={() => navigate(-1)}
        />

        {/* ATTENDANCE TABLE — admins also get a read-only Leave history tab. */}
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
                <LeaveHistoryTable leaves={leaves} />
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

      {/* BACKFILL a missing day straight from the timesheet (admin + superadmin). */}
      {canWrite && (
        <BackfillModal
          open={!!backfillDate}
          onClose={() => setBackfillDate(null)}
          employee={backfillEmployee}
          date={backfillDate ?? ""}
          onCreated={() => fetchAttendance()}
        />
      )}
    </div>
  )
}

export default EmployeeAttendanceDetail

