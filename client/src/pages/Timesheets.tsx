// Timesheets — one row per employee for a month with its approval status. Admins and
// superadmins approve (only a closed month with no missing / open / job-less days) and run
// every export here; supervisors browse read-only and can download timesheets.
// The Excel files export ANY selected timesheet (e.g. printed to check before approving);
// only the ERPNext CSVs need an approved one (server: utils/timesheetMonth.js).

import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import toast from "react-hot-toast"
import axios from "axios"
import { saveAs } from "file-saver"
import {
  CheckCircle2,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  Search,
} from "lucide-react"
import { api } from "@/lib/api"
import { useAuth } from "@/context/AuthContext"
import { useWorkConfig } from "@/context/WorkConfigContext"
import { erpExportWarning } from "@/lib/erpExportWarnings"
import { exportMonthlySummary, type ReportEmployee } from "@/lib/monthlySummaryExport"
import type { MonthYear } from "@/lib/monthYear"
import {
  STATUS_META,
  approvalDetail,
  blockerSummary,
  monthLabel,
  notApprovedFromError,
  previousMonthYear,
  type ApprovalStatus,
  type NotApprovedEmployee,
} from "@/lib/timesheetApproval"
import type { AttendanceRecord } from "@/pages/EditPastAttendance"
import { MonthYearPicker } from "@/components/MonthYearPicker"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

interface TimesheetRow {
  _id: string
  name: string
  employeeId: string
  companyId: string | null
  jobTitle: string
  employmentType: "permanent" | "temporary"
  isActive: boolean
  site: string | null
  status: ApprovalStatus
  approvedByName: string | null
  approvedAt: string | null
  revokedByName: string | null
  revokedAt: string | null
  revokeReason: "manual" | "records_changed" | null
  blockers: { missing: number; pending: number; noJob: number }
}

interface TimesheetsResponse {
  rows: TimesheetRow[]
  total: number
  currentPage: number
  totalPages: number
  monthClosed: boolean
  counts: Record<ApprovalStatus, number>
}

type ApprovalFilter = "all" | ApprovalStatus

interface Filters {
  month: number
  year: number
  search: string
  site: string
  employmentType: "" | "permanent" | "temporary"
  approval: ApprovalFilter
  page: number
  limit: number
}

interface Site {
  _id: string
  siteName: string
}

const ALL_ROWS = 0
const PAGE_SIZES = [25, 50, 100]

// The ERPNext Data Import files (rates live in ERPNext; these carry hours + status).
const ERP_FILES = [
  { type: "attendance", label: "Attendance (payroll)" },
  { type: "timesheet", label: "Timesheet (job cost)" },
] as const

type ErpFile = (typeof ERP_FILES)[number]

/** Run `worker` over `ids`, at most `limit` at a time. */
async function runWithConcurrency<T>(
  ids: string[],
  limit: number,
  worker: (id: string) => Promise<T>,
  onDone: () => void
): Promise<Array<{ id: string; value?: T; error?: unknown }>> {
  const results: Array<{ id: string; value?: T; error?: unknown }> = []
  let cursor = 0
  const runNext = async (): Promise<void> => {
    const i = cursor++
    if (i >= ids.length) return
    const id = ids[i]
    try {
      results[i] = { id, value: await worker(id) }
    } catch (error) {
      results[i] = { id, error }
    }
    onDone()
    await runNext()
  }
  await Promise.all(Array.from({ length: Math.min(limit, ids.length) }, () => runNext()))
  return results
}

const namesOf = (list: NotApprovedEmployee[]) =>
  list
    .slice(0, 5)
    .map((e) => e.name || e.employeeId || "unknown")
    .join(", ") + (list.length > 5 ? ` +${list.length - 5} more` : "")

export default function Timesheets() {
  const { user } = useAuth()
  const canWrite = user?.role === "admin" || user?.role === "superadmin"
  const { config: workConfig } = useWorkConfig()

  // Filters live in the URL (like Employees), so opening an employee and coming back
  // restores them. Only non-default values are written.
  const [searchParams, setSearchParams] = useSearchParams()
  const paramsKey = searchParams.toString()
  const filters = useMemo<Filters>(() => {
    const fallback = previousMonthYear()
    const month = Number(searchParams.get("month"))
    const year = Number(searchParams.get("year"))
    const validPeriod = month >= 1 && month <= 12 && year >= 2000
    const employmentType = searchParams.get("employmentType")
    const approval = searchParams.get("approval")
    const page = Number(searchParams.get("page"))
    const limit = searchParams.get("limit")
    return {
      month: validPeriod ? month : fallback.month,
      year: validPeriod ? year : fallback.year,
      search: searchParams.get("search") ?? "",
      site: searchParams.get("site") ?? "",
      employmentType:
        employmentType === "permanent" || employmentType === "temporary" ? employmentType : "",
      approval:
        approval === "approved" || approval === "pending" || approval === "revoked"
          ? approval
          : "all",
      page: Number.isInteger(page) && page > 0 ? page : 1,
      limit:
        limit !== null && [...PAGE_SIZES, ALL_ROWS].includes(Number(limit)) ? Number(limit) : 50,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey])

  const setFilters = (next: Filters) => {
    const params = new URLSearchParams()
    const fallback = previousMonthYear()
    if (next.month !== fallback.month || next.year !== fallback.year) {
      params.set("month", String(next.month))
      params.set("year", String(next.year))
    }
    if (next.search) params.set("search", next.search)
    if (next.site) params.set("site", next.site)
    if (next.employmentType) params.set("employmentType", next.employmentType)
    if (next.approval !== "all") params.set("approval", next.approval)
    if (next.page !== 1) params.set("page", String(next.page))
    if (next.limit !== 50) params.set("limit", String(next.limit))
    setSearchParams(params, { replace: true })
  }

  const period: MonthYear = { month: filters.month, year: filters.year }

  const [data, setData] = useState<TimesheetsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [sites, setSites] = useState<Site[]>([])
  const requestSeq = useRef(0)

  // Ticked employees for the CURRENT month, by Mongo _id, with the row they were ticked
  // from (status + names for exports across pages). Cleared when the month changes.
  const [selected, setSelected] = useState<Map<string, TimesheetRow>>(() => new Map())
  const [busy, setBusy] = useState<null | "approve" | "select" | "export">(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const listParams = (overrides: Record<string, string | number> = {}) => {
    const params: Record<string, string | number> = { month: filters.month, year: filters.year }
    if (filters.search) params.search = filters.search
    if (filters.site) params.site = filters.site
    if (filters.employmentType) params.employmentType = filters.employmentType
    if (filters.approval !== "all") params.approval = filters.approval
    if (filters.limit !== ALL_ROWS) {
      params.page = filters.page
      params.limit = filters.limit
    }
    return { ...params, ...overrides }
  }

  async function fetchRows() {
    const seq = ++requestSeq.current
    try {
      setLoading(true)
      const res = await api.get<TimesheetsResponse>("/api/timesheets", { params: listParams() })
      if (seq !== requestSeq.current) return
      setData(res.data)
      // Keep ticked rows' status current with what the server says now.
      setSelected((prev) => {
        if (prev.size === 0) return prev
        const next = new Map(prev)
        for (const row of res.data.rows) if (next.has(row._id)) next.set(row._id, row)
        return next
      })
    } catch (error) {
      if (seq !== requestSeq.current) return
      console.error(error)
      setData(null)
      toast.error("Failed to load timesheets")
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }

  useEffect(() => {
    fetchRows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey])

  useEffect(() => {
    api
      .get<Site[]>("/api/site")
      .then((res) => setSites(res.data))
      .catch((error) => console.error(error))
  }, [])

  const rows = data?.rows ?? []
  const monthClosed = data?.monthClosed ?? false
  const selectedRows = [...selected.values()]
  const approvedSelected = selectedRows.filter((r) => r.status === "approved")
  const unapprovedSelected = selectedRows.length - approvedSelected.length

  const filtersActive =
    filters.search !== "" ||
    filters.site !== "" ||
    filters.employmentType !== "" ||
    filters.approval !== "all"

  const pageSelectedCount = rows.filter((r) => selected.has(r._id)).length
  const allPageSelected = rows.length > 0 && pageSelectedCount === rows.length

  function togglePage() {
    setSelected((prev) => {
      const next = new Map(prev)
      for (const row of rows) {
        if (allPageSelected) next.delete(row._id)
        else next.set(row._id, row)
      }
      return next
    })
  }

  function toggleOne(row: TimesheetRow) {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(row._id)) next.delete(row._id)
      else next.set(row._id, row)
      return next
    })
  }

  // Tick everyone the filters list across all pages — optionally only the approved ones.
  async function selectAllListed(onlyApproved: boolean) {
    try {
      setBusy("select")
      const overrides: Record<string, string | number> = {}
      if (onlyApproved) overrides.approval = "approved"
      const params = listParams(overrides)
      delete params.page
      delete params.limit
      const res = await api.get<TimesheetsResponse>("/api/timesheets", { params })
      setSelected((prev) => {
        const next = new Map(prev)
        for (const row of res.data.rows) next.set(row._id, row)
        return next
      })
    } catch (error) {
      console.error(error)
      toast.error("Failed to select employees")
    } finally {
      setBusy(null)
    }
  }

  async function approveSelected() {
    const ids = selectedRows.filter((r) => r.status !== "approved").map((r) => r._id)
    if (ids.length === 0) {
      toast("Everyone selected is already approved")
      return
    }
    try {
      setBusy("approve")
      const res = await api.post<{
        approved: NotApprovedEmployee[]
        skipped: Array<NotApprovedEmployee & { reason: string }>
      }>("/api/timesheets/approve", { month: filters.month, year: filters.year, employeeIds: ids })
      const { approved, skipped } = res.data
      if (approved.length) toast.success(`Approved ${approved.length} timesheet(s)`)
      if (skipped.length) {
        toast.error(
          `${skipped.length} not approved — fix their missing or incomplete days first: ${namesOf(skipped)}`,
          { duration: 10000 }
        )
      }
      await fetchRows()
    } catch (error) {
      console.error(error)
      toast.error(
        (axios.isAxiosError(error) && error.response?.data?.message) || "Failed to approve"
      )
    } finally {
      setBusy(null)
    }
  }

  // The ERPNext files cover the APPROVED ticked employees only; the rest are named.
  function erpTargets(): TimesheetRow[] | null {
    if (approvedSelected.length === 0) {
      toast.error("Only approved timesheets can be sent to ERPNext — none of the selected are approved")
      return null
    }
    if (unapprovedSelected > 0) {
      toast(`${unapprovedSelected} selected timesheet(s) are not approved and were left out`, {
        icon: "⚠️",
      })
    }
    return approvedSelected
  }

  // A timesheet revoked since it was loaded (its records changed) comes back as a 409.
  async function handleExportError(error: unknown, label: string) {
    const notApproved = await notApprovedFromError(error)
    if (notApproved) {
      toast.error(`No longer approved (records changed): ${namesOf(notApproved)}. Nothing exported.`, {
        duration: 10000,
      })
      await fetchRows()
      return
    }
    console.error(error)
    toast.error(`Failed to export ${label}`)
  }

  // Excel files: every ticked employee, approved or not.
  async function exportTimesheetsXlsx() {
    const targets = selectedRows
    if (targets.length === 0) return
    try {
      setBusy("export")
      setProgress({ done: 0, total: targets.length })
      const results = await runWithConcurrency(
        targets.map((r) => r._id),
        5,
        (id) =>
          api
            .get(`/api/attendance/employee/${id}`, {
              params: { month: filters.month, year: filters.year },
            })
            .then((res) => ({
              records: (res.data.data || []) as AttendanceRecord[],
            })),
        () => setProgress((p) => (p ? { ...p, done: p.done + 1 } : p))
      )
      const byId = new Map(targets.map((r) => [r._id, r]))
      const ok = results.filter((r) => r && !r.error)
      const dropped = results.length - ok.length
      if (ok.length === 0) {
        toast.error("Nothing to export — the selected timesheets could not be loaded")
        return
      }
      const { exportBulkTimesheets } = await import("@/lib/timesheetExport")
      await exportBulkTimesheets({
        employees: ok.map((r) => {
          const row = byId.get(r.id)
          return {
            name: row?.name ?? "",
            employeeId: row?.employeeId ?? "",
            jobTitle: row?.jobTitle ?? "",
            companyId: row?.companyId ?? null,
            records: r.value?.records ?? [],
          }
        }),
        month: filters.month,
        year: filters.year,
        workConfig,
        sortOrder: "asc",
      })
      if (dropped > 0) {
        toast.success(`Exported ${ok.length} timesheet(s); ${dropped} failed to load and were left out`)
      } else {
        toast.success(`Exported ${ok.length} timesheet(s)`)
      }
    } catch (error) {
      await handleExportError(error, "timesheets")
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  async function exportSummaryXlsx() {
    const targets = selectedRows
    if (targets.length === 0) return
    try {
      setBusy("export")
      const res = await api.post<{ report: ReportEmployee[]; unmarkedAsAbsent?: boolean }>(
        "/api/timesheets/export/summary",
        { month: filters.month, year: filters.year, employeeIds: targets.map((r) => r._id) }
      )
      exportMonthlySummary(res.data.report, {
        month: filters.month,
        year: filters.year,
        unmarkedAsAbsent: res.data.unmarkedAsAbsent !== false,
      })
    } catch (error) {
      await handleExportError(error, "summary")
    } finally {
      setBusy(null)
    }
  }

  // One ERPNext Data Import CSV for the month (hours + status — rates live in ERPNext).
  async function downloadErp(file: ErpFile) {
    const targets = erpTargets()
    if (!targets) return
    try {
      setBusy("export")
      const res = await api.post(
        `/api/attendance/reports/erpnext/${filters.month}/${filters.year}`,
        { type: file.type, employeeIds: targets.map((r) => r._id) },
        { responseType: "blob" }
      )
      const stamp = `${filters.year}-${String(filters.month).padStart(2, "0")}`
      const filename =
        targets.length === 1
          ? `erpnext-${file.type}-${targets[0].employeeId}-${stamp}.csv`
          : `erpnext-${file.type}-${stamp}-${targets.length}-employees.csv`
      saveAs(res.data as Blob, filename)
      // Hours the file could not carry (no Overtime Type, no job / job code).
      const warning = erpExportWarning(res.headers)
      if (warning) toast(`${file.label}: ${warning}`, { icon: "⚠️", duration: 12000 })
    } catch (error) {
      await handleExportError(error, file.label)
    } finally {
      setBusy(null)
    }
  }

  const startIndex = filters.limit === ALL_ROWS ? 0 : (filters.page - 1) * filters.limit
  const counts = data?.counts

  return (
    <div className="px-6 pb-6 space-y-4">
      <div className="sticky top-0 z-20 -mx-6 space-y-4 border-b bg-background px-6 pt-6 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-4xl font-bold">Timesheets</h1>
            <MonthYearPicker
              value={period}
              onChange={(v) => {
                if (!v) return
                // A selection is per month (approval is per month).
                setSelected(new Map())
                setFilters({ ...filters, month: v.month, year: v.year, page: 1 })
              }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canWrite && (
              <Button
                variant="outline"
                onClick={approveSelected}
                disabled={busy !== null || !monthClosed || selectedRows.length === 0}
                title={
                  !monthClosed
                    ? "A month can be approved only after it ends"
                    : selectedRows.length === 0
                      ? "Select employees first"
                      : undefined
                }
              >
                {busy === "approve" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Approve{selectedRows.length ? ` (${selectedRows.length})` : ""}
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button disabled={busy !== null || selectedRows.length === 0}>
                  {busy === "export" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  {busy === "export" && progress
                    ? `Exporting ${progress.done}/${progress.total}`
                    : `Export${selectedRows.length ? ` (${selectedRows.length})` : ""}`}
                  <ChevronDown className="ml-1 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  Excel: all {selectedRows.length} selected
                  {canWrite && ` · ERPNext: ${approvedSelected.length} approved only`}
                </DropdownMenuLabel>
                <DropdownMenuItem onClick={exportTimesheetsXlsx}>
                  <FileSpreadsheet className="h-4 w-4" />
                  Timesheets (.xlsx)
                </DropdownMenuItem>
                {canWrite && (
                  <>
                    <DropdownMenuItem onClick={exportSummaryXlsx}>
                      <FileSpreadsheet className="h-4 w-4" />
                      Monthly summary (.xlsx)
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>ERPNext import (CSV)</DropdownMenuLabel>
                      {ERP_FILES.map((file) => (
                        <DropdownMenuItem
                          key={file.type}
                          disabled={approvedSelected.length === 0}
                          onClick={() => downloadErp(file)}
                        >
                          {file.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Filters: search grows; selects keep fixed widths on desktop, stack on mobile. */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative md:max-w-md md:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by name, ID or job title"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 md:flex md:items-center md:gap-2">
            <Select
              value={filters.site || "all"}
              onValueChange={(value) =>
                setFilters({ ...filters, site: value === "all" ? "" : value, page: 1 })
              }
            >
              <SelectTrigger className="w-full md:w-[200px]" aria-label="Site">
                <SelectValue placeholder="Select Site" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="null">Not assigned</SelectItem>
                <SelectItem value="all">All Sites</SelectItem>
                {sites.map((site) => (
                  <SelectItem key={site._id} value={site._id}>
                    {site.siteName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.employmentType || "all"}
              onValueChange={(value) =>
                setFilters({
                  ...filters,
                  employmentType: value === "all" ? "" : (value as "permanent" | "temporary"),
                  page: 1,
                })
              }
            >
              <SelectTrigger className="w-full md:w-[150px]" aria-label="Employment type">
                <SelectValue placeholder="Employment Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="permanent">Permanent</SelectItem>
                <SelectItem value="temporary">Temporary</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.approval}
              onValueChange={(value) =>
                setFilters({ ...filters, approval: value as ApprovalFilter, page: 1 })
              }
            >
              <SelectTrigger className="w-full md:w-[160px]" aria-label="Approval status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="revoked">Revoked</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start md:self-auto"
              onClick={() =>
                setFilters({
                  ...filters,
                  search: "",
                  site: "",
                  employmentType: "",
                  approval: "all",
                  page: 1,
                })
              }
            >
              <RotateCcw className="mr-1 h-3 w-3" />
              Clear
            </Button>
          )}
        </div>

        {/* Summary: the month's status counts, what is ticked, select-all shortcuts. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
          {counts && (
            <span>
              <span className="font-medium text-emerald-700 dark:text-emerald-400">{counts.approved}</span>{" "}
              approved ·{" "}
              <span className="font-medium text-amber-700 dark:text-amber-400">{counts.pending}</span>{" "}
              pending ·{" "}
              <span className="font-medium text-rose-700 dark:text-rose-400">{counts.revoked}</span>{" "}
              revoked
            </span>
          )}
          {data && !monthClosed && (
            <span className="font-medium text-amber-700 dark:text-amber-400">
              {monthLabel(period)} isn't over yet — it can be approved once it ends
            </span>
          )}
          <span className="flex flex-wrap items-center gap-1">
            {selectedRows.length > 0 && (
              <span>
                <span className="font-medium text-foreground">{selectedRows.length}</span> selected
                {unapprovedSelected > 0 && ` (${unapprovedSelected} not approved)`}
              </span>
            )}
            {data && data.total > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-primary"
                disabled={busy !== null}
                onClick={() => selectAllListed(false)}
              >
                Select all {data.total}
              </Button>
            )}
            {counts && counts.approved > 0 && filters.approval !== "pending" && filters.approval !== "revoked" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-primary"
                disabled={busy !== null}
                onClick={() => selectAllListed(true)}
              >
                Select all approved
              </Button>
            )}
            {selectedRows.length > 0 && (
              <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setSelected(new Map())}>
                Clear
              </Button>
            )}
          </span>
        </div>
      </div>

      <div className="border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allPageSelected ? true : pageSelectedCount > 0 ? "indeterminate" : false}
                  onCheckedChange={togglePage}
                  disabled={loading || rows.length === 0}
                  aria-label="Select all on this page"
                />
              </TableHead>
              <TableHead className="w-14 hidden md:table-cell">#</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">Employee ID</TableHead>
              <TableHead className="hidden md:table-cell">Job Title</TableHead>
              <TableHead className="hidden lg:table-cell">Site</TableHead>
              <TableHead>Approval</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !data ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  No timesheets found
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, index) => {
                const blockers = blockerSummary(row.blockers)
                const meta = STATUS_META[row.status]
                return (
                  <TableRow
                    key={row._id}
                    data-state={selected.has(row._id) ? "selected" : undefined}
                    className={row.isActive ? "" : "opacity-60"}
                  >
                    <TableCell className="w-10">
                      <Checkbox
                        checked={selected.has(row._id)}
                        onCheckedChange={() => toggleOne(row)}
                        aria-label={`Select ${row.name}`}
                      />
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {startIndex + index + 1}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to={`/employees/${row._id}?month=${filters.month}&year=${filters.year}`}
                            className="font-medium hover:underline"
                          >
                            {row.name}
                          </Link>
                          {row.employmentType === "temporary" && (
                            <Badge variant="secondary" className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/30 text-[10px] px-1.5 py-0 h-4">
                              Temporary
                            </Badge>
                          )}
                          {!row.isActive && (
                            <Badge variant="secondary" className="bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200/50 dark:border-rose-800/30 text-[10px] px-1.5 py-0 h-4">
                              Deactivated
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-col text-xs text-muted-foreground md:hidden">
                          <span>ID: {row.employeeId}</span>
                          <span>{row.jobTitle}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{row.employeeId}</TableCell>
                    <TableCell className="hidden md:table-cell">{row.jobTitle}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {row.site ?? <span className="text-muted-foreground">Not assigned</span>}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-col gap-0.5">
                        <Badge
                          variant="outline"
                          className={cn("w-fit", meta.className)}
                          title={approvalDetail(row)}
                        >
                          {meta.label}
                        </Badge>
                        {row.status === "approved" ? (
                          <span className="text-xs text-muted-foreground">
                            by {row.approvedByName || "unknown"}
                          </span>
                        ) : row.status === "revoked" && row.revokeReason === "records_changed" ? (
                          <span className="text-xs text-muted-foreground">records changed</span>
                        ) : null}
                        {row.status !== "approved" && blockers && (
                          <span className="text-xs font-medium text-rose-700 dark:text-rose-400">
                            {blockers}
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          className="order-1 flex-1 sm:flex-none"
          disabled={!data || data.currentPage <= 1}
          onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
        >
          Previous
        </Button>
        <div className="order-3 flex w-full items-center justify-between gap-3 sm:order-2 sm:w-auto sm:justify-normal sm:gap-4">
          <p className="text-sm whitespace-nowrap">
            Page {data?.currentPage ?? 1} of {data?.totalPages ?? 1}
            {data ? ` · ${data.total} employees` : ""}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Rows per page</span>
            <Select
              value={String(filters.limit)}
              onValueChange={(value) => setFilters({ ...filters, limit: Number(value), page: 1 })}
            >
              <SelectTrigger className="w-[80px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
                <SelectItem value={String(ALL_ROWS)}>All</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          variant="outline"
          className="order-2 flex-1 sm:order-3 sm:flex-none"
          disabled={!data || data.currentPage >= data.totalPages}
          onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
