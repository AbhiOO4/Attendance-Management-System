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
import { getLogicalShiftDate } from "@/lib/dateUtils"

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
  const today = getLogicalShiftDate()

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
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/10 to-muted/20 p-6">
      <div className="mx-auto max-w-7xl space-y-8 animate-in fade-in duration-500">

        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-foreground via-foreground/90 to-muted-foreground bg-clip-text text-transparent">
              Roster Dashboard
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Real-time attendance overview, man-hour rankings, and site activity metrics.
            </p>
          </div>

          <div className="flex items-center gap-3 bg-card border border-muted/30 rounded-2xl p-1.5 shadow-sm max-w-xs w-full sm:w-auto transition-all duration-300 focus-within:border-primary/40 focus-within:shadow-md">
            <span className="pl-3 text-xs font-bold text-muted-foreground whitespace-nowrap uppercase tracking-wider">Date</span>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 h-9 w-full sm:w-auto font-medium"
            />
          </div>
        </div>

        {/* Welcome Section */}
        <div className="relative overflow-hidden rounded-3xl border border-primary/10 bg-gradient-to-r from-primary/10 via-primary/5 to-card p-8 shadow-sm">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                Live Roster Analytics
              </span>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-foreground">
                Welcome back, {user?.name || "User"}! 👋
              </h2>
              <p className="mt-1.5 text-muted-foreground text-sm max-w-xl">
                Here is your site productivity and attendance dashboard overview for{" "}
                <span className="font-semibold text-foreground">
                  {new Date(date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </span>.
              </p>
            </div>
            <div className="flex items-center gap-3 bg-background/60 backdrop-blur-md rounded-2xl p-3 border border-muted/40 shadow-inner shrink-0">
              <div className="px-4 py-1 text-center">
                <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Roster Status</span>
                <span className="text-sm font-bold text-emerald-500 flex items-center justify-center gap-1.5 mt-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Active
                </span>
              </div>
            </div>
          </div>
          {/* Decorative background shapes */}
          <div className="absolute right-0 top-0 -mr-16 -mt-16 h-48 w-48 rounded-full bg-primary/5 blur-3xl pointer-events-none" />
          <div className="absolute left-1/3 bottom-0 -mb-12 h-36 w-36 rounded-full bg-blue-500/5 blur-2xl pointer-events-none" />
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {/* Present Employees */}
          <Card className="group relative overflow-hidden rounded-3xl border border-muted/30 bg-card p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-emerald-500/20">
            <div className="flex items-center justify-between">
              <div className="rounded-2xl bg-emerald-500/10 p-3 text-emerald-600 transition-colors duration-300 group-hover:bg-emerald-500/20">
                <Users className="h-6 w-6" />
              </div>
              <span className="rounded-full bg-muted/60 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Attendance
              </span>
            </div>
            
            <p className="mt-5 text-sm font-medium text-muted-foreground">
              Present Employees
            </p>
            
            <h2 className="mt-1 text-3xl font-extrabold tracking-tight text-foreground">
              {dashboard
                ? `${dashboard.attendance.presentToday} / ${dashboard.attendance.totalEmployees}`
                : "--"}
            </h2>

            {dashboard && (
              <div className="mt-4">
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div 
                    className="h-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${(dashboard.attendance.presentToday / Math.max(dashboard.attendance.totalEmployees, 1)) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </Card>

          {/* Attendance % */}
          <Card className="group relative overflow-hidden rounded-3xl border border-muted/30 bg-card p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-indigo-500/20">
            <div className="flex items-center justify-between">
              <div className="rounded-2xl bg-indigo-500/10 p-3 text-indigo-600 transition-colors duration-300 group-hover:bg-indigo-500/20">
                <Percent className="h-6 w-6" />
              </div>
              <span className="rounded-full bg-muted/60 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Ratio
              </span>
            </div>
            
            <p className="mt-5 text-sm font-medium text-muted-foreground">
              Attendance Percentage
            </p>
            
            <h2 className="mt-1 text-3xl font-extrabold tracking-tight text-foreground">
              {dashboard ? `${dashboard.attendance.attendancePercentage}%` : "--"}
            </h2>

            {dashboard && (
              <div className="mt-4">
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
                    style={{ width: `${dashboard.attendance.attendancePercentage}%` }}
                  />
                </div>
              </div>
            )}
          </Card>

          {/* Man Hours */}
          <Card className="group relative overflow-hidden rounded-3xl border border-muted/30 bg-card p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-violet-500/20">
            <div className="flex items-center justify-between">
              <div className="rounded-2xl bg-violet-500/10 p-3 text-violet-600 transition-colors duration-300 group-hover:bg-violet-500/20">
                <Clock3 className="h-6 w-6" />
              </div>
              <span className="rounded-full bg-muted/60 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Volume
              </span>
            </div>
            
            <p className="mt-5 text-sm font-medium text-muted-foreground">
              Total Man Hours
            </p>
            
            <h2 className="mt-1 text-3xl font-extrabold tracking-tight text-foreground">
              {dashboard?.totals.manHoursToday ?? 0}
            </h2>

            <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
              <span>Avg productive shift</span>
              <span className="font-semibold text-foreground">
                {dashboard?.sites.length ? (dashboard.totals.manHoursToday / Math.max(dashboard.attendance.presentToday, 1)).toFixed(1) : "0.0"} hrs
              </span>
            </div>
          </Card>

          {/* Active Sites */}
          <Card className="group relative overflow-hidden rounded-3xl border border-muted/30 bg-card p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-amber-500/20">
            <div className="flex items-center justify-between">
              <div className="rounded-2xl bg-amber-500/10 p-3 text-amber-600 transition-colors duration-300 group-hover:bg-amber-500/20">
                <Building2 className="h-6 w-6" />
              </div>
              <span className="rounded-full bg-muted/60 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Coverage
              </span>
            </div>
            
            <p className="mt-5 text-sm font-medium text-muted-foreground">
              Active Sites Worked
            </p>
            
            <h2 className="mt-1 text-3xl font-extrabold tracking-tight text-foreground">
              {dashboard?.sites?.length ?? 0}
            </h2>

            <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
              <span>Roster deployment</span>
              <span className="font-semibold text-foreground">100%</span>
            </div>
          </Card>
        </div>

        {/* Site Ranking */}
        <Card className="rounded-3xl border border-muted/30 bg-card p-8 shadow-sm">
          <div className="mb-6">
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Today's Site Activity Data
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ranked by total employee man hours worked in descending order.
            </p>
          </div>

          <div className="hidden md:block overflow-hidden rounded-2xl border border-muted/20">
            <Table wrapperClassName="h-[450px] overflow-y-auto">
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow className="border-b border-muted/20">
                  <TableHead className="font-bold py-3">Rank</TableHead>
                  <TableHead className="font-bold py-3">Site Name</TableHead>
                  <TableHead className="font-bold py-3">Employees</TableHead>
                  <TableHead className="font-bold py-3">Man Hours</TableHead>
                  <TableHead className="font-bold py-3">Avg Hours / Worker</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                        <span className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                        <span className="h-2 w-2 rounded-full bg-primary animate-bounce" />
                      </div>
                    </TableCell>
                  </TableRow>
                ) : !dashboard || activeSites.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground font-medium">
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
                      className={isSupervisor ? "border-b border-muted/20" : "cursor-pointer transition duration-200 hover:bg-muted/40 border-b border-muted/20"}
                    >
                      <TableCell className="py-3.5 font-medium">
                        <div className="flex items-center">
                          {index === 0 ? (
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/10 text-xs font-extrabold text-amber-600 border border-amber-500/20 shadow-sm">1</span>
                          ) : index === 1 ? (
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-400/10 text-xs font-extrabold text-slate-500 border border-slate-400/20 shadow-sm">2</span>
                          ) : index === 2 ? (
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-700/10 text-xs font-extrabold text-amber-800 border border-amber-700/20 shadow-sm">3</span>
                          ) : (
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted/60 text-xs font-semibold text-muted-foreground">{index + 1}</span>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="py-3.5 font-bold text-foreground">
                        {site.siteName}
                      </TableCell>

                      <TableCell className="py-3.5">
                        <span className="font-semibold text-foreground bg-muted/40 px-2 py-0.5 rounded-md">{site.employeesToday}</span>
                      </TableCell>

                      <TableCell className="py-3.5">
                        <div className="flex items-center gap-1 font-semibold text-foreground">
                          <span>{site.manHoursToday}</span>
                          <span className="text-xs text-muted-foreground font-normal">hrs</span>
                        </div>
                      </TableCell>

                      <TableCell className="py-3.5">
                        <div className="flex items-center gap-1 font-semibold text-foreground">
                          <span>{site.averageHoursPerWorker}</span>
                          <span className="text-xs text-muted-foreground font-normal">h/worker</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-4 md:hidden">
            {loading ? (
              <Card className="p-4 text-center">
                <div className="flex items-center justify-center gap-2 py-2">
                  <span className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                  <span className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                  <span className="h-2 w-2 rounded-full bg-primary animate-bounce" />
                </div>
              </Card>
            ) : !dashboard || activeSites.length === 0 ? (
              <Card className="p-4 text-center text-muted-foreground">
                No active site activity found for selected date
              </Card>
            ) : (
              activeSites.map((site, index) => (
                <Card
                  key={site.siteId}
                  onClick={() =>
                    !isSupervisor && navigate(`/site/${site.siteId}`, { state: { from: "dashboard" } })
                  }
                  className={isSupervisor 
                    ? "rounded-2xl border border-muted/30 p-5 bg-card" 
                    : "group cursor-pointer rounded-2xl border border-muted/30 p-5 transition-all duration-300 hover:shadow-md hover:border-primary/20 bg-card"}
                >
                  <div className="flex items-center justify-between border-b border-muted/10 pb-3">
                    <div className="flex items-center gap-2.5">
                      {index === 0 ? (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/10 text-xs font-extrabold text-amber-600 border border-amber-500/20">1</span>
                      ) : index === 1 ? (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-400/10 text-xs font-extrabold text-slate-500 border border-slate-400/20">2</span>
                      ) : index === 2 ? (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-700/10 text-xs font-extrabold text-amber-800 border border-amber-700/20">3</span>
                      ) : (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted/60 text-xs font-semibold text-muted-foreground">{index + 1}</span>
                      )}
                      <h3 className="font-bold text-foreground transition-colors duration-200 group-hover:text-primary">
                        {site.siteName}
                      </h3>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
                    <div className="bg-muted/30 rounded-xl p-2.5 text-center">
                      <p className="text-[10px] text-muted-foreground uppercase font-medium">Employees</p>
                      <p className="font-bold mt-0.5 text-sm text-foreground">
                        {site.employeesToday}
                      </p>
                    </div>

                    <div className="bg-muted/30 rounded-xl p-2.5 text-center">
                      <p className="text-[10px] text-muted-foreground uppercase font-medium">Man Hours</p>
                      <p className="font-bold mt-0.5 text-sm text-foreground">
                        {site.manHoursToday}h
                      </p>
                    </div>

                    <div className="bg-muted/30 rounded-xl p-2.5 text-center">
                      <p className="text-[10px] text-muted-foreground uppercase font-medium">Avg Hours</p>
                      <p className="font-bold mt-0.5 text-sm text-foreground">
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
          <Card className="rounded-3xl border border-muted/30 bg-card shadow-sm overflow-hidden">
            <div className="p-8 pb-0">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                Sites Overview
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Cumulative metrics from attendance records across site lifecycles.
              </p>
            </div>

            {/* Connected tab bar */}
            <div className="px-8 pt-6">
              <div className="flex items-center gap-0 border-b border-muted/30">
                <button
                  onClick={() => setOverviewTab("inprogress")}
                  className={`relative inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-colors duration-200 ${overviewTab === "inprogress"
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  In Progress
                  <span className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${overviewTab === "inprogress"
                      ? "bg-primary/10 text-primary"
                      : "bg-muted/60 text-muted-foreground"
                    }`}>
                    {inProgressCount}
                  </span>
                  {overviewTab === "inprogress" && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-t-full" />
                  )}
                </button>

                <button
                  onClick={() => setOverviewTab("completed")}
                  className={`relative inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-colors duration-200 ${overviewTab === "completed"
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  Completed
                  <span className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${overviewTab === "completed"
                      ? "bg-primary/10 text-primary"
                      : "bg-muted/60 text-muted-foreground"
                    }`}>
                    {completedCount}
                  </span>
                  {overviewTab === "completed" && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-t-full" />
                  )}
                </button>
              </div>
            </div>

            {/* Tab content */}
            <div className="p-8 pt-6">
              {overviewLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : (
                <div className={overviewTab === "completed" ? "max-h-[540px] overflow-y-auto pr-1 scrollbar-thin" : ""}>
                  {(overviewTab === "inprogress" ? inProgressSites : completedSites).length === 0 ? (
                    <div className="rounded-2xl border bg-muted/20 py-16 text-center">
                      <p className="text-muted-foreground font-medium">
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
                            className={`group relative rounded-xl border bg-card p-3.5 transition-all duration-300 ${overviewTab === "completed" ? "border-muted/20 bg-muted/5" : "border-muted/30"
                              } ${isAdmin ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:border-primary/20" : ""
                              }`}
                            onClick={() => isAdmin && navigate(`/site/${site.siteId}`, { state: { from: "dashboard" } })}
                          >
                            {/* Site name + permanent badge */}
                            <div className="flex items-start justify-between gap-2">
                              <h3 className={`text-sm font-bold text-foreground leading-snug ${isAdmin ? "transition-colors group-hover:text-primary" : ""
                                }`}>
                                {site.siteName}
                              </h3>
                              {site.isPermanent && (
                                <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary border border-primary/20">
                                  Permanent
                                </span>
                              )}
                            </div>

                            {/* Stats row */}
                            <div className="mt-3 grid grid-cols-3 gap-1.5">
                              <div className="rounded-lg bg-violet-500/8 border border-violet-500/10 p-1.5 text-center">
                                <div className="flex items-center justify-center gap-1 text-violet-600 dark:text-violet-400">
                                  <Clock3 className="h-2.5 w-2.5" />
                                  <span className="text-[9px] font-semibold uppercase tracking-wider">Hours</span>
                                </div>
                                <p className="mt-0.5 text-xs md:text-sm font-extrabold text-foreground">{site.totalManHours}</p>
                              </div>

                              <div className="rounded-lg bg-emerald-500/8 border border-emerald-500/10 p-1.5 text-center">
                                <div className="flex items-center justify-center gap-1 text-emerald-600 dark:text-emerald-400">
                                  <Users className="h-2.5 w-2.5" />
                                  <span className="text-[9px] font-semibold uppercase tracking-wider">Man Days</span>
                                </div>
                                <p className="mt-0.5 text-xs md:text-sm font-extrabold text-foreground">{site.totalManDays}</p>
                              </div>

                              <div className="rounded-lg bg-amber-500/8 border border-amber-500/10 p-1.5 text-center">
                                <div className="flex items-center justify-center gap-1 text-amber-600 dark:text-amber-400">
                                  <Calendar className="h-2.5 w-2.5" />
                                  <span className="text-[9px] font-semibold uppercase tracking-wider">Days</span>
                                </div>
                                <p className="mt-0.5 text-xs md:text-sm font-extrabold text-foreground">{site.totalCalendarDays}</p>
                              </div>
                            </div>

                            {/* Job status dots */}
                            {site.jobs.length > 0 && (
                              <div className="mt-3 border-t border-muted/20 pt-2 flex items-center justify-between">
                                <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Jobs</span>
                                <div className="flex flex-wrap items-center gap-1">
                                  {site.jobs.map((job) => (
                                    <span
                                      key={job._id}
                                      title={`${job.name} — ${job.isCompleted ? "Completed" : "In Progress"}`}
                                      className={`inline-flex h-4 w-4 items-center justify-center rounded-full transition-transform hover:scale-125 cursor-default ${job.isCompleted
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