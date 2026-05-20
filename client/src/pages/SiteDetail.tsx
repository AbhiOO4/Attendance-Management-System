import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"

import {
  Search,
  Plus,
  MapPin,
  ArrowLeft,
} from "lucide-react"

import {
  Briefcase,
  Clock3,
  Users,
  CalendarDays,
} from "lucide-react"

import { useNavigate } from "react-router-dom"

import { api } from "@/lib/api"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

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
}

interface Job {
  _id: string
  name: string
  jobCode: string
  totalManHours: number
  totalDays: number
  employeeCount: number
  isActive: boolean
}

function SiteDetail() {
  const { id } = useParams()

  const [site, setSite] = useState<Site | null>(null)

  const [employees, setEmployees] = useState<Employee[]>([])

  const [supervisors, setSupervisors] = useState<Employee[]>([])

  const [loadingEmployees, setLoadingEmployees] = useState(false)

  const [loadingSupervisors, setLoadingSupervisors] = useState(false)

  const [filters, setFilters] = useState<Filters>({name: "", employeeId: "",})

  const [supervisorFilters, setSupervisorFilters] = useState<SupervisorFilters>({ name: "", employeeId: "", notSupervisor: false })


  const [deactivateOpen, setDeactivateOpen] = useState(false)

  const [deactivating, setDeactivating] = useState(false)


  //jobs

  const navigate = useNavigate()

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

  const isSiteActive = site?.isActive

  async function fetchJobs() {
    try {
      setLoadingJobs(true)

      const res = await api.get(
        `/api/site/${id}/jobs`
      )

      setJobs(res.data)
    } catch (error) {
      console.log(error)

      setJobs([])
    } finally {
      setLoadingJobs(false)
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

      fetchJobs()
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
    fetchSite()
  }, [id])

  useEffect(() => {
    if (id) {
      fetchJobs()
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

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      
      <div className="mx-auto max-w-7xl space-y-8">

        <Link
          to="/site"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <Button variant="outline" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <span>Back</span>
        </Link>
        {/* Site Header */}

        <Card className="rounded-3xl border bg-card p-8 shadow-sm">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-4xl font-bold tracking-tight">
                  {site?.siteName || "Site"}
                </h1>

                <div
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    site?.isActive
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {site?.isActive
                    ? "Active"
                    : "Inactive"}
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4" />

                <p className="text-base">
                  {site?.locationDetails}
                </p>
              </div>
            </div>

            {isSiteActive ? (
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
            )}
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
                to={`/site/${id}/manage-supervisors`}
              >
                <Button className="rounded-xl">
                  <Plus className="mr-2 h-4 w-4" />
                  Manage Supervisors
                </Button>
              </Link>
            ) : (
              <Button
                disabled
                className="rounded-xl"
              >
                <Plus className="mr-2 h-4 w-4" />
                Manage Supervisors
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
            <div className="max-h-[350px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
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
            <div className="max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>Sl No</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Employee ID</TableHead>
                    <TableHead>Job Title</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {loadingEmployees ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="h-24 text-center"
                      >
                        Loading employees...
                      </TableCell>
                    </TableRow>
                  ) : employees.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
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
                    </div>

                    <p className="mt-1 text-sm text-muted-foreground">
                      {job.jobCode}
                    </p>
                  </div>

                  <Briefcase className="h-6 w-6 text-muted-foreground" />
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
                      <CalendarDays className="h-4 w-4" />

                      <span className="text-sm">
                        Days Spent
                      </span>
                    </div>

                    <span className="font-semibold">
                      {job.totalDays}
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
     </div>
  )
}

export default SiteDetail