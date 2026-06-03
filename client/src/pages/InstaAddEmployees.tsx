import { api } from "@/lib/api"

import {
    useEffect,
    useState,
} from "react"

import {
    useParams,
} from "react-router-dom"

import toast from "react-hot-toast"


import {useNavigate} from "react-router-dom"

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"

import {
    Button,
} from "@/components/ui/button"

import {
    Input,
} from "@/components/ui/input"

import {
    Badge,
} from "@/components/ui/badge"

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"

import {
    Loader2,
    UserPlus,
    ArrowLeft
} from "lucide-react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"

interface Employee {
    _id: string

    name: string

    employeeId: string

    jobTitle: string

    user: string | null

    currentSite: {
        _id: string
        siteName: string
    } | null

    currentJob: {
        _id: string
        name: string
    } | null
}

interface EmployeeResponse {
    employees: Employee[]

    page: number

    totalPages: number

    total: number
}

function InstaAddEmployees() {
    const { siteId } = useParams()

    const navigate = useNavigate()

    const [loading, setLoading] =
        useState(true)

    const [employees, setEmployees] =
        useState<Employee[]>([])

    const [page, setPage] =
        useState(1)

    const [totalPages, setTotalPages] =
        useState(1)

    const [selectedEmployee, setSelectedEmployee] =
        useState<Employee | null>(null)

    const [confirmOpen, setConfirmOpen] =
        useState(false)

    interface Site {
        _id: string
        siteName: string
        locationDetails: string
        isActive: boolean
    }

    const [sites, setSites] = useState<Site[]>([])

    const [filters, setFilters] = useState({
        name: "",
        employeeId: "",
        jobTitle: "",
        currentSite: "",
    })

    const fetchSites = async () => {
        try {
            const res = await api.get("/api/site")

            setSites(res.data || [])
        } catch (error) {
            console.log(error)
        }
    }

    const fetchEmployees =
        async () => {
            try {
                setLoading(true)

                const params = {
                    page,
                    name: filters.name,
                    employeeId: filters.employeeId,
                    jobTitle: filters.jobTitle,
                    currentSite:
                        filters.currentSite === "all"
                            ? ""
                            : filters.currentSite,
                }

                const res =
                    await api.get<EmployeeResponse>(
                        `/api/site/${siteId}/employees`,
                        {
                            params,
                        }
                    )

                setEmployees(
                    res.data.employees
                )

                setTotalPages(
                    res.data.totalPages
                )
            } catch (error) {
                console.log(error)

                toast.error(
                    "Failed to fetch employees"
                )
            } finally {
                setLoading(false)
            }
        }

    useEffect(() => {
        fetchSites()
    }, [])

    useEffect(() => {
        fetchEmployees()
    }, [page])

    const handleSearch = () => {
        setPage(1)
        fetchEmployees()
    }

    const instaAdd = async (employeeId: string) => {
        try{
            await api.post(`/api/site/${siteId}/insta-add-employee`, {empId: employeeId})
            toast.success("Employee Added successfully")
        }catch(error){
            console.log(error)
            toast.error("Couldn't add employee!")
        }
    }

    const confirmAdd =
        async () => {
            if (!selectedEmployee)
                return

            await instaAdd(
                selectedEmployee._id
            )

            setConfirmOpen(false)

            setSelectedEmployee(null)
        }

    if (loading) {
        return (
            <div className="flex justify-center items-center h-[60vh]">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        )
    }

    return (
        <div className="p-6 space-y-6">

            <Card>
                <CardHeader>

                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">

                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() =>
                                navigate(`/attendance/${siteId}`)
                            }
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </Button>

                        <div>

                            <h1 className="text-3xl font-bold tracking-tight">
                                Insta Add Employees
                            </h1>

                            <p className="text-sm text-muted-foreground mt-1">
                                Quickly assign employees to this site and today's attendance.
                            </p>

                        </div>

                    </div>

                </CardHeader>
            </Card>

            <Card>
                <CardContent className="pt-6">

                    <div className="grid gap-4 md:grid-cols-4">

                        <Input
                            placeholder="Search Name"
                            value={filters.name}
                            onChange={(e) =>
                                setFilters(
                                    (prev) => ({
                                        ...prev,
                                        name:
                                            e.target.value,
                                    })
                                )
                            }
                        />

                        <Input
                            placeholder="Employee ID"
                            value={
                                filters.employeeId
                            }
                            onChange={(e) =>
                                setFilters(
                                    (prev) => ({
                                        ...prev,
                                        employeeId:
                                            e.target.value,
                                    })
                                )
                            }
                        />

                        <Input
                            placeholder="Job Title"
                            value={
                                filters.jobTitle
                            }
                            onChange={(e) =>
                                setFilters(
                                    (prev) => ({
                                        ...prev,
                                        jobTitle:
                                            e.target.value,
                                    })
                                )
                            }
                        />

                        <Select
                            value={filters.currentSite}
                            onValueChange={(value) =>
                                setFilters((prev) => ({
                                    ...prev,
                                    currentSite: value,
                                }))
                            }
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Current Site" />
                            </SelectTrigger>

                            <SelectContent>

                                <SelectItem value="all">
                                    All Sites
                                </SelectItem>

                                <SelectItem value="unassigned">
                                    Unassigned
                                </SelectItem>

                                {sites.filter((site) => site._id !== siteId)
                                .map((site) => (
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

                    <div className="mt-4">
                        <Button
                            onClick={
                                handleSearch
                            }
                        >
                            Search
                        </Button>
                    </div>

                </CardContent>
            </Card>

            <Card>
                <CardContent className="pt-6">

                    <Table>

                        <TableHeader>
                            <TableRow>
                                <TableHead>
                                    Employee
                                </TableHead>

                                <TableHead>
                                    Current Site
                                </TableHead>

                                <TableHead>
                                    Current Job
                                </TableHead>

                                <TableHead className="text-right">
                                    Action
                                </TableHead>
                            </TableRow>
                        </TableHeader>

                        <TableBody>

                            {employees.map(
                                (employee) => (
                                    <TableRow
                                        key={
                                            employee._id
                                        }
                                    >
                                        <TableCell>
                                            <div className="space-y-1">

                                                <div className="font-medium">
                                                    {employee.name}
                                                </div>

                                                <div className="text-xs text-muted-foreground">
                                                    {employee.employeeId}
                                                </div>

                                                <div className="text-xs text-muted-foreground">
                                                    {employee.jobTitle}
                                                </div>

                                                {employee.user && (
                                                    <Badge variant="secondary">
                                                        Supervisor
                                                    </Badge>
                                                )}

                                            </div>
                                        </TableCell>

                                        <TableCell>
                                            {employee
                                                .currentSite
                                                ?.siteName ||
                                                "-"}
                                        </TableCell>

                                        <TableCell>
                                            {employee
                                                .currentJob
                                                ?.name || "-"}
                                        </TableCell>

                                        <TableCell className="text-right">

                                            <Button
                                                size="sm"
                                                onClick={() => {
                                                    setSelectedEmployee(
                                                        employee
                                                    )

                                                    setConfirmOpen(
                                                        true
                                                    )
                                                }}
                                            >
                                                <UserPlus className="h-4 w-4 mr-2" />
                                                Add
                                            </Button>

                                        </TableCell>

                                    </TableRow>
                                )
                            )}

                        </TableBody>

                    </Table>

                    <div className="flex justify-between items-center mt-6">

                        <Button
                            variant="outline"
                            disabled={page === 1}
                            onClick={() =>
                                setPage(
                                    (prev) =>
                                        prev - 1
                                )
                            }
                        >
                            Previous
                        </Button>

                        <span className="text-sm text-muted-foreground">
                            Page {page} of{" "}
                            {totalPages}
                        </span>

                        <Button
                            variant="outline"
                            disabled={
                                page ===
                                totalPages
                            }
                            onClick={() =>
                                setPage(
                                    (prev) =>
                                        prev + 1
                                )
                            }
                        >
                            Next
                        </Button>

                    </div>

                </CardContent>
            </Card>

            <Dialog
                open={confirmOpen}
                onOpenChange={
                    setConfirmOpen
                }
            >
                <DialogContent>

                    <DialogHeader>
                        <DialogTitle>
                            Confirm Employee Add
                        </DialogTitle>
                    </DialogHeader>

                    {selectedEmployee && (
                        <div className="space-y-3">

                            <div>
                                <strong>
                                    Name:
                                </strong>{" "}
                                {
                                    selectedEmployee.name
                                }
                            </div>

                            <div>
                                <strong>
                                    Employee ID:
                                </strong>{" "}
                                {
                                    selectedEmployee.employeeId
                                }
                            </div>

                            <div>
                                <strong>
                                    Current Site:
                                </strong>{" "}
                                {selectedEmployee
                                    .currentSite
                                    ?.siteName ||
                                    "Unassigned"}
                            </div>

                            {selectedEmployee.user && (
                                <Badge>
                                    Supervisor
                                </Badge>
                            )}

                        </div>
                    )}

                    <DialogFooter>

                        <Button
                            variant="outline"
                            onClick={() =>
                                setConfirmOpen(
                                    false
                                )
                            }
                        >
                            Cancel
                        </Button>

                        <Button
                            onClick={
                                confirmAdd
                            }
                        >
                            Confirm
                        </Button>

                    </DialogFooter>

                </DialogContent>
            </Dialog>

        </div>
    )
}

export default InstaAddEmployees