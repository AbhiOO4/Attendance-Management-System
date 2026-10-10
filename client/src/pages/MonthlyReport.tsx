
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Search,
  Download,
  RotateCcw,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  FileSpreadsheet,
} from "lucide-react"
import { api } from "@/lib/api"
import * as XLSX from "xlsx"
import { saveAs } from "file-saver"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
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
  ABSENT_REASONS,
  ANNUAL_LEAVE,
  type AbsentCounts,
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import toast from "react-hot-toast"

// Round to 2 decimals (avoids float artifacts when summing rounded hours).
const round2 = (n: number) => Math.round(n * 100) / 100

// --- Monthly Attendance types ---

interface ReportEmployee {
  // Mongo id — what the ERPNext export takes to pick employees.
  _id: string
  employeeName: string
  employeeId: string
  jobTitle: string
  isActive?: boolean
  employmentType?: "permanent" | "temporary"
  // Payroll view, classified exactly like the ERPNext Attendance CSV: every calendar
  // day of the period is a working day; paymentDays = workingDays − absentDays − 0.5 ×
  // halfDays (the figure on the ERPNext salary slip).
  workingDays: number
  paymentDays: number
  fullDays: number
  halfDays: number
  // Every unpaid day, and its composition (the four add up to absentDays).
  absentDays: number
  noReasonAbsentDays: number
  emergencyLeaveDays: number
  sickLeaveDays: number
  lopDays: number
  // Subset of noReasonAbsentDays: checked in, no check-out yet.
  pendingDays: number
  // Annual (paid) leave — never part of absentDays.
  leaveDays: number
  // Days before today with no record at all. Part of noReasonAbsentDays when the
  // response's unmarkedAsAbsent is set (Configure → ERPNext), otherwise counted as paid.
  unmarkedDays: number
  // paymentDays ÷ workingDays.
  attendancePercentage: number
  overtimeHours: number
  holidayHours: number
  totalOvertimeHours: number
}

// Shared by /reports/monthly/:month/:year and /reports/range?from&to.
interface AttendanceReportResponse {
  success: boolean
  report: ReportEmployee[]
  // WorkSchedule.countUnmarkedAsAbsent: unmarked days are already in absentDays.
  unmarkedAsAbsent?: boolean
}

// A report row's absent-day composition, keyed like ABSENT_REASONS.
const absentCountsOf = (e: ReportEmployee): AbsentCounts => ({
  none: e.noReasonAbsentDays || 0,
  emergency: e.emergencyLeaveDays || 0,
  sick: e.sickLeaveDays || 0,
  lop: e.lopDays || 0,
})

// The report covers one calendar month, or any from–to range of days.
type PeriodMode = "month" | "range"

// Which employees the report covers. A row without employmentType is permanent.
type EmploymentFilter = "all" | "permanent" | "temporary"

const EMPLOYMENT_FILTER_LABELS: Record<EmploymentFilter, string> = {
  all: "All employees",
  permanent: "Permanent",
  temporary: "Temporary",
}

// The ERPNext Data Import files (rates live in ERPNext; these carry hours + status).
const ERP_FILES = [
  { type: "attendance", label: "Attendance (payroll)" },
  { type: "timesheet", label: "Timesheet (job cost)" },
] as const

type ErpFile = (typeof ERP_FILES)[number]

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
  const [unmarkedAsAbsent, setUnmarkedAsAbsent] = useState(true)
  // One box matching name, employee ID and job title (like the Employees page).
  const [search, setSearch] = useState("")
  const [employmentType, setEmploymentType] = useState<EmploymentFilter>("all")
  const [erpBusy, setErpBusy] = useState(false)

  // Employees ticked for export (spreadsheet + ERPNext), by Mongo _id. Every export
  // covers exactly these. Deliberately kept across searches, filter and period changes,
  // so specific people can be gathered from several searches (and exported for more than
  // one month).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  // The "select employees first" hint on the muted Actions button — opened by a click
  // too (not just hover), so it also works on touch screens.
  const [actionsHintOpen, setActionsHintOpen] = useState(false)
  const actionsHintTimer = useRef<number | undefined>(undefined)

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
      setUnmarkedAsAbsent(res.data.unmarkedAsAbsent !== false)
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

  // All employees, sorted (active first, then by name).
  const sortedAll = useMemo(() => {
    return [...reports].sort((a, b) => {
      const aActive = a.isActive !== false
      const bActive = b.isActive !== false
      if (aActive && !bActive) return -1
      if (!aActive && bActive) return 1
      return a.employeeName.localeCompare(b.employeeName)
    })
  }, [reports])

  // The employment-type scope (the summary's "of N employees").
  const scopedReports = useMemo(() => {
    if (employmentType === "all") return sortedAll
    return sortedAll.filter(
      (e) => (e.employmentType ?? "permanent") === employmentType
    )
  }, [sortedAll, employmentType])

  // Search-filtered view (drives the table + summary). Filtering a sorted list
  // preserves order. Every word must match the name, ID or job title, so "ali mason"
  // still narrows to the masons named Ali.
  const filteredReports = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return scopedReports
    return scopedReports.filter((employee) => {
      const haystack = [employee.employeeName, employee.employeeId, employee.jobTitle]
        .join(" ")
        .toLowerCase()
      return terms.every((term) => haystack.includes(term))
    })
  }, [scopedReports, search])

  // The ticked employees still in the report (ids that dropped out are ignored), and
  // how many of them the current filters hide.
  const selectedReports = useMemo(
    () => sortedAll.filter((e) => selectedIds.has(e._id)),
    [sortedAll, selectedIds]
  )
  const listedSelectedCount = filteredReports.filter((e) =>
    selectedIds.has(e._id)
  ).length
  const hiddenSelectedCount = selectedReports.length - listedSelectedCount

  const columnCount = 13 + ABSENT_REASONS.length

  // Tick everyone the filters currently list, across all pages (the header checkbox
  // only covers the visible page).
  function selectAllListed() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const e of filteredReports) next.add(e._id)
      return next
    })
  }

  function showActionsHint() {
    setActionsHintOpen(true)
    window.clearTimeout(actionsHintTimer.current)
    actionsHintTimer.current = window.setTimeout(() => setActionsHintOpen(false), 2500)
  }
  useEffect(() => () => window.clearTimeout(actionsHintTimer.current), [])

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
  }, [search, employmentType, pageSize, mode, month, year, range.from, range.to])

  // Guard against landing past the last page if the data shrinks.
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages)
  }, [currentPage, totalPages])

  // The header checkbox ticks/unticks the rows on the current page.
  const pageSelectedCount = pagedReports.filter((e) =>
    selectedIds.has(e._id)
  ).length
  const allPageSelected =
    pagedReports.length > 0 && pageSelectedCount === pagedReports.length

  function togglePage() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const e of pagedReports) {
        if (allPageSelected) next.delete(e._id)
        else next.add(e._id)
      }
      return next
    })
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // The two things to clear up before an export, across the listed employees.
  const totals = useMemo(() => {
    return filteredReports.reduce(
      (acc, e) => {
        acc.pendingDays += e.pendingDays || 0
        acc.unmarkedDays += e.unmarkedDays || 0
        return acc
      },
      { pendingDays: 0, unmarkedDays: 0 }
    )
  }, [filteredReports])

  // The filter + summary toolbar is sticky; the table header pins right below it, so
  // track the toolbar's height (it wraps onto more lines on narrow screens).
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [toolbarHeight, setToolbarHeight] = useState(0)
  useEffect(() => {
    const el = toolbarRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setToolbarHeight(el.offsetHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Every calendar day of the period (holidays included) — the same for every row.
  const workingDays = reports[0]?.workingDays ?? 0

  // Spreadsheet of the period's figures for the ticked employees.
  function exportToExcel(employees: ReportEmployee[]) {
    if (employees.length === 0) return
    const formattedData = employees.map((employee, index) => {
      const absent = absentCountsOf(employee)
      return {
        "Sl No": index + 1,
        "Employee Name":
          employee.employeeName +
          (employee.isActive === false ? " (Inactive)" : ""),
        "Employee ID": employee.employeeId,
        "Job Title": employee.jobTitle,
        "Working Days": employee.workingDays,
        "Payment Days": employee.paymentDays,
        "Full Days": employee.fullDays,
        "Half Days": employee.halfDays,
        "Absent Days": employee.absentDays,
        // Absent composition: "Absent (no reason)", "Emergency Leave", "Sick Leave", "LOP".
        ...Object.fromEntries(
          ABSENT_REASONS.map((reason) => [reason.label, absent[reason.key]])
        ),
        "Pending Check-outs (in no reason)": employee.pendingDays || 0,
        [ANNUAL_LEAVE.label]: employee.leaveDays || 0,
        [unmarkedAsAbsent ? "Unmarked Days (in absent)" : "Unmarked Days (paid)"]:
          employee.unmarkedDays || 0,
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
    // Named like the ERPNext files: one employee by ID, a partial roster by count.
    const who =
      employees.length === 1
        ? `-${employees[0].employeeId}`
        : employees.length === sortedAll.length
          ? ""
          : `-${employees.length}-employees`
    saveAs(
      fileData,
      mode === "month"
        ? `monthly-report-${month}-${year}${who}.xlsx`
        : `attendance-report-${range.from}_to_${range.to}${who}.xlsx`
    )
  }

  // Download one ERPNext Data Import CSV for the selected month, covering `employees`.
  // The server streams the file (hours + status only — rates live in ERPNext); we just
  // save the blob.
  async function downloadErp(file: ErpFile, employees: ReportEmployee[]) {
    if (employees.length === 0) return
    try {
      setErpBusy(true)
      const res = await api.post(
        `/api/attendance/reports/erpnext/${month}/${year}`,
        { type: file.type, employeeIds: employees.map((e) => e._id) },
        { responseType: "blob" }
      )
      const stamp = `${year}-${String(month).padStart(2, "0")}`
      // One employee is named like the employee page's export; the whole roster keeps
      // the plain name.
      const filename =
        employees.length === 1
          ? `erpnext-${file.type}-${employees[0].employeeId}-${stamp}.csv`
          : employees.length === sortedAll.length
            ? `erpnext-${file.type}-${stamp}.csv`
            : `erpnext-${file.type}-${stamp}-${employees.length}-employees.csv`
      saveAs(res.data as Blob, filename)
    } catch (error) {
      console.error(error)
      toast.error(`Failed to export ${file.label}`)
    } finally {
      setErpBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Sticky toolbar: filters + summary stay pinned while the table scrolls with the
          page (like Employees). Opaque background tinted like the page behind it. */}
      <div
        ref={toolbarRef}
        className="sticky top-0 z-20 -mx-3 border-b bg-background sm:-mx-4"
      >
      <div className="space-y-3 bg-muted/30 px-3 py-3 sm:px-4">
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

        <Select
          value={employmentType}
          onValueChange={(v) => setEmploymentType(v as EmploymentFilter)}
        >
          <SelectTrigger className="w-[150px]" aria-label="Employment type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(EMPLOYMENT_FILTER_LABELS) as EmploymentFilter[]).map(
              (key) => (
                <SelectItem key={key} value={key}>
                  {EMPLOYMENT_FILTER_LABELS[key]}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>

        <div className="relative w-full sm:w-auto sm:min-w-[240px] sm:max-w-sm sm:flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search by name, ID or job title"
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

        {/* ACTIONS — every export covers exactly the ticked employees. With nothing
            ticked the button is muted (not disabled, so it can still be hovered or
            tapped) and explains itself in a tooltip instead of opening. */}
        <div className="ml-auto flex items-center gap-2">
          {selectedReports.length === 0 ? (
            <Tooltip open={actionsHintOpen} onOpenChange={setActionsHintOpen}>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  aria-disabled="true"
                  className="cursor-not-allowed opacity-50"
                  // preventDefault stops Radix's own click/pointer handlers from
                  // closing the tooltip we're opening.
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.preventDefault()
                    showActionsHint()
                  }}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Actions
                  <ChevronDown className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Select employees first — tick them in the table, or use "Select all".
              </TooltipContent>
            </Tooltip>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={erpBusy}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Actions ({selectedReports.length})
                  <ChevronDown className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {selectedReports.length} selected employee
                  {selectedReports.length === 1 ? "" : "s"}
                </DropdownMenuLabel>
                <DropdownMenuItem onClick={() => exportToExcel(selectedReports)}>
                  <FileSpreadsheet className="h-4 w-4" />
                  Spreadsheet (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {/* ERPNext imports are per month. */}
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    ERPNext import (CSV)
                    {mode === "range" && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        Per month only — switch to Month
                      </span>
                    )}
                  </DropdownMenuLabel>
                  {ERP_FILES.map((file) => (
                    <DropdownMenuItem
                      key={file.type}
                      disabled={erpBusy || mode === "range"}
                      onClick={() => downloadErp(file, selectedReports)}
                    >
                      {file.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Summary row — just the headcount, the period, and what to fix before export
          (the per-employee figures are in the table and the Excel export). */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
        {mode === "range" && (
          <span>
            <span className="font-medium text-foreground">{formatDateRange(range)}</span>
            {" · "}
            {daysInRange(range)} {daysInRange(range) === 1 ? "day" : "days"}
          </span>
        )}
        <span>
          {filteredReports.length === scopedReports.length ? (
            <>
              <span className="font-medium text-foreground">{scopedReports.length}</span> employees
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">{filteredReports.length}</span> of{" "}
              {scopedReports.length} employees
            </>
          )}
        </span>
        {workingDays > 0 && (
          <span title="Every calendar day of the period, holidays included">
            Working days <span className="font-medium text-foreground">{workingDays}</span>
          </span>
        )}
        {/* Open check-ins: counted as absent (no reason) — and exported to ERPNext as
            Absent — until someone closes them. */}
        {totals.pendingDays > 0 && (
          <span className="font-medium text-amber-700 dark:text-amber-400">
            {totals.pendingDays} pending check-out
            {totals.pendingDays === 1 ? "" : "s"} counted as absent
          </span>
        )}
        {/* Days before today with no record at all: not in the ERPNext file, so ERPNext
            applies "Consider Unmarked Attendance As" — mirrored by the Configure toggle. */}
        {totals.unmarkedDays > 0 && (
          <span
            className="font-medium text-amber-700 dark:text-amber-400"
            title={
              unmarkedAsAbsent
                ? "Days before today with no attendance record (holidays excluded). Counted as absent (no reason), like ERPNext with \"Consider Unmarked Attendance As: Absent\". Change it under Configure → ERPNext Export."
                : "Days before today with no attendance record (holidays excluded). Counted as paid, like ERPNext with \"Consider Unmarked Attendance As: Present\". Change it under Configure → ERPNext Export."
            }
          >
            {totals.unmarkedDays} unmarked day{totals.unmarkedDays === 1 ? "" : "s"} counted as{" "}
            {unmarkedAsAbsent ? "absent" : "paid"}
          </span>
        )}
        {/* Employees ticked for export, plus a one-click "everyone listed". */}
        <span className="flex items-center gap-1">
          {selectedReports.length > 0 && (
            <span>
              <span className="font-medium text-foreground">{selectedReports.length}</span>{" "}
              selected
              {hiddenSelectedCount > 0 && ` (${hiddenSelectedCount} hidden by filters)`}
            </span>
          )}
          {listedSelectedCount < filteredReports.length && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-primary"
              onClick={selectAllListed}
            >
              Select all {filteredReports.length}
            </Button>
          )}
          {selectedReports.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear
            </Button>
          )}
        </span>
      </div>
      </div>
      </div>

      {/* Table — grows with the page's rows; pagination bounds the count, so no inner
          scroll cage. From lg up the wrapper stops being a scroll box so the header can
          pin under the sticky toolbar (a scroll box would trap position: sticky); below
          lg it keeps horizontal scroll and only the toolbar pins. The shadow stands in
          for the header's bottom border, which a sticky collapsed-border table drops. */}
      <div className="rounded-lg border">
        <Table wrapperClassName="lg:overflow-visible">
          <TableHeader
            className="bg-background shadow-[0_1px_0_var(--border)] lg:sticky lg:z-10"
            style={{ top: toolbarHeight }}
          >
            <TableRow>
              <TableHead rowSpan={2} className="w-8 pr-0">
                <Checkbox
                  checked={
                    allPageSelected
                      ? true
                      : pageSelectedCount > 0
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={togglePage}
                  disabled={loading || pagedReports.length === 0}
                  aria-label="Select all on this page"
                />
              </TableHead>
              <TableHead rowSpan={2} className="w-10">#</TableHead>
              <TableHead rowSpan={2}>Employee</TableHead>
              <TableHead rowSpan={2}>ID</TableHead>
              <TableHead rowSpan={2}>Job</TableHead>
              <TableHead
                rowSpan={2}
                className="text-right"
                title={`Working days (${workingDays}, every calendar day) − absent days − 0.5 × half days. Matches the ERPNext salary slip's Payment Days.`}
              >
                Payment Days
              </TableHead>
              <TableHead
                rowSpan={2}
                className="text-right"
                title="Half days — each deducts 0.5 of a day"
              >
                Half
              </TableHead>
              <TableHead
                rowSpan={2}
                className="text-right"
                title="Every unpaid day: no reason + emergency + sick + LOP (what ERPNext receives as Absent)"
              >
                Absent
              </TableHead>
              <TableHead
                colSpan={ABSENT_REASONS.length}
                className="h-7 border-x text-center text-xs text-muted-foreground"
              >
                Absent breakdown
              </TableHead>
              <TableHead
                rowSpan={2}
                className="text-right"
                title="Annual leave — paid, not an absence"
              >
                {ANNUAL_LEAVE.short}
              </TableHead>
              <TableHead
                rowSpan={2}
                className="text-right"
                title="Payment days ÷ working days"
              >
                %
              </TableHead>
              <TableHead rowSpan={2} className="text-right">OT</TableHead>
              <TableHead rowSpan={2} className="text-right">Holiday</TableHead>
              <TableHead rowSpan={2} className="text-right">Total OT</TableHead>
            </TableRow>
            <TableRow>
              {ABSENT_REASONS.map((reason, i) => (
                <TableHead
                  key={reason.key}
                  title={reason.label}
                  className={cn(
                    "h-7 px-1.5 text-right text-xs",
                    i === 0 && "border-l",
                    i === ABSENT_REASONS.length - 1 && "border-r"
                  )}
                >
                  {reason.short}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="text-center h-24 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : filteredReports.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="text-center h-24 text-muted-foreground">
                  No data found
                </TableCell>
              </TableRow>
            ) : (
              pagedReports.map((employee, index) => {
                const absent = absentCountsOf(employee)
                const isSelected = selectedIds.has(employee._id)
                return (
                  <TableRow
                    key={employee.employeeId}
                    data-state={isSelected ? "selected" : undefined}
                    className={
                      employee.isActive === false
                        ? "opacity-50"
                        : ""
                    }
                  >
                    <TableCell className="w-8 pr-0">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleOne(employee._id)}
                        aria-label={`Select ${employee.employeeName}`}
                      />
                    </TableCell>
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
                    <TableCell className="text-right font-medium tabular-nums">
                      {employee.paymentDays}
                      {/* Days with no record counted as paid — flag them here. (When
                          they count as absent, the No-reason cell flags them instead.) */}
                      {!unmarkedAsAbsent && employee.unmarkedDays > 0 && (
                        <span
                          className="ml-1 text-xs font-normal text-amber-700 dark:text-amber-400"
                          title={`${employee.unmarkedDays} day(s) with no attendance record, counted as paid`}
                        >
                          ({employee.unmarkedDays} unmarked)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{employee.halfDays}</TableCell>
                    <TableCell className="text-right tabular-nums">{employee.absentDays}</TableCell>
                    {ABSENT_REASONS.map((reason, i) => (
                      <TableCell
                        key={reason.key}
                        className={cn(
                          "px-1.5 text-right tabular-nums",
                          i === 0 && "border-l",
                          i === ABSENT_REASONS.length - 1 && "border-r",
                          absent[reason.key] > 0
                            ? cn("font-medium", reason.text)
                            : "text-muted-foreground/60"
                        )}
                      >
                        {absent[reason.key]}
                        {/* Open check-ins — and, when counted as absent, unmarked days —
                            sit in "no reason" until someone records them. */}
                        {reason.key === "none" &&
                          (employee.pendingDays > 0 ||
                            (unmarkedAsAbsent && employee.unmarkedDays > 0)) && (
                          <span
                            className="ml-0.5 text-xs text-amber-700 dark:text-amber-400"
                            title={`incl. ${[
                              employee.pendingDays > 0 &&
                                `${employee.pendingDays} pending check-out(s)`,
                              unmarkedAsAbsent &&
                                employee.unmarkedDays > 0 &&
                                `${employee.unmarkedDays} unmarked day(s) with no record`,
                            ]
                              .filter(Boolean)
                              .join(" + ")}`}
                          >
                            *
                          </span>
                        )}
                      </TableCell>
                    ))}
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        employee.leaveDays > 0
                          ? cn("font-medium", ANNUAL_LEAVE.text)
                          : "text-muted-foreground/60"
                      )}
                    >
                      {employee.leaveDays || 0}
                    </TableCell>
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
