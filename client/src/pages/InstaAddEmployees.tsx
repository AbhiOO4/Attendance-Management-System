import { api } from "@/lib/api"
import { formatLocalTime12h } from "@/lib/dateUtils"

import {
    useEffect,
    useState,
} from "react"

import {
    useParams,
} from "react-router-dom"

import toast from "react-hot-toast"

import axios from "axios"

import { useNavigate, useLocation } from "react-router-dom"

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
    Briefcase,
    Clock3,
    AlertCircle
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

import { Label } from "@/components/ui/label"

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

    employmentType?: 'permanent' | 'temporary'
}

interface EmployeeResponse {
    employees: Employee[]

    page: number

    totalPages: number

    total: number
}

type Job = {
    _id: string,
    name: string,
    isActive?: boolean,
    isDeleted?: boolean,
    isCompleted?: boolean
}

type OverlapError = {
    employeeId: string
    conflictingSession: {
        siteId: string
        siteName: string
        checkIn: string | null
        checkOut: string | null
    }
}

// A session the employee already has at another site TODAY (read-only, informational).
type DaySession = {
    siteId: string
    siteName: string
    checkIn: string | null
    checkOut: string | null
    rawCheckIn: string | null
    rawCheckOut: string | null
    isOpen: boolean
}

function InstaAddEmployees() {
    const { siteId } = useParams()

    const navigate = useNavigate()

    const location = useLocation()

    // Opened from SiteDetail (admin) → schedule the add for tomorrow: no check-in,
    // no today session. Opened from SiteAttendance → instant add (unchanged).
    const from = location.state?.from as string | undefined
    const deferred = from === "site-detail"

    // Where the back button returns to. The embedded SiteDetail roster passes its
    // own path so Add returns there; other entry points fall back to hired-workers.
    const returnTo = location.state?.returnTo as string | undefined

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

    const [checkInTime, setCheckInTime] = useState("")
    const [submitting, setSubmitting] = useState(false)
    const [overlapError, setOverlapError] = useState<OverlapError | null>(null)

    // Instant add only: ON = carry a session for today without moving the employee's home
    // site (a one-day visit); OFF (default) = permanently move them here. For a supervisor
    // this also decides whether their attendance assignment follows (auth = home).
    const [onlyForToday, setOnlyForToday] = useState(false)

    // Instant add only: the employee's existing sessions at OTHER sites today.
    const [daySessions, setDaySessions] = useState<DaySession[]>([])
    const [daySessionsLoading, setDaySessionsLoading] = useState(false)

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

    // Instant add only: when the confirm modal opens for an employee, fetch any sessions
    // they already have at OTHER sites today so the supervisor can spot a same-day
    // conflict before entering a check-in. Deferred (tomorrow) adds create no session
    // today, so this is skipped for them.
    useEffect(() => {
        if (deferred || !confirmOpen || !selectedEmployee) {
            setDaySessions([])
            return
        }

        let cancelled = false

        const fetchDaySessions = async () => {
            try {
                setDaySessionsLoading(true)
                const res = await api.get("/api/attendance/employee-day-sessions", {
                    params: {
                        employeeId: selectedEmployee._id,
                        excludeSiteId: siteId,
                    },
                })
                if (!cancelled) {
                    setDaySessions(res.data?.data?.sessions ?? [])
                }
            } catch (error) {
                console.log(error)
                if (!cancelled) {
                    setDaySessions([])
                }
            } finally {
                if (!cancelled) {
                    setDaySessionsLoading(false)
                }
            }
        }

        fetchDaySessions()

        return () => {
            cancelled = true
        }
    }, [confirmOpen, selectedEmployee, deferred, siteId])

    const openConfirmModal = (employee: Employee) => {
        setSelectedEmployee(employee)
        setSelectedJob(null)
        setCheckInTime("")
        setOverlapError(null)
        setDaySessions([])
        setOnlyForToday(false)
        setConfirmOpen(true)
    }

    const instaAdd = async (employeeId: string, jobId: string | null, checkIn: string): Promise<boolean> => {
        try {
            await api.post(`/api/site/${siteId}/insta-add-employee`, {
                empId: employeeId,
                currentJob: jobId,
                // Deferred adds carry no check-in — they only take effect tomorrow.
                // onlyForToday applies to instant adds only (a one-day visit vs a move).
                ...(deferred ? { deferred: true } : { checkInTime: checkIn, onlyForToday }),
            })
            toast.success(
                deferred
                    ? "Employee scheduled — starts tomorrow"
                    : onlyForToday
                    ? "Session added for today"
                    : "Employee added successfully"
            )

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
            return true
        } catch (error) {
            console.log(error)
            if (axios.isAxiosError(error) && error.response?.data?.overlap) {
                setOverlapError(error.response.data.overlap)
                toast.error(error.response.data.message || "Check-in time overlaps with an existing session")
            } else {
                toast.error("Couldn't add employee!")
            }
            return false
        }
    }

    const confirmAdd = async () => {
        if (!selectedEmployee) return

        if (!deferred && !checkInTime) {
            toast.error("Check-in time is required")
            return
        }

        setSubmitting(true)
        const success = await instaAdd(selectedEmployee._id, selectedJob, checkInTime)
        setSubmitting(false)

        if (success) {
            setConfirmOpen(false)
            setSelectedEmployee(null)
            setSelectedJob(null)
            setCheckInTime("")
            setOverlapError(null)
        }
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
                                navigate(
                                    returnTo || `/attendance/${siteId}/hired-workers`,
                                    { state: { from } }
                                )
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
                                {deferred
                                    ? "Assign employees to this site — the change takes effect tomorrow."
                                    : "Quickly assign employees to this site and today's attendance."}
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
                                                        {employee.employmentType === 'temporary' && (
                                                            <Badge variant="secondary" className="text-[10px] font-medium py-0 px-2 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/30">
                                                                Temporary
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </div>
                                                <Button
                                                    size="sm"
                                                    onClick={() => openConfirmModal(employee)}
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
                                                    Employee ID
                                                </TableHead>
                                                <TableHead>
                                                    Job Title
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
                                            {employees.map((employee) => (
                                                <TableRow key={employee._id} className="transition-colors hover:bg-muted/50">
                                                    <TableCell>
                                                        <div className="font-medium text-foreground flex items-center gap-2">
                                                            {employee.name}
                                                            {employee.user && (
                                                                <Badge variant="secondary">
                                                                    Supervisor
                                                                </Badge>
                                                            )}
                                                            {employee.employmentType === 'temporary' && (
                                                                <Badge variant="secondary" className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/30 text-[10px] px-1.5 py-0">
                                                                    Temporary
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="font-mono text-xs text-muted-foreground">
                                                        {employee.employeeId}
                                                    </TableCell>
                                                    <TableCell className="text-sm">
                                                        {employee.jobTitle}
                                                    </TableCell>
                                                    <TableCell className="font-medium text-foreground text-sm">
                                                        {employee.currentSite?.siteName || "-"}
                                                    </TableCell>
                                                    <TableCell className="text-sm text-muted-foreground">
                                                        {employee.currentJob?.name || "-"}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <Button
                                                            size="sm"
                                                            onClick={() => openConfirmModal(employee)}
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
                onOpenChange={(open) => {
                    setConfirmOpen(open)
                    if (!open) {
                        setCheckInTime("")
                        setOverlapError(null)
                    }
                }}
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
                                            {selectedEmployee.employmentType === 'temporary' && (
                                                <Badge variant="secondary" className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/30 text-[10px] font-medium py-0 px-1.5 h-4">
                                                    Temporary
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

                                    {site?.jobs?.filter(job => job.isActive !== false && !job.isDeleted && !job.isCompleted).map((job) => (
                                        <SelectItem key={job._id} value={job._id}>
                                            {job.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {deferred ? (
                            <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                                <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                                <span>
                                    This assignment takes effect <strong className="text-foreground">tomorrow</strong> —
                                    no check-in time is needed. The employee will appear on{" "}
                                    <strong className="text-foreground">{site?.siteName}</strong>'s roster from then.
                                </span>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {/* Cross-site visibility: any sessions this employee already
                                    has at OTHER sites today. Neutral info — a multi-site day
                                    is legitimate; only the supervisor knows if it's a mistake. */}
                                {daySessionsLoading ? (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        Checking other sites...
                                    </div>
                                ) : daySessions.length > 0 ? (
                                    <div className="rounded-xl border border-amber-200/70 bg-amber-50 p-3 space-y-1.5 text-amber-800 dark:bg-amber-950/20 dark:border-amber-800/30 dark:text-amber-200">
                                        <div className="font-medium flex items-center gap-1.5 text-sm">
                                            <AlertCircle className="h-4 w-4 shrink-0" />
                                            Already recorded today at another site
                                        </div>
                                        <ul className="space-y-1 text-xs">
                                            {daySessions.map((s, idx) => (
                                                <li key={`${s.siteId}-${idx}`} className="flex items-center gap-1.5">
                                                    <MapPin className="h-3.5 w-3.5 shrink-0 opacity-70" />
                                                    <span className="font-medium">{s.siteName}</span>
                                                    <span className="opacity-80">
                                                        {formatLocalTime12h(s.checkIn)}
                                                        {s.isOpen
                                                            ? " (no check-out)"
                                                            : ` - ${formatLocalTime12h(s.checkOut)}`}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                        <p className="text-[11px] opacity-80 leading-snug">
                                            This may be an intentional multi-site day. If it's a mistake, ask that
                                            site's supervisor or an admin to remove the session before adding here.
                                        </p>
                                    </div>
                                ) : null}

                                <label className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-3 cursor-pointer hover:border-primary/20 transition-colors">
                                    <input
                                        type="checkbox"
                                        className="h-4 w-4 accent-primary mt-0.5"
                                        checked={onlyForToday}
                                        onChange={(e) => setOnlyForToday(e.target.checked)}
                                    />
                                    <div className="flex-1 min-w-0 space-y-0.5">
                                        <p className="text-sm font-semibold text-foreground">Only for today</p>
                                        <p className="text-xs text-muted-foreground leading-snug">
                                            {onlyForToday
                                                ? selectedEmployee?.user
                                                    ? "A visit for today only — home site and attendance assignment stay unchanged; back on their own site tomorrow."
                                                    : "A visit for today only — home site stays unchanged; back on it tomorrow."
                                                : selectedEmployee?.user
                                                ? "Permanent — home site and attendance assignment move to this site."
                                                : "Permanent — home site moves to this site from today."}
                                        </p>
                                    </div>
                                </label>

                                <div className="space-y-2.5">
                                    <div className="flex items-center gap-1.5">
                                        <Clock3 className="h-4 w-4 text-muted-foreground" />
                                        <Label className="text-sm font-semibold text-foreground">Check-in Time</Label>
                                        <Badge variant="secondary" className="text-[10px] font-medium py-0 px-1.5 h-4 bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300 border border-red-200/50 dark:border-red-800/30">
                                            Required
                                        </Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Enter the check-in time for this employee at <strong>{site?.siteName}</strong>.
                                    </p>

                                    <Input
                                        type="time"
                                        value={checkInTime}
                                        onChange={(e) => {
                                            setCheckInTime(e.target.value)
                                            setOverlapError(null)
                                        }}
                                        className="w-full bg-background border-input shadow-sm hover:border-accent mt-1"
                                    />

                                    {overlapError && (
                                        <div className="p-3 bg-red-50 border border-red-200 rounded-xl space-y-1 text-sm text-red-700 dark:bg-red-950/20 dark:border-red-800/30 dark:text-red-200">
                                            <div className="font-medium flex items-center gap-1.5">
                                                <AlertCircle className="h-4 w-4 shrink-0" />
                                                Conflicts with existing session
                                            </div>
                                            <div>
                                                Site: {overlapError.conflictingSession.siteName}
                                            </div>
                                            <div>
                                                Time: {formatLocalTime12h(overlapError.conflictingSession.checkIn)}
                                                {overlapError.conflictingSession.checkOut
                                                    ? ` - ${formatLocalTime12h(overlapError.conflictingSession.checkOut)}`
                                                    : " (no check-out)"}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    <DialogFooter className="px-6 py-4 bg-muted/30 border-t border-border/40 flex sm:justify-end gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setConfirmOpen(false)}
                            disabled={submitting}
                            className="w-full sm:w-auto"
                        >
                            Cancel
                        </Button>

                        <Button
                            onClick={confirmAdd}
                            disabled={submitting || (!deferred && !checkInTime)}
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5"
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    {deferred ? "Scheduling..." : "Adding..."}
                                </>
                            ) : (
                                <>
                                    <UserPlus className="h-4 w-4" />
                                    {deferred ? "Schedule for Tomorrow" : "Confirm Add"}
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

        </div>
    )
}

export default InstaAddEmployees