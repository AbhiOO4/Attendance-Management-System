// pages/ManageEmployees.tsx

import { useEffect, useState, useMemo } from "react"
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
} from "@/components/ui/dialog"

interface Employee {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
  monthlySalary: number
  currentSite: string | null
  currentJob: { _id: string; name: string } | string | null
  user?: any
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
}

interface Filters {
  name: string,
  employeeId: string,
  jobTitle: string
}

function ManageEmployees() {
  const { id } = useParams()

  const [site, setSite] = useState<Site | null>(null)

  const [filters, setFilters] = useState<Filters>({name: "", employeeId: "", jobTitle: ""})

  const [filters2, setFilters2] = useState<Filters>({name: "", employeeId: "", jobTitle: ""})

  const [employees, setEmployees] = useState<
    Employee[]
  >([])

  const [availableEmployees, setAvailableEmployees] =
    useState<Employee[]>([])

  const [loading, setLoading] = useState(false)

  // Supervisor toggle filters
  const [showSupervisorsOnlyCurrent, setShowSupervisorsOnlyCurrent] = useState(false)
  const [showSupervisorsOnlyAvailable, setShowSupervisorsOnlyAvailable] = useState(false)

  // Remove confirmation modal state
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)
  const [employeeToRemove, setEmployeeToRemove] = useState<Employee | null>(null)

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
      setLoading(true)

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
      setLoading(false)
    }
  }

  async function fetchAvailableEmployees() {
    try {
      const res = await api.get<EmployeesResponse>(
        "/api/employees",
        {
          params: {
            ...filters2,
            site: "null",
          },
        }
      )

      setAvailableEmployees(res.data.employees)
    } catch (error) {
      console.log(error)

      setAvailableEmployees([])
    }
  }

  async function assignEmployee( uid: string ) {
    try {
      await api.patch(
        `/api/site/${id}/add-employee`,
        {
          _id: uid,
        }
      )

      toast.success("Employee assigned")

      // Clear draft cache for this site so SiteAttendance page fetches fresh employees list
      if (id) {
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith(`attendance_draft_${id}_`)) {
            localStorage.removeItem(key)
          }
        })
        localStorage.removeItem(`active_inline_edit_row_${id}`)
        localStorage.removeItem(`active_inline_edit_data_${id}`)
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

  async function removeEmployee( uid: string ) {
    try {
      await api.patch(
        `/api/site/${id}/remove-employee`,
        {
          _id: uid,
        }
      )

      toast.success("Employee removed")

      // Clear draft cache for this site so SiteAttendance page fetches fresh employees list
      if (id) {
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith(`attendance_draft_${id}_`)) {
            localStorage.removeItem(key)
          }
        })
        localStorage.removeItem(`active_inline_edit_row_${id}`)
        localStorage.removeItem(`active_inline_edit_data_${id}`)
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

  useEffect(() => {
    fetchSite()
  }, [id])

  useEffect(() => {
    fetchEmployees()
  }, [filters])

  useEffect(() => {
    fetchAvailableEmployees()
  }, [filters2])

  // Filtered lists computed via useMemo
  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      if (showSupervisorsOnlyCurrent && !emp.user) {
        return false
      }
      return true
    })
  }, [employees, showSupervisorsOnlyCurrent])

  const filteredAvailableEmployees = useMemo(() => {
    return availableEmployees.filter((emp) => {
      if (showSupervisorsOnlyAvailable && !emp.user) {
        return false
      }
      return true
    })
  }, [availableEmployees, showSupervisorsOnlyAvailable])

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex items-center gap-4">
          <Link to={`/site/${id}`}>
            <Button variant="outline" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>

          <div>
            <h1 className="text-4xl font-bold">
              Manage Employees
            </h1>

            <p className="mt-1 text-muted-foreground">
              {site?.siteName}
            </p>
          </div>
        </div>

        {/* Current Employees */}

        <Card className="rounded-3xl border bg-card p-8 shadow-sm">
          <h2 className="mb-6 text-2xl font-bold">
            Current Employees
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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
                  employeeId: e.target.value,
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
                })
              }
            />

            <Button
              variant={showSupervisorsOnlyCurrent ? "default" : "outline"}
              onClick={() => setShowSupervisorsOnlyCurrent(prev => !prev)}
              className="w-full h-8"
            >
              {showSupervisorsOnlyCurrent ? "Supervisors Only" : "All Employees"}
            </Button>
          </div>

          <div className="overflow-hidden rounded-2xl border">
            <Table wrapperClassName="h-[320px] overflow-y-auto">
              <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>Sl No</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Employee ID</TableHead>
                    <TableHead>Job Title</TableHead>
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
                        Loading employees...
                      </TableCell>
                    </TableRow>
                  ) : filteredEmployees.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="h-24 text-center text-muted-foreground"
                      >
                        {employees.length === 0 ? "No employees assigned" : "No supervisors assigned"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredEmployees.map((employee, index) => (
                      <TableRow key={employee._id}>
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
                            {employee.currentJob && (
                              <span className="text-xs text-muted-foreground">
                                {typeof employee.currentJob === 'object' ? employee.currentJob.name : ''}
                              </span>
                            )}
                          </div>
                        </TableCell>

                        <TableCell>
                          {employee.employeeId}
                        </TableCell>

                        <TableCell>
                          {employee.jobTitle}
                        </TableCell>

                        <TableCell className="text-right">
                          <Button
                            variant="destructive"
                            size="sm"
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
                    ))
                  )}
                </TableBody>
              </Table>
          </div>
        </Card>

        {/* Available Employees */}

        <Card className="rounded-3xl border bg-card p-8 shadow-sm">
          <h2 className="mb-6 text-2xl font-bold">
            Available Employees
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Input
              placeholder="Search by name"
              value={filters2.name}
              onChange={(e) =>
                setFilters2({
                  ...filters2,
                  name: e.target.value,
                })
              }
            />

            <Input
              placeholder="Employee ID"
              value={filters2.employeeId}
              onChange={(e) =>
                setFilters2({
                  ...filters2,
                  employeeId: e.target.value,
                })
              }
            />

            <Input
              placeholder="Job Title"
              value={filters2.jobTitle}
              onChange={(e) =>
                setFilters2({
                  ...filters2,
                  jobTitle: e.target.value,
                })
              }
            />

            <Button
              variant={showSupervisorsOnlyAvailable ? "default" : "outline"}
              onClick={() => setShowSupervisorsOnlyAvailable(prev => !prev)}
              className="w-full h-8"
            >
              {showSupervisorsOnlyAvailable ? "Supervisors Only" : "All Employees"}
            </Button>
          </div>

          <div className="overflow-hidden rounded-2xl border">
            <Table wrapperClassName="h-[320px] overflow-y-auto">
              <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>Sl No</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Employee ID</TableHead>
                    <TableHead>Job Title</TableHead>
                    <TableHead className="text-right">
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {filteredAvailableEmployees.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="h-24 text-center text-muted-foreground"
                      >
                        {availableEmployees.length === 0 ? "No available employees" : "No available supervisors"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAvailableEmployees.map(
                      (employee, index) => (
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

                          <TableCell className="text-right">
                            <Button
                              size="sm"
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
        </Card>
      </div>

      {/* Remove Confirmation Dialog */}
      <Dialog open={confirmRemoveOpen} onOpenChange={setConfirmRemoveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Remove Employee?</DialogTitle>
            <DialogDescription className="pt-2 text-base">
              Are you sure you want to remove the following employee from <strong>{site?.siteName}</strong>?
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

export default ManageEmployees