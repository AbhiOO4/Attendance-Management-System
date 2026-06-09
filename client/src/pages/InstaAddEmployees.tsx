import { api } from "@/lib/api"

import {
    useEffect,
    useState,
} from "react"

import {
    useParams,
} from "react-router-dom"

import toast from "react-hot-toast"


import { useNavigate } from "react-router-dom"

import {
    Card,
    CardContent,
    CardHeader,
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
    ArrowLeft,
    MapPin,
    Briefcase
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

type Job = {
    _id: string,
    name: string
}

function InstaAddEmployees() {
    const { siteId } = useParams()

    const navigate = useNavigate()

    const [loading, setLoading] =
        useState(true)

    const [searching, setSearching] =
        useState(false)

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
        jobs: Job[]
        isActive: boolean
    }

    const [sites, setSites] = useState<Site[]>([])

    const [site, setSite] = useState<Site | null>(null)

    const [selectedJob, setSelectedJob] = useState<string | null>(null)

    const [filters, setFilters] = useState({
        name: "",
        employeeId: "",
        jobTitle: "",
        currentSite: "",
    })

    const [activeFilters, setActiveFilters] = useState(filters)

    const fetchSites = async () => {
        try {
            const res = await api.get("/api/site", {
                params: {
                    isActive: true
                }
            })

            setSites(res.data || [])
        } catch (error) {
            console.log(error)
        }
    }

    const fetchSite = async () => {
        try {
            const res = await api.get(`/api/site/${siteId}`)

            setSite(res.data)

        } catch (error) {
            console.log(error)
        }
    }

    const fetchEmployees =
        async () => {
            try {
                if (!loading) {
                    setSearching(true)
                }

                const params = {
                    page,
                    name: activeFilters.name,
                    employeeId: activeFilters.employeeId,
                    jobTitle: activeFilters.jobTitle,
                    currentSite:
                        activeFilters.currentSite === "all"
                            ? ""
                            : activeFilters.currentSite,
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
                setSearching(false)
            }
        }

    useEffect(() => {
        fetchSite()
        fetchSites()
    }, [])

    // Debounce filters updates, reset page to 1 on filter changes
    useEffect(() => {
        const handler = setTimeout(() => {
            setActiveFilters(filters)
            setPage(1)
        }, 300)

        return () => {
            clearTimeout(handler)
        }
    }, [filters])

    // Re-fetch when page or active filters change
    useEffect(() => {
        fetchEmployees()
    }, [page, activeFilters])

    const instaAdd = async (employeeId: string, jobId: string | null) => {
        try {
            await api.post(`/api/site/${siteId}/insta-add-employee`, { empId: employeeId, currentJob: jobId })
            toast.success("Employee Added successfully")
            
            // Clear draft cache for this site so SiteAttendance page fetches fresh employees list
            if (siteId) {
                Object.keys(localStorage).forEach((key) => {
                    if (key.startsWith(`attendance_draft_${siteId}_`)) {
                        localStorage.removeItem(key)
                    }
                })
                localStorage.removeItem(`active_inline_edit_row_${siteId}`)
                localStorage.removeItem(`active_inline_edit_data_${siteId}`)
            }

            setEmployees((prev) =>
                prev.filter((emp) => emp._id !== employeeId)
            )
        } catch (error) {
            console.log(error)
            toast.error("Couldn't add employee!")
        }
    }

    const confirmAdd = async () => {
        if (!selectedEmployee) return

        await instaAdd(selectedEmployee._id, selectedJob)

        setConfirmOpen(false)
        setSelectedEmployee(null)
        setSelectedJob(null)
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

                            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                                Add New Employees
                                {searching && (
                                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                )}
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

                </CardContent>
            </Card>

            <Card>
                <CardContent className="pt-6">

                    <div className={`transition-opacity duration-200 ${searching ? "opacity-50 pointer-events-none" : ""}`}>
                        {employees.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                                <div className="text-muted-foreground text-lg font-medium mb-1">
                                    No employees found
                                </div>
                                <p className="text-sm text-muted-foreground max-w-sm">
                                    Try adjusting your search or filter options to find the employees you are looking for.
                                </p>
                            </div>
                        ) : (
                            <>
                                {/* Mobile View: Card List */}
                                <div className="grid gap-4 sm:grid-cols-2 md:hidden">
                                    {employees.map((employee) => (
                                        <div
                                            key={employee._id}
                                            className="group relative rounded-xl border border-border bg-card p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-primary/20"
                                        >
                                            <div className="flex justify-between items-start gap-4">
                                                <div className="space-y-1.5">
                                                    <div className="font-semibold text-foreground text-sm tracking-tight group-hover:text-primary transition-colors">
                                                        {employee.name}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground font-mono">
                                                        ID: {employee.employeeId}
                                                    </div>
                                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                                        <Badge variant="outline" className="text-[10px] font-medium py-0 px-2">
                                                            {employee.jobTitle}
                                                        </Badge>
                                                        {employee.user && (
                                                            <Badge variant="secondary" className="text-[10px] font-medium py-0 px-2 bg-secondary/80 text-secondary-foreground">
                                                                Supervisor
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </div>
                                                <Button
                                                    size="sm"
                                                    onClick={() => {
                                                        setSelectedEmployee(employee)
                                                        setSelectedJob(null)
                                                        setConfirmOpen(true)
                                                    }}
                                                    className="shrink-0 transition-transform active:scale-95 duration-100"
                                                >
                                                    <UserPlus className="h-4 w-4 mr-1.5" />
                                                    Add
                                                </Button>
                                            </div>

                                            <div className="mt-4 pt-3 border-t border-border/60 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                                                <div>
                                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Current Site</div>
                                                    <div className="font-medium text-foreground truncate mt-0.5">
                                                        {employee.currentSite?.siteName || "Unassigned"}
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Current Job</div>
                                                    <div className="font-medium text-foreground truncate mt-0.5">
                                                        {employee.currentJob?.name || "-"}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Desktop View: Table */}
                                <div className="hidden md:block">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>
                                                    Employee
                                                </TableHead>
                                                <TableHead>
                                                    Current Site
                                                </TableHead>
                                                <TableHead className="text-right">
                                                    Action
                                                </TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {employees.map((employee) => (
                                                <TableRow key={employee._id} className="transition-colors hover:bg-muted/50">
                                                    <TableCell>
                                                        <div className="space-y-1">
                                                            <div className="font-medium text-foreground">
                                                                {employee.name}
                                                                {employee.user && (
                                                                    <Badge variant="secondary" className="ml-2">
                                                                        Supervisor
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                            <div className="text-xs text-muted-foreground font-mono">
                                                                {employee.employeeId}
                                                            </div>
                                                            <div className="text-xs text-muted-foreground">
                                                                {employee.jobTitle}
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="font-medium text-foreground">
                                                            {employee.currentSite?.siteName || "-"}
                                                        </div>
                                                        <div className="text-xs text-muted-foreground">
                                                            {employee.currentJob?.name || "-"}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <Button
                                                            size="sm"
                                                            onClick={() => {
                                                                setSelectedEmployee(employee)
                                                                setSelectedJob(null)
                                                                setConfirmOpen(true)
                                                            }}
                                                        >
                                                            <UserPlus className="h-4 w-4 mr-2" />
                                                            Add
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>

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
                            </>
                        )}
                    </div>

                </CardContent>
            </Card>

            <Dialog
                open={confirmOpen}
                onOpenChange={
                    setConfirmOpen
                }
            >
                <DialogContent className="sm:max-w-[460px] rounded-2xl overflow-hidden p-0 border border-border bg-card shadow-2xl">
                    <DialogHeader className="px-6 pt-6 pb-4 bg-muted/30 border-b border-border/40">
                        <DialogTitle className="text-xl font-bold flex items-center gap-2 text-foreground">
                            <UserPlus className="h-5 w-5 text-primary" />
                            Confirm Employee Add
                        </DialogTitle>
                    </DialogHeader>

                    <div className="p-6 space-y-6">
                        {/* Employee Profile Card */}
                        {selectedEmployee && (
                            <div className="relative rounded-xl border border-border bg-card p-4 shadow-sm flex items-start gap-4 transition-all duration-200 hover:border-primary/20">
                                <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-lg shrink-0">
                                    {selectedEmployee.name
                                        ? selectedEmployee.name.split(' ').filter(Boolean).map(n => n[0]).join('').substring(0, 2).toUpperCase()
                                        : "EE"}
                                </div>
                                <div className="space-y-2.5 min-w-0 flex-1">
                                    <div>
                                        <h3 className="font-bold text-foreground leading-tight text-base flex flex-wrap items-center gap-2">
                                            {selectedEmployee.name}
                                            {selectedEmployee.user && (
                                                <Badge variant="secondary" className="bg-secondary/80 text-secondary-foreground text-[10px] font-medium py-0 px-1.5 h-4">
                                                    Supervisor
                                                </Badge>
                                            )}
                                        </h3>
                                        <p className="text-xs text-muted-foreground mt-0.5">{selectedEmployee.jobTitle}</p>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3 pt-2 text-xs border-t border-border/60">
                                        <div className="space-y-0.5">
                                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Employee ID</div>
                                            <div className="font-mono font-medium text-foreground">{selectedEmployee.employeeId}</div>
                                        </div>
                                        <div className="space-y-0.5">
                                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Current Site</div>
                                            <div className="font-medium text-foreground truncate flex items-center gap-1">
                                                <MapPin className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                                                <span className="truncate">{selectedEmployee.currentSite?.siteName || "Unassigned"}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Job Assignment Selector */}
                        <div className="space-y-2.5">
                            <div className="flex items-center gap-1.5">
                                <Briefcase className="h-4 w-4 text-muted-foreground" />
                                <label className="text-sm font-semibold text-foreground">Assign Job Role</label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Select a job from site <strong>{site?.siteName}</strong> to assign to this employee.
                            </p>

                            <Select
                                value={selectedJob ?? "none"}
                                onValueChange={(value) =>
                                    setSelectedJob(value === "none" ? null : value)
                                }
                            >
                                <SelectTrigger className="w-full bg-background border-input shadow-sm hover:border-accent mt-1">
                                    <SelectValue placeholder="Select job (optional)" />
                                </SelectTrigger>

                                <SelectContent>
                                    <SelectItem value="none">
                                        Don't assign job
                                    </SelectItem>

                                    {site?.jobs?.map((job) => (
                                        <SelectItem key={job._id} value={job._id}>
                                            {job.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <DialogFooter className="px-6 py-4 bg-muted/30 border-t border-border/40 flex sm:justify-end gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setConfirmOpen(false)}
                            className="w-full sm:w-auto"
                        >
                            Cancel
                        </Button>

                        <Button
                            onClick={confirmAdd}
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5"
                        >
                            <UserPlus className="h-4 w-4" />
                            Confirm Add
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

        </div>
    )
}

export default InstaAddEmployees