import { api } from "@/lib/api"
import { useEffect, useMemo, useState } from "react"
import { getLogicalShiftDate, isInExtendedPeriod, formatLogicalDateLabel, formatCurrentDateLabel } from "@/lib/dateUtils"
import { useWorkConfig } from "@/context/WorkConfigContext"
import toast from "react-hot-toast"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, MapPin } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Link } from "react-router-dom"
import { Pencil } from "lucide-react"

type Site = {
  _id: string
  siteName: string
  locationDetails: string
  isActive: boolean
  isPermanent?: boolean
  status?: "pending" | "taken" | "completed"
}

type SiteAttendanceStatus = {
  [key: string]: "pending" | "taken" | "completed"
}

function MarkAttendance() {
  const navigate = useNavigate()

  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [attendanceStatus, setAttendanceStatus] =
    useState<SiteAttendanceStatus>({})

  // This page only ever deals with today's roster, so the currently-active cutoff applies.
  const { currentCutoff: cutoffHour, loading: configLoading } = useWorkConfig()
  const today = useMemo(() => getLogicalShiftDate(cutoffHour), [cutoffHour])
  const extendedPeriod = useMemo(() => isInExtendedPeriod(cutoffHour), [cutoffHour])

  const formattedDate = formatCurrentDateLabel()

  const fetchSites = async (targetDate: string = today) => {
    try {
      setLoading(true)

      const response = await api.get("/api/site", {
        params: {
          isActive: true,
          date: targetDate,
        },
      })

      const fetchedSites = response.data || []
      const sortedSites = [...fetchedSites].sort((a, b) => {
        const aPerm = a.isPermanent ? 1 : 0
        const bPerm = b.isPermanent ? 1 : 0
        return bPerm - aPerm
      })
      setSites(sortedSites)

      const statusMap: SiteAttendanceStatus = {}
      sortedSites.forEach((site: any) => {
        statusMap[site._id] = site.status || "pending"
      })

      setAttendanceStatus(statusMap)
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message ||
          "Failed to fetch sites"
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Wait for the config: the logical business day depends on the cutoff.
    if (configLoading) return
    fetchSites(getLogicalShiftDate(cutoffHour))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoading, cutoffHour])

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold">
              Mark Attendance
            </h1>

            <p className="text-muted-foreground">
              {formattedDate}
            </p>
          </div>

          <Button asChild variant="outline" >
            <Link to="/attendance/edit">
              <Pencil className="mr-2 h-4 w-4" />
              Edit Past Attendance
            </Link>
          </Button>
        </div>

        {extendedPeriod && (
          <div className="night-shift-banner" style={{
            background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
            color: "#e0e0ff",
            padding: "12px 16px",
            borderRadius: "8px",
            marginBottom: "16px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontSize: "14px",
            border: "1px solid rgba(100, 100, 255, 0.2)",
          }}>
            <span style={{ fontSize: "20px" }}>🌙</span>
            <div>
              <strong>Logging for {formatLogicalDateLabel(today)} (Night Shift)</strong>
              <div style={{ fontSize: "12px", opacity: 0.8, marginTop: "2px" }}>
                The portal is showing the previous day's roster because it's before {cutoffHour}:00 AM.
              </div>
            </div>
          </div>
        )}

        {sites.length === 0 ? (
          <div className="rounded-xl border bg-background p-10 text-center text-muted-foreground">
            No active sites found
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {sites.map((site) => {
              const status = attendanceStatus[site._id] || "pending"

              return (
                <Card
                  key={site._id}
                  onClick={() =>
                    navigate(`/attendance/${site._id}`)
                  }
                  className="cursor-pointer border-2 transition-all hover:-translate-y-1 hover:shadow-lg"
                >
                  <CardContent className="space-y-5 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <h2 className="text-lg font-semibold flex flex-wrap items-center gap-2">
                          {site.siteName}
                          {site.isPermanent && (
                            <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 text-[10px] font-medium h-4 py-0 px-1.5">
                              Permanent
                            </Badge>
                          )}
                        </h2>

                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="h-4 w-4" />

                          <span>
                            {site.locationDetails}
                          </span>
                        </div>
                      </div>

                      <Badge
                        variant="outline"
                        className={
                          status === "completed"
                            ? "border-green-500 bg-green-500/10 text-green-600"
                            : status === "taken"
                            ? "border-amber-500 bg-amber-500/10 text-amber-600"
                            : "border-red-500 bg-red-500/10 text-red-600"
                        }
                      >
                        {status === "completed"
                          ? "Completed"
                          : status === "taken"
                          ? "Taken"
                          : "Pending"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default MarkAttendance