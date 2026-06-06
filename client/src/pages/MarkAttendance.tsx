import { api } from "@/lib/api"
import { useEffect, useMemo, useState } from "react"
import { getLogicalShiftDate, isInExtendedPeriod, formatLogicalDateLabel } from "@/lib/dateUtils"
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
}

type SiteAttendanceStatus = {
  [key: string]: boolean
}

function MarkAttendance() {
  const navigate = useNavigate()

  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [attendanceStatus, setAttendanceStatus] =
    useState<SiteAttendanceStatus>({})

  const [cutoffHour, setCutoffHour] = useState(7)
  const today = useMemo(() => getLogicalShiftDate(cutoffHour), [cutoffHour])
  const extendedPeriod = useMemo(() => isInExtendedPeriod(cutoffHour), [cutoffHour])

  const formattedDate = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  const fetchSites = async () => {
    try {
      setLoading(true)

      const response = await api.get("/api/site", {
        params: {
          isActive: true,
        },
      })

      const fetchedSites = response.data || []
      setSites(fetchedSites)

      const statusPromises = fetchedSites.map(async (site: Site) => {
        const res = await api.post(
          `/api/site/${site._id}/check-pending`,
          {
            date: today,
          }
        )

        return {
          siteId: site._id,
          taken: res.data.status,
        }
      })

      const results = await Promise.all(statusPromises)

      const statusMap: SiteAttendanceStatus = {}

      results.forEach((item) => {
        statusMap[item.siteId] = item.taken
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
    const init = async () => {
      // Fetch night shift cutoff config
      try {
        const configRes = await api.get("/api/config")
        if (configRes.data?.data?.nightShiftCutoffHour !== undefined) {
          setCutoffHour(configRes.data.data.nightShiftCutoffHour)
        }
      } catch (err) {
        console.error("Failed to fetch config:", err)
      }
      fetchSites()
    }
    init()
  }, [])

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
              const taken = attendanceStatus[site._id]

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
                        <h2 className="text-lg font-semibold">
                          {site.siteName}
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
                          taken
                            ? "border-green-500 bg-green-500/10 text-green-600"
                            : "border-red-500 bg-red-500/10 text-red-600"
                        }
                      >
                        {taken ? "Taken" : "Pending"}
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