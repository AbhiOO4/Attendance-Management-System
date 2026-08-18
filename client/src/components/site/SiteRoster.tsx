import { useEffect, useMemo, useState } from "react"
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
} from "lucide-react"

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
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
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
  // Client-only markers for a post-submit session-holder whose home is another site
  // (surfaced on the Today tab from the daily report, not the rosterForSite fetch).
  __crossSite?: boolean
  __sessionJobId?: string | null
}

interface Job {
  _id: string
  name: string
}

type DayMode = "today" | "tomorrow"
type CategoryTab = "all" | RosterCategory | "supervisor"

interface SiteRosterProps {
  siteId: string
  isSiteActive: boolean
  // Reports the size of the Today roster so the parent's stat strip can show it.
  onTodayCountChange?: (count: number) => void
}

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
function SiteRoster({ siteId, isSiteActive, onTodayCountChange }: SiteRosterProps) {
  const navigate = useNavigate()

  const [employees, setEmployees] = useState<Employee[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(false)

  const [dayTab, setDayTab] = useState<DayMode>("today")
  const [categoryTab, setCategoryTab] = useState<CategoryTab>("all")
  const [filters, setFilters] = useState({ name: "", employeeId: "" })

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
  const [hideLeaving, setHideLeaving] = useState(false)

  const [scheduleToCancel, setScheduleToCancel] = useState<Employee | null>(null)
  const [cancelScheduleOpen, setCancelScheduleOpen] = useState(false)

  const canEdit = isSiteActive

  async function fetchRoster() {
    if (!siteId) return
    setLoading(true)
    try {
      const res = await api.get<{ employees: Employee[] }>("/api/employees", {
        params: { rosterForSite: siteId },
      })
      const list = res.data.employees || []
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
    return e.currentSite === siteId
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
    const name = filters.name.trim().toLowerCase()
    const empId = filters.employeeId.trim().toLowerCase()
    const searched = dayList.filter(
      (e) =>
        e.name.toLowerCase().includes(name) &&
        e.employeeId.toLowerCase().includes(empId)
    )
    return searched
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
    // Cross-site visitor (post-submit Today only): their home is another site, so the
    // inline job control is read-only and shows the job from their session here. Their
    // currentJob belongs to their home site and is not this site's to change.
    if (e.__crossSite) {
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
        {canEdit && info.editable && (
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
    if (!canEdit) return null
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

    return (
      <>
        {/* Category sub-tabs */}
        <div className="mb-4 flex items-center gap-0 overflow-x-auto border-b border-muted/30">
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

        {/* Desktop table */}
        <div className="hidden overflow-hidden rounded-2xl border md:block">
          <Table wrapperClassName="max-h-[440px] overflow-y-auto">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
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
                  <TableCell colSpan={6} className="py-10 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
                  </TableCell>
                </TableRow>
              ) : visible.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    {mode === "today"
                      ? "No employees on this site"
                      : "No employees scheduled for tomorrow"}
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((e, index) => (
                  <TableRow key={e._id} className="transition-colors hover:bg-muted/50">
                    <TableCell className="font-medium text-muted-foreground">
                      {index + 1}
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
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Mobile cards */}
        <div className="block space-y-3 md:hidden">
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
            visible.map((e, index) => (
              <div
                key={e._id}
                className="rounded-xl border bg-card p-4 shadow-sm"
              >
                <div className="mb-2 flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-bold">{e.name}</span>
                      {nameBadges(e, mode)}
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">
                      ID: {e.employeeId}
                    </p>
                  </div>
                  <span className="rounded bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">
                    #{index + 1}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 border-t pt-3 text-sm">
                  <div>
                    <span className="block text-xs text-muted-foreground">
                      Job Title
                    </span>
                    <span className="font-medium capitalize">{e.jobTitle}</span>
                  </div>
                  <div>
                    <span className="mb-1 block text-xs text-muted-foreground">
                      {mode === "today" ? "Current Job" : "Job (tomorrow)"}
                    </span>
                    {renderJobCell(e, mode)}
                  </div>
                </div>
                {canEdit && (
                  <div className="mt-3 flex justify-end gap-2 border-t pt-3">
                    {renderActions(e, mode)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </>
    )
  }

  return (
    <div className="space-y-5">
      <Tabs
        value={dayTab}
        onValueChange={(v) => changeDayTab(v as DayMode)}
        className="gap-5"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="tomorrow">Tomorrow</TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            {canEdit && (
              <Button variant="outline" onClick={goToAddEmployees}>
                <UserPlus className="mr-2 h-4 w-4" />
                Add Employees
              </Button>
            )}
            {canEdit && dayTab === "today" && (
              <AddTemporaryWorker onAdd={addTempWorker} assignedSiteId={siteId} />
            )}
          </div>
        </div>

        {dayTab === "tomorrow" && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="rounded-lg border border-amber-200/50 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:border-amber-800/30 dark:bg-amber-950/40 dark:text-amber-300">
              Adds, job changes and removals made here take effect tomorrow. A
              removal can be undone any time before midnight.
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <Switch
                id="hide-leaving"
                checked={hideLeaving}
                onCheckedChange={setHideLeaving}
              />
              <Label
                htmlFor="hide-leaving"
                className="cursor-pointer whitespace-nowrap text-xs text-muted-foreground"
              >
                Hide leaving
              </Label>
            </div>
          </div>
        )}

        {/* Search filters (shared across both tabs) */}
        <div className="grid gap-3 md:grid-cols-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name..."
              className="pl-10"
              value={filters.name}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, name: e.target.value }))
              }
            />
          </div>
          <Input
            placeholder="Search by employee ID..."
            value={filters.employeeId}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, employeeId: e.target.value }))
            }
          />
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
    </div>
  )
}

export default SiteRoster
