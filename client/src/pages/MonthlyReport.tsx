
import { useEffect, useMemo, useState } from "react"
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

// --- Monthly Attendance types ---

interface ReportEmployee {
  employeeName: string
  employeeId: string
  jobTitle: string
  isActive?: boolean
  fullDays: number
  halfDays: number
  absentDays: number
  attendancePercentage: number
  overtimeHours: number
  holidayHours: number
  totalOvertimeHours: number
}

interface MonthlyReportResponse {
  success: boolean
  month: number
  year: number
  report: ReportEmployee[]
}

// --- Job Report types ---

interface JobReportJob {
  jobId: string
  jobCode: string
  jobName: string
  isActive: boolean
  isCompleted: boolean
  normalHours: number
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
  report: JobReportSite[]
}

// =============================================================================
// Monthly Attendance Tab
// =============================================================================

function MonthlyAttendanceTab() {
  const today = new Date()
  const [month, setMonth] = useState(String(today.getMonth() + 1))
  const [year, setYear] = useState(String(today.getFullYear()))
  const [loading, setLoading] = useState(false)
  const [reports, setReports] = useState<ReportEmployee[]>([])
  const [name, setName] = useState("")
  const [employeeId, setEmployeeId] = useState("")
  const [jobTitle, setJobTitle] = useState("")

  // Client-side pagination for the display only. The full month stays in `reports`
  // so search spans everyone and Export always covers the whole roster.
  const PAGE_SIZE_OPTIONS = ["25", "50", "100", "all"] as const
  const [pageSize, setPageSize] = useState<string>("50")
  const [currentPage, setCurrentPage] = useState(1)

  async function fetchReports() {
    try {
      setLoading(true)
      const res = await api.get<MonthlyReportResponse>(
        `/api/attendance/reports/monthly/${month}/${year}`
      )
      setReports(res.data.report || [])
    } catch (error) {
      console.log(error)
      setReports([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchReports()
  }, [month, year])

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
  }, [name, employeeId, jobTitle, pageSize, month, year])

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
        acc.overtimeHours += e.overtimeHours
        acc.holidayHours += e.holidayHours
        acc.totalOvertimeHours += e.totalOvertimeHours
        return acc
      },
      {
        fullDays: 0,
        halfDays: 0,
        absentDays: 0,
        overtimeHours: 0,
        holidayHours: 0,
        totalOvertimeHours: 0,
      }
    )
  }, [filteredReports])

  function exportToExcel() {
    // Always export every employee for the month, regardless of the active search.
    if (sortedAll.length === 0) return
    const formattedData = sortedAll.map((employee, index) => ({
      "Sl No": index + 1,
      "Employee Name":
        employee.employeeName +
        (employee.isActive === false ? " (Inactive)" : ""),
      "Employee ID": employee.employeeId,
      "Job Title": employee.jobTitle,
      "Full Days": employee.fullDays,
      "Half Days": employee.halfDays,
      "Absent Days": employee.absentDays,
      "Attendance %": employee.attendancePercentage,
      "OT Hours": employee.overtimeHours,
      "Holiday Hours": employee.holidayHours,
      "Total OT Hours": employee.totalOvertimeHours,
    }))
    const worksheet = XLSX.utils.json_to_sheet(formattedData)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Monthly Report")
    const excelBuffer = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "array",
    })
    const fileData = new Blob([excelBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8",
    })
    saveAs(fileData, `monthly-report-${month}-${year}.xlsx`)
  }

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ]

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months.map((monthName, index) => (
              <SelectItem key={monthName} value={String(index + 1)}>
                {monthName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          className="w-[80px]"
          placeholder="Year"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />

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

        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={exportToExcel}
            disabled={sortedAll.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export all
          </Button>
        </div>
      </div>

      {/* Summary row */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground border-b pb-3">
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
      </div>

      {/* Table — grows with the page's rows; pagination bounds the count, so no
          inner scroll cage. Horizontal scroll is handled by the Table wrapper. */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader className="bg-background">
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>ID</TableHead>
              <TableHead>Job</TableHead>
              <TableHead className="text-right">Full</TableHead>
              <TableHead className="text-right">Half</TableHead>
              <TableHead className="text-right">Absent</TableHead>
              <TableHead className="text-right">%</TableHead>
              <TableHead className="text-right">OT</TableHead>
              <TableHead className="text-right">Holiday</TableHead>
              <TableHead className="text-right">Total OT</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center h-24 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : filteredReports.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center h-24 text-muted-foreground">
                  No data found
                </TableCell>
              </TableRow>
            ) : (
              pagedReports.map((employee, index) => (
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
                  <TableCell>
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
                  <TableCell className="capitalize">{employee.jobTitle}</TableCell>
                  <TableCell className="text-right">{employee.fullDays}</TableCell>
                  <TableCell className="text-right">{employee.halfDays}</TableCell>
                  <TableCell className="text-right">{employee.absentDays}</TableCell>
                  <TableCell className="text-right">{employee.attendancePercentage}%</TableCell>
                  <TableCell className="text-right">{employee.overtimeHours}</TableCell>
                  <TableCell className="text-right">{employee.holidayHours}</TableCell>
                  <TableCell className="text-right font-medium">{employee.totalOvertimeHours}</TableCell>
                </TableRow>
              ))
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

  async function fetchJobReport() {
    try {
      setLoading(true)
      const res = await api.get<JobReportResponse>("/api/attendance/reports/job-report")
      setSites(res.data.report || [])
    } catch (error) {
      console.log(error)
      setSites([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchJobReport()
  }, [])

  const filteredSites = useMemo(() => {
    if (!search) return sites
    const q = search.toLowerCase()
    return sites
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
  }, [sites, search])

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
          Status: job.isCompleted ? "Completed" : job.isActive ? "Active" : "Inactive",
          "Normal Hours": job.normalHours,
          "OT Hours": job.overtimeHours,
          "Holiday Hours": job.holidayHours,
          "Total OT Hours": job.totalOTHours,
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
    saveAs(fileData, `job-report.xlsx`)
  }

  const totalJobs = filteredSites.reduce((sum, s) => sum + s.jobs.length, 0)

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
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
        <span>
          <span className="font-medium text-foreground">{filteredSites.length}</span> sites
        </span>
        <span>
          <span className="font-medium text-foreground">{totalJobs}</span> jobs
        </span>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-auto max-h-[calc(100vh-280px)]">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead className="w-[240px]">Job Number</TableHead>
              <TableHead>Job Name</TableHead>
              <TableHead className="text-right">Normal Hours</TableHead>
              <TableHead className="text-right">OT Hours</TableHead>
              <TableHead className="text-right">Holiday Hours</TableHead>
              <TableHead className="text-right">Total OT Hours</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : filteredSites.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                  No data found
                </TableCell>
              </TableRow>
            ) : (
              filteredSites.map((site) => {
                const isCollapsed = collapsedSites.has(site.siteId)
                const siteTotals = site.jobs.reduce(
                  (acc, j) => {
                    acc.normal += j.normalHours
                    acc.ot += j.overtimeHours
                    acc.holiday += j.holidayHours
                    acc.totalOT += j.totalOTHours
                    return acc
                  },
                  { normal: 0, ot: 0, holiday: 0, totalOT: 0 }
                )

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
                            ({site.jobs.length} {site.jobs.length === 1 ? "job" : "jobs"})
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {siteTotals.normal.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {siteTotals.ot.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {siteTotals.holiday.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-muted-foreground">
                        {siteTotals.totalOT.toFixed(2)}
                      </TableCell>
                    </TableRow>

                    {/* Job rows */}
                    {!isCollapsed &&
                      site.jobs.map((job) => (
                        <TableRow
                          key={job.jobId}
                          className={job.isCompleted || !job.isActive ? "opacity-50" : ""}
                        >
                          <TableCell className="pl-10">{job.jobCode || "—"}</TableCell>
                          <TableCell>
                            <span>{job.jobName || "—"}</span>
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
                          <TableCell className="text-right">{job.normalHours}</TableCell>
                          <TableCell className="text-right">{job.overtimeHours}</TableCell>
                          <TableCell className="text-right">{job.holidayHours}</TableCell>
                          <TableCell className="text-right font-medium">{job.totalOTHours}</TableCell>
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
