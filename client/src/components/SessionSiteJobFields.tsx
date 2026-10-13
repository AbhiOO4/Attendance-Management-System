import { useState } from "react"
import { Truck } from "lucide-react"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import JobPicker from "@/components/drivers/JobPicker"
import { useDriverJobIndex, type DriverJob } from "@/lib/driverJobs"
import { GLOBAL_JOBS_GROUP_LABEL, type GlobalJob } from "@/lib/globalJobs"

/** A site as the past-day editors fetch it (GET /api/site?includeDriverPool=true). */
export type PickerSite = {
  _id: string
  siteName: string
  // The hidden Drivers pool (server utils/driverPool.js) — shown as "Drivers", not a site.
  isDriverPool?: boolean
  jobs: { _id: string; name: string; jobCode?: string | null }[]
}

/**
 * The Site + Job pair of one session in the admin past-day editors (Edit past, Backfill).
 *
 * "Drivers" is offered as its own "No site" group when `allowDrivers` (a driver employee), or
 * whenever the session is already on it. A Drivers session gets the drivers sheet's any-site
 * JobPicker (every live site's jobs + the global jobs) and the job is REQUIRED once the session
 * has a time, like on the Drivers sheet; a site session keeps the site's jobs + global jobs.
 */
export default function SessionSiteJobFields({
  sites,
  siteId,
  jobId,
  jobName,
  jobCode,
  allowDrivers,
  globalJobs,
  hasTimes,
  onSiteChange,
  onJobChange,
}: {
  sites: PickerSite[]
  siteId: string
  jobId?: string | null
  // The stored job's label — shown when that job is no longer pickable (completed since).
  jobName?: string
  jobCode?: string | null
  allowDrivers: boolean
  globalJobs: GlobalJob[]
  hasTimes: boolean
  onSiteChange: (siteId: string) => void
  onJobChange: (jobId: string) => void
}) {
  const pool = sites.find((s) => s.isDriverPool)
  const regularSites = sites.filter((s) => !s.isDriverPool)
  const onPool = !!pool && siteId === pool._id
  const showPool = !!pool && (allowDrivers || onPool)
  const selectedSite = regularSites.find((s) => s._id === siteId)

  const driverJobIndex = useDriverJobIndex(onPool)
  const [picked, setPicked] = useState<DriverJob | null>(null)
  const driverJob: DriverJob | null = !jobId
    ? null
    : driverJobIndex.get(jobId) ??
      (picked?._id === jobId ? picked : { _id: jobId, name: jobName || "Job", jobCode: jobCode ?? null })

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Site</label>
        <Select value={siteId} onValueChange={onSiteChange}>
          <SelectTrigger className="w-full h-10 text-sm">
            <SelectValue placeholder="Select site" />
          </SelectTrigger>
          <SelectContent>
            {regularSites.map((site) => (
              <SelectItem key={site._id} value={site._id}>{site.siteName}</SelectItem>
            ))}
            {showPool && pool && (
              <>
                {regularSites.length > 0 && <SelectSeparator />}
                <SelectGroup>
                  <SelectLabel>No site</SelectLabel>
                  <SelectItem value={pool._id}>
                    <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                    Drivers
                  </SelectItem>
                </SelectGroup>
              </>
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          {onPool ? "Job (any site)" : "Job"}
        </label>
        {onPool ? (
          <JobPicker
            value={driverJob}
            onChange={(job) => {
              setPicked(job)
              onJobChange(job._id)
            }}
            invalid={hasTimes && !jobId}
            className="h-10"
          />
        ) : (
          <Select value={jobId || ""} onValueChange={onJobChange}>
            <SelectTrigger className="w-full h-10 text-sm">
              <SelectValue placeholder="Select job" />
            </SelectTrigger>
            <SelectContent>
              {selectedSite?.jobs.map((job) => (
                <SelectItem key={job._id} value={job._id}>{job.name}</SelectItem>
              ))}
              {/* Global jobs (any site) — session-only general-expense jobs. */}
              {globalJobs.length > 0 && (
                <>
                  {!!selectedSite?.jobs.length && <SelectSeparator />}
                  <SelectGroup>
                    <SelectLabel>{GLOBAL_JOBS_GROUP_LABEL}</SelectLabel>
                    {globalJobs.map((job) => (
                      <SelectItem key={job._id} value={job._id}>
                        {job.jobCode ? `${job.jobCode} · ${job.name}` : job.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </>
              )}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  )
}
