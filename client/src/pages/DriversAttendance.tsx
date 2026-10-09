import { useEffect, useState } from "react"
import { Loader2, RotateCw } from "lucide-react"

import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { SiteAttendance } from "./SiteAttendance"

const fetchPoolId = async (): Promise<string> => {
  const res = await api.get<{ data: { _id: string } }>("/api/drivers/pool")
  return String(res.data.data._id)
}

const errorMessage = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
  "Couldn't load the drivers sheet"

/**
 * Drivers Attendance: the Site Attendance sheet run against the hidden "Drivers" pool site
 * (server utils/driverPool.js). The roster is every driver with no site; each session is
 * logged against a job from any site. Lock, roster guard, carryovers, defaults, activity and
 * saved-row editing all ride on the pool's site id, so the sheet behaves like a site's.
 */
export default function DriversAttendance() {
  const [poolId, setPoolId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchPoolId()
      .then((id) => alive && setPoolId(id))
      .catch((err) => alive && setError(errorMessage(err)))
    return () => {
      alive = false
    }
  }, [])

  const retry = () => {
    setError(null)
    fetchPoolId()
      .then(setPoolId)
      .catch((err) => setError(errorMessage(err)))
  }

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={retry}>
              <RotateCw className="h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!poolId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return <SiteAttendance key={poolId} siteIdOverride={poolId} variant="drivers" />
}
