// Employees.tsx

import { api } from "@/lib/api"
import toast from "react-hot-toast"
import { useEffect, useRef, useState } from "react"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import EditEmployee from "@/components/EditEmployee"
import AddEmployee from "@/components/AddEmployee"
import axios from "axios"
import { Link, useNavigate } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { useWorkConfig } from "@/context/WorkConfigContext"
import { useAuth } from "@/context/AuthContext"
import { Download, Loader2, Search, X } from "lucide-react"
import type { AttendanceRecord } from "@/pages/EditPastAttendance"

interface Employee {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
  currentSite: string | null
  currentJob: { _id: string; name: string } | null
  user?: string | null
  employmentType: 'permanent' | 'temporary'
  nationality?: 'foreign' | 'omani'
  isActive?: boolean
}


interface Filters {
  // One combined search box matching name, employee ID and job title at once.
  search: string
  site: string
  // Which lifecycle bucket to list: active (default), soft-deleted, or both.
  status: "active" | "deactivated" | "all"
  page: number
  limit: number
}

interface Site {
  _id: string
  siteName: string
}

interface EmployeesResponse {
  employees: Employee[]
  currentPage: number
  totalPages: number
  totalEmployees: number
}

type NewEmployee = {
  name: string
  employeeId: string
  jobTitle: string
  employmentType: 'permanent' | 'temporary'
  nationality: 'foreign' | 'omani'
}

type UpdateInfo = {
  name: string
  employeeId: string
  jobTitle: string
  employmentType: 'permanent' | 'temporary'
  nationality: 'foreign' | 'omani'
}


function Employees() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState<Filters>({
    search: "",
    site: "",
    status: "active",
    page: 1,
    limit: 10,
  })

  const [employees, setEmployees] = useState<Employee[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [siteMap, setSiteMap] = useState<Record<string, string>>({})


  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalEmployees, setTotalEmployees] = useState(0)

  const { config: workConfig } = useWorkConfig()

  // Supervisors get read-only access: they can browse + export but not add/edit/delete.
  const { user } = useAuth()
  const canWrite = user?.role === "admin" || user?.role === "superadmin"

  // --- Bulk timesheet export ---
  const currentYear = new Date().getFullYear()
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [exportMonth, setExportMonth] = useState(
    String(new Date().getMonth() + 1)
  )
  const [exportYear, setExportYear] = useState(String(currentYear))
  const [selectingAll, setSelectingAll] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<{
    done: number
    total: number
  } | null>(null)
  // Employee meta accumulated across every fetch (current page + "select all"),
  // so selected ids on other pages still resolve their name/id/title at export time.
  const employeeMetaRef = useRef<Map<string, Employee>>(new Map())

  async function fetchEmployees() {
    try {
      const res = await api.get<EmployeesResponse>(
        "/api/employees",
        {
          params: filters,
        }
      )

      setEmployees(res.data.employees)

      res.data.employees.forEach((e) =>
        employeeMetaRef.current.set(e._id, e)
      )

      setCurrentPage(res.data.currentPage)

      setTotalPages(res.data.totalPages)

      setTotalEmployees(res.data.totalEmployees)
    } catch (error) {
      console.log(error)
      setEmployees([])
    }
  }



  const fetchSites = async () => {
    try {
      const res = await api.get<Site[]>("/api/site")

      const sitesData = res.data

      const map: Record<string, string> = {}

      for (const site of sitesData) {
        map[site._id] = site.siteName
      }

      setSites(sitesData)

      setSiteMap(map)
    } catch (error) {
      console.log(error)
    }
  }

  useEffect(() => {
    fetchSites()
  }, [])

  useEffect(() => {
    fetchEmployees()
  }, [filters])

  const addEmployee = async ( newEmployee: NewEmployee ) => {
    try{
      await api.post('/api/employees', newEmployee)
      toast.success("Employee added successfully")
      fetchEmployees()
    }catch(error){
      console.log(error)
      if (axios.isAxiosError(error)) {
      toast.error(
        error.response?.data?.message || "Failed to add employee"
      )
    } else {
      toast.error("Something went wrong")
    }
    }
  }

  const removeEmployee = async (id: string) => {
    try {
      await api.delete(`/api/employees/${id}`)

      toast.success("Employee deactivated")

      fetchEmployees()
    } catch (error) {
      toast.error("Failed to deactivate employee")
      console.log(error)
    }
  }

  const permanentlyDeleteEmployee = async (id: string) => {
    try {
      await api.delete(`/api/employees/${id}`, { params: { mode: "permanent" } })

      toast.success("Employee permanently deleted")

      fetchEmployees()
    } catch (error) {
      console.log(error)
      if (axios.isAxiosError(error)) {
        toast.error(error.response?.data?.message || "Failed to delete employee")
      } else {
        toast.error("Something went wrong")
      }
    }
  }

  const restoreEmployee = async (id: string) => {
    try {
      await api.patch(`/api/employees/${id}/restore`)

      toast.success("Employee restored")

      fetchEmployees()
    } catch (error) {
      toast.error("Failed to restore employee")
      console.log(error)
    }
  }

  const editEmployee = async (id: string, updateInfo: UpdateInfo ) => {
    try {
      await api.put(`/api/employees/${id}`, updateInfo)

      toast.success("Employee updated successfully")

      fetchEmployees()
    } catch (error) {
      toast.error("Couldn't update employee")
      console.log(error)
    }
  }

  const toggleSelectionMode = () => {
    setSelectionMode((prev) => {
      // Leaving selection mode clears the current selection.
      if (prev) setSelectedIds(new Set())
      return !prev
    })
  }

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  // Select every employee matching the CURRENT filters (across all pages) by
  // re-fetching the list without pagination — mirrors the page's own filters.
  const selectAllMatching = async () => {
    try {
      setSelectingAll(true)

      const params: Record<string, string> = {}
      if (filters.search) params.search = filters.search
      if (filters.site) params.site = filters.site

      const res = await api.get<{ employees: Employee[] }>("/api/employees", {
        params,
      })

      const all = res.data.employees || []
      all.forEach((e) => employeeMetaRef.current.set(e._id, e))
      setSelectedIds(new Set(all.map((e) => e._id)))
    } catch (error) {
      console.log(error)
      toast.error("Failed to select all employees")
    } finally {
      setSelectingAll(false)
    }
  }

  // Run async workers over ids with a fixed concurrency cap, reporting progress.
  const runWithConcurrency = async <T,>(
    ids: string[],
    limit: number,
    worker: (id: string) => Promise<T>
  ): Promise<Array<{ id: string; value?: T; error?: unknown }>> => {
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
      setExportProgress((p) => (p ? { ...p, done: p.done + 1 } : p))
      await runNext()
    }

    await Promise.all(
      Array.from({ length: Math.min(limit, ids.length) }, () => runNext())
    )

    return results
  }

  const handleBulkExport = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) {
      toast.error("Select at least one employee")
      return
    }

    try {
      setExporting(true)
      setExportProgress({ done: 0, total: ids.length })

      const results = await runWithConcurrency(ids, 5, (id) =>
        api
          .get(`/api/attendance/employee/${id}`, {
            params: { month: exportMonth, year: exportYear },
          })
          .then((res) => (res.data.data || []) as AttendanceRecord[])
      )

      const succeeded = results.filter((r) => r && !r.error)
      const failed = results.filter((r) => r && r.error)

      if (succeeded.length === 0) {
        toast.error("Failed to fetch attendance for the selected employees")
        return
      }

      const employeesForExport = succeeded.map((r) => {
        const meta = employeeMetaRef.current.get(r.id)
        const records = (r.value || []) as AttendanceRecord[]
        const fallback = records[0]
        return {
          name: meta?.name ?? fallback?.name ?? "",
          employeeId: meta?.employeeId ?? fallback?.employeeId ?? "",
          jobTitle: meta?.jobTitle ?? fallback?.jobTitle ?? "",
          records,
        }
      })

      // Lazy-load the exporter so exceljs stays out of this route's chunk until
      // a bulk export is actually run.
      const { exportBulkTimesheets } = await import("@/lib/timesheetExport")

      await exportBulkTimesheets({
        employees: employeesForExport,
        month: exportMonth,
        year: exportYear,
        workConfig,
        sortOrder: "asc",
      })

      if (failed.length > 0) {
        toast.success(
          `Exported ${succeeded.length} timesheet(s); ${failed.length} failed`
        )
      } else {
        toast.success(`Exported ${succeeded.length} timesheet(s)`)
      }
    } catch (error) {
      console.log(error)
      toast.error("Failed to export timesheets")
    } finally {
      setExporting(false)
      setExportProgress(null)
    }
  }

  const pageIds = employees.map((e) => e._id)
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id))
  const somePageSelected = pageIds.some((id) => selectedIds.has(id))

  const togglePage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allPageSelected) {
        pageIds.forEach((id) => next.delete(id))
      } else {
        pageIds.forEach((id) => next.add(id))
      }
      return next
    })
  }

  return (
    <div className="px-6 pb-6 space-y-6">
      {/* Sticky toolbar: title + filters stay pinned while the list scrolls
          naturally with the page (no inner table scrollbar). */}
      <div className="sticky top-0 z-20 -mx-6 space-y-4 border-b bg-background px-6 pt-6 pb-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-4xl font-bold">
            Employees
          </h1>
          <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-sm font-semibold px-3 py-1 mt-1">
            Total: {totalEmployees}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={selectionMode ? "secondary" : "outline"}
            onClick={toggleSelectionMode}
          >
            <Download className="mr-2 h-4 w-4" />
            Bulk Export Timesheet
          </Button>

          {canWrite && <AddEmployee onAdd={addEmployee} />}
        </div>
      </div>

      {/* FILTER SECTION */}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        {/* SEARCH: one box matching name, employee ID and job title at once. */}
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name, ID or job title"
            value={filters.search}
            onChange={(e) =>
              setFilters({
                ...filters,
                search: e.target.value,
                page: 1,
              })
            }
          />
        </div>

        {/* SITE FILTER */}

        <Select
          value={filters.site || "all"}
          onValueChange={(value) =>
            setFilters({
              ...filters,
              site: value === "all" ? "" : value,
              page: 1,
            })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Select Site" />
          </SelectTrigger>

          <SelectContent>
            <SelectItem value="null">
              Not assigned
            </SelectItem>
            <SelectItem value="all">
              All Sites
            </SelectItem>

            {sites.map((site) => (
              <SelectItem
                key={site._id}
                value={site._id}
              >
                {site.siteName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* STATUS FILTER: active (default) / deactivated (soft-deleted) / all. */}
        <Select
          value={filters.status}
          onValueChange={(value) =>
            setFilters({
              ...filters,
              status: value as Filters["status"],
              page: 1,
            })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>

          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="deactivated">Deactivated</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* BULK EXPORT ACTION BAR */}
      {selectionMode && (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">
              {selectedIds.size} selected
            </span>

            {selectedIds.size < totalEmployees && (
              <Button
                variant="outline"
                size="sm"
                onClick={selectAllMatching}
                disabled={selectingAll || exporting}
              >
                {selectingAll && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Select all {totalEmployees}
              </Button>
            )}

            {selectedIds.size > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearSelection}
                disabled={exporting}
              >
                Clear
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* MONTH */}
            <Select value={exportMonth} onValueChange={setExportMonth}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {new Date(0, i).toLocaleString("en-IN", {
                      month: "long",
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* YEAR */}
            <Select value={exportYear} onValueChange={setExportYear}>
              <SelectTrigger className="w-[110px]">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 5 }, (_, i) => {
                  const yr = currentYear - i
                  return (
                    <SelectItem key={yr} value={String(yr)}>
                      {yr}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>

            <Button
              onClick={handleBulkExport}
              disabled={exporting || selectedIds.size === 0}
            >
              {exporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {exporting && exportProgress
                ? `Exporting ${exportProgress.done}/${exportProgress.total}`
                : `Export Selected${
                    selectedIds.size ? ` (${selectedIds.size})` : ""
                  }`}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSelectionMode}
              disabled={exporting}
              aria-label="Exit selection mode"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      </div>

      {/* TABLE */}

      <div className="border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {selectionMode && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={
                      allPageSelected
                        ? true
                        : somePageSelected
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={togglePage}
                    aria-label="Select all on this page"
                  />
                </TableHead>
              )}
              <TableHead className="w-16 hidden md:table-cell">Sl No</TableHead>
              <TableHead>Name</TableHead>

              <TableHead className="hidden md:table-cell">
                Employee ID
              </TableHead>

              <TableHead className="hidden md:table-cell">
                Job Title
              </TableHead>

              <TableHead>Current Site</TableHead>

              {canWrite && (
                <TableHead className="text-right">
                  Actions
                </TableHead>
              )}
            </TableRow>
          </TableHeader>

          <TableBody>
            {employees.length > 0 ? (
              employees.map((employee, index) => (
                <TableRow
                  key={employee._id}
                  className={`cursor-pointer hover:bg-muted/50 transition-colors ${
                    employee.isActive === false ? "opacity-60" : ""
                  }`}
                  onClick={() => navigate(`/employees/${employee._id}`)}
                >
                  {selectionMode && (
                    <TableCell
                      className="w-10"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={selectedIds.has(employee._id)}
                        onCheckedChange={() => toggleOne(employee._id)}
                        aria-label={`Select ${employee.name}`}
                      />
                    </TableCell>
                  )}
                  <TableCell className="hidden md:table-cell font-medium text-muted-foreground">
                    {(currentPage - 1) * filters.limit + index + 1}
                  </TableCell>

                  <TableCell className="whitespace-normal">
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to={`/employees/${employee._id}`} className="font-medium hover:underline">{employee.name}</Link>
                        {employee.user && (
                          <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-800/30 text-[10px] px-1.5 py-0 h-4">
                            Supervisor
                          </Badge>
                        )}
                        {employee.employmentType === 'temporary' && (
                          <Badge variant="secondary" className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/30 text-[10px] px-1.5 py-0 h-4">
                            Temporary
                          </Badge>
                        )}
                        {employee.isActive === false && (
                          <Badge variant="secondary" className="bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200/50 dark:border-rose-800/30 text-[10px] px-1.5 py-0 h-4">
                            Deactivated
                          </Badge>
                        )}
                      </div>

                      {/* Mobile-only: fold Employee ID + Job Title under the name */}
                      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground md:hidden">
                        <span>ID: {employee.employeeId}</span>
                        <span>{employee.jobTitle}</span>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="hidden md:table-cell">
                    {employee.employeeId}
                  </TableCell>

                  <TableCell className="hidden md:table-cell">
                    {employee.jobTitle}
                  </TableCell>

                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span>{employee.currentSite ? siteMap[employee.currentSite] : "Not Assigned"}</span>
                      {employee.currentJob && (
                        <span className="text-xs text-muted-foreground">{employee.currentJob.name}</span>
                      )}
                    </div>
                  </TableCell>

                  {canWrite && (
                    <TableCell className="flex flex-col items-end gap-2 sm:flex-row sm:justify-end" onClick={(e) => e.stopPropagation()}>
                      {employee.isActive === false ? (
                        /* DEACTIVATED: only offer Restore */
                        <Button
                          variant="outline"
                          onClick={() => restoreEmployee(employee._id)}
                        >
                          Restore
                        </Button>
                      ) : (
                        <>
                          {/* EDIT */}

                          <EditEmployee
                            employee={employee}
                            onSave={editEmployee}
                          />

                          {/* DELETE — deactivate (soft) or permanently delete (hard) */}

                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="destructive">
                                Delete
                              </Button>
                            </AlertDialogTrigger>

                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Delete {employee.name}?
                                </AlertDialogTitle>

                                <AlertDialogDescription>
                                  <strong>Deactivate</strong> hides the employee but
                                  keeps their record and attendance history — you can
                                  restore them later.{" "}
                                  <strong>Permanently delete</strong> removes them for
                                  good and frees their Employee ID (only possible when
                                  they have no attendance history).
                                </AlertDialogDescription>
                              </AlertDialogHeader>

                              <AlertDialogFooter className="sm:justify-between">
                                <AlertDialogCancel>
                                  Cancel
                                </AlertDialogCancel>

                                <div className="flex flex-col gap-2 sm:flex-row">
                                  <AlertDialogAction
                                    onClick={() =>
                                      removeEmployee(employee._id)
                                    }
                                  >
                                    Deactivate
                                  </AlertDialogAction>

                                  <AlertDialogAction
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    onClick={() =>
                                      permanentlyDeleteEmployee(employee._id)
                                    }
                                  >
                                    Permanently delete
                                  </AlertDialogAction>
                                </div>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={5 + (selectionMode ? 1 : 0) + (canWrite ? 1 : 0)}
                  className="text-center py-6"
                >
                  No employees found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* PAGINATION */}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          className="order-1 flex-1 sm:flex-none"
          disabled={currentPage === 1}
          onClick={() =>
            setFilters({
              ...filters,
              page: currentPage - 1,
            })
          }
        >
          Previous
        </Button>

        <div className="order-3 flex w-full items-center justify-between gap-3 sm:order-2 sm:w-auto sm:justify-normal sm:gap-4">
          <p className="text-sm whitespace-nowrap">
            Page {currentPage} of {totalPages}
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

        <Button
          variant="outline"
          className="order-2 flex-1 sm:order-3 sm:flex-none"
          disabled={currentPage === totalPages}
          onClick={() =>
            setFilters({
              ...filters,
              page: currentPage + 1,
            })
          }
        >
          Next
        </Button>
      </div>
    </div>
  )
}

export default Employees