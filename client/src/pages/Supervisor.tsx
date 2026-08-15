//POST /api/employees/Supervisor "create a super visor account with name, empid, email* and password*"
//DELETE /api/employees/Supervisor/:id  "delete an employee who is a supervisor"
//GET /api/employees?notSupervisor=true  "get all employees who are not a supervisor"

import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Plus, Trash2, Search, ShieldCheck, Users } from "lucide-react"
import toast from "react-hot-toast"

import { api } from "@/lib/api"
import { useAuth } from "@/context/AuthContext"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface Employee {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
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
  const { user } = useAuth()
  const isSuperadmin = user?.role === "superadmin"

  const [employees, setEmployees] = useState<Employee[]>([])
  const [supervisors, setSupervisors] = useState<Employee[]>([])

  const [filters, setFilters] = useState<Filters>({
    name: "",
    employeeId: "",
    jobTitle: "",
    page: 1,
    limit: 10,
    notSupervisor: true,
  })

  const [supervisorFilters, setSupervisorFilters] = useState<Filters>({
    name: "",
    employeeId: "",
    jobTitle: "",
    page: 1,
    limit: 10,
    notSupervisor: false,
  })

  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const [supervisorCurrentPage, setSupervisorCurrentPage] = useState(1)
  const [supervisorTotalPages, setSupervisorTotalPages] = useState(1)

  const [siteMap, setSiteMap] = useState<Record<string, string>>({})

  // Delete flow: lifted to page level so state isn't shared across per-row dialogs.
  // Deletion is superadmin-only (enforced by the API and gated in the UI below).
  const [supervisorToDelete, setSupervisorToDelete] = useState<Employee | null>(null)

  async function fetchEmployees() {
    try {
      const res = await api.get<EmployeesResponse>("/api/employees", { params: filters })
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
      const res = await api.get<EmployeesResponse>("/api/employees/Supervisors", {
        params: supervisorFilters,
      })
      setSupervisors(res.data.employees)
      setSupervisorCurrentPage(res.data.currentPage)
      setSupervisorTotalPages(res.data.totalPages)
    } catch (error) {
      console.log(error)
      setSupervisors([])
    }
  }

  const fetchSites = async () => {
    try {
      const res = await api.get<Site[]>("/api/site")
      const map: Record<string, string> = {}
      for (const site of res.data) {
        map[site._id] = site.siteName
      }
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

  async function handleDeleteSupervisor() {
    if (!supervisorToDelete) return
    try {
      await api.delete(`/api/employees/Supervisor/${supervisorToDelete._id}`)
      fetchSupervisors()
      fetchEmployees()
      toast.success("Supervisor removed")
      setSupervisorToDelete(null)
    } catch (error: any) {
      console.log(error)
      toast.error(error?.response?.data?.message || "Couldn't remove supervisor")
    }
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-10">
        {/* Header */}
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Supervisors</h1>
          <p className="text-sm text-muted-foreground">
            Create supervisor accounts from existing employees, and manage
            everyone with access.
          </p>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="add" className="mt-8">
          <TabsList>
            <TabsTrigger value="add">
              <Users className="h-3.5 w-3.5" />
              Add supervisor
            </TabsTrigger>
            <TabsTrigger value="current">
              <ShieldCheck className="h-3.5 w-3.5" />
              Current
              {supervisors.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {supervisors.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ------------------ ADD TAB ------------------ */}
          <TabsContent value="add" className="mt-6">
            <SearchRow
              name={filters.name}
              employeeId={filters.employeeId}
              jobTitle={filters.jobTitle}
              onChange={(patch) => setFilters({ ...filters, ...patch, page: 1 })}
            />

            <div className="mt-4 rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead>Employee ID</TableHead>
                    <TableHead>Job title</TableHead>
                    <TableHead>Current site</TableHead>
                    <TableHead className="w-16 pr-4 text-right">Add</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {employees.length > 0 ? (
                    employees.map((employee) => (
                      <TableRow key={employee._id} className="hover:bg-muted/40">
                        <TableCell className="pl-4 font-medium">
                          {employee.name}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {employee.employeeId}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {employee.jobTitle}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {employee.currentSite ? (
                            siteMap[employee.currentSite]
                          ) : (
                            <span className="italic">Not assigned</span>
                          )}
                        </TableCell>
                        <TableCell className="pr-4 text-right">
                          <Button
                            asChild
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          >
                            <Link
                              to={`/supervisor/${employee._id}`}
                              aria-label={`Create account for ${employee.name}`}
                            >
                              <Plus className="h-4 w-4" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={5}
                        className="h-32 text-center text-sm text-muted-foreground"
                      >
                        No employees found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <PaginationBar
              currentPage={currentPage}
              totalPages={totalPages}
              limit={filters.limit}
              onPage={(p) => setFilters({ ...filters, page: p })}
              onLimit={(l) => setFilters({ ...filters, limit: l, page: 1 })}
            />
          </TabsContent>

          {/* ------------------ CURRENT TAB ------------------ */}
          <TabsContent value="current" className="mt-6">
            <SearchRow
              name={supervisorFilters.name}
              employeeId={supervisorFilters.employeeId}
              jobTitle={supervisorFilters.jobTitle}
              onChange={(patch) =>
                setSupervisorFilters({ ...supervisorFilters, ...patch, page: 1 })
              }
            />

            <div className="mt-4 rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead>Employee ID</TableHead>
                    <TableHead>Job title</TableHead>
                    <TableHead>Current site</TableHead>
                    <TableHead className="w-16 pr-4 text-right">Remove</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {supervisors.length > 0 ? (
                    supervisors.map((supervisor) => (
                      <TableRow key={supervisor._id} className="hover:bg-muted/40">
                        <TableCell className="pl-4 font-medium">
                          {supervisor.name}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {supervisor.employeeId}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {supervisor.jobTitle}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {supervisor.currentSite ? (
                            siteMap[supervisor.currentSite]
                          ) : (
                            <span className="italic">Not assigned</span>
                          )}
                        </TableCell>
                        <TableCell className="pr-4 text-right">
                          {isSuperadmin ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => setSupervisorToDelete(supervisor)}
                              aria-label={`Remove ${supervisor.name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={5}
                        className="h-32 text-center text-sm text-muted-foreground"
                      >
                        No supervisors yet
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <PaginationBar
              currentPage={supervisorCurrentPage}
              totalPages={supervisorTotalPages}
              limit={supervisorFilters.limit}
              onPage={(p) => setSupervisorFilters({ ...supervisorFilters, page: p })}
              onLimit={(l) =>
                setSupervisorFilters({ ...supervisorFilters, limit: l, page: 1 })
              }
            />
          </TabsContent>
        </Tabs>

        {/* Delete dialog — lifted to page level so state isn't shared per row */}
        <AlertDialog
          open={!!supervisorToDelete}
          onOpenChange={(open) => {
            if (!open) {
              setSupervisorToDelete(null)
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Remove {supervisorToDelete?.name}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Their supervisor account will be deleted and their site access
                revoked. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteSupervisor}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}

/**
 * Compact filter row: 3 inputs with a leading search icon.
 * On mobile stacks; on desktop sits in one row.
 */
function SearchRow({
  name,
  employeeId,
  jobTitle,
  onChange,
}: {
  name: string
  employeeId: string
  jobTitle: string
  onChange: (patch: Partial<{ name: string; employeeId: string; jobTitle: string }>) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <IconInput
        icon={<Search className="h-4 w-4" />}
        placeholder="Search name"
        value={name}
        onChange={(v) => onChange({ name: v })}
      />
      <IconInput
        icon={<Search className="h-4 w-4" />}
        placeholder="Employee ID"
        value={employeeId}
        onChange={(v) => onChange({ employeeId: v })}
      />
      <IconInput
        icon={<Search className="h-4 w-4" />}
        placeholder="Job title"
        value={jobTitle}
        onChange={(v) => onChange({ jobTitle: v })}
      />
    </div>
  )
}

function PaginationBar({
  currentPage,
  totalPages,
  limit,
  onPage,
  onLimit,
}: {
  currentPage: number
  totalPages: number
  limit: number
  onPage: (page: number) => void
  onLimit: (limit: number) => void
}) {
  return (
    <div className="mt-4 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={currentPage === 1}
          onClick={() => onPage(currentPage - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={currentPage === totalPages || totalPages === 0}
          onClick={() => onPage(currentPage + 1)}
        >
          Next
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Page {currentPage} of {Math.max(totalPages, 1)}
      </p>

      <div className="flex items-center gap-2">
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          Rows per page
        </span>
        <Select value={String(limit)} onValueChange={(v) => onLimit(Number(v))}>
          <SelectTrigger className="w-[72px]" size="sm">
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
  )
}

function IconInput({
  icon,
  placeholder,
  value,
  onChange,
}: {
  icon: React.ReactNode
  placeholder: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
        {icon}
      </div>
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-8"
      />
    </div>
  )
}

export default Supervisor
