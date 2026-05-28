// Employees.tsx

import { api } from "@/lib/api"
import toast from "react-hot-toast"
import { useEffect, useState } from "react"

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
  site: string
  jobTitle: string
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

type UpdateInfo = {
  name: string
  employeeId: string
  jobTitle: string
  currentSite: string | null
  monthlySalary: number
}


function Employees() {
  const [filters, setFilters] = useState<Filters>({
    name: "",
    employeeId: "",
    site: "",
    jobTitle: "",
    page: 1,
    limit: 10,
  })

  const [employees, setEmployees] = useState<Employee[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [siteMap, setSiteMap] = useState<Record<string, string>>({})


  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

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

  const addEmployee = async ( newEmployee: Omit<Employee, "_id"> ) => {
    try{

      if (newEmployee.currentSite === " "){
        newEmployee.currentSite = null
      } 
      await api.post('/api/employees', newEmployee)
      toast.success("Employee added successfully")
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

      toast.success("Employee removed successfully")

      fetchEmployees()
    } catch (error) {
      toast.error("Failed to remove employee")
      console.log(error)
    }
  }

  const editEmployee = async (id: string, updateInfo: UpdateInfo ) => {
    try {
      if (updateInfo.currentSite === " "){
        updateInfo.currentSite = null
      }
      await api.put(`/api/employees/${id}`, updateInfo)

      toast.success("Employee updated successfully")

      fetchEmployees()
    } catch (error) {
      toast.error("Couldn't update employee")
      console.log(error)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-4xl font-bold">
        Employees
      </h1>

      <div className="flex justify-end">
        <AddEmployee onAdd={addEmployee} sites={sites} />
      </div>

      {/* FILTER SECTION */}

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
      </div>

      {/* TABLE */}

      <div className="border rounded-xl overflow-hidden">
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
                Monthly Salary
              </TableHead>

              <TableHead>Current Site</TableHead>

              <TableHead className="text-right">
                Actions
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
                     {employee.monthlySalary}
                  </TableCell>

                  <TableCell>
                    {employee.currentSite
                      ? siteMap[
                          employee.currentSite
                        ]
                      : "Not Assigned"}
                  </TableCell>

                  <TableCell className="flex justify-end gap-2">
                    {/* EDIT */}

                    <EditEmployee
                      employee={employee}
                      onSave={editEmployee}
                      sites={sites}
                    />

                    {/* DELETE */}

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive">
                          Delete
                        </Button>
                      </AlertDialogTrigger>

                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Delete Employee?
                          </AlertDialogTitle>

                          <AlertDialogDescription>
                            This action cannot be
                            undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>

                        <AlertDialogFooter>
                          <AlertDialogCancel>
                            Cancel
                          </AlertDialogCancel>

                          <AlertDialogAction
                            onClick={() =>
                              removeEmployee(
                                employee._id
                              )
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
                  colSpan={6}
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
  )
}

export default Employees