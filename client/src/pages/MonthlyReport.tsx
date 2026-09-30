
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Search,
  Download,
  RotateCcw,
  ChevronRight,
  ChevronLeft,
} from "lucide-react"
import { api } from "@/lib/api"
import * as XLSX from "xlsx"
import { saveAs } from "file-saver"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { MonthYearPicker } from "@/components/MonthYearPicker"
import { DateRangePicker } from "@/components/DateRangePicker"
import {
  MONTH_NAMES,
  currentMonthToDate,
  currentMonthYear,
  daysInRange,
  formatDateRange,
  type DateRange,
  type MonthYear,
} from "@/lib/monthYear"
import {
  LEAVE_KINDS,
  emptyLeaveCounts,
  type LeaveCounts,
} from "@/lib/leaveComposition"
import { cn } from "@/lib/utils"
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import toast from "react-hot-toast"

// Round to 2 decimals (avoids float artifacts when summing rounded hours).
const round2 = (n: number) => Math.round(n * 100) / 100

// --- Monthly Attendance types ---

interface ReportEmployee {
  employeeName: string
  employeeId: string
  jobTitle: string
  isActive?: boolean
  fullDays: number
  halfDays: number
  absentDays: number
  // Checked in, no check-out yet — neither present nor absent until closed.
  pendingDays: number
  // Leave composition. leaveDays is annual (paid) leave; the other three are unpaid.
  // All four are separate from absentDays, which only counts absences with no leave
  // or LOP recorded.
  leaveDays: number
  emergencyLeaveDays: number
  sickLeaveDays: number
  lopDays: number
  attendancePercentage: number
  overtimeHours: number
  holidayHours: number
  totalOvertimeHours: number
}

// Shared by /reports/monthly/:month/:year and /reports/range?from&to.
interface AttendanceReportResponse {
  success: boolean
  report: ReportEmployee[]
}

// A report row's leave composition, keyed like LEAVE_KINDS.
const leaveCountsOf = (e: ReportEmployee): LeaveCounts => ({
  annual: e.leaveDays || 0,
  emergency: e.emergencyLeaveDays || 0,
  sick: e.sickLeaveDays || 0,
  lop: e.lopDays || 0,
})

// The report covers one calendar month, or any from–to range of days.
type PeriodMode = "month" | "range"

// --- Job Report types ---

interface JobReportJob {
  jobId: string | null
  jobCode: string | null
  jobName: string
  isActive: boolean
  isCompleted: boolean
  unassigned?: boolean
  regularHours: number
  overtimeHours: number
  holidayHours: number
  totalOTHours: number
}

interface JobReportSite {
  siteId: string
  siteName: string
  isActive: boolean
  isPermanent: boolean
  isCompleted: boolean
  jobs: JobReportJob[]
}

interface JobReportResponse {
  success: boolean
  month: number | null
  year: number | null
  report: JobReportSite[]
}

// =============================================================================
// Monthly Attendance Tab
// =============================================================================

function MonthlyAttendanceTab() {
  const [mode, setMode] = useState<PeriodMode>("month")
  const [period, setPeriod] = useState<MonthYear>(currentMonthYear)
  const [range, setRange] = useState<DateRange>(currentMonthToDate)
  const { month, year } = period
  const [loading, setLoading] = useState(false)
  const [reports, setReports] = useState<ReportEmployee[]>([])
  const [name, setName] = useState("")
  const [employeeId, setEmployeeId] = useState("")
  const [jobTitle, setJobTitle] = useState("")
  const [erpBusy, setErpBusy] = useState(false)

  // Client-side pagination for the display only. The full month stays in `reports`
  // so search spans everyone and Export always covers the whole roster.
  const PAGE_SIZE_OPTIONS = ["25", "50", "100", "all"] as const
  const [pageSize, setPageSize] = useState<string>("50")
  const [currentPage, setCurrentPage] = useState(1)

  // Only the latest request may update state — stepping months (or switching
  // periods) quickly would otherwise let a slower, older response overwrite the
  // newer one.
  const requestSeq = useRef(0)

  async function fetchReports() {
    const seq = ++requestSeq.current
    try {
      setLoading(true)
      const res =
        mode === "month"
          ? await api.get<AttendanceReportResponse>(
              `/api/attendance/reports/monthly/${month}/${year}`
            )
          : await api.get<AttendanceReportResponse>(
              "/api/attendance/reports/range",
              { params: { from: range.from, to: range.to } }
            )
      if (seq !== requestSeq.current) return
      setReports(res.data.report || [])
    } catch (error) {
      if (seq !== requestSeq.current) return
      console.log(error)
      setReports([])
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }

  useEffect(() => {
    fetchReports()
  }, [mode, month, year, range.from, range.to])

  // All employees, sorted (active first, then by name). This is the export set —
  // Export always covers everyone, independent of the on-screen search.
  const sortedAll = useMemo(() => {
    return [...reports].sort((a, b) => {
      const aActive = a.isActive !== false
      const bActive = b.isActive !== false
      if (aActive && !bActive) return -1
      if (!aActive && bActive) return 1
      return a.employeeName.localeCompare(b.employeeName)
    })
  }, [reports])

  // Search-filtered view (drives the table + summary). Filtering a sorted list
  // preserves order.
  const filteredReports = useMemo(() => {
    return sortedAll.filter((employee) => {
      const matchesName = employee.employeeName
        .toLowerCase()
        .includes(name.toLowerCase())
      const matchesEmployeeId = employee.employeeId
        .toLowerCase()
        .includes(employeeId.toLowerCase())
      const matchesJobTitle = employee.jobTitle
        .toLowerCase()
        .includes(jobTitle.toLowerCase())
      return matchesName && matchesEmployeeId && matchesJobTitle
    })
  }, [sortedAll, name, employeeId, jobTitle])

  // Pagination math. "all" collapses to a single page of the full filtered list.
  const showAll = pageSize === "all"
  const perPage = showAll ? filteredReports.length || 1 : Number(pageSize)
  const totalPages = showAll
    ? 1
    : Math.max(1, Math.ceil(filteredReports.length / perPage))
  const startIndex = showAll ? 0 : (currentPage - 1) * perPage
  const pagedReports = showAll
    ? filteredReports
    : filteredReports.slice(startIndex, startIndex + perPage)

  // Reset to page 1 whenever the filtered set or page size changes.
  useEffect(() => {
    setCurrentPage(1)
  }, [name, employeeId, jobTitle, pageSize, mode, month, year, range.from, range.to])

  // Guard against landing past the last page if the data shrinks.
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages)
  }, [currentPage, totalPages])

  const totals = useMemo(() => {
    return filteredReports.reduce(
      (acc, e) => {
        acc.fullDays += e.fullDays
        acc.halfDays += e.halfDays
        acc.absentDays += e.absentDays
        acc.pendingDays += e.pendingDays || 0
        const leave = leaveCountsOf(e)
        for (const kind of LEAVE_KINDS) acc.leave[kind.key] += leave[kind.key]
        acc.overtimeHours += e.overtimeHours
        acc.holidayHours += e.holidayHours
        acc.totalOvertimeHours += e.totalOvertimeHours
        return acc
      },
      {
        fullDays: 0,
        halfDays: 0,
        absentDays: 0,
        pendingDays: 0,
        leave: emptyLeaveCounts(),
        overtimeHours: 0,
        holidayHours: 0,
        totalOvertimeHours: 0,
      }
    )
  }, [filteredReports])

  function exportToExcel() {
    // Always export every employee for the period, regardless of the active search.
    if (sortedAll.length === 0) return
    const formattedData = sortedAll.map((employee, index) => {
      const leave = leaveCountsOf(employee)
      return {
        "Sl No": index + 1,
        "Employee Name":
          employee.employeeName +
          (employee.isActive === false ? " (Inactive)" : ""),
        "Employee ID": employee.employeeId,
        "Job Title": employee.jobTitle,
        "Full Days": employee.fullDays,
        "Half Days": employee.halfDays,
        "Absent Days": employee.absentDays,
        "Pending Days": employee.pendingDays || 0,
        // Leave composition: "Annual Leave", "Emergency Leave", "Sick Leave", "LOP".
        ...Object.fromEntries(
          LEAVE_KINDS.map((kind) => [kind.label, leave[kind.key]])
        ),
        "Attendance %": employee.attendancePercentage,
        "OT Hours": employee.overtimeHours,
        "Holiday Hours": employee.holidayHours,
        "Total OT Hours": employee.totalOvertimeHours,
      }
    })
    const worksheet = XLSX.utils.json_to_sheet(formattedData)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      mode === "month" ? "Monthly Report" : "Attendance Report"
    )
    const excelBuffer = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "array",
    })
    const fileData = new Blob([excelBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8",
    })
    saveAs(
      fileData,
      mode === "month"
        ? `monthly-report-${month}-${year}.xlsx`
        : `attendance-report-${range.from}_to_${range.to}.xlsx`
    )
  }

  // Download one ERPNext Data Import CSV for the selected month. The server streams the
  // file (hours + status only — rates live in ERPNext); we just save the blob.
  async function downloadErp(
    type: "attendance" | "timesheet" | "ot-summary",
    label: string
  ) {
    try {
      setErpBusy(true)
      const res = await api.get(
        `/api/attendance/reports/erpnext/${month}/${year}`,
        { params: { type }, responseType: "blob" }
      )
      const mm = String(month).padStart(2, "0")
      saveAs(res.data as Blob, `erpnext-${type}-${year}-${mm}.csv`)
    } catch (error) {
      console.error(error)
      toast.error(`Failed to export ${label}`)
    } finally {
      setErpBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={mode} onValueChange={(v) => setMode(v as PeriodMode)}>
          <TabsList className="h-8">
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="range">Date range</TabsTrigger>
          </TabsList>
        </Tabs>

        {mode === "month" ? (
          <MonthYearPicker value={period} onChange={(v) => v && setPeriod(v)} />
        ) : (
          <DateRangePicker value={range} onChange={setRange} />
        )}

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-[160px] pl-8"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <Input
          className="w-[120px]"
          placeholder="ID"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
        />

        <Input
          className="w-[120px]"
          placeholder="Job Title"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
        />

        {(name || employeeId || jobTitle) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setName("")
              setEmployeeId("")
              setJobTitle("")
            }}
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            Clear
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportToExcel}
            disabled={sortedAll.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export all
          </Button>

          {/* ERPNext imports are per month. The span carries the tooltip because a
              disabled button gets no pointer events. */}
          <span
            className="inline-flex"
            title={
              mode === "range"
                ? "ERPNext export works per month — switch to Month"
                : undefined
            }
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={erpBusy || mode === "range"}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
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
          </span>
        </div>
      </div>

      {/* Summary row */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground border-b pb-3">
        {mode === "range" && (
          <span>
            <span className="font-medium text-foreground">{formatDateRange(range)}</span>
            {" · "}
            {daysInRange(range)} {daysInRange(range) === 1 ? "day" : "days"}
          </span>
        )}
        <span>
          {filteredReports.length === sortedAll.length ? (
            <>
              <span className="font-medium text-foreground">{sortedAll.length}</span> employees
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">{filteredReports.length}</span> of{" "}
              {sortedAll.length} employees
            </>
          )}
        </span>
        <span>
          OT <span className="font-medium text-foreground">{totals.overtimeHours.toFixed(2)}</span>h
        </span>
        <span>
          Holiday <span className="font-medium text-foreground">{totals.holidayHours.toFixed(2)}</span>h
        </span>
        <span>
          Total OT <span className="font-medium text-foreground">{totals.totalOvertimeHours.toFixed(2)}</span>h
        </span>
        {/* Leave composition across the listed employees */}
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>Leave</span>
          {LEAVE_KINDS.map((kind) => (
            <span key={kind.key} className="inline-flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", kind.dot)} />
              {kind.name}
              <span className="font-medium text-foreground tabular-nums">
                {totals.leave[kind.key]}
              </span>
            </span>
          ))}
        </span>
        {/* Open sessions someone still has to close */}
        {totals.pendingDays > 0 && (
          <span className="font-medium text-amber-700 dark:text-amber-400">
            {totals.pendingDays} pending check-out
          </span>
        )}
      </div>

      {/* Table — grows with the page's rows; pagination bounds the count, so no
          inner scroll cage. Horizontal scroll is handled by the Table wrapper. */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader className="bg-background">
            <TableRow>
              <TableHead rowSpan={2} className="w-10">#</TableHead>
              <TableHead rowSpan={2}>Employee</TableHead>
              <TableHead rowSpan={2}>ID</TableHead>
              <TableHead rowSpan={2}>Job</TableHead>
              <TableHead rowSpan={2} className="text-right">Full</TableHead>
              <TableHead rowSpan={2} className="text-right">Half</TableHead>
              <TableHead
                rowSpan={2}
                className="text-right"
                title="Absent with no leave or LOP recorded"
              >
                Absent
              </TableHead>
              <TableHead
                rowSpan={2}
                className="text-right"
                title="Checked in but no check-out yet — neither present nor absent until the check-out is entered"
              >
                Pending
              </TableHead>
              <TableHead
                colSpan={LEAVE_KINDS.length}
                className="h-7 border-x text-center text-xs text-muted-foreground"
              >
                Leave
              </TableHead>
              <TableHead rowSpan={2} className="text-right">%</TableHead>
              <TableHead rowSpan={2} className="text-right">OT</TableHead>
              <TableHead rowSpan={2} className="text-right">Holiday</TableHead>
              <TableHead rowSpan={2} className="text-right">Total OT</TableHead>
            </TableRow>
            <TableRow>
              {LEAVE_KINDS.map((kind, i) => (
                <TableHead
                  key={kind.key}
                  title={kind.label}
                  className={cn(
                    "h-7 px-1.5 text-right text-xs",
                    i === 0 && "border-l",
                    i === LEAVE_KINDS.length - 1 && "border-r"
                  )}
                >
                  {kind.short}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={12 + LEAVE_KINDS.length} className="text-center h-24 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : filteredReports.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12 + LEAVE_KINDS.length} className="text-center h-24 text-muted-foreground">
                  No data found
                </TableCell>
              </TableRow>
            ) : (
              pagedReports.map((employee, index) => {
                const leave = leaveCountsOf(employee)
                return (
                  <TableRow
                    key={employee.employeeId}
                    className={
                      employee.isActive === false
                        ? "opacity-50"
                        : ""
                    }
                  >
                    <TableCell className="text-muted-foreground">
                      {startIndex + index + 1}
                    </TableCell>
                    {/* Name and job may wrap so the full row of day columns fits. */}
                    <TableCell className="whitespace-normal">
                      <span className={employee.isActive === false ? "line-through decoration-1" : ""}>
                        {employee.employeeName}
                      </span>
                      {employee.isActive === false && (
                        <span className="ml-1.5 text-[10px] text-destructive font-medium uppercase">
                          Inactive
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{employee.employeeId}</TableCell>
                    <TableCell className="capitalize whitespace-normal">{employee.jobTitle}</TableCell>
                    <TableCell className="text-right">{employee.fullDays}</TableCell>
                    <TableCell className="text-right">{employee.halfDays}</TableCell>
                    <TableCell className="text-right">{employee.absentDays}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        employee.pendingDays > 0
                          ? "font-medium text-amber-700 dark:text-amber-400"
                          : "text-muted-foreground/60"
                      )}
                    >
                      {employee.pendingDays || 0}
                    </TableCell>
                    {LEAVE_KINDS.map((kind, i) => (
                      <TableCell
                        key={kind.key}
                        className={cn(
                          "px-1.5 text-right tabular-nums",
                          i === 0 && "border-l",
                          i === LEAVE_KINDS.length - 1 && "border-r",
                          leave[kind.key] > 0
                            ? cn("font-medium", kind.text)
                            : "text-muted-foreground/60"
                        )}
                      >
                        {leave[kind.key]}
                      </TableCell>
                    ))}
                    <TableCell className="text-right">{employee.attendancePercentage}%</TableCell>
                    <TableCell className="text-right">{employee.overtimeHours}</TableCell>
                    <TableCell className="text-right">{employee.holidayHours}</TableCell>
                    <TableCell className="text-right font-medium">{employee.totalOvertimeHours}</TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination — display only; search and Export always span the full month */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Rows per page</span>
          <Select value={pageSize} onValueChange={setPageSize}>
            <SelectTrigger className="h-8 w-[90px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt === "all" ? "All" : opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {filteredReports.length === 0
              ? "0"
              : `${startIndex + 1}–${Math.min(
                  startIndex + perPage,
                  filteredReports.length
                )}`}{" "}
            of {filteredReports.length}
          </span>
          {!showAll && (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-1 tabular-nums">
                {currentPage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Job Report Tab
// =============================================================================

function JobReportTab() {
  const [loading, setLoading] = useState(false)
  const [sites, setSites] = useState<JobReportSite[]>([])
  const [search, setSearch] = useState("")
  const [collapsedSites, setCollapsedSites] = useState<Set<string>>(new Set())

  // Period scope: null = entire life cycle (default), else one calendar month.
  const [period, setPeriod] = useState<MonthYear | null>(null)
  // Only count hours worked by temporary employees.
  const [tempOnly, setTempOnly] = useState(false)

  // Only the latest request may update state — the month arrows and the toggle
  // make it easy for an older, slower response to land after a newer one.
  const requestSeq = useRef(0)

  async function fetchJobReport() {
    const seq = ++requestSeq.current
    try {
      setLoading(true)
      const params: Record<string, string | number> = {}
      if (period) {
        params.month = period.month
        params.year = period.year
      }
      if (tempOnly) params.employmentType = "temporary"
      const res = await api.get<JobReportResponse>(
        "/api/attendance/reports/job-report",
        { params }
      )
      if (seq !== requestSeq.current) return
      setSites(res.data.report || [])
    } catch (error) {
      if (seq !== requestSeq.current) return
      console.log(error)
      setSites([])
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }

  useEffect(() => {
    fetchJobReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period?.month, period?.year, tempOnly])

  // In temporary-only mode most jobs have no temp hours at all, so drop the
  // zero rows (and sites left empty) instead of listing a wall of zeros.
  const visibleSites = useMemo(() => {
    if (!tempOnly) return sites
    return sites
      .map((site) => ({
        ...site,
        jobs: site.jobs.filter((j) => j.regularHours + j.totalOTHours > 0),
      }))
      .filter((site) => site.jobs.length > 0)
  }, [sites, tempOnly])

  const filteredSites = useMemo(() => {
    if (!search) return visibleSites
    const q = search.toLowerCase()
    return visibleSites
      .map((site) => {
        const matchesSite = site.siteName.toLowerCase().includes(q)
        const matchingJobs = site.jobs.filter(
          (j) =>
            (j.jobCode && j.jobCode.toLowerCase().includes(q)) ||
            (j.jobName && j.jobName.toLowerCase().includes(q))
        )
        if (matchesSite) return site
        if (matchingJobs.length > 0) return { ...site, jobs: matchingJobs }
        return null
      })
      .filter(Boolean) as JobReportSite[]
  }, [visibleSites, search])

  function toggleSite(siteId: string) {
    setCollapsedSites((prev) => {
      const next = new Set(prev)
      if (next.has(siteId)) next.delete(siteId)
      else next.add(siteId)
      return next
    })
  }

  function exportToExcel() {
    const rows: Record<string, string | number>[] = []
    for (const site of filteredSites) {
      for (const job of site.jobs) {
        rows.push({
          Site: site.siteName,
          "Job Number": job.jobCode || "",
          "Job Name": job.jobName || "",
          Status: job.unassigned
            ? ""
            : job.isCompleted ? "Completed" : job.isActive ? "Active" : "Inactive",
          "Regular Hours": job.regularHours,
          "Total OT Hours": job.totalOTHours,
          "Man Hours": round2(job.regularHours + job.totalOTHours),
        })
      }
    }
    if (rows.length === 0) return
    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Job Report")
    const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" })
    const fileData = new Blob([excelBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8",
    })
    const suffix = period ? `${period.month}-${period.year}` : "all-time"
    saveAs(fileData, `job-report-${suffix}${tempOnly ? "-temporary" : ""}.xlsx`)
  }

  // Count only real jobs — the synthetic "Unassigned (no job)" row is not a job.
  const totalJobs = filteredSites.reduce(
    (sum, s) => sum + s.jobs.filter((j) => !j.unassigned).length,
    0
  )

  const totalManHours = round2(
    filteredSites.reduce(
      (sum, s) =>
        sum + s.jobs.reduce((acc, j) => acc + j.regularHours + j.totalOTHours, 0),
      0
    )
  )

  // Human-readable label for the active period.
  const periodLabel = period
    ? `${MONTH_NAMES[period.month - 1]} ${period.year}`
    : "Entire life cycle"

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <MonthYearPicker value={period} onChange={setPeriod} allowAllTime />

        <div
          className={`inline-flex h-8 items-center gap-2 rounded-lg border px-2.5 transition-colors ${
            tempOnly ? "border-primary/40 bg-primary/5" : "bg-background"
          }`}
        >
          <Switch
            id="job-report-temp-only"
            checked={tempOnly}
            onCheckedChange={setTempOnly}
          />
          <Label htmlFor="job-report-temp-only" className="cursor-pointer font-normal">
            Temporary workers only
          </Label>
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-[220px] pl-8"
            placeholder="Search site or job..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
            <RotateCcw className="mr-1 h-3 w-3" />
            Clear
          </Button>
        )}

        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={exportToExcel}
            disabled={totalJobs === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground border-b pb-3">
        <span className="flex items-center gap-2">
          <span className="font-medium text-foreground">{periodLabel}</span>
          {tempOnly && <Badge variant="secondary">Temporary workers</Badge>}
        </span>
        <span>
          <span className="font-medium text-foreground">{filteredSites.length}</span>{" "}
          {filteredSites.length === 1 ? "site" : "sites"}
        </span>
        <span>
          <span className="font-medium text-foreground">{totalJobs}</span>{" "}
          {totalJobs === 1 ? "job" : "jobs"}
        </span>
        <span>
          <span className="font-medium text-foreground">{totalManHours.toFixed(2)}</span> man hours
        </span>
      </div>

      {/* Table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead className="w-[240px]">Job Number</TableHead>
              <TableHead>Job Name</TableHead>
              <TableHead className="text-right">Regular Hours</TableHead>
              <TableHead className="text-right">Total OT Hours</TableHead>
              <TableHead className="text-right">Man Hours</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center h-24 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : filteredSites.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center h-24 text-muted-foreground">
                  {tempOnly && !search
                    ? `No hours logged by temporary workers for ${
                        period ? periodLabel : "the entire life cycle"
                      }`
                    : "No data found"}
                </TableCell>
              </TableRow>
            ) : (
              filteredSites.map((site) => {
                const isCollapsed = collapsedSites.has(site.siteId)
                const siteTotals = site.jobs.reduce(
                  (acc, j) => {
                    acc.regular += j.regularHours
                    acc.totalOT += j.totalOTHours
                    acc.manHours += j.regularHours + j.totalOTHours
                    return acc
                  },
                  { regular: 0, totalOT: 0, manHours: 0 }
                )

                // The synthetic "Unassigned (no job)" row is not a real job.
                const realJobCount = site.jobs.filter((j) => !j.unassigned).length

                return (
                  <SiteGroup key={site.siteId}>
                    {/* Site header row */}
                    <TableRow
                      className="bg-muted/40 hover:bg-muted/60 cursor-pointer"
                      onClick={() => toggleSite(site.siteId)}
                    >
                      <TableCell colSpan={2} className="font-medium">
                        <div className="flex items-center gap-2">
                          <ChevronRight
                            className={`h-4 w-4 text-muted-foreground transition-transform ${
                              !isCollapsed ? "rotate-90" : ""
                            }`}
                          />
                          <span>{site.siteName}</span>
                          {site.isCompleted && (
                            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                              Completed
                            </span>
                          )}
                          {!site.isCompleted && !site.isActive && (
                            <span className="text-[10px] text-destructive font-medium uppercase tracking-wide">
                              Inactive
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground font-normal">
                            ({realJobCount} {realJobCount === 1 ? "job" : "jobs"})
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {siteTotals.regular.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {siteTotals.totalOT.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-muted-foreground">
                        {siteTotals.manHours.toFixed(2)}
                      </TableCell>
                    </TableRow>

                    {/* Job rows */}
                    {!isCollapsed &&
                      site.jobs.map((job) => (
                        <TableRow
                          key={job.jobId ?? `unassigned-${site.siteId}`}
                          className={job.isCompleted || !job.isActive ? "opacity-50" : ""}
                        >
                          <TableCell className="pl-10">{job.jobCode || "—"}</TableCell>
                          <TableCell>
                            <span className={job.unassigned ? "italic text-muted-foreground" : ""}>
                              {job.jobName || "—"}
                            </span>
                            {job.isCompleted && (
                              <span className="ml-1.5 text-[10px] text-muted-foreground font-medium uppercase">
                                Completed
                              </span>
                            )}
                            {!job.isCompleted && !job.isActive && (
                              <span className="ml-1.5 text-[10px] text-destructive font-medium uppercase">
                                Inactive
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{job.regularHours}</TableCell>
                          <TableCell className="text-right">{job.totalOTHours}</TableCell>
                          <TableCell className="text-right font-medium">{round2(job.regularHours + job.totalOTHours)}</TableCell>
                        </TableRow>
                      ))}
                  </SiteGroup>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function SiteGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

// =============================================================================
// Page
// =============================================================================

function MonthlyReport() {
  return (
    <div className="min-h-screen bg-muted/30 px-3 py-6 sm:px-4">
      <div className="mx-auto max-w-none space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>

        <Tabs defaultValue="monthly">
          <TabsList>
            <TabsTrigger value="monthly">Monthly Attendance</TabsTrigger>
            <TabsTrigger value="job">Job Report</TabsTrigger>
          </TabsList>

          <TabsContent value="monthly">
            <MonthlyAttendanceTab />
          </TabsContent>

          <TabsContent value="job">
            <JobReportTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

export default MonthlyReport
