// pages/ManageEmployees.tsx

import { useEffect, useState } from "react"
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

interface Employee {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
  monthlySalary: number
  currentSite: string | null
  currentJob : string | null
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

          <div className="grid grid-cols-1 md: grid-cols-2 lg:grid-cols-4 gap-4">
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

          </div>

          <div className="overflow-hidden rounded-2xl border">
            <div className="max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
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
                  ) : employees.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No employees assigned
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

                        <TableCell className="text-right">
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() =>
                              removeEmployee(
                                employee._id
                              )
                            }
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
          </div>
        </Card>

        {/* Available Employees */}

        <Card className="rounded-3xl border bg-card p-8 shadow-sm">
          <h2 className="mb-6 text-2xl font-bold">
            Available Employees
          </h2>

          <div className="grid grid-cols-1 md: grid-cols-2 lg:grid-cols-4 gap-4">
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
                    <TableHead className="text-right">
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {availableEmployees.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No available employees
                      </TableCell>
                    </TableRow>
                  ) : (
                    availableEmployees.map(
                      (employee, index) => (
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
          </div>
        </Card>
      </div>
    </div>
  )
}

export default ManageEmployees