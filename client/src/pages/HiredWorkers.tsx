// HiredWorkers.tsx

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

import { useAuth } from "@/context/AuthContext"
import AddTemporaryWorker from "@/components/AddTemporaryWorker"
import axios from "axios"
import { Badge } from "@/components/ui/badge"

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
}

interface Filters {
  name: string
  employeeId: string
  jobTitle: string
  page: number
  limit: number
}

interface EmployeesResponse {
  employees: Employee[]
  currentPage: number
  totalPages: number
  totalEmployees: number
}

function HiredWorkers() {
  const { user } = useAuth()
  const assignedSite = user?.assignedSite

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

  async function fetchHiredWorkers() {
    if (!assignedSite) return
    try {
      const res = await api.get<EmployeesResponse>(
        "/api/employees",
        {
          params: {
            ...filters,
            site: assignedSite,
            employmentType: "temporary",
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
    }
  }

  useEffect(() => {
    fetchHiredWorkers()
  }, [filters, assignedSite])

  const addHiredWorker = async (newEmployee: Omit<Employee, "_id" | "currentJob">) => {
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

  if (!assignedSite) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        You do not have an assigned site. Please contact an administrator.
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-4xl font-bold">
            Hired Workers
          </h1>
          <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-sm font-semibold px-3 py-1 mt-1">
            Total: {totalEmployees}
          </Badge>
        </div>

        <AddTemporaryWorker onAdd={addHiredWorker} assignedSiteId={assignedSite} />
      </div>

      {/* FILTER SECTION */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

      {/* DESKTOP TABLE */}
      <div className="hidden md:block border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Sl No</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Employee ID</TableHead>
              <TableHead>Job Title</TableHead>
              <TableHead>Monthly Salary</TableHead>
              <TableHead>Current Site</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {employees.length > 0 ? (
              employees.map((employee, index) => (
                <TableRow 
                  key={employee._id}
                  className="hover:bg-muted/50 transition-colors"
                >
                  <TableCell className="font-medium text-muted-foreground">
                    {(currentPage - 1) * filters.limit + index + 1}
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{employee.name}</span>
                      <Badge variant="secondary" className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/30 text-[10px] px-1.5 py-0 h-4">
                        Temporary
                      </Badge>
                    </div>
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
                    Assigned Site
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center py-6"
                >
                  No temporary workers found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* MOBILE LIST */}
      <div className="block md:hidden space-y-4">
        {employees.length > 0 ? (
          employees.map((employee, index) => (
            <div
              key={employee._id}
              className="bg-card border rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-foreground text-lg">
                      {employee.name}
                    </span>
                    <Badge variant="secondary" className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/30 text-[10px] px-1.5 py-0">
                      Temporary
                    </Badge>
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
                <div>
                  <span className="text-xs text-muted-foreground block">Monthly Salary</span>
                  <span className="font-medium text-foreground">{employee.monthlySalary}</span>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-8 text-muted-foreground border rounded-xl bg-card/50">
            No temporary workers found
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
    </div>
  )
}

export default HiredWorkers
