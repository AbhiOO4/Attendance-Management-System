import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import toast from "react-hot-toast"
import axios from "axios"

import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Loader2,
  UserPlus,
  Trash2,
  Pencil,
  X,
  Plane,
  Search,
  ListChecks,
  Plus,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Info,
} from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"

import {
  categoryOf,
  CATEGORY_LABELS,
  CATEGORY_IS_FOREIGN,
  type RosterCategory,
} from "@/lib/rosterUtils"
import AddTemporaryWorker from "@/components/AddTemporaryWorker"
import RemoveEmployeeDialog, {
  type RemoveMode,
} from "@/components/site/RemoveEmployeeDialog"
import { Label } from "@/components/ui/label"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"
import { getCurrentTargetDateString } from "@/lib/dateUtils"

interface JobRef {
  _id: string
  name: string
}

interface SiteRef {
  _id: string
  siteName: string
}

interface Employee {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
  user?: string | null
  employmentType: "permanent" | "temporary"
  currentSite: string | null
  currentJob: JobRef | string | null
  // Deferred ("from tomorrow") assignment, resolved by rosterForSite.
  scheduledSiteId?: SiteRef | string | null
  scheduledJobId?: JobRef | string | null
  scheduledEffectiveDate?: string | null
  // "Leaving tomorrow" — a deferred removal scheduled from the Tomorrow tab.
  scheduledRemoval?: boolean
  nationality?: "foreign" | "omani"
  collarType?: "skilled" | "staff"
  // "Only for today" visitor stash: their home stays at currentSite but they're marked
  // present here today (see empModel pendingTransfer*). Cleared on submit.
  pendingTransferSiteId?: string | null
  pendingTransferDate?: string | null
  pendingTransferFromSiteId?: SiteRef | string | null
  // Client-only markers for a post-submit session-holder whose home is another site
  // (surfaced on the Today tab from the daily report, not the rosterForSite fetch).
  __crossSite?: boolean
  __sessionJobId?: string | null
  // Client-only marker for a PRE-submit "only for today" visitor (today-dated
  // pendingTransferSiteId = this site), shown as a read-only "Visiting" row.
  __visitingToday?: boolean
}

interface Job {
  _id: string
  name: string
  isActive?: boolean
}

type DayMode = "today" | "tomorrow"
type CategoryTab = "all" | RosterCategory | "supervisor"

interface SiteRosterProps {
  siteId: string
  isSiteActive: boolean
  // Reports the size of the Today roster so the parent's stat strip can show it.
  onTodayCountChange?: (count: number) => void
  // Called after a job is created here so the parent can refresh its own job list.
  onJobsChanged?: () => void
  // Whether the current user may create jobs (POST add-job is admin-only, so the
  // supervisor view hides the inline "Add job" affordance). Defaults to true.
  canCreateJobs?: boolean
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

// ---- small field helpers (the roster fields can be populated objects or ids) ----
function refId(v: JobRef | SiteRef | string | null | undefined): string | null {
  if (!v) return null
  return typeof v === "object" ? v._id : v
}
function jobName(v: JobRef | string | null | undefined): string | null {
  return v && typeof v === "object" ? v.name : null
}

// Embedded Today / Tomorrow roster for a site (admin-facing, lives in SiteDetail).
// One rosterForSite fetch drives both tabs; membership is derived client-side:
//   Today    = employees currently on the site. Once today's attendance is submitted,
//              it becomes session-based: currentSite members PLUS cross-site visitors
//              who logged a session here (from the daily report).
//   Tomorrow = today's members minus anyone scheduled to move to another site or
//              scheduled for removal, plus incoming scheduled-adds targeting this site.
// Today actions are instant (a cross-site remove deletes only the session). Tomorrow
// actions — job change and removal — are deferred to the day-rollover cron and can be
// undone before midnight.
function SiteRoster({
  siteId,
  isSiteActive,
  onTodayCountChange,
  onJobsChanged,
  canCreateJobs = true,
}: SiteRosterProps) {
  const navigate = useNavigate()

  const [employees, setEmployees] = useState<Employee[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(false)

  const [dayTab, setDayTab] = useState<DayMode>("today")
  const [categoryTab, setCategoryTab] = useState<CategoryTab>("all")
  // Single search box matches either name or employee ID.
  const [query, setQuery] = useState("")

  // "Add hired worker" dialog, opened from the actions menu (Today tab only).
  const [tempWorkerOpen, setTempWorkerOpen] = useState(false)

  // Filter the list by job ("all" | jobId | "none" for unassigned).
  const [jobFilter, setJobFilter] = useState<string>("all")

  // Bulk "Assign jobs" selection mode.
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assignTarget, setAssignTarget] = useState<string>("") // "" | jobId | "none"
  const [assigning, setAssigning] = useState(false)

  // Add-job modal.
  const [addJobOpen, setAddJobOpen] = useState(false)
  const [creatingJob, setCreatingJob] = useState(false)
  const [jobForm, setJobForm] = useState({ name: "", jobCode: "" })
  const [jobErrors, setJobErrors] = useState({ name: "", jobCode: "", general: "" })

  // Pagination (client-side over the fully-loaded roster).
  const [pageSize, setPageSize] = useState<number>(25)
  const [currentPage, setCurrentPage] = useState(1)

  // The list is truly paginated now (no inner scroll), so a page can be tall.
  // Paging jumps the roster back to the top so you don't land at the bottom.
  const rosterRef = useRef<HTMLDivElement>(null)

  // Stacked sticky tiers (md+): section header → category sub-tabs → table head.
  // The header/sub-tab heights vary (Tomorrow banner, bulk bar, wrapping filters),
  // so we measure them and publish the heights as CSS vars for the tiers below.
  const headerRef = useRef<HTMLDivElement>(null)
  const subtabsRef = useRef<HTMLDivElement>(null)

  const [editingJobEmployeeId, setEditingJobEmployeeId] = useState<string | null>(null)
  const [updatingJobMap, setUpdatingJobMap] = useState<Record<string, boolean>>({})
  const [cancelingId, setCancelingId] = useState<string | null>(null)

  const [workerToRemove, setWorkerToRemove] = useState<Employee | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [removeMode, setRemoveMode] = useState<RemoveMode>("today-home")

  // Post-submit Today tab becomes session-based: once today's attendance is submitted
  // for this site, the Today list is the set of session-holders (which includes
  // cross-site visitors), not just the currentSite members.
  const [todaySubmitted, setTodaySubmitted] = useState(false)
  const [crossSiteRows, setCrossSiteRows] = useState<Employee[]>([])
  // Leaving-tomorrow rows are hidden by default; revealed via the actions menu.
  const [hideLeaving, setHideLeaving] = useState(true)

  // Transient info tooltip shown briefly when switching to the Tomorrow tab.
  const [tomorrowTipOpen, setTomorrowTipOpen] = useState(false)

  const [scheduleToCancel, setScheduleToCancel] = useState<Employee | null>(null)
  const [cancelScheduleOpen, setCancelScheduleOpen] = useState(false)

  const canEdit = isSiteActive

  // Plain calendar day in the app's timezone — used to keep only TODAY-dated visitors.
  const today = getCurrentTargetDateString()

  // A today-dated "only for today" visitor: home is elsewhere (currentSite !== this site)
  // but they were added here for today via pendingTransfer*. Stale (non-today) stashes are
  // ignored so an abandoned draft doesn't leave a phantom row. Mirrors SiteAttendance.
  function isTodayVisitor(e: Employee) {
    return (
      e.currentSite !== siteId &&
      !!e.pendingTransferSiteId &&
      refId(e.pendingTransferSiteId) === siteId &&
      !!e.pendingTransferDate &&
      String(e.pendingTransferDate).slice(0, 10) === today
    )
  }

  async function fetchRoster() {
    if (!siteId) return
    setLoading(true)
    try {
      const res = await api.get<{ employees: Employee[] }>("/api/employees", {
        params: { rosterForSite: siteId },
      })
      // Tag pre-submit "only for today" visitors so they render as read-only "Visiting"
      // rows on the Today tab (the server returns them via pendingTransferSiteId).
      const list = (res.data.employees || []).map((e) =>
        isTodayVisitor(e) ? { ...e, __visitingToday: true } : e
      )
      setEmployees(list)
      await fetchTodayState(list)
    } catch (error) {
      console.log(error)
      setEmployees([])
    } finally {
      setLoading(false)
    }
  }

  // Determine whether today's attendance is submitted for this site and, if so, load the
  // session-holders. Cross-site visitors (session here, but home is another site) are the
  // daily-report rows whose employee id is NOT among this site's currentSite members.
  async function fetchTodayState(homeList: Employee[]) {
    if (!siteId) {
      setTodaySubmitted(false)
      setCrossSiteRows([])
      return
    }
    try {
      const today = getCurrentTargetDateString()
      const pend = await api.post(`/api/site/${siteId}/check-pending`, { date: today })
      const submitted = !!pend.data?.status
      setTodaySubmitted(submitted)

      if (!submitted) {
        setCrossSiteRows([])
        return
      }

      const rep = await api.get<{ data: any[] }>("/api/attendance/reports/daily", {
        params: { date: today, siteId },
      })
      const rows = rep.data?.data || []
      const homeIds = new Set(
        homeList.filter((e) => e.currentSite === siteId).map((e) => e._id)
      )

      const cross: Employee[] = rows
        .filter((r) => !homeIds.has(r.employee))
        .map((r) => {
          const sess =
            (r.sessions || []).find((s: any) => refId(s.siteId) === siteId) ||
            (r.sessions || [])[0]
          return {
            _id: r.employee,
            name: r.name,
            employeeId: r.employeeId,
            jobTitle: r.jobTitle,
            user: r.user ?? null,
            employmentType: r.employmentType,
            nationality: r.nationality,
            collarType: r.collarType,
            currentSite: null,
            currentJob: null,
            __crossSite: true,
            __sessionJobId: sess ? refId(sess.jobId) : null,
          }
        })
      setCrossSiteRows(cross)
    } catch (error) {
      console.log(error)
      setTodaySubmitted(false)
      setCrossSiteRows([])
    }
  }

  async function fetchJobs() {
    if (!siteId) return
    try {
      const res = await api.get<Job[]>(`/api/site/${siteId}/Jobs`)
      setJobs(res.data)
    } catch (error) {
      console.log("Failed to fetch jobs:", error)
    }
  }

  useEffect(() => {
    fetchRoster()
    fetchJobs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId])

  // Membership predicates for this site.
  function inToday(e: Employee) {
    // On-site members plus today's "only for today" visitors (read-only "Visiting" rows).
    return e.currentSite === siteId || !!e.__visitingToday
  }
  function inTomorrow(e: Employee) {
    const hasSchedule = !!e.scheduledEffectiveDate
    const sSite = refId(e.scheduledSiteId)
    const onToday = e.currentSite === siteId
    const movingAway = hasSchedule && !!sSite && sSite !== siteId
    const incomingHere = hasSchedule && sSite === siteId
    return (onToday && !movingAway) || incomingHere
  }

  const todayCount = useMemo(
    () => employees.filter(inToday).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [employees, siteId]
  )

  useEffect(() => {
    onTodayCountChange?.(todayCount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayCount])

  // Reset to the first page whenever the visible set changes.
  useEffect(() => {
    setCurrentPage(1)
  }, [dayTab, jobFilter, query, categoryTab, pageSize])

  // Flash the "changes take effect tomorrow" note when switching to Tomorrow,
  // then auto-dismiss so it doesn't take up permanent space.
  useEffect(() => {
    if (dayTab !== "tomorrow") {
      setTomorrowTipOpen(false)
      return
    }
    setTomorrowTipOpen(true)
    const t = setTimeout(() => setTomorrowTipOpen(false), 4500)
    return () => clearTimeout(t)
  }, [dayTab])

  function goToPage(page: number) {
    setCurrentPage(page)
    rosterRef.current?.scrollIntoView({ block: "start" })
  }

  // Keep the two upper sticky tiers' heights in CSS vars so the sub-tabs pin below
  // the header and the table head pins below both. Re-runs when the header or the
  // active sub-tabs node changes (tab switch / select mode); a ResizeObserver
  // covers in-place height changes (filters wrapping on resize).
  useLayoutEffect(() => {
    const root = rosterRef.current
    if (!root) return
    const measure = () => {
      if (headerRef.current) {
        root.style.setProperty("--roster-header-h", `${headerRef.current.offsetHeight}px`)
      }
      if (subtabsRef.current) {
        root.style.setProperty("--roster-subtabs-h", `${subtabsRef.current.offsetHeight}px`)
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (headerRef.current) ro.observe(headerRef.current)
    if (subtabsRef.current) ro.observe(subtabsRef.current)
    return () => ro.disconnect()
  }, [dayTab, selectMode])

  function clearSiteDrafts() {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith(`attendance_draft_${siteId}_`)) {
        localStorage.removeItem(key)
      }
    })
    localStorage.removeItem(`active_inline_edit_row_${siteId}`)
    localStorage.removeItem(`active_inline_edit_data_${siteId}`)
  }

  async function handleJobChange(
    employeeId: string,
    jobId: string,
    mode: DayMode
  ) {
    const deferred = mode === "tomorrow"
    setUpdatingJobMap((m) => ({ ...m, [employeeId]: true }))
    try {
      const targetJobId = jobId === "unassigned" ? null : jobId
      await api.patch(`/api/site/${siteId}/employee/${employeeId}/job`, {
        jobId: targetJobId,
        ...(deferred ? { deferred: true } : {}),
      })
      toast.success(
        deferred
          ? "Job change scheduled — starts tomorrow"
          : "Employee job updated"
      )
      setEditingJobEmployeeId(null)
      if (!deferred) clearSiteDrafts()
      await fetchRoster()
    } catch (error: any) {
      console.log(error)
      toast.error(error.response?.data?.message || "Failed to update job")
    } finally {
      setUpdatingJobMap((m) => ({ ...m, [employeeId]: false }))
    }
  }

  async function cancelSchedule(employeeId: string) {
    setCancelingId(employeeId)
    try {
      await api.delete(`/api/site/${siteId}/employee/${employeeId}/scheduled`)
      toast.success("Scheduled change cancelled")
      await fetchRoster()
    } catch (error: any) {
      console.log(error)
      toast.error(
        error.response?.data?.message || "Failed to cancel scheduled change"
      )
    } finally {
      setCancelingId(null)
    }
  }

  async function addTempWorker(newEmployee: any) {
    try {
      await api.post("/api/employees", newEmployee)
      toast.success("Temporary worker added")
      await fetchRoster()
    } catch (error) {
      console.log(error)
      if (axios.isAxiosError(error)) {
        toast.error(error.response?.data?.message || "Failed to add worker")
      } else {
        toast.error("Something went wrong")
      }
    }
  }

  function goToAddEmployees() {
    navigate(`/attendance/${siteId}/insta-add`, {
      state:
        dayTab === "tomorrow"
          ? { from: "site-detail", returnTo: `/site/${siteId}` }
          : { returnTo: `/site/${siteId}` },
    })
  }

  function changeDayTab(next: DayMode) {
    setDayTab(next)
    setEditingJobEmployeeId(null)
    // Selection is per-tab (today = immediate, tomorrow = deferred) — reset on switch.
    setSelected(new Set())
  }

  // ---- bulk "Assign jobs" helpers ----
  function isRowSelectable(e: Employee) {
    // Only real on-site roster members can be bulk-assigned (not cross-site visitors,
    // and not pre-submit "only for today" visitors).
    return e.currentSite === siteId && !e.__crossSite && !e.__visitingToday
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelected(new Set())
    setAssignTarget("")
  }

  async function submitBulkAssign() {
    const empIds = [...selected]
    if (empIds.length === 0 || assignTarget === "") return
    const deferred = dayTab === "tomorrow"
    const jobId = assignTarget === "none" ? null : assignTarget
    setAssigning(true)
    try {
      await api.patch(`/api/site/${siteId}/employees/job`, {
        empIds,
        jobId,
        deferred,
      })
      toast.success(
        deferred ? "Job change scheduled — starts tomorrow" : "Jobs updated"
      )
      if (!deferred) clearSiteDrafts()
      exitSelectMode()
      await fetchRoster()
    } catch (error: any) {
      console.log(error)
      toast.error(error?.response?.data?.message || "Failed to assign jobs")
    } finally {
      setAssigning(false)
    }
  }

  // ---- inline Add-job modal ----
  function validateJobForm() {
    const errors = { name: "", jobCode: "", general: "" }
    let valid = true
    if (!jobForm.name.trim()) {
      errors.name = "Job name is required"
      valid = false
    }
    if (!jobForm.jobCode.trim()) {
      errors.jobCode = "Job code is required"
      valid = false
    }
    setJobErrors(errors)
    return valid
  }

  async function createJobInline() {
    if (!validateJobForm()) return
    setCreatingJob(true)
    try {
      await api.post(`/api/site/${siteId}/add-job`, {
        name: jobForm.name.trim(),
        jobCode: jobForm.jobCode.trim(),
      })
      setJobForm({ name: "", jobCode: "" })
      setJobErrors({ name: "", jobCode: "", general: "" })
      setAddJobOpen(false)
      toast.success("Job created")
      await fetchJobs()
      onJobsChanged?.()
    } catch (error: any) {
      setJobErrors((prev) => ({
        ...prev,
        general: error?.response?.data?.message || "Failed to create job",
      }))
    } finally {
      setCreatingJob(false)
    }
  }

  // ---- per-mode derived lists ----
  function listForMode(mode: DayMode) {
    let dayList = employees.filter(mode === "today" ? inToday : inTomorrow)
    // Post-submit, the Today list also includes cross-site session-holders.
    if (mode === "today" && todaySubmitted) {
      dayList = [...dayList, ...crossSiteRows]
    }
    // The "hide leaving" toggle drops scheduled-for-removal rows from Tomorrow.
    if (mode === "tomorrow" && hideLeaving) {
      dayList = dayList.filter((e) => !e.scheduledRemoval)
    }
    const q = query.trim().toLowerCase()
    const searched = dayList.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.employeeId.toLowerCase().includes(q)
    )
    // Filter by job — today keys off the current job, tomorrow off the effective
    // scheduled-or-current job (rowInfo.selectValue). "none" = unassigned / No job.
    if (jobFilter === "all") return searched
    return searched.filter((e) => {
      const jid =
        mode === "today"
          ? refId(e.currentJob)
          : rowInfo(e, mode).selectValue === "unassigned"
          ? null
          : rowInfo(e, mode).selectValue
      return jobFilter === "none" ? jid === null : jid === jobFilter
    })
  }

  function categoryTabsFor(list: Employee[]) {
    const counts: Record<RosterCategory, number> = {
      foreignSkilled: 0,
      foreignStaff: 0,
      omaniSkilled: 0,
      omaniStaff: 0,
    }
    let supervisor = 0
    for (const e of list) {
      counts[categoryOf(e.collarType, e.nationality)]++
      if (e.user) supervisor++
    }
    return [
      { key: "all" as CategoryTab, label: "All", count: list.length, foreign: false },
      {
        key: "foreignSkilled" as CategoryTab,
        label: CATEGORY_LABELS.foreignSkilled,
        count: counts.foreignSkilled,
        foreign: CATEGORY_IS_FOREIGN.foreignSkilled,
      },
      {
        key: "foreignStaff" as CategoryTab,
        label: CATEGORY_LABELS.foreignStaff,
        count: counts.foreignStaff,
        foreign: CATEGORY_IS_FOREIGN.foreignStaff,
      },
      {
        key: "omaniSkilled" as CategoryTab,
        label: CATEGORY_LABELS.omaniSkilled,
        count: counts.omaniSkilled,
        foreign: CATEGORY_IS_FOREIGN.omaniSkilled,
      },
      {
        key: "omaniStaff" as CategoryTab,
        label: CATEGORY_LABELS.omaniStaff,
        count: counts.omaniStaff,
        foreign: CATEGORY_IS_FOREIGN.omaniStaff,
      },
      { key: "supervisor" as CategoryTab, label: "Supervisors", count: supervisor, foreign: false },
    ]
  }

  function visibleFor(list: Employee[]) {
    if (categoryTab === "all") return list
    if (categoryTab === "supervisor") return list.filter((e) => !!e.user)
    return list.filter((e) => categoryOf(e.collarType, e.nationality) === categoryTab)
  }

  // Per-row derived state for a given mode.
  function rowInfo(e: Employee, mode: DayMode) {
    // Cross-site visitor: their home is another site, so the inline job control is
    // read-only. Post-submit (__crossSite) shows the job from their logged session here;
    // a pre-submit "only for today" visitor (__visitingToday) has no per-site job stored
    // on the employee, so it shows Unassigned. Their currentJob belongs to their home
    // site and is not this site's to change.
    if (e.__crossSite || e.__visitingToday) {
      const sessJobName = jobs.find((j) => j._id === e.__sessionJobId)?.name || null
      return {
        onSiteToday: false,
        hasSchedule: false,
        incoming: false,
        movingAway: false,
        jobChangePending: false,
        leaving: false,
        crossSite: true,
        curJobName: sessJobName,
        schedJobName: null,
        displayJobName: sessJobName,
        editable: false,
        selectValue: "unassigned",
      }
    }

    const onSiteToday = e.currentSite === siteId
    const hasSchedule = !!e.scheduledEffectiveDate
    const sSite = refId(e.scheduledSiteId)
    const leaving = !!e.scheduledRemoval // deferred removal ("leaving tomorrow")
    const incoming = mode === "tomorrow" && !onSiteToday
    const movingAway = hasSchedule && !!sSite && sSite !== siteId
    // A removal also carries scheduledEffectiveDate with a null site; gate the
    // job-only-change read on !leaving so it isn't mislabeled as a job change.
    const jobChangePending = !leaving && hasSchedule && sSite === null
    const curJobName = jobName(e.currentJob)
    const schedJobName = jobName(e.scheduledJobId)

    // The job shown in this mode.
    const displayJobName = leaving
      ? curJobName
      : mode === "tomorrow"
      ? incoming
        ? schedJobName
        : hasSchedule
        ? schedJobName
        : curJobName
      : curJobName

    // Editable except for a leaving row (nothing to assign). Incoming scheduled-adds
    // stay editable — editing their job updates scheduledJobId in place.
    const editable = !leaving

    const selectValue =
      mode === "tomorrow" && hasSchedule
        ? refId(e.scheduledJobId) || "unassigned"
        : refId(e.currentJob) || "unassigned"

    return {
      onSiteToday,
      hasSchedule,
      incoming,
      movingAway,
      jobChangePending,
      leaving,
      crossSite: false,
      curJobName,
      schedJobName,
      displayJobName,
      editable,
      selectValue,
    }
  }

  function renderJobCell(e: Employee, mode: DayMode) {
    const info = rowInfo(e, mode)
    const isEditing = editingJobEmployeeId === e._id
    const updating = updatingJobMap[e._id]

    if (canEdit && info.editable && isEditing) {
      return (
        <div className="flex items-center gap-1.5">
          <Select
            value={info.selectValue}
            onValueChange={(val) => handleJobChange(e._id, val, mode)}
            disabled={updating}
          >
            <SelectTrigger className="h-9 w-[180px] bg-background">
              {updating ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                  <span className="text-xs">Updating...</span>
                </div>
              ) : (
                <SelectValue placeholder="Select Job" />
              )}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {jobs.map((job) => (
                <SelectItem key={job._id} value={job._id}>
                  {job.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setEditingJobEmployeeId(null)}
            disabled={updating}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )
    }

    return (
      <div className="group/job flex items-center gap-2">
        <span className="text-sm font-medium">
          {info.displayJobName || (
            <span className="text-xs font-normal text-muted-foreground">
              Unassigned
            </span>
          )}
          {mode === "today" && info.jobChangePending && (
            <span className="block text-[11px] font-normal text-violet-600 dark:text-violet-400">
              → {info.schedJobName || "Unassigned"} tomorrow
            </span>
          )}
        </span>
        {canEdit && info.editable && !selectMode && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/job:opacity-100 hover:bg-transparent hover:text-primary"
            onClick={() => setEditingJobEmployeeId(e._id)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    )
  }

  function renderActions(e: Employee, mode: DayMode) {
    if (!canEdit || selectMode) return null
    // Pre-submit "only for today" visitors are display-only: their session isn't saved
    // yet, so the cross-site session-only remove has nothing to delete. They're consumed
    // when attendance is submitted (or expire with the day).
    if (e.__visitingToday) return null
    const info = rowInfo(e, mode)

    // Tomorrow, incoming: the only action is to cancel the scheduled arrival.
    if (info.incoming) {
      return (
        <Button
          variant="ghost"
          size="sm"
          className="text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
          disabled={cancelingId === e._id}
          onClick={() => {
            setScheduleToCancel(e)
            setCancelScheduleOpen(true)
          }}
        >
          {cancelingId === e._id ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <X className="mr-1 h-4 w-4" />
          )}
          Cancel
        </Button>
      )
    }

    // Tomorrow, leaving (a scheduled removal): the action is Undo, not Remove.
    if (mode === "tomorrow" && info.leaving) {
      return (
        <Button
          variant="ghost"
          size="sm"
          className="text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
          disabled={cancelingId === e._id}
          onClick={() => cancelSchedule(e._id)}
        >
          {cancelingId === e._id ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <X className="mr-1 h-4 w-4" />
          )}
          Undo
        </Button>
      )
    }

    // Which removal this row/tab performs: Tomorrow schedules for midnight; Today is
    // immediate (full unassign for a home worker, session-only for a cross-site visitor).
    const rMode: RemoveMode =
      mode === "tomorrow"
        ? "tomorrow-deferred"
        : e.__crossSite
        ? "today-cross-site"
        : "today-home"

    return (
      <div className="flex items-center justify-end gap-1">
        {mode === "tomorrow" && info.jobChangePending && (
          <Button
            variant="ghost"
            size="sm"
            className="text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
            disabled={cancelingId === e._id}
            onClick={() => {
              setScheduleToCancel(e)
              setCancelScheduleOpen(true)
            }}
          >
            {cancelingId === e._id ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <X className="mr-1 h-4 w-4" />
            )}
            Cancel change
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:bg-destructive/10"
          onClick={() => {
            setWorkerToRemove(e)
            setRemoveMode(rMode)
            setRemoveOpen(true)
          }}
        >
          <Trash2 className="mr-1 h-4 w-4" />
          Remove
        </Button>
      </div>
    )
  }

  function nameBadges(e: Employee, mode: DayMode) {
    const info = rowInfo(e, mode)
    return (
      <>
        {e.user && <Badge variant="secondary">Supervisor</Badge>}
        {e.employmentType === "temporary" && (
          <Badge
            variant="secondary"
            className="h-4 bg-amber-50 px-1.5 py-0 text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
          >
            Temporary
          </Badge>
        )}
        {info.crossSite && (
          <Badge
            variant="secondary"
            className="h-4 bg-slate-100 px-1.5 py-0 text-[10px] text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
          >
            Visiting
          </Badge>
        )}
        {info.leaving && (
          <Badge
            variant="secondary"
            className="h-4 bg-rose-50 px-1.5 py-0 text-[10px] text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
          >
            Leaving tomorrow
          </Badge>
        )}
        {mode === "tomorrow" && info.incoming && (
          <Badge
            variant="secondary"
            className="h-4 bg-sky-50 px-1.5 py-0 text-[10px] text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
          >
            New
          </Badge>
        )}
        {mode === "tomorrow" && !info.incoming && info.jobChangePending && (
          <Badge
            variant="secondary"
            className="h-4 bg-violet-50 px-1.5 py-0 text-[10px] text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
          >
            Job change
          </Badge>
        )}
        {mode === "today" && info.movingAway && (
          <Badge
            variant="secondary"
            className="h-4 bg-amber-50 px-1.5 py-0 text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
          >
            Moving tomorrow
          </Badge>
        )}
        {mode === "today" && info.jobChangePending && (
          <Badge
            variant="secondary"
            className="h-4 bg-violet-50 px-1.5 py-0 text-[10px] text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
          >
            Job change tomorrow
          </Badge>
        )}
      </>
    )
  }

  function renderBody(mode: DayMode) {
    const searched = listForMode(mode)
    const tabs = categoryTabsFor(searched)
    const visible = visibleFor(searched)

    // Client-side pagination over the filtered list.
    const totalItems = visible.length
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
    const safePage = Math.min(currentPage, totalPages)
    const start = (safePage - 1) * pageSize
    const paged = visible.slice(start, start + pageSize)

    // Select-all spans the whole filtered set (all pages), not just this page.
    const selectableAll = visible.filter(isRowSelectable)
    const allSelected =
      selectableAll.length > 0 && selectableAll.every((e) => selected.has(e._id))
    const colCount = selectMode ? 7 : 6

    return (
      <>
        {/* Category sub-tabs — tier 2: pins directly beneath the section header
            (all viewports; the offset var is measured on every size). */}
        <div
          ref={subtabsRef}
          style={{ top: "var(--roster-header-h, 0px)" }}
          className="sticky z-20 mb-4 flex items-center gap-0 overflow-x-auto border-b border-muted/30 bg-card"
        >
          {tabs.map((tab) => {
            const active = categoryTab === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setCategoryTab(tab.key)}
                className={`relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 pt-1.5 pb-2.5 text-sm font-semibold transition-colors ${
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.foreign && (
                  <Plane className="h-3.5 w-3.5 shrink-0" aria-label="Foreign" />
                )}
                {tab.label}
                <span
                  className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${
                    active
                      ? "bg-primary/10 text-primary"
                      : "bg-muted/60 text-muted-foreground"
                  }`}
                >
                  {tab.count}
                </span>
                {active && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full bg-primary" />
                )}
              </button>
            )
          })}
        </div>

        {/* Desktop table — no inner scroll (paginated). The border box and the table
            wrapper must NOT be scroll containers, otherwise the sticky <thead> would
            pin to them instead of the page. Trade-off: a very wide table scrolls the
            page horizontally rather than scrolling inside its own box. */}
        <div className="hidden rounded-2xl border md:block">
          <Table
            wrapperClassName="overflow-x-visible"
            className="[&_td]:py-2 [&_th]:py-2 [&_th]:text-xs [&_td]:text-[13px]"
          >
            {/* Tier 3: table head pins below the header + sub-tabs (md+). */}
            <TableHeader
              className="bg-background md:sticky md:z-10"
              style={{
                top: "calc(var(--roster-header-h, 0px) + var(--roster-subtabs-h, 0px))",
              }}
            >
              <TableRow>
                {selectMode && (
                  <TableHead className="w-12">
                    <Checkbox
                      checked={allSelected}
                      disabled={selectableAll.length === 0}
                      onCheckedChange={(v) => {
                        setSelected((prev) => {
                          const next = new Set(prev)
                          if (v) selectableAll.forEach((e) => next.add(e._id))
                          else selectableAll.forEach((e) => next.delete(e._id))
                          return next
                        })
                      }}
                      aria-label="Select all"
                    />
                  </TableHead>
                )}
                <TableHead className="w-16">Sl No</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Employee ID</TableHead>
                <TableHead>Job Title</TableHead>
                <TableHead className="w-[240px]">
                  {mode === "today" ? "Current Job" : "Job (tomorrow)"}
                </TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={colCount} className="py-10 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
                  </TableCell>
                </TableRow>
              ) : paged.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={colCount}
                    className="py-8 text-center text-muted-foreground"
                  >
                    {mode === "today"
                      ? "No employees on this site"
                      : "No employees scheduled for tomorrow"}
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((e, index) => {
                  const selectable = isRowSelectable(e)
                  return (
                    <TableRow key={e._id} className="transition-colors hover:bg-muted/50">
                      {selectMode && (
                        <TableCell>
                          {selectable && (
                            <Checkbox
                              checked={selected.has(e._id)}
                              onCheckedChange={() => toggleSelect(e._id)}
                              aria-label={`Select ${e.name}`}
                            />
                          )}
                        </TableCell>
                      )}
                      <TableCell className="font-medium text-muted-foreground">
                        {start + index + 1}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{e.name}</span>
                          {nameBadges(e, mode)}
                        </div>
                      </TableCell>
                      <TableCell>{e.employeeId}</TableCell>
                      <TableCell className="capitalize">{e.jobTitle}</TableCell>
                      <TableCell>{renderJobCell(e, mode)}</TableCell>
                      <TableCell className="text-right">
                        {renderActions(e, mode)}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Mobile cards */}
        <div className="block space-y-2 md:hidden">
          {loading ? (
            <div className="py-10 text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-xl border bg-card/50 py-8 text-center text-muted-foreground">
              {mode === "today"
                ? "No employees on this site"
                : "No employees scheduled for tomorrow"}
            </div>
          ) : (
            // Mobile shows the full list (no pagination) — scroll to the end.
            visible.map((e, index) => {
              const selectable = isRowSelectable(e)
              return (
                <div
                  key={e._id}
                  className="rounded-xl border bg-card p-3 shadow-sm"
                >
                  <div className="mb-1.5 flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2.5">
                      {selectMode && selectable && (
                        <Checkbox
                          className="mt-0.5"
                          checked={selected.has(e._id)}
                          onCheckedChange={() => toggleSelect(e._id)}
                          aria-label={`Select ${e.name}`}
                        />
                      )}
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold">{e.name}</span>
                          {nameBadges(e, mode)}
                        </div>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          ID: {e.employeeId}
                        </p>
                      </div>
                    </div>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                      #{index + 1}
                    </span>
                  </div>
                  <div className="space-y-1.5 border-t pt-2 text-[13px]">
                    <div className="flex items-center gap-2">
                      <span className="w-24 shrink-0 text-[11px] text-muted-foreground">
                        Job Title
                      </span>
                      <span className="min-w-0 truncate font-medium capitalize">
                        {e.jobTitle}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-24 shrink-0 text-[11px] text-muted-foreground">
                        {mode === "today" ? "Current Job" : "Job (tomorrow)"}
                      </span>
                      <div className="min-w-0">{renderJobCell(e, mode)}</div>
                    </div>
                  </div>
                  {canEdit && !selectMode && (
                    <div className="mt-2 flex justify-end gap-2 border-t pt-2">
                      {renderActions(e, mode)}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Pagination (desktop only — mobile scrolls the full list) */}
        {!loading && totalItems > 0 && (
          <div className="hidden flex-wrap items-center justify-between gap-3 pt-1 md:flex">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Rows per page</span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => setPageSize(Number(v))}
              >
                <SelectTrigger className="h-8 w-[80px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="tabular-nums">
                {start + 1}–{Math.min(start + pageSize, totalItems)} of {totalItems}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => goToPage(Math.max(1, safePage - 1))}
                  disabled={safePage <= 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-1 tabular-nums">
                  {safePage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => goToPage(Math.min(totalPages, safePage + 1))}
                  disabled={safePage >= totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <div ref={rosterRef} className="space-y-5">
      <Tabs
        value={dayTab}
        onValueChange={(v) => changeDayTab(v as DayMode)}
        className="gap-5"
      >
        {/* Sticky section header — the heading, the Today/Tomorrow switch and the
            search/filter controls stay pinned while the roster list scrolls. md+
            only: on phones the stacked filters would swallow most of the screen.
            Relies on the parent Card being overflow-visible (see SiteDetail). */}
        <div ref={headerRef} className="sticky top-0 z-30 space-y-3 bg-card pb-3 md:space-y-4 md:pb-4">
          <h2 className="hidden text-xl font-bold tracking-tight md:block">
            Employees
          </h2>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <TabsList>
                <TabsTrigger value="today">Today</TabsTrigger>
                <TabsTrigger value="tomorrow">Tomorrow</TabsTrigger>
              </TabsList>
              {dayTab === "tomorrow" && (
                <Tooltip open={tomorrowTipOpen} onOpenChange={setTomorrowTipOpen}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label="What happens on the Tomorrow tab"
                    >
                      <Info className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start">
                    Adds, job changes and removals made here take effect tomorrow.
                    A removal can be undone any time before midnight.
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            {canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                  >
                    <MoreVertical className="h-4 w-4" />
                    <span className="sr-only">Roster actions</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>Manage roster</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() =>
                      selectMode ? exitSelectMode() : setSelectMode(true)
                    }
                  >
                    <ListChecks className="mr-2 h-4 w-4" />
                    {selectMode ? "Exit assign mode" : "Assign jobs"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={goToAddEmployees}>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Add employees
                  </DropdownMenuItem>
                  {dayTab === "today" && (
                    <DropdownMenuItem
                      onSelect={() => setTimeout(() => setTempWorkerOpen(true), 0)}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add hired worker
                    </DropdownMenuItem>
                  )}
                  {dayTab === "tomorrow" && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuCheckboxItem
                        checked={!hideLeaving}
                        onCheckedChange={(v) => setHideLeaving(!v)}
                      >
                        Show leaving employees
                      </DropdownMenuCheckboxItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

        {/* Filters (shared across both tabs) */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name or ID..."
              className="pl-10"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Select value={jobFilter} onValueChange={setJobFilter}>
            <SelectTrigger className="sm:w-56">
              <SelectValue placeholder="Filter by job" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All jobs</SelectItem>
              <SelectItem value="none">No job</SelectItem>
              {jobs
                .filter((j) => j.isActive !== false)
                .map((j) => (
                  <SelectItem key={j._id} value={j._id}>
                    {j.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        {/* Bulk assign bar (selection mode) */}
        {selectMode && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
              <Select value={assignTarget} onValueChange={setAssignTarget}>
                <SelectTrigger className="h-9 w-[200px] bg-background">
                  <SelectValue placeholder="Assign to job..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No job (unassigned)</SelectItem>
                  {jobs
                    .filter((j) => j.isActive !== false)
                    .map((j) => (
                      <SelectItem key={j._id} value={j._id}>
                        {j.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {canCreateJobs && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-primary"
                  onClick={() => setAddJobOpen(true)}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add job
                </Button>
              )}
              <Button
                size="sm"
                disabled={assigning || selected.size === 0 || assignTarget === ""}
                onClick={submitBulkAssign}
              >
                {assigning
                  ? "Saving..."
                  : dayTab === "tomorrow"
                  ? `Assign tomorrow (${selected.size})`
                  : `Assign (${selected.size})`}
              </Button>
              <Button variant="ghost" size="sm" onClick={exitSelectMode}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        </div>

        <TabsContent value="today">{renderBody("today")}</TabsContent>
        <TabsContent value="tomorrow">{renderBody("tomorrow")}</TabsContent>
      </Tabs>

      <RemoveEmployeeDialog
        open={removeOpen}
        // Keep workerToRemove set through the close animation so the dialog's
        // name/session don't blank out mid-fade; the next Remove click overwrites it.
        onOpenChange={setRemoveOpen}
        siteId={siteId}
        employee={workerToRemove}
        mode={removeMode}
        submitted={todaySubmitted}
        onRemoved={fetchRoster}
      />

      {/* Controlled "Add hired worker" dialog — triggered from the actions menu. */}
      {canEdit && (
        <AddTemporaryWorker
          onAdd={addTempWorker}
          assignedSiteId={siteId}
          open={tempWorkerOpen}
          onOpenChange={setTempWorkerOpen}
          hideTrigger
        />
      )}

      <Dialog open={cancelScheduleOpen} onOpenChange={setCancelScheduleOpen}>
        <DialogContent className="sm:max-w-md">
          {(() => {
            // Tailor the copy to the pending change being cancelled: an incoming
            // scheduled-add (arriving here tomorrow) vs a from-tomorrow job change.
            const incoming =
              !!scheduleToCancel &&
              refId(scheduleToCancel.scheduledSiteId) === siteId &&
              scheduleToCancel.currentSite !== siteId
            return (
              <DialogHeader>
                <DialogTitle className="text-xl font-bold">
                  {incoming
                    ? "Cancel scheduled arrival?"
                    : "Cancel scheduled job change?"}
                </DialogTitle>
                <DialogDescription className="pt-2 text-base">
                  {incoming ? (
                    <>
                      <strong>{scheduleToCancel?.name}</strong> will no longer be
                      added to this site tomorrow. You can schedule them again
                      later.
                    </>
                  ) : (
                    <>
                      The job change scheduled for{" "}
                      <strong>{scheduleToCancel?.name}</strong> tomorrow will be
                      discarded. Their current job stays unchanged.
                    </>
                  )}
                </DialogDescription>
              </DialogHeader>
            )
          })()}

          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              disabled={!!scheduleToCancel && cancelingId === scheduleToCancel._id}
              onClick={() => setCancelScheduleOpen(false)}
            >
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={!!scheduleToCancel && cancelingId === scheduleToCancel._id}
              onClick={async () => {
                if (!scheduleToCancel) return
                await cancelSchedule(scheduleToCancel._id)
                setCancelScheduleOpen(false)
              }}
            >
              {!!scheduleToCancel && cancelingId === scheduleToCancel._id
                ? "Cancelling..."
                : "Cancel change"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Job modal */}
      <Dialog open={addJobOpen} onOpenChange={setAddJobOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl">Create New Job</DialogTitle>
            <DialogDescription>Add a new job under this site.</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Job Name</Label>
              <Input
                placeholder="Enter job name"
                value={jobForm.name}
                onChange={(e) => setJobForm((p) => ({ ...p, name: e.target.value }))}
              />
              {jobErrors.name && <p className="text-sm text-red-500">{jobErrors.name}</p>}
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Job Code</Label>
              <Input
                placeholder="Enter job code"
                value={jobForm.jobCode}
                onChange={(e) => setJobForm((p) => ({ ...p, jobCode: e.target.value }))}
              />
              {jobErrors.jobCode && (
                <p className="text-sm text-red-500">{jobErrors.jobCode}</p>
              )}
            </div>

            {jobErrors.general && (
              <p className="text-sm text-red-500">{jobErrors.general}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddJobOpen(false)}>
              Cancel
            </Button>
            <Button disabled={creatingJob} onClick={createJobInline}>
              {creatingJob ? "Creating..." : "Create Job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default SiteRoster
