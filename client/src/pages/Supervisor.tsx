//POST /api/employees/Supervisor "create a super visor account with name, empid, email* and password*"
//DELETE /api/employees/69f42a8a5ba166652fb76229  "delete an employee who is a supervisor"
//GET /api/employees?notSupervisor=true  "get all employees who are not a supervisor"

import { useEffect, useState } from "react"
import { api } from "@/lib/api"
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

import { Link } from "react-router-dom"

import { Plus, Trash2 } from "lucide-react"
import toast from "react-hot-toast"

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
  jobTitle: string
  page: number
  limit: number
  notSupervisor: boolean
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
}

function Supervisor() {

  const [employees, setEmployees] = useState<Employee[]>([])

  const [supervisors, setSupervisors] = useState<Employee[]>([])

  const [filters, setFilters] = useState<Filters>({
    name: "",
    employeeId: "",
    jobTitle: "",
    page: 1,
    limit: 10,
    notSupervisor: true
  })

  const [supervisorFilters, setSupervisorFilters] = useState<Filters>({
    name: "",
    employeeId: "",
    jobTitle: "",
    page: 1,
    limit: 10,
    notSupervisor: false
  })

  const [currentPage, setCurrentPage] = useState(1)

  const [totalPages, setTotalPages] = useState(1)

  const [sites, setSites] = useState<Site[]>([])

  const [siteMap, setSiteMap] = useState<Record<string, string>>({})

  async function fetchEmployees() {
    try {

      const res = await api.get<EmployeesResponse>(
        "/api/employees",
        {
          params: filters,
        }
      )

      setEmployees(res.data.employees)

      setCurrentPage(res.data.currentPage)

      setTotalPages(res.data.totalPages)

    } catch (error) {

      console.log(error)

      setEmployees([])
    }
  }

  async function fetchSupervisors() {

    try {

      const res = await api.get<EmployeesResponse>(
        "/api/employees/Supervisors",
        {
          params: supervisorFilters
        }
      )

      setSupervisors(res.data.employees)

    } catch (error) {

      console.log(error)

      setSupervisors([])
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

  useEffect(() => {
    fetchSupervisors()
  }, [supervisorFilters])

  // DELETE SUPERVISOR
  async function handleDeleteSupervisor(id: string) {
    try{
      await api.delete(`/api/employees/Supervisor/${id}`)
      fetchSupervisors()
      fetchEmployees()
      toast.success("Supervisor Removed SuccessFully")
    }catch(error){
      console.log(error)
      toast.error("Couldn't Remove Supervisor ")
    }
  }

  return (
    <div className="p-6 space-y-10">

      {/* TOP SECTION */}

      <div className="space-y-6">

        <h1 className="text-4xl font-bold">
          Add Supervisors
        </h1>

        {/* FILTERS */}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

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

        {/* EMPLOYEE TABLE */}

        <div className="space-y-3">

          <h2 className="text-2xl font-semibold">
            Employees List
          </h2>

          <Table>

            <TableHeader>

              <TableRow>

                <TableHead>Name</TableHead>

                <TableHead>
                  Employee ID
                </TableHead>

                <TableHead>
                  Job Title
                </TableHead>

                <TableHead>
                  Current Site
                </TableHead>

                <TableHead>
                  Add
                </TableHead>

              </TableRow>

            </TableHeader>

            <TableBody>

              {employees.length > 0 ? (

                employees.map((employee) => (

                  <TableRow key={employee._id}>

                    <TableCell>
                      {employee.name}
                    </TableCell>

                    <TableCell>
                      {employee.employeeId}
                    </TableCell>

                    <TableCell>
                      {employee.jobTitle}
                    </TableCell>

                    <TableCell>
                      {employee.currentSite
                        ? siteMap[employee.currentSite]
                        : "Not Assigned"}
                    </TableCell>

                    <TableCell>

                      <Link to={`/addsupervisor/${employee._id}`}>

                        <Button
                          size="icon"
                          variant="outline"
                        >
                          <Plus className="w-4 h-4" />
                        </Button>

                      </Link>

                    </TableCell>

                  </TableRow>
                ))

              ) : (

                <TableRow>

                  <TableCell
                    colSpan={5}
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

      </div>

      {/* SUPERVISOR SECTION */}

      <div className="space-y-4">

        <h2 className="text-2xl font-semibold">
          Supervisors List
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

          <Input
            placeholder="Search by name"
            value={supervisorFilters.name}
            onChange={(e) =>
              setSupervisorFilters({
                ...supervisorFilters,
                name: e.target.value,
                page: 1,
              })
            }
          />

          <Input
            placeholder="Employee ID"
            value={supervisorFilters.employeeId}
            onChange={(e) =>
              setSupervisorFilters({
                ...supervisorFilters,
                employeeId: e.target.value,
                page: 1,
              })
            }
          />

          <Input
            placeholder="Job Title"
            value={supervisorFilters.jobTitle}
            onChange={(e) =>
              setSupervisorFilters({
                ...supervisorFilters,
                jobTitle: e.target.value,
                page: 1,
              })
            }
          />

        </div>

        <Table>

          <TableHeader>

            <TableRow>

              <TableHead>Name</TableHead>

              <TableHead>
                Employee ID
              </TableHead>

              <TableHead>
                Job Title
              </TableHead>

              <TableHead>
                Current Site
              </TableHead>

              <TableHead>
                Delete
              </TableHead>

            </TableRow>

          </TableHeader>

          <TableBody>

            {supervisors.length > 0 ? (

              supervisors.map((supervisor) => (

                <TableRow key={supervisor._id}>

                  <TableCell>
                    {supervisor.name}
                  </TableCell>

                  <TableCell>
                    {supervisor.employeeId}
                  </TableCell>

                  <TableCell>
                    {supervisor.jobTitle}
                  </TableCell>

                  <TableCell>
                    {supervisor.currentSite
                      ? siteMap[supervisor.currentSite]
                      : "Not Assigned"}
                  </TableCell>

                  <TableCell>

                    <AlertDialog>

                      <AlertDialogTrigger asChild>

                        <Button
                          size="icon"
                          variant="destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>

                      </AlertDialogTrigger>

                      <AlertDialogContent>

                        <AlertDialogHeader>

                          <AlertDialogTitle>
                            Delete Supervisor?
                          </AlertDialogTitle>

                          <AlertDialogDescription>
                            The supervisor's account will be deleted.
                            Are you sure you want to continue?
                          </AlertDialogDescription>

                        </AlertDialogHeader>

                        <AlertDialogFooter>

                          <AlertDialogCancel>
                            Cancel
                          </AlertDialogCancel>

                          <AlertDialogAction
                            onClick={() =>
                              handleDeleteSupervisor(supervisor._id)
                            }
                          >
                            Delete
                          </AlertDialogAction>

                        </AlertDialogFooter>

                      </AlertDialogContent>

                    </AlertDialog>

                  </TableCell>

                </TableRow>
              ))

            ) : (

              <TableRow>

                <TableCell
                  colSpan={5}
                  className="text-center py-6"
                >
                  No supervisors found
                </TableCell>

              </TableRow>
            )}

          </TableBody>

        </Table>

      </div>

    </div>
  )
}

export default Supervisor