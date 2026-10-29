// Employees.tsx

import { api } from "@/lib/api"
import toast from "react-hot-toast"
import { useEffect, useMemo, useState } from "react"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

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
} from "@/components/ui/alert-dialog"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import EditEmployee from "@/components/EditEmployee"
import AddEmployee from "@/components/AddEmployee"
import axios from "axios"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/context/AuthContext"
import { MoreHorizontal, Pencil, RotateCcw, Search, Trash2 } from "lucide-react"
import { isDriverTitle } from "@/lib/driverJobs"
import HelpButton from "@/components/help/HelpButton"

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
  companyId?: string | null
  isActive?: boolean
  // Drivers only (no site of their own): the site their latest Drivers Attendance session
  // served — "General" for global jobs; null when they've never been marked.
  driverSite?: { siteId: string | null; siteName: string } | null
}


interface Filters {
  // One combined search box matching name, employee ID and job title at once.
  search: string
  site: string
  // Which lifecycle bucket to list: active (default), soft-deleted, or both.
  status: "active" | "deactivated" | "all"
  // "" = all employment types; otherwise restrict to permanent or temporary.
  employmentType: "" | "permanent" | "temporary"
  page: number
  // Rows per page; ALL_ROWS (0) = no pagination, every matching employee on one page.
  limit: number
}

const ALL_ROWS = 0

interface Site {
  _id: string
  siteName: string
}

interface EmployeesResponse {
  employees: Employee[]
  // Only sent when the request is paginated (page + limit both given).
  currentPage?: number
  totalPages?: number
  totalEmployees: number
}

type NewEmployee = {
  name: string
  employeeId: string
  jobTitle: string
  employmentType: 'permanent' | 'temporary'
  nationality: 'foreign' | 'omani'
  companyId?: string | null
}

type UpdateInfo = {
  name: string
  employeeId: string
  jobTitle: string
  employmentType: 'permanent' | 'temporary'
  nationality: 'foreign' | 'omani'
  companyId?: string | null
}


// Per-row action menu. Kept as its own component so each row owns the open state
// of its Edit / Delete dialogs. Deactivated rows only offer Restore.
// The dialogs are rendered as siblings of the menu (not nested inside the dropdown
// content) and driven in controlled mode, so opening one from a menu item is clean.
function EmployeeRowActions({
  employee,
  onEdit,
  onRemove,
  onPermanentlyDelete,
  onRestore,
}: {
  employee: Employee
  onEdit: (id: string, updateInfo: UpdateInfo) => Promise<boolean>
  onRemove: (id: string) => void
  onPermanentlyDelete: (id: string) => void
  onRestore: (id: string) => void
}) {
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  if (employee.isActive === false) {
    return (
      <Button variant="outline" size="sm" onClick={() => onRestore(employee._id)}>
        Restore
      </Button>
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Employee actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" />
            Edit
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* EDIT — controlled, triggerless */}
      <EditEmployee
        employee={employee}
        onSave={onEdit}
        open={editOpen}
        onOpenChange={setEditOpen}
        hideTrigger
      />

      {/* DELETE — deactivate (soft) or permanently delete (hard) */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {employee.name}?
            </AlertDialogTitle>

            <AlertDialogDescription>
              <strong>Deactivate</strong> hides the employee but keeps their
              record and attendance history — you can restore them later.{" "}
              <strong>Permanently delete</strong> removes them for good and frees
              their Employee ID (only possible when they have no attendance
              history).
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className="sm:justify-between">
            <AlertDialogCancel>Cancel</AlertDialogCancel>

            <div className="flex flex-col gap-2 sm:flex-row">
              <AlertDialogAction onClick={() => onRemove(employee._id)}>
                Deactivate
              </AlertDialogAction>

              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => onPermanentlyDelete(employee._id)}
              >
                Permanently delete
              </AlertDialogAction>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function Employees() {
  const navigate = useNavigate()

  // Filters live in the URL query string, so opening an employee and coming back
  // (Back / browser back) restores them, while the sidebar's bare /employees link
  // resets them. Writes replace the history entry so typing doesn't stack entries.
  const [searchParams, setSearchParams] = useSearchParams()
  const paramsKey = searchParams.toString()
  const filters = useMemo<Filters>(() => {
    const status = searchParams.get("status")
    const employmentType = searchParams.get("employmentType")
    const page = Number(searchParams.get("page"))
    const limit = searchParams.get("limit")
    return {
      search: searchParams.get("search") ?? "",
      site: searchParams.get("site") ?? "",
      status:
        status === "deactivated" || status === "all" ? status : "active",
      employmentType:
        employmentType === "permanent" || employmentType === "temporary"
          ? employmentType
          : "",
      page: Number.isInteger(page) && page > 0 ? page : 1,
      limit:
        limit !== null && [10, 25, 50, 100, ALL_ROWS].includes(Number(limit))
          ? Number(limit)
          : 10,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey])

  // Only non-default values go in the URL, keeping it short and readable.
  const setFilters = (next: Filters) => {
    const params = new URLSearchParams()
    if (next.search) params.set("search", next.search)
    if (next.site) params.set("site", next.site)
    if (next.status !== "active") params.set("status", next.status)
    if (next.employmentType) params.set("employmentType", next.employmentType)
    if (next.page !== 1) params.set("page", String(next.page))
    if (next.limit !== 10) params.set("limit", String(next.limit))
    setSearchParams(params, { replace: true })
  }

  const [employees, setEmployees] = useState<Employee[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [siteMap, setSiteMap] = useState<Record<string, string>>({})


  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalEmployees, setTotalEmployees] = useState(0)

  // Supervisors no longer reach this page (they use Timesheets); admins + superadmins write.
  const { user } = useAuth()
  const canWrite = user?.role === "admin" || user?.role === "superadmin"

  async function fetchEmployees() {
    try {
      // "All" omits page + limit, which the API treats as "return everything".
      const params: Partial<Filters> = { ...filters }
      if (filters.limit === ALL_ROWS) {
        delete params.page
        delete params.limit
      }

      const res = await api.get<EmployeesResponse>(
        "/api/employees",
        {
          params,
        }
      )

      setEmployees(res.data.employees)

      setCurrentPage(res.data.currentPage ?? 1)

      setTotalPages(res.data.totalPages ?? 1)

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
      return true
    }catch(error){
      console.log(error)
      if (axios.isAxiosError(error)) {
      toast.error(
        error.response?.data?.message || "Failed to add employee"
      )
    } else {
      toast.error("Something went wrong")
    }
      return false
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
      return true
    } catch (error) {
      // Surface the server's reason (e.g. a duplicate Employee/Company ID).
      toast.error(
        (axios.isAxiosError(error) && error.response?.data?.message) ||
          "Couldn't update employee"
      )
      console.log(error)
      return false
    }
  }

  const filtersActive =
    filters.search !== "" ||
    filters.site !== "" ||
    filters.status !== "active" ||
    filters.employmentType !== ""

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
          <HelpButton topic="employees" />
          <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-sm font-semibold px-3 py-1 mt-1">
            Total: {totalEmployees}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {canWrite && <AddEmployee onAdd={addEmployee} />}
        </div>
      </div>

      {/* FILTER SECTION: one row on desktop (search grows, selects keep fixed
          widths); search above three equal selects on tablet; stacked on mobile. */}

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        {/* SEARCH: one box matching name, employee ID and job title at once. */}
        <div className="relative md:max-w-md md:flex-1">
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 md:flex md:items-center md:gap-2">
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
          <SelectTrigger className="w-full md:w-[200px]" aria-label="Site">
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
          <SelectTrigger className="w-full md:w-[150px]" aria-label="Status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>

          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="deactivated">Deactivated</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>

        {/* EMPLOYMENT-TYPE FILTER: all / permanent / temporary. */}
        <Select
          value={filters.employmentType || "all"}
          onValueChange={(value) =>
            setFilters({
              ...filters,
              employmentType:
                value === "all" ? "" : (value as "permanent" | "temporary"),
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
        </div>

        {/* CLEAR: back to the defaults (keeps the page size). */}
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
                status: "active",
                employmentType: "",
                page: 1,
              })
            }
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            Clear
          </Button>
        )}
      </div>

      </div>

      {/* TABLE */}

      <div className="border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16 hidden md:table-cell">Sl No</TableHead>
              <TableHead>Name</TableHead>

              <TableHead className="hidden md:table-cell">
                Employee ID
              </TableHead>

              <TableHead className="hidden md:table-cell">
                Company ID
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
                        {employee.companyId && (
                          <span>Company ID: {employee.companyId}</span>
                        )}
                        <span>{employee.jobTitle}</span>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="hidden md:table-cell">
                    {employee.employeeId}
                  </TableCell>

                  <TableCell className="hidden md:table-cell">
                    {employee.companyId || (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  <TableCell className="hidden md:table-cell">
                    {employee.jobTitle}
                  </TableCell>

                  <TableCell>
                    {isDriverTitle(employee.jobTitle) ? (
                      // Drivers live on Drivers Attendance: their site is the one their latest
                      // session served. No job — a driver's hours split across that site's jobs.
                      <div className="flex flex-col gap-0.5">
                        <span className={employee.driverSite ? "" : "text-muted-foreground"}>
                          {employee.driverSite?.siteName ?? "Not marked yet"}
                        </span>
                        <span className="text-xs text-muted-foreground">Drivers</span>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        <span>{employee.currentSite ? siteMap[employee.currentSite] : "Not Assigned"}</span>
                        {employee.currentJob && (
                          <span className="text-xs text-muted-foreground">{employee.currentJob.name}</span>
                        )}
                      </div>
                    )}
                  </TableCell>

                  {canWrite && (
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <EmployeeRowActions
                        employee={employee}
                        onEdit={editEmployee}
                        onRemove={removeEmployee}
                        onPermanentlyDelete={permanentlyDeleteEmployee}
                        onRestore={restoreEmployee}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={6 + (canWrite ? 1 : 0)}
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
                <SelectItem value={String(ALL_ROWS)}>All</SelectItem>
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