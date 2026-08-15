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
import { Link, useNavigate } from "react-router-dom"
import { Badge } from "@/components/ui/badge"

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

type NewEmployee = {
  name: string
  employeeId: string
  jobTitle: string
  employmentType: 'permanent' | 'temporary'
  nationality: 'foreign' | 'omani'
}

type UpdateInfo = {
  name: string
  employeeId: string
  jobTitle: string
  employmentType: 'permanent' | 'temporary'
  nationality: 'foreign' | 'omani'
}


function Employees() {
  const navigate = useNavigate()
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
  const [totalEmployees, setTotalEmployees] = useState(0)

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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-4xl font-bold">
            Employees
          </h1>
          <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-sm font-semibold px-3 py-1 mt-1">
            Total: {totalEmployees}
          </Badge>
        </div>

        <AddEmployee onAdd={addEmployee} />
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
      </div>

      {/* TABLE */}

      <div className="border rounded-xl overflow-hidden">
        <Table wrapperClassName="max-h-[calc(100vh-320px)] overflow-y-auto">
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="w-16">Sl No</TableHead>
              <TableHead>Name</TableHead>

              <TableHead>
                Employee ID
              </TableHead>

              <TableHead>
                Job Title
              </TableHead>

              <TableHead>Current Site</TableHead>

              <TableHead className="text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {employees.length > 0 ? (
              employees.map((employee, index) => (
                <TableRow 
                  key={employee._id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => navigate(`/employees/${employee._id}`)}
                >
                  <TableCell className="font-medium text-muted-foreground">
                    {(currentPage - 1) * filters.limit + index + 1}
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link to={`/employees/${employee._id}`} className="hover:underline">{employee.name}</Link>
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
                    </div>
                  </TableCell>

                  <TableCell>
                    {employee.employeeId}
                  </TableCell>

                  <TableCell>
                    {employee.jobTitle}
                  </TableCell>

                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span>{employee.currentSite ? siteMap[employee.currentSite] : "Not Assigned"}</span>
                      {employee.currentJob && (
                        <span className="text-xs text-muted-foreground">{employee.currentJob.name}</span>
                      )}
                    </div>
                  </TableCell>

                  <TableCell className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                    {/* EDIT */}

                    <EditEmployee
                      employee={employee}
                      onSave={editEmployee}
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

        <div className="flex items-center gap-4">
          <p className="text-sm">
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
              </SelectContent>
            </Select>
          </div>
        </div>

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