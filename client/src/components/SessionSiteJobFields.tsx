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
import SiteSplitPicker from "@/components/drivers/SiteSplitPicker"
import { useDriverJobIndex } from "@/lib/driverJobs"
import { placeFromJob, type DriverPlace, type SplitJob } from "@/lib/jobSplit"
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
 * whenever the session is already on it. A driver gets ONLY "Drivers" (drivers live only on
 * Drivers Attendance) — plus the session's own site when it's history from before that rule. A Drivers session names the SITE the driver served
 * (SiteSplitPicker: its jobs ticked, hours split equally) and that is REQUIRED once the session
 * has a time, like on the Drivers sheet; a site session keeps the site's jobs + global jobs.
 */
export default function SessionSiteJobFields({
  sites,
  siteId,
  jobId,
  jobName,
  allowDrivers,
  globalJobs,
  hasTimes,
  place,
  knownJobs,
  onSiteChange,
  onJobChange,
  onPlaceChange,
}: {
  sites: PickerSite[]
  siteId: string
  jobId?: string | null
  // The stored job's label — shown when that job is no longer pickable (completed since).
  jobName?: string
  allowDrivers: boolean
  globalJobs: GlobalJob[]
  hasTimes: boolean
  // Drivers: the working site + ticked jobs; undefined = an untouched legacy single-job
  // session (shown as its job's site). `knownJobs` names the stored split's jobs.
  place?: DriverPlace | null
  knownJobs?: SplitJob[]
  onSiteChange: (siteId: string) => void
  onJobChange: (jobId: string) => void
  onPlaceChange: (place: DriverPlace) => void
}) {
  const pool = sites.find((s) => s.isDriverPool)
  const regularSites = sites.filter((s) => !s.isDriverPool && (!allowDrivers || s._id === siteId))
  const onPool = !!pool && siteId === pool._id
  const showPool = !!pool && (allowDrivers || onPool)
  const selectedSite = regularSites.find((s) => s._id === siteId)

  // A legacy single-job driver session opens as its job's site with that one job ticked.
  const driverJobIndex = useDriverJobIndex(onPool && place === undefined && !!jobId)
  // (A job no longer pickable just shows its name until a site is picked.)
  const driverPlace: DriverPlace | null =
    place !== undefined
      ? place
      : jobId
      ? placeFromJob(driverJobIndex.get(jobId)) ?? { siteId: "", siteName: jobName || "Job", jobIds: [jobId] }
      : null
  const placeMissing = place !== undefined ? !place?.jobIds.length : !jobId

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
          {onPool ? "Worked for (hours split across its jobs)" : "Job"}
        </label>
        {onPool ? (
          <SiteSplitPicker
            value={driverPlace}
            knownJobs={knownJobs}
            onChange={onPlaceChange}
            invalid={hasTimes && placeMissing}
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
