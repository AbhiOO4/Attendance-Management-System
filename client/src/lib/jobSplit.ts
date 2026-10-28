import type { DriverJob, SiteJobs } from "@/lib/driverJobs"

/**
 * Driver job splits — mirror of server/src/utils/jobSplit.js (KEEP IN SYNC).
 *
 * A driver serves a SITE, not one job: their session on the Drivers pool names the site and
 * its hours are split EQUALLY across the ticked jobs of that site (or of the "General" place —
 * the global jobs). The server stores `servedSiteId` + `splitJobIds` and sends them back
 * resolved as `servedSite` + `splitJobs`. A session's jobs are `splitJobIds` when non-empty,
 * else its single `jobId`.
 */

/** Label of the place whose jobs are the global jobs (servedSiteId null). */
export const GENERAL_PLACE_LABEL = "General"

/** A job a split names, as the server resolves it. */
export type SplitJob = { _id: string; name: string; jobCode?: string | null; isGlobal?: boolean }

/** Where a driver session's hours go: a site (null = General) and the jobs ticked there. */
export type DriverPlace = { siteId: string | null; siteName: string; jobIds: string[] }

/** The split fields a session carries in API responses. */
export type SessionSplitFields = {
  servedSite?: { _id: string; siteName: string } | null
  splitJobs?: SplitJob[]
}

/** The place a stored single job belongs to — how a legacy one-job driver session opens. */
export function placeFromJob(job?: DriverJob | null): DriverPlace | null {
  if (!job?._id) return null
  if (job.isGlobal) return { siteId: null, siteName: GENERAL_PLACE_LABEL, jobIds: [job._id] }
  if (!job.site?._id) return null
  return { siteId: job.site._id, siteName: job.site.siteName, jobIds: [job._id] }
}

/** The place a saved session's split names (or its legacy single job), else null. */
export function placeFromSession(
  s?: (SessionSplitFields & { job?: DriverJob | null }) | null
): DriverPlace | null {
  if (!s) return null
  if (s.splitJobs?.length) {
    return {
      siteId: s.servedSite?._id ?? null,
      siteName: s.servedSite?.siteName ?? GENERAL_PLACE_LABEL,
      jobIds: s.splitJobs.map((j) => j._id),
    }
  }
  return placeFromJob(s.job)
}

/** The picker group a place lives in (General = the global group). */
export const placeGroup = (places: SiteJobs[], siteId: string | null) =>
  places.find((p) => (siteId === null ? !!p.isGlobal : !p.isGlobal && p._id === siteId)) ?? null

/** "3 jobs · split equally" / "2 of 3 jobs" / "1 job" — the count line under a place. */
export function placeJobsText(place: DriverPlace, liveCount?: number | null) {
  const n = place.jobIds.length
  if (liveCount && liveCount > 0 && n < liveCount) return `${n} of ${liveCount} jobs`
  return n === 1 ? "1 job" : `${n} jobs · split equally`
}

/** One-line text for a session's job(s): "GR-30 · 3 jobs", or the single job's code/name. */
export function sessionJobText(
  s?: (SessionSplitFields & { jobCode?: string | null; jobName?: string | null }) | null
): string {
  if (!s) return ""
  const jobs = s.splitJobs ?? []
  if (jobs.length) {
    const site = s.servedSite?.siteName ?? GENERAL_PLACE_LABEL
    if (jobs.length === 1) return `${site} · ${jobs[0].jobCode || jobs[0].name}`
    return `${site} · ${jobs.length} jobs`
  }
  return s.jobCode || s.jobName || ""
}

/** The job codes/names of a split, for a tooltip or an export cell ("A, B, C"). */
export const splitJobsList = (jobs?: SplitJob[]) =>
  (jobs ?? []).map((j) => j.jobCode || j.name).join(", ")

/**
 * A session's Job cell in tables and exports: a split reads "GR-30 · A, B, C" (hours shared
 * equally), any other session falls back to `single` (the page's usual code or name).
 */
export const sessionJobCell = (s: SessionSplitFields | null | undefined, single: string) =>
  s?.splitJobs?.length
    ? `${s.servedSite?.siteName ?? GENERAL_PLACE_LABEL} · ${splitJobsList(s.splitJobs)}`
    : single

/**
 * A session's Site cell in timesheets: a driver split shows the site actually served (or
 * "General"), not the hidden Drivers pool; any other session keeps `fallback` (its own site).
 */
export const sessionPlaceLabel = (s: SessionSplitFields | null | undefined, fallback: string) =>
  s?.splitJobs?.length ? (s.servedSite?.siteName ?? GENERAL_PLACE_LABEL) : fallback

/** One label per job a session's hours are split across; any other session is `[single]`. */
export const sessionJobLabels = (s: SessionSplitFields | null | undefined, single: string): string[] =>
  s?.splitJobs?.length ? s.splitJobs.map((j) => j.jobCode || j.name) : [single]

/**
 * True when a session sits on the Drivers pool and has a time but no site + jobs (blocks
 * save). `place` is the editor's working pick — undefined on an untouched legacy single-job
 * session, whose `jobId` then still counts.
 */
export const driverSessionMissingPlace = (
  sites: { _id: string; isDriverPool?: boolean }[],
  s: { siteId: string; place?: DriverPlace | null; jobId?: string | null; checkIn?: string | null; checkOut?: string | null }
) => {
  const pool = sites.find((x) => x.isDriverPool)
  const hasJobs = s.place !== undefined ? !!s.place?.jobIds.length : !!s.jobId
  return !!pool && s.siteId === pool._id && !!(s.checkIn || s.checkOut) && !hasJobs
}
