
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
  LEAVE_KINDS,
  emptyLeaveCounts,
  leaveKindOf,
} from "@/lib/leaveComposition"
import { cn } from "@/lib/utils"

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
import GrantLeaveDialog from "@/components/GrantLeaveDialog"
import { MonthYearPicker } from "@/components/MonthYearPicker"

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
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"

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

interface LeaveBalance {
  year: number
  defaultDays: number
  override: number | null
  entitlement: number
  used: number
  remaining: number
  // Emergency (unpaid, excused) leave days taken this year — informational, no allowance.
  emergencyUsed?: number
}

interface LeaveGrant {
  _id: string
  type?: "annual" | "emergency"
  fromDate: string
  toDate: string
  note?: string
  workingDays: number
  status: "active" | "cancelled"
  createdAt: string
  grantedBy?: { name?: string } | null
  cancelledBy?: { name?: string } | null
}

// `round2` and `getDisplayStatus` now live in @/lib/timesheetExport (shared with
// the bulk export) and are imported above.

const dayWord = (n: number) => (Math.abs(n) === 1 ? "day" : "days")

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
    type: "attendance" | "timesheet" | "ot-summary",
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
    return attendance.reduce(
      (acc, record) => {
        acc.totalHours += record.totalWorkHours || 0

        acc.otHours += record.overtimeHours || 0

        if (record.isHoliday) {
          acc.holidayHours += record.holidayHours || 0
        }

        // Each day counts in exactly one bucket — the one its Status badge below
        // shows — so the summary always equals a count of the badges (the monthly
        // report classifies days the same way).
        const status = getDisplayStatus(record)
        const leaveKind = leaveKindOf(status)

        if (leaveKind) {
          // Annual / emergency / sick / LOP — the Leave tile, never an absence.
          acc.leave[leaveKind] += 1
        } else if (status === "pending") {
          // Checked in, no check-out yet: 0 hours only until it is closed.
          acc.daysPending += 1
        } else if (status === "fullday" || status === "halfday") {
          // Present — holiday work included. Half-days count as present; full/half
          // are also tallied for the breakdown under Days Present.
          acc.daysPresent += 1
          if (status === "fullday") acc.daysFull += 1
          else acc.daysHalf += 1
        } else if (status === "absent") {
          acc.daysAbsent += 1
        }
        // "holiday" — a holiday not worked is a day off: counted nowhere.

        return acc
      },
      {
        totalHours: 0,
        otHours: 0,
        holidayHours: 0,
        daysPresent: 0,
        daysFull: 0,
        daysHalf: 0,
        daysAbsent: 0,
        daysPending: 0,
        leave: emptyLeaveCounts(),
      }
    )
  }, [attendance])

  // Leave-balance tiles: how much of the annual allowance is used (for the bar).
  const annualUsedPct =
    leaveBalance && leaveBalance.entitlement > 0
      ? Math.min(100, (leaveBalance.used / leaveBalance.entitlement) * 100)
      : 0
  const emergencyUsed = leaveBalance?.emergencyUsed ?? 0

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

                {/* MONTH + YEAR (same picker as the Monthly Report) */}
                <MonthYearPicker
                  value={period}
                  onChange={(v) => v && setPeriod(v)}
                />

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

                {canWrite && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={erpBusy}
                        className="w-full sm:w-auto"
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Export for ERPNext
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => downloadErp("attendance", "Attendance (payroll)")}
                      >
                        Attendance (payroll)
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => downloadErp("timesheet", "Timesheet (job cost)")}
                      >
                        Timesheet (job cost)
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => downloadErp("ot-summary", "OT & Holiday summary")}
                      >
                        OT &amp; Holiday summary
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {canWrite && employee && (
                  <GrantLeaveDialog
                    employeeId={employee._id}
                    employeeName={employee.name}
                    onGranted={refreshAfterLeaveChange}
                  />
                )}

                {canWrite && employee && (
                  <GrantLeaveDialog
                    employeeId={employee._id}
                    employeeName={employee.name}
                    leaveType="emergency"
                    onGranted={refreshAfterLeaveChange}
                  />
                )}
              </div>
            </div>

            {/* LEAVE BALANCE (admin only) — annual and emergency as two separate
                tiles for the selected year, colored like the Status badges. */}
            {canWrite && leaveBalance && (
              <div className="grid gap-3 sm:grid-cols-2">
                {/* Annual: paid, drawn from a yearly allowance */}
                <div className="rounded-lg border bg-muted/30 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <span className="size-2 shrink-0 rounded-full bg-violet-500" />
                      Annual leave {leaveBalance.year}
                    </p>
                    {leaveBalance.override !== null && (
                      <Badge variant="outline" className="font-normal text-muted-foreground">
                        Custom allowance
                      </Badge>
                    )}
                  </div>
                  <p className="mt-2 text-2xl font-bold tabular-nums">
                    {leaveBalance.remaining}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      {dayWord(leaveBalance.remaining)} left
                    </span>
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-violet-500/15">
                    <div
                      className="h-full rounded-full bg-violet-500"
                      style={{ width: `${annualUsedPct}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {leaveBalance.used} of {leaveBalance.entitlement} used
                  </p>
                </div>

                {/* Emergency: excused but unpaid, no allowance — just a count */}
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <span className="size-2 shrink-0 rounded-full bg-orange-500" />
                    Emergency leave {leaveBalance.year}
                  </p>
                  <p
                    className={cn(
                      "mt-2 text-2xl font-bold tabular-nums",
                      emergencyUsed > 0 && "text-orange-700 dark:text-orange-400"
                    )}
                  >
                    {emergencyUsed}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      {dayWord(emergencyUsed)} taken
                    </span>
                  </p>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Unpaid · no yearly limit
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* SUMMARY */}
        {employee && (
          <Card>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">
                    Regular Hours
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {round2(totals.totalHours - totals.otHours - totals.holidayHours)} hrs
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
                  <p className="text-xs text-muted-foreground">
                    {totals.daysFull} full · {totals.daysHalf} half
                  </p>
                </div>

                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">
                    Days Absent
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {totals.daysAbsent}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    no leave or LOP recorded
                  </p>
                  {/* Open sessions are neither present nor absent until closed. */}
                  {totals.daysPending > 0 && (
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                      + {totals.daysPending} pending check-out
                    </p>
                  )}
                </div>

                {/* LEAVE COMPOSITION — days of each kind, colored like the Status badges.
                    Two columns wide so the four kinds fit side by side. */}
                <div className="col-span-2 rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">
                    Leave
                  </p>
                  <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    {LEAVE_KINDS.map((kind) => {
                      const days = totals.leave[kind.key]
                      return (
                        <div
                          key={kind.key}
                          className="flex items-center justify-between gap-2"
                        >
                          <dt className="flex items-center gap-1.5 text-muted-foreground">
                            <span className={cn("size-2 shrink-0 rounded-full", kind.dot)} />
                            {kind.name}
                          </dt>
                          <dd
                            className={cn(
                              "tabular-nums",
                              days > 0
                                ? cn("font-semibold", kind.text)
                                : "text-muted-foreground/60"
                            )}
                          >
                            {days}
                          </dd>
                        </div>
                      )
                    })}
                  </dl>
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
                                          cancel the grant (in Leave history below) to edit it. */}
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

        {/* LEAVE HISTORY (admin only) */}
        {canWrite && leaves.length > 0 && (
          <Card>
            <CardContent className="p-6">
              <h2 className="mb-4 text-lg font-semibold">Leave history</h2>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Range</TableHead>
                      <TableHead className="text-right">Days</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead>Granted by</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leaves.map((leave) => {
                      const fmt = (d: string) =>
                        new Date(d).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })
                      return (
                        <TableRow key={leave._id}>
                          <TableCell className="whitespace-nowrap">
                            {leave.type === "emergency" ? "Emergency" : "Annual"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {fmt(leave.fromDate)} – {fmt(leave.toDate)}
                          </TableCell>
                          <TableCell className="text-right">
                            {leave.workingDays}
                          </TableCell>
                          <TableCell className="max-w-[240px] whitespace-normal text-muted-foreground">
                            {leave.note || "-"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {leave.grantedBy?.name || "-"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="secondary"
                              className={
                                leave.status === "active"
                                  ? "bg-violet-500/15 text-violet-700 dark:text-violet-400 border-transparent"
                                  : "bg-muted text-muted-foreground border-transparent"
                              }
                            >
                              {leave.status === "active" ? "Active" : "Cancelled"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {leave.status === "active" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleCancelLeave(leave._id)}
                              >
                                Cancel
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {leave.cancelledBy?.name
                                  ? `by ${leave.cancelledBy.name}`
                                  : "—"}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
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

