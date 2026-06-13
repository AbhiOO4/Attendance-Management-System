import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import {
  Search,
  Plus,
  MapPin,
  ArrowLeft,
  Trash2,
  Loader2,
} from "lucide-react"

import {
  Briefcase,
  Clock3,
  Users,
  CalendarDays,
} from "lucide-react"

import toast from "react-hot-toast"

import { useNavigate, useLocation } from "react-router-dom"

import { api } from "@/lib/api"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// add these imports

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

interface Employee {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
  monthlySalary: number
  currentSite: string | null
  currentJob: { _id: string; name: string } | string | null
  user?: string | null
}

interface Filters {
  name: string
  employeeId: string
}

interface SupervisorFilters extends Filters {
  notSupervisor: false
}

interface EmployeesResponse {
  employees: Employee[]
  currentPage: number
  totalPages: number
  totalEmployees: number
}

interface Site {
  _id: string
  siteName: string
  locationDetails: string
  isActive: boolean
  jobs: string[]
  isPermanent?: boolean
  isCompleted?: boolean
}

interface Job {
  _id: string
  name: string
  jobCode: string
  employeeCount: number,
  totalManHours: number,
  totalManDays: number,
  totalCalendarDays: number,
  isActive: boolean
  isCompleted?: boolean
}

interface SiteStats {
  siteId: string
  totalManHours: number
  totalManDays: number
  totalCalendarDays: number
}

function SiteDetail() {
  const { id } = useParams()

  const [site, setSite] = useState<Site | null>(null)

  const [employees, setEmployees] = useState<Employee[]>([])

  const [supervisors, setSupervisors] = useState<Employee[]>([])

  const [loadingEmployees, setLoadingEmployees] = useState(false)

  const [loadingSupervisors, setLoadingSupervisors] = useState(false)

  const [filters, setFilters] = useState<Filters>({ name: "", employeeId: "", })

  const [supervisorFilters, setSupervisorFilters] = useState<SupervisorFilters>({ name: "", employeeId: "", notSupervisor: false })


  const [deactivateOpen, setDeactivateOpen] = useState(false)

  const [deactivating, setDeactivating] = useState(false)


  //jobs

  const navigate = useNavigate()
  const location = useLocation()

  const [jobs, setJobs] = useState<Job[]>([])

  const [loadingJobs, setLoadingJobs] = useState(false)

  const [jobDialogOpen, setJobDialogOpen] = useState(false)

  const [creatingJob, setCreatingJob] = useState(false)

  const [jobForm, setJobForm] = useState({
    name: "",
    jobCode: "",
  })

  const [jobErrors, setJobErrors] = useState({
    name: "",
    jobCode: "",
    general: "",
  })

  const [reactivating, setReactivating] = useState(false)

  // Delete Site states
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deletingSite, setDeletingSite] = useState(false)

  // Delete Job states
  const [confirmDeleteJobOpen, setConfirmDeleteJobOpen] = useState(false)
  const [jobToDelete, setJobToDelete] = useState<Job | null>(null)
  const [deletingJob, setDeletingJob] = useState(false)

  // Edit Location state
  const [isEditingLocation, setIsEditingLocation] = useState(false)
  const [editedLocationDetails, setEditedLocationDetails] = useState("")
  const [savingLocation, setSavingLocation] = useState(false)

  const isSiteActive = site?.isActive

  // inline job-change state
  const [updatingJobFor, setUpdatingJobFor] = useState<string | null>(null)

  const [siteStats, setSiteStats] =
    useState<SiteStats | null>(null)

  const [loadingSiteStats, setLoadingSiteStats] =
    useState(false)

  async function fetchSiteStats() {
    try {
      setLoadingSiteStats(true)

      const res = await api.get(
        `/api/site/${id}/site-data`
      )

      setSiteStats(res.data)
    } catch (error) {
      console.log(error)

      setSiteStats(null)
    } finally {
      setLoadingSiteStats(false)
    }
  }

  async function fetchJobs(showLoading = false) {
    try {
      if (showLoading || jobs.length === 0) {
        setLoadingJobs(true)
      }

      const res = await api.get(
        `/api/site/${id}/Jobs`
      )

      setJobs(res.data)
    } catch (error) {
      console.log(error)

      setJobs([])
    } finally {
      setLoadingJobs(false)
    }
  }

  async function updateEmployeeJob(employee: Employee, newJobId: string | null) {
    try {
      setUpdatingJobFor(employee._id)
      const currentSiteId = typeof employee.currentSite === "object" && employee.currentSite !== null
        ? (employee.currentSite as any)._id
        : employee.currentSite
      await api.put(`/api/employees/${employee._id}`, {
        name: employee.name,
        employeeId: employee.employeeId,
        jobTitle: employee.jobTitle,
        monthlySalary: employee.monthlySalary,
        currentSite: currentSiteId || null,
        currentJob: newJobId,
      })
      toast.success("Job updated")
      fetchEmployees()
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to update job")
    } finally {
      setUpdatingJobFor(null)
    }
  }

  async function fetchSite() {
    try {
      const res = await api.get(`/api/site/${id}`)

      setSite(res.data)
    } catch (error) {
      console.log(error)
    }
  }

  async function fetchEmployees() {
    try {
      setLoadingEmployees(true)

      const res = await api.get<EmployeesResponse>(
        "/api/employees",
        {
          params: {
            ...filters,
            site: id,
          },
        }
      )

      setEmployees(res.data.employees)
    } catch (error) {
      console.log(error)

      setEmployees([])
    } finally {
      setLoadingEmployees(false)
    }
  }

  async function fetchSupervisors() {
    try {
      setLoadingSupervisors(true)

      const res = await api.get<EmployeesResponse>(
        "/api/employees/Supervisors",
        {
          params: {
            ...supervisorFilters,
            site: id,
          },
        }
      )

      setSupervisors(res.data.employees)
    } catch (error) {
      console.log(error)

      setSupervisors([])
    } finally {
      setLoadingSupervisors(false)
    }
  }

  function validateJobForm() {
    const errors = {
      name: "",
      jobCode: "",
      general: "",
    }

    let valid = true

    if (!jobForm.name.trim()) {
      errors.name = "Job name is required"
      valid = false
    }

    if (!jobForm.jobCode.trim()) {
      errors.jobCode = "Job code is required"
      valid = false
    }

    setJobErrors(errors)

    return valid
  }

  async function createJob() {
    try {
      const isValid = validateJobForm()

      if (!isValid) return

      setCreatingJob(true)

      await api.post(
        `/api/site/${id}/add-job`,
        {
          name: jobForm.name.trim(),
          jobCode: jobForm.jobCode.trim(),
        }
      )

      setJobForm({
        name: "",
        jobCode: "",
      })

      setJobErrors({
        name: "",
        jobCode: "",
        general: "",
      })

      setJobDialogOpen(false)

      fetchJobs(true)
    } catch (error: any) {
      console.log(error)

      setJobErrors((prev) => ({
        ...prev,
        general:
          error?.response?.data?.message ||
          "Failed to create job",
      }))
    } finally {
      setCreatingJob(false)
    }
  }

  useEffect(() => {
    if (!id) return

    fetchSite()
    fetchSiteStats()
  }, [id])

  useEffect(() => {
    if (id) {
      fetchJobs(true)
    }
  }, [id])

  useEffect(() => {
    const timeout = setTimeout(() => {
      fetchEmployees()
    }, 400)

    return () => clearTimeout(timeout)
  }, [filters, id])

  useEffect(() => {
    const timeout = setTimeout(() => {
      fetchSupervisors()
    }, 400)

    return () => clearTimeout(timeout)
  }, [supervisorFilters, id])

  // add this function inside component

  async function deactivateSite() {
    try {
      setDeactivating(true)

      await api.patch(
        `/api/site/deactivate/${id}`
      )

      await fetchSite()

      setDeactivateOpen(false)
    } catch (error) {
      console.log(error)
    } finally {
      setDeactivating(false)
    }
  }

  async function reactivateSite() {
    try {
      setReactivating(true)

      await api.patch(
        `/api/site/reactivate/${id}`
      )

      await fetchSite()
    } catch (error) {
      console.log(error)
    } finally {
      setReactivating(false)
    }
  }

  async function handleSaveLocation() {
    if (!site) return
    try {
      setSavingLocation(true)
      await api.patch(`/api/site/${site._id}`, {
        locationDetails: editedLocationDetails.trim()
      })
      toast.success("Location details updated successfully")
      setIsEditingLocation(false)
      fetchSite()
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to update location details")
    } finally {
      setSavingLocation(false)
    }
  }

  async function handleDeleteSite() {
    try {
      setDeletingSite(true)
      await api.delete(`/api/site/${id}`)
      toast.success("Site soft-deleted successfully")
      setConfirmDeleteOpen(false)
      navigate("/site")
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to delete site")
    } finally {
      setDeletingSite(false)
    }
  }

  async function handleDeleteJob() {
    if (!jobToDelete) return
    try {
      setDeletingJob(true)
      await api.delete(`/api/site/job/${jobToDelete._id}`)
      toast.success("Job soft-deleted successfully")
      setConfirmDeleteJobOpen(false)
      setJobToDelete(null)
      fetchJobs(true)
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to delete job")
    } finally {
      setDeletingJob(false)
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 p-6">

      <div className="mx-auto max-w-7xl space-y-8">

        <div
          onClick={() => {
            if (location.state?.from === "dashboard") {
              navigate(-1)
            } else {
              navigate("/site")
            }
          }}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground cursor-pointer"
        >
          <Button variant="outline" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <span>Back</span>
        </div>
        {/* Site Header */}

        <Card className="rounded-3xl border bg-card p-8 shadow-sm">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-4xl font-bold tracking-tight">
                  {site?.siteName || "Site"}
                </h1>

                <div
                  className={`rounded-full px-3 py-1 text-xs font-medium ${site?.isActive
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-700"
                    }`}
                >
                  {site?.isActive
                    ? "Active"
                    : "Inactive"}
                </div>

                {site?.isCompleted && (
                  <div className="rounded-full px-3 py-1 text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                    Completed
                  </div>
                )}

                {site?.isPermanent && (
                  <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 font-medium">
                    Permanent Home Site
                  </Badge>
                )}
              </div>

              <div className="mt-2 flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <p>{site?.locationDetails}</p>
              </div>

                {site?.isPermanent ? (
                  <div className="mt-6 grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl bg-primary/5 border border-primary/10 p-5 flex items-center gap-4">
                      <div className="p-3 rounded-xl bg-primary/10 text-primary">
                        <Users className="h-6 w-6" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Currently Assigned Employees</div>
                        <p className="mt-1 text-3xl font-bold text-foreground">
                          {loadingEmployees ? "--" : employees.length}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-2xl bg-muted/50 border border-border p-5 flex items-center gap-4">
                      <div className="p-3 rounded-xl bg-muted text-muted-foreground">
                        <Briefcase className="h-6 w-6" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active Jobs</div>
                        <p className="mt-1 text-3xl font-bold text-foreground">
                          {loadingJobs ? "--" : jobs.length}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-6 grid gap-4 md:grid-cols-3">
                    <div className="rounded-2xl bg-muted/50 p-4">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Clock3 className="h-4 w-4" />

                        <span className="text-sm">
                          Total Man Hours
                        </span>
                      </div>

                      <p className="mt-2 text-2xl font-bold">
                        {loadingSiteStats
                          ? "--"
                          : siteStats?.totalManHours ?? 0}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-muted/50 p-4">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Users className="h-4 w-4" />

                        <span className="text-sm">
                          Total Man Days
                        </span>
                      </div>

                      <p className="mt-2 text-2xl font-bold">
                        {loadingSiteStats
                          ? "--"
                          : siteStats?.totalManDays ?? 0}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-muted/50 p-4">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <CalendarDays className="h-4 w-4" />

                        <span className="text-sm">
                          Calendar Days
                        </span>
                      </div>

                      <p className="mt-2 text-2xl font-bold">
                        {loadingSiteStats
                          ? "--"
                          : siteStats?.totalCalendarDays ?? 0}
                      </p>
                    </div>
                  </div>
                )}
              </div>

          <div className="flex flex-wrap items-center gap-2">
            {isSiteActive && (
              <>
                <Button
                  variant="outline"
                  className="rounded-xl border border-muted-foreground/30"
                  onClick={() => {
                    if (site) {
                      setEditedLocationDetails(site.locationDetails)
                      setIsEditingLocation(true)
                    }
                  }}
                >
                  Edit Location
                </Button>

                {!site?.isPermanent && (
                <Button
                  variant="outline"
                  className={`rounded-xl border transition-all ${
                    site?.isCompleted
                      ? "bg-indigo-500 hover:bg-indigo-600 text-white border-indigo-600 dark:bg-indigo-600 dark:hover:bg-indigo-700"
                      : "hover:bg-accent border-muted-foreground/20 text-muted-foreground"
                  }`}
                  onClick={async () => {
                    if (!site) return
                    try {
                      const updatedStatus = !site.isCompleted
                      await api.patch(`/api/site/${site._id}`, { isCompleted: updatedStatus })
                      toast.success(`Site marked as ${updatedStatus ? 'completed' : 'incomplete'}`)
                      fetchSite()
                    } catch (error: any) {
                      toast.error(error?.response?.data?.message || "Failed to update site status")
                    }
                  }}
                >
                  {site?.isCompleted ? "Reopen Site" : "Complete Site"}
                </Button>
                )}
              </>
            )}

            {!site?.isPermanent && (
              isSiteActive ? (
                <Dialog
                  open={deactivateOpen}
                  onOpenChange={setDeactivateOpen}
                >
                  <DialogTrigger asChild>
                    <Button
                      variant="destructive"
                      className="rounded-xl"
                    >
                      Deactivate Site
                    </Button>
                  </DialogTrigger>

                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle className="text-2xl">
                        Deactivate Site?
                      </DialogTitle>

                      <DialogDescription className="pt-3 text-base leading-relaxed">
                        All employees and supervisors
                        associated with this site will be
                        removed from the site upon
                        deactivation.

                        <br />
                        <br />

                        Jobs under this site will also
                        become inactive.
                      </DialogDescription>
                    </DialogHeader>

                    <DialogFooter className="mt-4 flex-col gap-3 sm:flex-row">
                      <Button
                        variant="outline"
                        onClick={() =>
                          setDeactivateOpen(false)
                        }
                      >
                        Cancel
                      </Button>

                      <Button
                        variant="destructive"
                        disabled={deactivating}
                        onClick={deactivateSite}
                      >
                        {deactivating
                          ? "Deactivating..."
                          : "Deactivate Site"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              ) : (
                <Button
                  className="rounded-xl"
                  disabled={reactivating}
                  onClick={reactivateSite}
                >
                  {reactivating
                    ? "Reactivating..."
                    : "Re-Activate Site"}
                </Button>
              )
            )}
            {!site?.isPermanent && (
              <Button
                variant="destructive"
                className="rounded-xl"
                onClick={() => setConfirmDeleteOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Site
              </Button>
            )}
          </div>
        </div>
      </Card>

        {/* Supervisors Section */}

        <Card className="rounded-3xl border bg-card p-8 shadow-sm">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <h2 className="text-3xl font-bold">
              Supervisors
            </h2>

            {isSiteActive ? (
              <Link
                to={`/site/${id}/manage-employees`}
              >
                <Button className="rounded-xl">
                  <Plus className="mr-2 h-4 w-4" />
                  Manage Employees
                </Button>
              </Link>
            ) : (
              <Button
                disabled
                className="rounded-xl"
              >
                <Plus className="mr-2 h-4 w-4" />
                Manage Employees
              </Button>
            )}
          </div>

          <div className="mb-6 grid gap-4 md:grid-cols-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

              <Input
                placeholder="Search by name..."
                className="pl-10"
                value={supervisorFilters.name}
                onChange={(e) =>
                  setSupervisorFilters((prev) => ({
                    ...prev,
                    name: e.target.value,
                  }))
                }
              />
            </div>

            <Input
              placeholder="Search by employee ID..."
              value={supervisorFilters.employeeId}
              onChange={(e) =>
                setSupervisorFilters((prev) => ({
                  ...prev,
                  employeeId: e.target.value,
                }))
              }
            />
          </div>

          <div className="overflow-hidden rounded-2xl border">
            <Table wrapperClassName="h-[350px] overflow-y-auto">
              <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>Sl No</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Employee ID</TableHead>
                    <TableHead>Job Title</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {loadingSupervisors ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="h-24 text-center"
                      >
                        Loading supervisors...
                      </TableCell>
                    </TableRow>
                  ) : supervisors.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No supervisors found
                      </TableCell>
                    </TableRow>
                  ) : (
                    supervisors.map((employee, index) => (
                      <TableRow key={employee._id}>
                        <TableCell>
                          {index + 1}
                        </TableCell>

                        <TableCell className="font-medium">
                          {employee.name}
                        </TableCell>

                        <TableCell>
                          {employee.employeeId}
                        </TableCell>

                        <TableCell>
                          {employee.jobTitle}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
          </div>
        </Card>

        {/* Employees Section */}

        <Card className="rounded-3xl border bg-card p-8 shadow-sm">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <h2 className="text-3xl font-bold">
              Employees
            </h2>

            {isSiteActive ? (
              <Link
                to={`/site/${id}/manage-employees`}
              >
                <Button className="rounded-xl">
                  <Plus className="mr-2 h-4 w-4" />
                  Manage Employees
                </Button>
              </Link>
            ) : (
              <Button
                disabled
                className="rounded-xl"
              >
                <Plus className="mr-2 h-4 w-4" />
                Manage Employees
              </Button>
            )}
          </div>

          <div className="mb-6 grid gap-4 md:grid-cols-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

              <Input
                placeholder="Search by name..."
                className="pl-10"
                value={filters.name}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    name: e.target.value,
                  }))
                }
              />
            </div>

            <Input
              placeholder="Search by employee ID..."
              value={filters.employeeId}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  employeeId: e.target.value,
                }))
              }
            />
          </div>

          <div className="overflow-hidden rounded-2xl border">
            <Table wrapperClassName="h-[400px] overflow-y-auto">
              <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>Sl No</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Employee ID</TableHead>
                    <TableHead>Job Title</TableHead>
                    <TableHead>Current Job</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {loadingEmployees ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="h-24 text-center"
                      >
                        Loading employees...
                      </TableCell>
                    </TableRow>
                  ) : employees.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No employees found
                      </TableCell>
                    </TableRow>
                  ) : (
                    employees.map((employee, index) => (
                      <TableRow key={employee._id}>
                        <TableCell>
                          {index + 1}
                        </TableCell>

                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <span>{employee.name}</span>
                            {employee.user && (
                              <Badge variant="secondary" className="bg-secondary/80 text-secondary-foreground text-[10px] font-medium py-0 px-1.5 h-4">
                                Supervisor
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

                        <TableCell className="min-w-[160px]">
                          {updatingJobFor === employee._id ? (
                            <div className="flex items-center gap-2 text-muted-foreground text-sm">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Updating...
                            </div>
                          ) : (
                            <Select
                              value={
                                typeof employee.currentJob === "object" && employee.currentJob !== null
                                  ? employee.currentJob._id
                                  : employee.currentJob ?? "none"
                              }
                              onValueChange={(val) =>
                                updateEmployeeJob(employee, val === "none" ? null : val)
                              }
                            >
                              <SelectTrigger className="h-8 text-sm w-full">
                                <SelectValue placeholder="No Job" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">— Not Assigned —</SelectItem>
                                {jobs.map((job) => (
                                  <SelectItem key={job._id} value={job._id}>
                                    {job.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
          </div>
        </Card>


        {/* Jobs Section */}

        <Card className="rounded-3xl border bg-card p-8 shadow-sm">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <Briefcase className="h-8 w-8" />

              <h2 className="text-3xl font-bold">
                Jobs
              </h2>
            </div>

            <Dialog
              open={jobDialogOpen}
              onOpenChange={setJobDialogOpen}
            >
              <DialogTrigger asChild>
                <Button className="rounded-xl" disabled={!isSiteActive}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Job
                </Button>
              </DialogTrigger>

              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="text-2xl">
                    Create New Job
                  </DialogTitle>

                  <DialogDescription>
                    Add a new job under this site.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-5 py-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Job Name
                    </label>

                    <Input
                      placeholder="Enter job name"
                      value={jobForm.name}
                      onChange={(e) =>
                        setJobForm((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                    />

                    {jobErrors.name && (
                      <p className="text-sm text-red-500">
                        {jobErrors.name}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Job Code
                    </label>

                    <Input
                      placeholder="Enter job code"
                      value={jobForm.jobCode}
                      onChange={(e) =>
                        setJobForm((prev) => ({
                          ...prev,
                          jobCode: e.target.value,
                        }))
                      }
                    />

                    {jobErrors.jobCode && (
                      <p className="text-sm text-red-500">
                        {jobErrors.jobCode}
                      </p>
                    )}
                  </div>

                  {jobErrors.general && (
                    <p className="text-sm text-red-500">
                      {jobErrors.general}
                    </p>
                  )}
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setJobDialogOpen(false)
                    }
                  >
                    Cancel
                  </Button>

                  <Button
                    disabled={creatingJob}
                    onClick={createJob}
                  >
                    {creatingJob
                      ? "Creating..."
                      : "Create Job"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {loadingJobs ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              Loading jobs...
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-3 text-center">
              <Briefcase className="h-10 w-10 text-muted-foreground" />

              <div>
                <p className="font-medium">
                  No jobs found
                </p>

                <p className="text-sm text-muted-foreground">
                  Create your first job for this site.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {jobs.map((job) => (
                <div
                  key={job._id}
                  onClick={() =>
                    navigate(`/site/job/${job._id}`)
                  }
                  className="cursor-pointer rounded-3xl border bg-background p-6 transition hover:-translate-y-1 hover:shadow-md"
                >
                  <div className="mb-5 flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-xl font-semibold">
                          {job.name}
                        </h3>

                        <div
                          className={`rounded-full px-2 py-1 text-[10px] font-medium ${job.isActive
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                            }`}
                        >
                          {job.isActive
                            ? "Active"
                            : "Inactive"}
                        </div>

                        {job.isCompleted && (
                          <div className="rounded-full px-2 py-1 text-[10px] font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                            Completed
                          </div>
                        )}
                      </div>

                      <p className="mt-1 text-sm text-muted-foreground">
                        {job.jobCode}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {isSiteActive && job.isActive && (
                        <Button
                          variant="outline"
                          size="sm"
                          className={`rounded-lg h-7 px-2 text-xs font-medium border transition-all ${
                            job.isCompleted
                              ? "bg-indigo-500 hover:bg-indigo-600 text-white border-indigo-600 dark:bg-indigo-600 dark:hover:bg-indigo-700"
                              : "hover:bg-accent border-muted-foreground/20 text-muted-foreground"
                          }`}
                          onClick={async (e) => {
                            e.stopPropagation()
                            try {
                              await api.patch(`/api/site/job/${job._id}/toggle-completed`)
                              toast.success(`Job marked as ${!job.isCompleted ? 'completed' : 'incomplete'}`)
                              fetchJobs(false)
                            } catch (error: any) {
                              toast.error(error?.response?.data?.message || "Failed to update job status")
                            }
                          }}
                        >
                          {job.isCompleted ? "Reopen" : "Complete"}
                        </Button>
                      )}

                      <Button
                        variant="destructive"
                        size="icon-xs"
                        className="rounded-lg h-7 w-7 p-0 flex items-center justify-center"
                        onClick={(e) => {
                          e.stopPropagation()
                          setJobToDelete(job)
                          setConfirmDeleteJobOpen(true)
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <Briefcase className="h-6 w-6 text-muted-foreground" />
                    </div>
                  </div>

                  <div className="space-y-4">

                    <div className="flex items-center justify-between rounded-2xl bg-muted/50 p-3">
                      <div className="flex items-center gap-2">
                        <Clock3 className="h-4 w-4" />

                        <span className="text-sm">
                          Man Hours
                        </span>
                      </div>

                      <span className="font-semibold">
                        {job.totalManHours}
                      </span>
                    </div>

                    <div className="flex items-center justify-between rounded-2xl bg-muted/50 p-3">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4" />

                        <span className="text-sm">
                          Man Days
                        </span>
                      </div>

                      <span className="font-semibold">
                        {job.totalManDays}
                      </span>
                    </div>

                    <div className="flex items-center justify-between rounded-2xl bg-muted/50 p-3">
                      <div className="flex items-center gap-2">
                        <CalendarDays className="h-4 w-4" />

                        <span className="text-sm">
                          Calendar Days
                        </span>
                      </div>

                      <span className="font-semibold">
                        {job.totalCalendarDays}
                      </span>
                    </div>

                    <div className="flex items-center justify-between rounded-2xl bg-muted/50 p-3">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4" />

                        <span className="text-sm">
                          Employees
                        </span>
                      </div>

                      <span className="font-semibold">
                        {job.employeeCount}
                      </span>
                    </div>

                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Delete Site Dialog */}
      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-destructive flex items-center gap-2">
              <Trash2 className="h-5 w-5" />
              Delete Site?
            </DialogTitle>
            <DialogDescription className="pt-2 text-base">
              Are you sure you want to delete <strong>{site?.siteName}</strong>?
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 rounded-xl border bg-destructive/5 border-destructive/10 p-4 text-sm text-destructive space-y-2">
            <p className="font-semibold">This action is permanent for the active roster:</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>All associated jobs will be soft-deleted.</li>
              <li>All assigned employees will have their site/job assignments cleared.</li>
              <li>Any assigned supervisor will have their site assignment cleared.</li>
              {site?.isPermanent && (
                <li className="font-bold underline text-red-600">WARNING: This is a Permanent Home Site!</li>
              )}
            </ul>
          </div>

          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              disabled={deletingSite}
              onClick={() => setConfirmDeleteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deletingSite}
              onClick={handleDeleteSite}
            >
              {deletingSite ? "Deleting..." : "Confirm Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Job Dialog */}
      <Dialog open={confirmDeleteJobOpen} onOpenChange={setConfirmDeleteJobOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-destructive flex items-center gap-2">
              <Trash2 className="h-5 w-5" />
              Delete Job?
            </DialogTitle>
            <DialogDescription className="pt-2 text-base">
              Are you sure you want to delete job <strong>{jobToDelete?.name}</strong> ({jobToDelete?.jobCode})?
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 rounded-xl border bg-destructive/5 border-destructive/10 p-4 text-sm text-destructive space-y-2">
            <p className="font-semibold">This action is permanent for the active roster:</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>All employees assigned to this job will have their job assignments cleared (set to null).</li>
              <li>The job will be removed from the site's jobs array.</li>
            </ul>
          </div>

          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              disabled={deletingJob}
              onClick={() => {
                setConfirmDeleteJobOpen(false)
                setJobToDelete(null)
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deletingJob}
              onClick={handleDeleteJob}
            >
              {deletingJob ? "Deleting..." : "Confirm Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Site Location Dialog */}
      <Dialog open={isEditingLocation} onOpenChange={setIsEditingLocation}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              Edit Location Details
            </DialogTitle>
            <DialogDescription>
              Update the location details for this site.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Location Details</label>
              <Input
                placeholder="Enter location details"
                value={editedLocationDetails}
                onChange={(e) => setEditedLocationDetails(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              disabled={savingLocation}
              onClick={() => setIsEditingLocation(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={savingLocation}
              onClick={handleSaveLocation}
            >
              {savingLocation ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default SiteDetail