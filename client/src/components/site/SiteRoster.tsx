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
import RemoveEmployeeDialog from "@/components/site/RemoveEmployeeDialog"

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
  nationality?: "foreign" | "omani"
  collarType?: "skilled" | "staff"
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
//   Today    = employees currently on the site.
//   Tomorrow = today's members minus anyone scheduled to move to another site,
//              plus incoming scheduled-adds targeting this site.
// Today actions are instant; Tomorrow actions (job change) are deferred to the
// day-rollover. Removal is always instant (via RemoveEmployeeDialog).
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
      setEmployees(res.data.employees || [])
    } catch (error) {
      console.log(error)
      setEmployees([])
    } finally {
      setLoading(false)
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
    const dayList = employees.filter(mode === "today" ? inToday : inTomorrow)
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
    const onSiteToday = e.currentSite === siteId
    const hasSchedule = !!e.scheduledEffectiveDate
    const sSite = refId(e.scheduledSiteId)
    const incoming = mode === "tomorrow" && !onSiteToday
    const movingAway = hasSchedule && !!sSite && sSite !== siteId
    const jobChangePending = hasSchedule && sSite === null // job-only change stays on site
    const curJobName = jobName(e.currentJob)
    const schedJobName = jobName(e.scheduledJobId)

    // The job shown in this mode.
    const displayJobName =
      mode === "tomorrow"
        ? incoming
          ? schedJobName
          : hasSchedule
          ? schedJobName
          : curJobName
        : curJobName

    // Job cell is editable in both tabs. On Tomorrow this includes incoming
    // scheduled-adds — editing their job updates scheduledJobId in place.
    const editable = true

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
          <div className="rounded-lg border border-amber-200/50 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:border-amber-800/30 dark:bg-amber-950/40 dark:text-amber-300">
            Adds and job changes made here take effect tomorrow. Removals are
            always immediate.
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
