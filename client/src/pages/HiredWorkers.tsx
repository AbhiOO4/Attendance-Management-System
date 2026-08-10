import { api } from "@/lib/api"
import toast from "react-hot-toast"
import { useEffect, useState } from "react"
import { useParams, useNavigate, useLocation } from "react-router-dom"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { useAuth } from "@/context/AuthContext"
import AddTemporaryWorker from "@/components/AddTemporaryWorker"
import axios from "axios"
import { Badge } from "@/components/ui/badge"
import { Loader2, UserPlus, ArrowLeft, Trash2, Pencil, X } from "lucide-react"

interface Employee {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
  monthlySalary: number
  currentSite: string | null
  currentJob: { _id: string; name: string } | null
  user?: string | null
  employmentType: 'permanent' | 'temporary'
  // Deferred ("from tomorrow") assignment, only surfaced in the SiteDetail context.
  scheduledSiteId?: { _id: string; siteName: string } | string | null
  scheduledJobId?: { _id: string; name: string } | string | null
  scheduledEffectiveDate?: string | null
}

interface Filters {
  name: string
  employeeId: string
  jobTitle: string
  page: number
  limit: number
}

interface Job {
  _id: string
  name: string
}

interface EmployeesResponse {
  employees: Employee[]
  currentPage: number
  totalPages: number
  totalEmployees: number
}

function HiredWorkers() {
  const { user } = useAuth()
  const { siteId } = useParams<{ siteId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const assignedSite = siteId || user?.assignedSite

  // Opened from SiteDetail (admin) → assignment actions are deferred to tomorrow and
  // pending changes are shown with a cancel option. From SiteAttendance → instant.
  const from = location.state?.from as string | undefined
  const deferred = from === "site-detail"

  // Return to whichever page opened this one. SiteDetail passes
  // state={{ from: "site-detail" }}; every other entry point (Site Attendance,
  // Add Employees) passes no state and keeps landing on Site Attendance.
  function handleBack() {
    if (location.state?.from === "site-detail" && siteId) {
      navigate(`/site/${siteId}`)
    } else {
      navigate(`/attendance/${assignedSite}`)
    }
  }

  const [filters, setFilters] = useState<Filters>({
    name: "",
    employeeId: "",
    jobTitle: "",
    page: 1,
    limit: 10,
  })

  const [employees, setEmployees] = useState<Employee[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalEmployees, setTotalEmployees] = useState(0)
  const [loadingRoster, setLoadingRoster] = useState(false)

  // Toggle filter
  const [showTempOnly, setShowTempOnly] = useState(false)

  // Jobs state
  const [jobs, setJobs] = useState<Job[]>([])
  const [updatingJobMap, setUpdatingJobMap] = useState<Record<string, boolean>>({})
  const [editingJobEmployeeId, setEditingJobEmployeeId] = useState<string | null>(null)

  // Remove worker state
  const [workerToRemove, setWorkerToRemove] = useState<Employee | null>(null)
  const [isRemoveConfirmOpen, setIsRemoveConfirmOpen] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [deleteAttendance, setDeleteAttendance] = useState(false)

  // Cancel-pending-schedule state (deferred mode only)
  const [cancelingId, setCancelingId] = useState<string | null>(null)

  // Classify a row's pending (from-tomorrow) state. Incoming = scheduled to arrive
  // tomorrow but not on the site yet; jobChange = already on the site with a pending
  // job change. Only meaningful in deferred (SiteDetail) mode.
  function pendingInfo(employee: Employee) {
    const isOnSite = employee.currentSite === assignedSite
    const hasSchedule = !!employee.scheduledEffectiveDate
    const scheduledJobName =
      employee.scheduledJobId && typeof employee.scheduledJobId === "object"
        ? employee.scheduledJobId.name
        : null
    return {
      isIncoming: deferred && hasSchedule && !isOnSite,
      hasJobChange: deferred && hasSchedule && isOnSite,
      scheduledJobName,
    }
  }

  async function cancelSchedule(employeeId: string) {
    setCancelingId(employeeId)
    try {
      await api.delete(`/api/site/${assignedSite}/employee/${employeeId}/scheduled`)
      toast.success("Scheduled change cancelled")
      fetchHiredWorkers()
    } catch (error: any) {
      console.log(error)
      toast.error(error.response?.data?.message || "Failed to cancel scheduled change")
    } finally {
      setCancelingId(null)
    }
  }

  // Roster fetching
  async function fetchHiredWorkers() {
    if (!assignedSite) return
    setLoadingRoster(true)
    try {
      const res = await api.get<EmployeesResponse>(
        "/api/employees",
        {
          params: {
            ...filters,
            // Deferred mode also surfaces incoming scheduled-adds for this site.
            ...(deferred
              ? { rosterForSite: assignedSite }
              : { site: assignedSite }),
            employmentType: showTempOnly ? "temporary" : undefined,
          },
        }
      )

      setEmployees(res.data.employees)
      setCurrentPage(res.data.currentPage)
      setTotalPages(res.data.totalPages)
      setTotalEmployees(res.data.totalEmployees)
    } catch (error) {
      console.log(error)
      setEmployees([])
    } finally {
      setLoadingRoster(false)
    }
  }

  // Site jobs fetching
  async function fetchSiteJobs() {
    if (!assignedSite) return
    try {
      const res = await api.get<Job[]>(`/api/site/${assignedSite}/Jobs`)
      setJobs(res.data)
    } catch (error) {
      console.log("Failed to fetch jobs:", error)
    }
  }

  useEffect(() => {
    fetchHiredWorkers()
  }, [filters, assignedSite, showTempOnly])

  useEffect(() => {
    fetchSiteJobs()
  }, [assignedSite])

  const addHiredWorker = async (newEmployee: any) => {
    try {
      await api.post('/api/employees', newEmployee)
      toast.success("Temporary worker added successfully")
      fetchHiredWorkers()
    } catch (error) {
      console.log(error)
      if (axios.isAxiosError(error)) {
        toast.error(
          error.response?.data?.message || "Failed to add worker"
        )
      } else {
        toast.error("Something went wrong")
      }
    }
  }

  const handleJobChange = async (employeeId: string, jobId: string) => {
    setUpdatingJobMap(prev => ({ ...prev, [employeeId]: true }))
    try {
      const targetJobId = jobId === "unassigned" ? null : jobId
      const res = await api.patch<Employee>(`/api/site/${assignedSite}/employee/${employeeId}/job`, {
        jobId: targetJobId,
        ...(deferred ? { deferred: true } : {}),
      })
      toast.success(deferred ? "Job change scheduled — starts tomorrow" : "Employee job updated successfully")
      setEmployees(prev => prev.map(emp => emp._id === employeeId ? res.data : emp))
      setEditingJobEmployeeId(null)

      // Instant job changes affect today's draft; deferred ones don't touch today.
      if (!deferred && assignedSite) {
        // Clear draft cache for this site so SiteAttendance page fetches fresh employees list
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith(`attendance_draft_${assignedSite}_`)) {
            localStorage.removeItem(key)
          }
        })
        localStorage.removeItem(`active_inline_edit_row_${assignedSite}`)
        localStorage.removeItem(`active_inline_edit_data_${assignedSite}`)
      }
    } catch (error: any) {
      console.log(error)
      toast.error(error.response?.data?.message || "Failed to update employee job")
    } finally {
      setUpdatingJobMap(prev => ({ ...prev, [employeeId]: false }))
    }
  }

  const handleRemoveWorker = async (employeeId: string) => {
    setRemovingId(employeeId)
    try {
      await api.patch(`/api/site/${assignedSite}/remove-employee`, {
        _id: employeeId,
        deleteAttendance
      })
      toast.success("Employee removed from site successfully")
      fetchHiredWorkers()
      setIsRemoveConfirmOpen(false)
      setWorkerToRemove(null)
      setDeleteAttendance(false)

      // Clear draft cache for this site so SiteAttendance page fetches fresh employees list
      if (assignedSite) {
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith(`attendance_draft_${assignedSite}_`)) {
            localStorage.removeItem(key)
          }
        })
        localStorage.removeItem(`active_inline_edit_row_${assignedSite}`)
        localStorage.removeItem(`active_inline_edit_data_${assignedSite}`)
      }
    } catch (error: any) {
      console.log(error)
      toast.error(error.response?.data?.message || "Failed to remove employee")
    } finally {
      setRemovingId(null)
    }
  }

  if (!assignedSite) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        You do not have an assigned site. Please contact an administrator.
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* HEADER SECTION */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl sm:text-4xl font-bold tracking-tight">
              Manage Employees
            </h1>
            <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-sm font-semibold px-3 py-1 mt-1">
              Total: {totalEmployees}
            </Badge>
            {deferred && (
              <Badge variant="secondary" className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/30 text-xs font-medium px-2.5 py-1 mt-1">
                Changes take effect tomorrow
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => navigate(`/attendance/${assignedSite}/insta-add`, { state: { from } })}
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Add Employees
          </Button>
          {!deferred && (
            <AddTemporaryWorker onAdd={addHiredWorker} assignedSiteId={assignedSite} />
          )}
        </div>
      </div>

      {/* FILTER SECTION */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1 w-full">
          <Input
            placeholder="Search by name"
            value={filters.name}
            onChange={(e) =>
              setFilters({
                ...filters,
                name: e.target.value,
                page: 1,
              })
            }
          />

          <Input
            placeholder="Employee ID"
            value={filters.employeeId}
            onChange={(e) =>
              setFilters({
                ...filters,
                employeeId: e.target.value,
                page: 1,
              })
            }
          />

          <Input
            placeholder="Job Title"
            value={filters.jobTitle}
            onChange={(e) =>
              setFilters({
                ...filters,
                jobTitle: e.target.value,
                page: 1,
              })
            }
          />
        </div>

        <div className="flex items-center space-x-2 bg-card border px-4 py-2.5 rounded-lg shrink-0">
          <Switch
            id="temp-only"
            checked={showTempOnly}
            onCheckedChange={(checked) => {
              setShowTempOnly(checked)
              setFilters(prev => ({ ...prev, page: 1 }))
            }}
          />
          <Label htmlFor="temp-only" className="text-sm font-medium cursor-pointer">
            Temporary Employees Only
          </Label>
        </div>
      </div>

      {/* DESKTOP TABLE */}
      <div className="hidden md:block border rounded-xl overflow-hidden bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Sl No</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Employee ID</TableHead>
              <TableHead>Job Title</TableHead>
              <TableHead>Current Job</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {loadingRoster ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                </TableCell>
              </TableRow>
            ) : employees.length > 0 ? (
              employees.map((employee, index) => {
                const { isIncoming, hasJobChange, scheduledJobName } = pendingInfo(employee)
                return (
                <TableRow
                  key={employee._id}
                  className="hover:bg-muted/50 transition-colors"
                >
                  <TableCell className="font-medium text-muted-foreground">
                    {(currentPage - 1) * filters.limit + index + 1}
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{employee.name}</span>
                      {employee.user && (
                        <Badge variant="secondary">
                          Supervisor
                        </Badge>
                      )}
                      {employee.employmentType === 'temporary' && (
                        <Badge variant="secondary" className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/30 text-[10px] px-1.5 py-0 h-4">
                          Temporary
                        </Badge>
                      )}
                      {isIncoming && (
                        <Badge variant="secondary" className="bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300 border border-sky-200/50 dark:border-sky-800/30 text-[10px] px-1.5 py-0 h-4">
                          Starting tomorrow
                        </Badge>
                      )}
                      {hasJobChange && (
                        <Badge variant="secondary" className="bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300 border border-violet-200/50 dark:border-violet-800/30 text-[10px] px-1.5 py-0 h-4">
                          Job change tomorrow
                        </Badge>
                      )}
                    </div>
                  </TableCell>

                  <TableCell>
                    {employee.employeeId}
                  </TableCell>

                  <TableCell>
                    {employee.jobTitle}
                  </TableCell>

                  <TableCell className="w-[240px]">
                    {isIncoming ? (
                      <div className="text-sm">
                        <span className="font-medium">
                          {scheduledJobName || <span className="text-muted-foreground text-xs font-normal">Unassigned</span>}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">from tomorrow</span>
                      </div>
                    ) : editingJobEmployeeId === employee._id ? (
                      <div className="flex items-center gap-1.5">
                        <Select
                          value={employee.currentJob?._id || "unassigned"}
                          onValueChange={(val) => handleJobChange(employee._id, val)}
                          disabled={updatingJobMap[employee._id]}
                        >
                          <SelectTrigger className="w-[180px] h-9 bg-background">
                            {updatingJobMap[employee._id] ? (
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin shrink-0 text-primary" />
                                <span className="text-xs">Updating...</span>
                              </div>
                            ) : (
                              <SelectValue placeholder="Select Job" />
                            )}
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">Unassigned</SelectItem>
                            {jobs.map((job) => (
                              <SelectItem key={job._id} value={job._id}>
                                {job.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
                          onClick={() => setEditingJobEmployeeId(null)}
                          disabled={updatingJobMap[employee._id]}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 group/job">
                        <span className="font-medium text-sm">
                          {employee.currentJob?.name || <span className="text-muted-foreground text-xs font-normal">Unassigned</span>}
                          {hasJobChange && (
                            <span className="block text-[11px] font-normal text-violet-600 dark:text-violet-400">
                              → {scheduledJobName || "Unassigned"} tomorrow
                            </span>
                          )}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover/job:opacity-100 transition-opacity text-muted-foreground hover:text-primary hover:bg-transparent shrink-0"
                          onClick={() => setEditingJobEmployeeId(employee._id)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </TableCell>

                  <TableCell className="text-right">
                    {isIncoming ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                        disabled={cancelingId === employee._id}
                        onClick={() => cancelSchedule(employee._id)}
                      >
                        {cancelingId === employee._id ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-1" />
                        ) : (
                          <X className="h-4 w-4 mr-1" />
                        )}
                        Cancel
                      </Button>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        {hasJobChange && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                            disabled={cancelingId === employee._id}
                            onClick={() => cancelSchedule(employee._id)}
                          >
                            {cancelingId === employee._id ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-1" />
                            ) : (
                              <X className="h-4 w-4 mr-1" />
                            )}
                            Cancel change
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10"
                          onClick={() => {
                            setWorkerToRemove(employee)
                            setIsRemoveConfirmOpen(true)
                          }}
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Remove
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
                )
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center py-6 text-muted-foreground"
                >
                  No employees found on this site
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* MOBILE LIST */}
      <div className="block md:hidden space-y-4">
        {loadingRoster ? (
          <div className="text-center py-10">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
          </div>
        ) : employees.length > 0 ? (
          employees.map((employee, index) => {
            const { isIncoming, hasJobChange, scheduledJobName } = pendingInfo(employee)
            return (
            <div
              key={employee._id}
              className="bg-card border rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-foreground text-lg">
                      {employee.name}
                    </span>
                    {employee.user && (
                      <Badge variant="secondary">
                        Supervisor
                      </Badge>
                    )}
                    {employee.employmentType === 'temporary' && (
                      <Badge variant="secondary" className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/30 text-[10px] px-1.5 py-0">
                        Temporary
                      </Badge>
                    )}
                    {isIncoming && (
                      <Badge variant="secondary" className="bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300 border border-sky-200/50 dark:border-sky-800/30 text-[10px] px-1.5 py-0">
                        Starting tomorrow
                      </Badge>
                    )}
                    {hasJobChange && (
                      <Badge variant="secondary" className="bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300 border border-violet-200/50 dark:border-violet-800/30 text-[10px] px-1.5 py-0">
                        Job change tomorrow
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">
                    ID: {employee.employeeId}
                  </p>
                </div>
                <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-1 rounded">
                  #{(currentPage - 1) * filters.limit + index + 1}
                </span>
              </div>
              
              <div className="grid grid-cols-2 gap-2 pt-3 border-t text-sm">
                <div>
                  <span className="text-xs text-muted-foreground block">Job Title</span>
                  <span className="font-medium text-foreground capitalize">{employee.jobTitle}</span>
                </div>
                <div className="col-span-2 mt-2">
                  <span className="text-xs text-muted-foreground block mb-1">
                    {isIncoming ? "Job from tomorrow" : "Current Job"}
                  </span>
                  {isIncoming ? (
                    <div className="border rounded-lg px-3 py-2 bg-card/50">
                      <span className="font-medium text-sm">
                        {scheduledJobName || <span className="text-muted-foreground text-xs font-normal">Unassigned</span>}
                      </span>
                    </div>
                  ) : editingJobEmployeeId === employee._id ? (
                    <div className="flex items-center gap-1.5">
                      <Select
                        value={employee.currentJob?._id || "unassigned"}
                        onValueChange={(val) => handleJobChange(employee._id, val)}
                        disabled={updatingJobMap[employee._id]}
                      >
                        <SelectTrigger className="w-full h-9 bg-background">
                          {updatingJobMap[employee._id] ? (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin shrink-0 text-primary" />
                              <span className="text-xs">Updating...</span>
                            </div>
                          ) : (
                            <SelectValue placeholder="Select Job" />
                          )}
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">Unassigned</SelectItem>
                          {jobs.map((job) => (
                            <SelectItem key={job._id} value={job._id}>
                              {job.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-muted-foreground hover:text-foreground shrink-0 border rounded-md bg-background"
                        onClick={() => setEditingJobEmployeeId(null)}
                        disabled={updatingJobMap[employee._id]}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between border rounded-lg px-3 py-2 bg-card/50">
                      <span className="font-medium text-sm">
                        {employee.currentJob?.name || <span className="text-muted-foreground text-xs font-normal">Unassigned</span>}
                        {hasJobChange && (
                          <span className="block text-[11px] font-normal text-violet-600 dark:text-violet-400">
                            → {scheduledJobName || "Unassigned"} tomorrow
                          </span>
                        )}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-transparent shrink-0"
                        onClick={() => setEditingJobEmployeeId(employee._id)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t flex justify-end gap-2">
                {isIncoming ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                    disabled={cancelingId === employee._id}
                    onClick={() => cancelSchedule(employee._id)}
                  >
                    {cancelingId === employee._id ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <X className="h-4 w-4 mr-1" />
                    )}
                    Cancel
                  </Button>
                ) : (
                  <>
                    {hasJobChange && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                        disabled={cancelingId === employee._id}
                        onClick={() => cancelSchedule(employee._id)}
                      >
                        {cancelingId === employee._id ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-1" />
                        ) : (
                          <X className="h-4 w-4 mr-1" />
                        )}
                        Cancel change
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        setWorkerToRemove(employee)
                        setIsRemoveConfirmOpen(true)
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      Remove
                    </Button>
                  </>
                )}
              </div>
            </div>
            )
          })
        ) : (
          <div className="text-center py-8 text-muted-foreground border rounded-xl bg-card/50">
            No employees found on this site
          </div>
        )}
      </div>

      {/* PAGINATION */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
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

        <p className="text-sm">
          Page {currentPage} of {totalPages}
        </p>

        <Button
          variant="outline"
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

      {/* REMOVE CONFIRMATION DIALOG */}
      <Dialog open={isRemoveConfirmOpen} onOpenChange={setIsRemoveConfirmOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              Confirm Removal
            </DialogTitle>
            <DialogDescription className="pt-2 text-sm text-muted-foreground leading-relaxed">
              Are you sure you want to remove <strong className="text-foreground font-semibold">{workerToRemove?.name}</strong> from this site?
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-start space-x-3 py-4 border-t border-b my-2">
            <Checkbox
              id="delete-attendance"
              checked={deleteAttendance}
              onCheckedChange={(checked) => setDeleteAttendance(!!checked)}
            />
            <div className="grid gap-1.5 leading-none">
              <Label
                htmlFor="delete-attendance"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer text-foreground"
              >
                Delete today's attendance sessions
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                Check this if the employee was assigned to this site by mistake and did not work today.
              </p>
            </div>
          </div>

          <DialogFooter className="mt-4 gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setIsRemoveConfirmOpen(false)
                setWorkerToRemove(null)
                setDeleteAttendance(false)
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={removingId !== null}
              onClick={async () => {
                if (workerToRemove) {
                  await handleRemoveWorker(workerToRemove._id)
                }
              }}
            >
              {removingId !== null ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Remove Employee
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default HiredWorkers;
