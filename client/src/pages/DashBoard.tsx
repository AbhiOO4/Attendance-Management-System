// pages/DashBoard.tsx

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"

import {
  useNavigate,
} from "react-router-dom"

import { api } from "@/lib/api"
import { getCurrentTargetDateString } from "@/lib/dateUtils"

import { Card } from "@/components/ui/card"

import { Input } from "@/components/ui/input"

import { Button } from "@/components/ui/button"

import { useAuth } from "@/context/AuthContext"

import {
  Users,
  Clock3,
  Building2,
  Percent,
  Check,
  Calendar,
  ChevronDown,
  Loader2,
} from "lucide-react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface SiteSummary {
  siteId: string
  siteName: string
  employeesToday: number
  manHoursToday: number
  averageHoursPerWorker: number
}

interface DashboardResponse {
  success: boolean

  date: string

  attendance: {
    presentToday: number
    totalEmployees: number
    attendancePercentage: number
  }

  totals: {
    manHoursToday: number
  }

  sites: SiteSummary[]
}

interface OverviewJob {
  _id: string
  name: string
  isCompleted: boolean
  isActive: boolean
}

interface OverviewSite {
  siteId: string
  siteName: string
  locationDetails: string
  isPermanent: boolean
  totalManHours: number
  totalManDays: number
  totalCalendarDays: number
  jobs: OverviewJob[]
}

interface OverviewResponse {
  success: boolean
  inProgressCount: number
  completedCount: number
  sites: OverviewSite[]
  hasMore: boolean
}

function DashBoard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isSupervisor = user?.role === "supervisor"
  const today = getCurrentTargetDateString()

  const [date, setDate] =
    useState(today)

  const [loading, setLoading] =
    useState(false)

  const [dashboard, setDashboard] =
    useState<DashboardResponse | null>(
      null
    )

  const activeSites = dashboard?.sites.filter((site) => site.employeesToday > 0 || site.manHoursToday > 0) || []

  // --- Sites Overview state ---
  const [overviewTab, setOverviewTab] = useState<"inprogress" | "completed">("inprogress")
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [inProgressSites, setInProgressSites] = useState<OverviewSite[]>([])
  const [completedSites, setCompletedSites] = useState<OverviewSite[]>([])
  const [inProgressCount, setInProgressCount] = useState(0)
  const [completedCount, setCompletedCount] = useState(0)
  const [completedHasMore, setCompletedHasMore] = useState(false)
  const overviewRef = useRef<HTMLDivElement>(null)
  const prevTabRef = useRef<"inprogress" | "completed" | null>(null)

  async function fetchDashboard() {
    try {
      setLoading(true)

      const res =
        await api.get<DashboardResponse>(
          "/api/attendance/dashboard",
          {
            params: {
              date,
            },
          }
        )

      setDashboard(res.data)
    } catch (error) {
      console.log(error)

      setDashboard(null)
    } finally {
      setLoading(false)
    }
  }

  const fetchOverview = useCallback(async (tab: "inprogress" | "completed", skip = 0, append = false) => {
    try {
      if (append) {
        setLoadingMore(true)
      } else {
        setOverviewLoading(true)
      }

      const res = await api.get<OverviewResponse>("/api/attendance/dashboard/active-sites", {
        params: { tab, skip, limit: 5 },
      })

      const data = res.data
      setInProgressCount(data.inProgressCount)
      setCompletedCount(data.completedCount)

      if (tab === "inprogress") {
        setInProgressSites(data.sites)
      } else {
        if (append) {
          setCompletedSites((prev) => [...prev, ...data.sites])
        } else {
          setCompletedSites(data.sites)
        }
        setCompletedHasMore(data.hasMore)
      }
    } catch (error) {
      console.log(error)
    } finally {
      setOverviewLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    fetchDashboard()
  }, [date])

  // Fetch overview on mount and when tab changes
  useEffect(() => {
    if (overviewTab === "completed") {
      setCompletedSites([])
    }
    fetchOverview(overviewTab, 0, false)
    // Scroll the section into view to prevent page jumping, but only on actual tab switches (not on initial mount or re-renders)
    if (prevTabRef.current !== null && prevTabRef.current !== overviewTab) {
      overviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
    prevTabRef.current = overviewTab
  }, [overviewTab, fetchOverview])

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      <div className="mx-auto max-w-7xl space-y-6 animate-in fade-in duration-300">

        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              Dashboard
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Welcome back,{" "}
              <span className="font-medium text-foreground">{user?.name || "User"}</span>
              {" "}— here's your overview for{" "}
              <span className="font-medium text-foreground">
                {new Date(date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </span>.
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-lg border bg-card px-3 shadow-sm w-full sm:w-auto">
            <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border-0 bg-transparent px-0 focus-visible:ring-0 focus-visible:ring-offset-0 h-9 w-full sm:w-auto font-medium"
            />
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Present Employees */}
          <Card className="p-5">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Users className="h-4 w-4" />
                <span className="text-sm font-medium">Present Employees</span>
              </div>
              <p className="text-2xl font-bold tracking-tight text-foreground">
                {dashboard
                  ? `${dashboard.attendance.presentToday} / ${dashboard.attendance.totalEmployees}`
                  : "--"}
              </p>
              {dashboard && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all duration-500"
                    style={{ width: `${(dashboard.attendance.presentToday / Math.max(dashboard.attendance.totalEmployees, 1)) * 100}%` }}
                  />
                </div>
              )}
            </div>
          </Card>

          {/* Attendance % */}
          <Card className="p-5">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Percent className="h-4 w-4" />
                <span className="text-sm font-medium">Attendance Percentage</span>
              </div>
              <p className="text-2xl font-bold tracking-tight text-foreground">
                {dashboard ? `${dashboard.attendance.attendancePercentage}%` : "--"}
              </p>
              {dashboard && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all duration-500"
                    style={{ width: `${dashboard.attendance.attendancePercentage}%` }}
                  />
                </div>
              )}
            </div>
          </Card>

          {/* Man Hours */}
          <Card className="p-5">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock3 className="h-4 w-4" />
                <span className="text-sm font-medium">Total Man Hours</span>
              </div>
              <p className="text-2xl font-bold tracking-tight text-foreground">
                {dashboard?.totals.manHoursToday ?? 0}
              </p>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Avg productive shift</span>
                <span className="font-medium text-foreground">
                  {dashboard?.sites.length ? (dashboard.totals.manHoursToday / Math.max(dashboard.attendance.presentToday, 1)).toFixed(1) : "0.0"} hrs
                </span>
              </div>
            </div>
          </Card>

          {/* Active Sites */}
          <Card className="p-5">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Building2 className="h-4 w-4" />
                <span className="text-sm font-medium">Active Sites Worked</span>
              </div>
              <p className="text-2xl font-bold tracking-tight text-foreground">
                {dashboard?.sites?.length ?? 0}
              </p>
            </div>
          </Card>
        </div>

        {/* Site Ranking */}
        <Card className="p-6">
          <div className="mb-5">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Today's Site Activity
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ranked by total employee man-hours worked.
            </p>
          </div>

          <div className="hidden md:block overflow-hidden rounded-lg border">
            <Table wrapperClassName="h-[450px] overflow-y-auto">
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="font-semibold py-3">Rank</TableHead>
                  <TableHead className="font-semibold py-3">Site Name</TableHead>
                  <TableHead className="font-semibold py-3">Employees</TableHead>
                  <TableHead className="font-semibold py-3">Man Hours</TableHead>
                  <TableHead className="font-semibold py-3">Avg Hours / Worker</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      <div className="flex items-center justify-center">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    </TableCell>
                  </TableRow>
                ) : !dashboard || activeSites.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      No active site activity found for the selected date
                    </TableCell>
                  </TableRow>
                ) : (
                  activeSites.map((site, index) => (
                    <TableRow
                      key={site.siteId}
                      onClick={() =>
                        !isSupervisor && navigate(`/site/${site.siteId}`, { state: { from: "dashboard" } })
                      }
                      className={isSupervisor ? "" : "cursor-pointer transition-colors hover:bg-muted/50"}
                    >
                      <TableCell className="py-3.5">
                        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
                          index === 0 ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
                        }`}>
                          {index + 1}
                        </span>
                      </TableCell>

                      <TableCell className="py-3.5 font-medium text-foreground">
                        {site.siteName}
                      </TableCell>

                      <TableCell className="py-3.5 font-medium text-foreground tabular-nums">
                        {site.employeesToday}
                      </TableCell>

                      <TableCell className="py-3.5">
                        <div className="flex items-center gap-1 font-medium text-foreground tabular-nums">
                          <span>{site.manHoursToday}</span>
                          <span className="text-xs font-normal text-muted-foreground">hrs</span>
                        </div>
                      </TableCell>

                      <TableCell className="py-3.5">
                        <div className="flex items-center gap-1 font-medium text-foreground tabular-nums">
                          <span>{site.averageHoursPerWorker}</span>
                          <span className="text-xs font-normal text-muted-foreground">h/worker</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3 md:hidden">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !dashboard || activeSites.length === 0 ? (
              <div className="rounded-lg border bg-muted/20 py-10 text-center text-sm text-muted-foreground">
                No active site activity found for selected date
              </div>
            ) : (
              activeSites.map((site, index) => (
                <Card
                  key={site.siteId}
                  onClick={() =>
                    !isSupervisor && navigate(`/site/${site.siteId}`, { state: { from: "dashboard" } })
                  }
                  className={isSupervisor
                    ? "border p-4"
                    : "cursor-pointer border p-4 transition-colors hover:border-primary/50"}
                >
                  <div className="flex items-center gap-2.5 border-b pb-3">
                    <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
                      index === 0 ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
                    }`}>
                      {index + 1}
                    </span>
                    <h3 className="font-medium text-foreground">
                      {site.siteName}
                    </h3>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                      <p className="text-[10px] font-medium uppercase text-muted-foreground">Employees</p>
                      <p className="mt-0.5 text-sm font-semibold text-foreground tabular-nums">
                        {site.employeesToday}
                      </p>
                    </div>

                    <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                      <p className="text-[10px] font-medium uppercase text-muted-foreground">Man Hours</p>
                      <p className="mt-0.5 text-sm font-semibold text-foreground tabular-nums">
                        {site.manHoursToday}h
                      </p>
                    </div>

                    <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                      <p className="text-[10px] font-medium uppercase text-muted-foreground">Avg Hours</p>
                      <p className="mt-0.5 text-sm font-semibold text-foreground tabular-nums">
                        {site.averageHoursPerWorker}h
                      </p>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        </Card>

        {/* ─── Sites Overview (Tabbed) ─── */}
        <div ref={overviewRef} className="scroll-mt-6">
          <Card className="overflow-hidden py-0">
            <div className="p-6 pb-0">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Sites Overview
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Cumulative metrics from attendance records across site lifecycles.
              </p>
            </div>

            {/* Connected tab bar */}
            <div className="px-6 pt-5">
              <div className="flex items-center gap-0 border-b">
                <button
                  onClick={() => setOverviewTab("inprogress")}
                  className={`relative inline-flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${overviewTab === "inprogress"
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  In Progress
                  <span className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${overviewTab === "inprogress"
                      ? "bg-foreground/10 text-foreground"
                      : "bg-muted text-muted-foreground"
                    }`}>
                    {inProgressCount}
                  </span>
                  {overviewTab === "inprogress" && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full bg-foreground" />
                  )}
                </button>

                <button
                  onClick={() => setOverviewTab("completed")}
                  className={`relative inline-flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${overviewTab === "completed"
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  Completed
                  <span className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${overviewTab === "completed"
                      ? "bg-foreground/10 text-foreground"
                      : "bg-muted text-muted-foreground"
                    }`}>
                    {completedCount}
                  </span>
                  {overviewTab === "completed" && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full bg-foreground" />
                  )}
                </button>
              </div>
            </div>

            {/* Tab content */}
            <div className="p-6 pt-5">
              {overviewLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className={overviewTab === "completed" ? "max-h-[540px] overflow-y-auto pr-1 scrollbar-thin" : ""}>
                  {(overviewTab === "inprogress" ? inProgressSites : completedSites).length === 0 ? (
                    <div className="rounded-lg border bg-muted/20 py-16 text-center">
                      <p className="text-sm text-muted-foreground">
                        {overviewTab === "inprogress" ? "No active sites in progress" : "No completed sites found"}
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {(overviewTab === "inprogress" ? inProgressSites : completedSites).map((site) => {
                        const isAdmin = !isSupervisor
                        return (
                          <Card
                            key={site.siteId}
                            className={`border p-3.5 ${isAdmin ? "cursor-pointer transition-colors hover:border-primary/50" : ""}`}
                            onClick={() => isAdmin && navigate(`/site/${site.siteId}`, { state: { from: "dashboard" } })}
                          >
                            {/* Site name + permanent badge */}
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="text-sm font-semibold leading-snug text-foreground">
                                {site.siteName}
                              </h3>
                              {site.isPermanent && (
                                <span className="shrink-0 rounded-full border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                                  Permanent
                                </span>
                              )}
                            </div>

                            {/* Stats row */}
                            <div className="mt-3 grid grid-cols-3 gap-1.5">
                              <div className="rounded-lg border bg-muted/30 p-1.5 text-center">
                                <div className="flex items-center justify-center gap-1 text-muted-foreground">
                                  <Clock3 className="h-2.5 w-2.5" />
                                  <span className="text-[9px] font-medium uppercase tracking-wider">Hours</span>
                                </div>
                                <p className="mt-0.5 text-xs font-semibold text-foreground tabular-nums md:text-sm">{site.totalManHours}</p>
                              </div>

                              <div className="rounded-lg border bg-muted/30 p-1.5 text-center">
                                <div className="flex items-center justify-center gap-1 text-muted-foreground">
                                  <Users className="h-2.5 w-2.5" />
                                  <span className="text-[9px] font-medium uppercase tracking-wider">Man Days</span>
                                </div>
                                <p className="mt-0.5 text-xs font-semibold text-foreground tabular-nums md:text-sm">{site.totalManDays}</p>
                              </div>

                              <div className="rounded-lg border bg-muted/30 p-1.5 text-center">
                                <div className="flex items-center justify-center gap-1 text-muted-foreground">
                                  <Calendar className="h-2.5 w-2.5" />
                                  <span className="text-[9px] font-medium uppercase tracking-wider">Days</span>
                                </div>
                                <p className="mt-0.5 text-xs font-semibold text-foreground tabular-nums md:text-sm">{site.totalCalendarDays}</p>
                              </div>
                            </div>

                            {/* Job status dots */}
                            {site.jobs.length > 0 && (
                              <div className="mt-3 flex items-center justify-between border-t pt-2">
                                <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Jobs</span>
                                <div className="flex flex-wrap items-center gap-1">
                                  {site.jobs.map((job) => (
                                    <span
                                      key={job._id}
                                      title={`${job.name} — ${job.isCompleted ? "Completed" : "In Progress"}`}
                                      className={`inline-flex h-4 w-4 items-center justify-center rounded-full cursor-default ${job.isCompleted
                                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                          : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                        }`}
                                    >
                                      {job.isCompleted ? (
                                        <Check className="h-2.5 w-2.5" strokeWidth={3} />
                                      ) : (
                                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                      )}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </Card>
                        )
                      })}
                    </div>
                  )}

                  {/* Load More buttons grouped safely within tab view container */}
                  {overviewTab === "completed" && completedHasMore && (
                    <div className="mt-4 flex justify-center">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={loadingMore}
                        onClick={() => fetchOverview("completed", completedSites.length, true)}
                        className="rounded-full px-6"
                      >
                        {loadingMore ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <ChevronDown className="mr-2 h-4 w-4" />
                        )}
                        {loadingMore ? "Loading..." : "Load More"}
                      </Button>
                    </div>
                  )}

                  {overviewTab === "completed" && !completedHasMore && completedSites.length > 0 && (
                    <p className="mt-4 text-center text-xs text-muted-foreground">
                      All completed sites loaded
                    </p>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>

      </div>
    </div>
  )
}

export default DashBoard