import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"

import {
  Search,
  Plus,
  MapPin,
} from "lucide-react"

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

function SiteDetail() {
  const { id } = useParams()

  const [site, setSite] = useState<Site | null>(null)

  const [employees, setEmployees] = useState<Employee[]>(
    []
  )

  const [supervisors, setSupervisors] = useState<
    Employee[]
  >([])

  const [loadingEmployees, setLoadingEmployees] =
    useState(false)

  const [loadingSupervisors, setLoadingSupervisors] =
    useState(false)

  const [filters, setFilters] = useState<Filters>({
    name: "",
    employeeId: "",
  })

  const [supervisorFilters, setSupervisorFilters] =
    useState<SupervisorFilters>({
      name: "",
      employeeId: "",
      notSupervisor: false,
    })


  const [deactivateOpen, setDeactivateOpen] =
    useState(false)

  const [deactivating, setDeactivating] =
    useState(false)

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

  useEffect(() => {
    fetchSite()
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

    // implement later

    setDeactivateOpen(false)
  } catch (error) {
    console.log(error)
  } finally {
    setDeactivating(false)
  }
}

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      <div className="mx-auto max-w-7xl space-y-8">
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
                    All employees and supervisors associated
                    with this site will be removed from the
                    site upon deactivation.

                    <br />
                    <br />

                    They will need to be assigned again when
                    the site is reactivated.
                  </DialogDescription>
                </DialogHeader>

                <DialogFooter className="mt-4 flex-col gap-3 sm:flex-row">
                  <Button
                    variant="outline"
                    onClick={() => setDeactivateOpen(false)}
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
          </div>
        </Card>

        {/* Supervisors Section */}

        <Card className="rounded-3xl border bg-card p-8 shadow-sm">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <h2 className="text-3xl font-bold">
              Supervisors
            </h2>

            <Link
              to={`/site/${id}/manage-supervisors`}
            >
              <Button className="rounded-xl">
                <Plus className="mr-2 h-4 w-4" />
                Manage Supervisors
              </Button>
            </Link>
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

            <Link to={`/site/${id}/manage-employees`}>
              <Button className="rounded-xl">
                <Plus className="mr-2 h-4 w-4" />
                Manage Employees
              </Button>
            </Link>
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
      </div>
    </div>
  )
}

export default SiteDetail