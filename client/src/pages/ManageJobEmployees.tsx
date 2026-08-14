// pages/ManageJobEmployees.tsx

import { useEffect, useMemo, useState } from "react"

import { Link, useParams } from "react-router-dom"

import {
  ArrowLeft,
  Minus,
  Plus,
} from "lucide-react"

import { api } from "@/lib/api"
    
import toast from "react-hot-toast"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

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
  currentSite: string | null
  currentJob: string | null
  user?: any
}

interface EmployeesResponse {
  employees: Employee[]
  currentPage: number
  totalPages: number
  totalEmployees: number
}

interface Job {
  _id: string
  name: string
  jobCode: string
  site: string
  isActive: boolean
}

interface Filters {
  name: string
  employeeId: string
  jobTitle: string
}

function ManageJobEmployees() {
  const { jobId } = useParams()

  const [job, setJob] = useState<Job | null>(null)

  const [employees, setEmployees] = useState<Employee[]>([])

  const [availableEmployees, setAvailableEmployees] = useState<Employee[]>([])

  const [filters, setFilters] = useState<Filters>({
    name: "",
    employeeId: "",
    jobTitle: "",
  })

  const [availableFilters, setAvailableFilters] = useState<Filters>({name: "", employeeId: "", jobTitle: "",})

  const [page, setPage] = useState(1)

  const [totalPages, setTotalPages] = useState(1)

  const [loading, setLoading] = useState(false)

  const [deactivateOpen, setDeactivateOpen] =  useState(false)

  // Remove confirmation modal state
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)
  const [employeeToRemove, setEmployeeToRemove] = useState<Employee | null>(null)

  const isJobActive = job?.isActive

  async function fetchJob() {
    try {
      const res = await api.get(
        `/api/site/job/${jobId}`
      )

      setJob(res.data)
    } catch (error) {
      console.log(error)
    }
  }

  async function fetchEmployees() {
    try {
      setLoading(true)

      const res = await api.get(
        `/api/site/job/${jobId}/employees`
      )

      setEmployees(res.data)
    } catch (error) {
      console.log(error)

      setEmployees([])
    } finally {
      setLoading(false)
    }
  }

  async function fetchAvailableEmployees() {
    try {
      if (!job?.site) return

      const res =
        await api.get<EmployeesResponse>(
          `/api/site/${job.site}/free-employees`,
          {
            params: {
              ...availableFilters,
              page,
              limit: 10,
            },
          }
        )

      setAvailableEmployees(
        res.data.employees
      )

      setTotalPages(res.data.totalPages)
    } catch (error) {
      console.log(error)

      setAvailableEmployees([])
    }
  }

  async function assignEmployee(
    empId: string
  ) {
    try {
      await api.post(
        `/api/site/job/${jobId}/add-employee`,
        {
          empId,
        }
      )

      toast.success("Employee assigned")

      // Clear draft cache for this site so SiteAttendance page fetches fresh employees list
      if (job?.site) {
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith(`attendance_draft_${job.site}_`)) {
            localStorage.removeItem(key)
          }
        })
        localStorage.removeItem(`active_inline_edit_row_${job.site}`)
        localStorage.removeItem(`active_inline_edit_data_${job.site}`)
      }

      fetchEmployees()
      fetchAvailableEmployees()
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message ||
          "Failed to assign employee"
      )
    }
  }

  async function removeEmployee(
    empId: string
  ) {
    try {
      await api.delete(
        `/api/site/job/${jobId}/remove-employee`,
        {
          data: {
            empId,
          },
        }
      )

      toast.success("Employee removed")

      // Clear draft cache for this site so SiteAttendance page fetches fresh employees list
      if (job?.site) {
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith(`attendance_draft_${job.site}_`)) {
            localStorage.removeItem(key)
          }
        })
        localStorage.removeItem(`active_inline_edit_row_${job.site}`)
        localStorage.removeItem(`active_inline_edit_data_${job.site}`)
      }

      fetchEmployees()
      fetchAvailableEmployees()
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message ||
          "Failed to remove employee"
      )
    }
  }

  // define later
  async function changeJobStatus() {
    try{
      await api.patch(`/api/site/job/${jobId}/status`)
      fetchJob()
      fetchEmployees()
      fetchAvailableEmployees()
    }catch(error){
      console.log(error)
    }
  }

  const filteredEmployees = useMemo(() => {
    return employees.filter((employee) => {
      const matchesName =
        employee.name
          .toLowerCase()
          .includes(
            filters.name.toLowerCase()
          )

      const matchesEmployeeId =
        employee.employeeId
          .toLowerCase()
          .includes(
            filters.employeeId.toLowerCase()
          )

      const matchesJobTitle =
        employee.jobTitle
          .toLowerCase()
          .includes(
            filters.jobTitle.toLowerCase()
          )

      return (
        matchesName &&
        matchesEmployeeId &&
        matchesJobTitle
      )
    })
  }, [employees, filters])

  useEffect(() => {
    fetchJob()
  }, [jobId])

  useEffect(() => {
    fetchEmployees()
  }, [jobId])

  useEffect(() => {
    fetchAvailableEmployees()
  }, [
    availableFilters,
    page,
    job,
  ])

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      <div className="mx-auto max-w-7xl space-y-8">
        {/* Header */}

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Link to={`/site/${job?.site}`}>
              <Button
                variant="outline"
                size="icon"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>

            <div>
              <h1 className="text-4xl font-bold">
                Manage Employees
              </h1>

              <div className="mt-2 flex items-center gap-3">
                <p className="text-muted-foreground">
                  {job?.name}
                </p>

                <span className="text-muted-foreground">
                  •
                </span>

                <p className="font-medium">
                  {job?.jobCode}
                </p>

                <div
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    isJobActive
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {isJobActive
                    ? "Active"
                    : "Inactive"}
                </div>
              </div>
            </div>
          </div>

          <div className="w-full md:w-auto">
            {isJobActive ? (
              <Dialog
                open={deactivateOpen}
                onOpenChange={setDeactivateOpen}
              >
                <DialogTrigger asChild>
                  <Button
                    variant="destructive"
                    className="w-full md:w-auto"
                  >
                    Deactivate Job
                  </Button>
                </DialogTrigger>

                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      Deactivate Job?
                    </DialogTitle>

                    <DialogDescription className="pt-3 leading-relaxed">
                      Employees associated with this
                      job will be removed from the
                      job assignment upon
                      deactivation.

                      <br />
                      <br />

                      They will remain assigned to
                      the site but will no longer
                      belong to this job.
                    </DialogDescription>
                  </DialogHeader>

                  <DialogFooter>
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
                      onClick={async () => {
                        await changeJobStatus()

                        setDeactivateOpen(false)
                      }}
                    >
                      Deactivate Job
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : (
              <Button
                className="w-full md:w-auto"
                onClick={changeJobStatus}
              >
                Re-Activate Job
              </Button>
            )}
          </div>
        </div>

        {!isJobActive && (
          <Card className="border-red-200 bg-red-50 p-5">
            <p className="font-medium text-red-700">
              This job is inactive.
              Employee assignment and
              removal have been disabled.
            </p>
          </Card>
        )}

        {/* Current Employees */}

        <Card className="rounded-3xl border bg-card p-8 shadow-sm">
          <h2 className="mb-6 text-2xl font-bold">
            Current Employees
          </h2>

          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Input
              placeholder="Search by name"
              value={filters.name}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  name: e.target.value,
                })
              }
            />

            <Input
              placeholder="Employee ID"
              value={filters.employeeId}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  employeeId:
                    e.target.value,
                })
              }
            />

            <Input
              placeholder="Job Title"
              value={filters.jobTitle}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  jobTitle:
                    e.target.value,
                })
              }
            />
          </div>

          <div className="overflow-hidden rounded-2xl border">
            <Table wrapperClassName="h-[320px] overflow-y-auto">
              <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>
                      Sl No
                    </TableHead>

                    <TableHead>
                      Name
                    </TableHead>

                    <TableHead>
                      Employee ID
                    </TableHead>

                    <TableHead>
                      Job Title
                    </TableHead>

                    <TableHead className="text-right">
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="h-24 text-center"
                      >
                        Loading
                        employees...
                      </TableCell>
                    </TableRow>
                  ) : filteredEmployees.length ===
                    0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No employees
                        assigned
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredEmployees.map(
                      (
                        employee,
                        index
                      ) => (
                        <TableRow
                          key={
                            employee._id
                          }
                        >
                          <TableCell>
                            {index + 1}
                          </TableCell>

                          <TableCell className="font-medium">
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <span>{employee.name}</span>
                                {employee.user && (
                                  <Badge variant="secondary" className="bg-secondary/80 text-secondary-foreground text-[10px] font-medium py-0 px-1.5 h-4">
                                    Supervisor
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </TableCell>

                          <TableCell>
                            {
                              employee.employeeId
                            }
                          </TableCell>

                          <TableCell>
                            {
                              employee.jobTitle
                            }
                          </TableCell>

                          <TableCell className="text-right">
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={
                                !isJobActive
                              }
                              onClick={() => {
                                setEmployeeToRemove(employee)
                                setConfirmRemoveOpen(true)
                              }}
                            >
                              <Minus className="mr-2 h-4 w-4" />
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    )
                  )}
                </TableBody>
              </Table>
          </div>
        </Card>

        {/* Available Employees */}

        <Card
          className={`rounded-3xl border bg-card p-8 shadow-sm ${
            !isJobActive
              ? "pointer-events-none opacity-60"
              : ""
          }`}
        >
          <h2 className="mb-6 text-2xl font-bold">
            Available Employees
          </h2>

          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Input
              placeholder="Search by name"
              value={
                availableFilters.name
              }
              onChange={(e) =>
                setAvailableFilters({
                  ...availableFilters,
                  name:
                    e.target.value,
                })
              }
            />

            <Input
              placeholder="Employee ID"
              value={
                availableFilters.employeeId
              }
              onChange={(e) =>
                setAvailableFilters({
                  ...availableFilters,
                  employeeId:
                    e.target.value,
                })
              }
            />

            <Input
              placeholder="Job Title"
              value={
                availableFilters.jobTitle
              }
              onChange={(e) =>
                setAvailableFilters({
                  ...availableFilters,
                  jobTitle:
                    e.target.value,
                })
              }
            />
          </div>

          <div className="overflow-hidden rounded-2xl border">
            <Table wrapperClassName="h-[320px] overflow-y-auto">
              <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>
                      Sl No
                    </TableHead>

                    <TableHead>
                      Name
                    </TableHead>

                    <TableHead>
                      Employee ID
                    </TableHead>

                    <TableHead>
                      Job Title
                    </TableHead>

                    <TableHead className="text-right">
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {availableEmployees.length ===
                  0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No available
                        employees
                      </TableCell>
                    </TableRow>
                  ) : (
                    availableEmployees.map(
                      (
                        employee,
                        index
                      ) => (
                        <TableRow
                          key={
                            employee._id
                          }
                        >
                          <TableCell>
                            {index + 1}
                          </TableCell>

                          <TableCell className="font-medium">
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <span>{employee.name}</span>
                                {employee.user && (
                                  <Badge variant="secondary" className="bg-secondary/80 text-secondary-foreground text-[10px] font-medium py-0 px-1.5 h-4">
                                    Supervisor
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </TableCell>

                          <TableCell>
                            {
                              employee.employeeId
                            }
                          </TableCell>

                          <TableCell>
                            {
                              employee.jobTitle
                            }
                          </TableCell>

                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              disabled={
                                !isJobActive
                              }
                              onClick={() =>
                                assignEmployee(
                                  employee._id
                                )
                              }
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              Add
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    )
                  )}
                </TableBody>
              </Table>
          </div>

          {/* Pagination */}

          <div className="mt-6 flex items-center justify-between">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() =>
                setPage((prev) =>
                  prev - 1
                )
              }
            >
              Previous
            </Button>

            <p className="text-sm text-muted-foreground">
              Page {page} of{" "}
              {totalPages}
            </p>

            <Button
              variant="outline"
              disabled={
                page === totalPages
              }
              onClick={() =>
                setPage((prev) =>
                  prev + 1
                )
              }
            >
              Next
            </Button>
          </div>
        </Card>
      </div>

      {/* Remove Employee Confirmation Dialog */}
      <Dialog open={confirmRemoveOpen} onOpenChange={setConfirmRemoveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Remove Employee from Job?</DialogTitle>
            <DialogDescription className="pt-2 text-base">
              Are you sure you want to remove this employee from the job <strong>{job?.name}</strong>?
            </DialogDescription>
          </DialogHeader>

          {employeeToRemove && (
            <div className="my-4 rounded-xl border bg-muted/30 p-4 space-y-2 text-sm">
              <div className="flex justify-between border-b pb-1.5">
                <span className="text-muted-foreground">Name:</span>
                <span className="font-semibold text-foreground">{employeeToRemove.name}</span>
              </div>
              <div className="flex justify-between border-b pb-1.5">
                <span className="text-muted-foreground">Employee ID:</span>
                <span className="font-mono text-foreground">{employeeToRemove.employeeId}</span>
              </div>
              <div className="flex justify-between border-b pb-1.5">
                <span className="text-muted-foreground">Job Title:</span>
                <span className="text-foreground">{employeeToRemove.jobTitle}</span>
              </div>
              <div className="flex justify-between items-center pt-0.5">
                <span className="text-muted-foreground">Role:</span>
                <span>
                  {employeeToRemove.user ? (
                    <Badge variant="secondary" className="bg-secondary/80 text-secondary-foreground text-[10px] font-medium py-0 px-1.5 h-4">
                      Supervisor
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground text-xs">Standard Employee</span>
                  )}
                </span>
              </div>
            </div>
          )}

          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setConfirmRemoveOpen(false)
                setEmployeeToRemove(null)
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (employeeToRemove) {
                  removeEmployee(employeeToRemove._id)
                }
                setConfirmRemoveOpen(false)
                setEmployeeToRemove(null)
              }}
            >
              Confirm Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default ManageJobEmployees