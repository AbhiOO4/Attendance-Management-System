// pages/DashBoard.tsx

import {
  useEffect,
  useState,
} from "react"

import {
  useNavigate,
} from "react-router-dom"

import { api } from "@/lib/api"

import { Card } from "@/components/ui/card"

import { Input } from "@/components/ui/input"

import { useAuth } from "@/context/AuthContext"

import {
  Users,
  Clock3,
  Building2,
  Percent,
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

function DashBoard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const today = new Date()
    .toISOString()
    .split("T")[0]

  const [date, setDate] =
    useState(today)

  const [loading, setLoading] =
    useState(false)

  const [dashboard, setDashboard] =
    useState<DashboardResponse | null>(
      null
    )

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

  useEffect(() => {
    fetchDashboard()
  }, [date])

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      <div className="mx-auto max-w-7xl space-y-8">

        {/* Header */}

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">

          <div>
            <h1 className="text-4xl font-bold tracking-tight">
              Dashboard
            </h1>

            <p className="mt-1 text-muted-foreground">
              Attendance overview and
              site activity
            </p>
          </div>

          <div className="w-full md:w-[220px]">
            <Input
              type="date"
              value={date}
              onChange={(e) =>
                setDate(
                  e.target.value
                )
              }
            />
          </div>
        </div>

        <Card className="rounded-3xl border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-bold">
              Hi, {user?.name || "User"} 👋
            </h2>

            <p className="text-muted-foreground">
              Welcome back. Here's your attendance overview for{" "}
              {new Date(date).toLocaleDateString()}
            </p>
          </div>
        </Card>

        {/* Summary Cards */}

        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">

          {/* Present */}

          <Card className="rounded-3xl border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <Users className="h-7 w-7 text-muted-foreground" />

              <span className="text-xs text-muted-foreground">
                Today
              </span>
            </div>

            <p className="mt-5 text-sm text-muted-foreground">
              Present Employees
            </p>

            <h2 className="mt-1 text-2xl md:text-3xl font-bold">
              {dashboard
                ? `${dashboard.attendance.presentToday} / ${dashboard.attendance.totalEmployees}`
                : "--"}
            </h2>
          </Card>

          {/* Attendance % */}

          <Card className="rounded-3xl border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <Percent className="h-7 w-7 text-muted-foreground" />

              <span className="text-xs text-muted-foreground">
                Today
              </span>
            </div>

            <p className="mt-5 text-sm text-muted-foreground">
              Attendance %
            </p>

            <h2 className="mt-1 text-3xl font-bold">
              {dashboard
                ?.attendance
                .attendancePercentage ?? 0}
              %
            </h2>
          </Card>

          {/* Man Hours */}

          <Card className="rounded-3xl border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <Clock3 className="h-7 w-7 text-muted-foreground" />

              <span className="text-xs text-muted-foreground">
                Today
              </span>
            </div>

            <p className="mt-5 text-sm text-muted-foreground">
              Total Man Hours
            </p>

            <h2 className="mt-1 text-3xl font-bold">
              {dashboard?.totals
                .manHoursToday ?? 0}
            </h2>
          </Card>

          {/* Sites */}

          <Card className="rounded-3xl border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <Building2 className="h-7 w-7 text-muted-foreground" />

              <span className="text-xs text-muted-foreground">
                Today
              </span>
            </div>

            <p className="mt-5 text-sm text-muted-foreground">
              Active Sites Worked
            </p>

            <h2 className="mt-1 text-3xl font-bold">
              {dashboard?.sites
                ?.length ?? 0}
            </h2>
          </Card>
        </div>

        {/* Site Ranking */}

        <Card className="rounded-3xl border bg-card p-8 shadow-sm">

          <div className="mb-6">
            <h2 className="text-3xl font-bold">
              Todays Site Activity Data
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              Sorted by man hours in
              descending order
            </p>
          </div>

          <div className="hidden md:block overflow-hidden rounded-2xl border">

            <div className="max-h-[600px] overflow-y-auto">

              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>
                      Rank
                    </TableHead>

                    <TableHead>
                      Site Name
                    </TableHead>

                    <TableHead>
                      Employees
                    </TableHead>

                    <TableHead>
                      Man Hours
                    </TableHead>

                    <TableHead>
                      Avg Hours / Worker
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>

                  {loading ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="h-24 text-center"
                      >
                        Loading dashboard...
                      </TableCell>
                    </TableRow>
                  ) : !dashboard ||
                    dashboard.sites
                      .length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No attendance data
                        found for selected
                        date
                      </TableCell>
                    </TableRow>
                  ) : (
                    dashboard.sites.map(
                      (
                        site,
                        index
                      ) => (
                        <TableRow
                          key={site.siteId}
                          onClick={() =>
                            navigate(`/site/${site.siteId}`)
                          }
                          className="cursor-pointer transition hover:bg-muted/50"
                        >
                          <TableCell className="font-medium">
                            {index + 1}
                          </TableCell>

                          <TableCell className="font-medium">
                            {
                              site.siteName
                            }
                          </TableCell>

                          <TableCell>
                            {
                              site.employeesToday
                            }
                          </TableCell>

                          <TableCell>
                            {
                              site.manHoursToday
                            }
                          </TableCell>

                          <TableCell>
                            {
                              site.averageHoursPerWorker
                            }
                          </TableCell>
                        </TableRow>
                      )
                    )
                  )}

                </TableBody>
              </Table>

            </div>
          </div>

          <div className="space-y-3 md:hidden">

            {loading ? (
              <Card className="p-4">
                Loading dashboard...
              </Card>
            ) : !dashboard || dashboard.sites.length === 0 ? (
              <Card className="p-4 text-muted-foreground">
                No attendance data found for selected date
              </Card>
            ) : (
              dashboard.sites.map((site, index) => (
                <Card
                  key={site.siteId}
                  onClick={() =>
                    navigate(`/site/${site.siteId}`)
                  }
                  className="cursor-pointer p-4 transition hover:bg-muted/50"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">
                      #{index + 1}
                    </h3>

                    <span className="text-sm text-muted-foreground">
                      {site.siteName}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">

                    <div>
                      <p className="text-muted-foreground">
                        Employees
                      </p>
                      <p className="font-medium">
                        {site.employeesToday}
                      </p>
                    </div>

                    <div>
                      <p className="text-muted-foreground">
                        Man Hours
                      </p>
                      <p className="font-medium">
                        {site.manHoursToday}
                      </p>
                    </div>

                    <div>
                      <p className="text-muted-foreground">
                        Avg Hours
                      </p>
                      <p className="font-medium">
                        {site.averageHoursPerWorker}
                      </p>
                    </div>

                  </div>
                </Card>
              ))
            )}

          </div>
        </Card>

      </div>
    </div>
  )
}

export default DashBoard