import { useEffect, useState } from "react"
import { api } from "@/lib/api"

/** A job a driver session can be logged against (any live site, or a global job). */
export type DriverJob = {
  _id: string
  name: string
  jobCode?: string | null
  // A global job (lib/globalJobs.ts) has no site.
  isGlobal?: boolean
  site?: { _id: string; siteName: string } | null
}

export type SiteJobs = {
  _id: string
  siteName: string
  // The global-jobs group (GET /api/drivers/jobs lists it first; site sheets append it).
  isGlobal?: boolean
  jobs: { _id: string; name: string; jobCode: string | null }[]
}

// One fetch of GET /api/drivers/jobs shared by every picker on the page (a drivers sheet can
// have dozens of rows), refreshed at most once a minute.
let cache: { at: number; data: SiteJobs[] } | null = null
let inflight: Promise<SiteJobs[]> | null = null
const TTL_MS = 60_000

export const cachedDriverJobs = (): SiteJobs[] | null => cache?.data ?? null

/** Drop the cache (after the Global Jobs page changes the list). */
export const invalidateDriverJobs = () => {
  cache = null
}

export function loadDriverJobs(force = false): Promise<SiteJobs[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.data)
  if (inflight) return inflight
  inflight = api
    .get<{ data: SiteJobs[] }>("/api/drivers/jobs")
    .then((res) => {
      cache = { at: Date.now(), data: res.data.data || [] }
      return cache.data
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

// A driver's job title contains "driver". KEEP IN SYNC with the server's DRIVER_TITLE_REGEX
// (server/src/utils/driverPool.js). Past-day editors gate the "Drivers" place on it.
export const isDriverTitle = (jobTitle?: string | null) => /driver/i.test(jobTitle || "")

/**
 * GET /api/site plus the hidden Drivers pool (last, flagged `isDriverPool`) — for the admin
 * past-day editors, where a driver session is placed on "Drivers" like on a site.
 */
export async function fetchSitesWithDriverPool<T = unknown>(): Promise<T[]> {
  const res = await api.get<T[]>("/api/site", { params: { includeDriverPool: true } })
  return res.data || []
}

export const jobLabel = (job?: DriverJob | null) =>
  job ? [job.jobCode, job.name].filter(Boolean).join(" · ") : ""

/** Where a job belongs: its site, or "Global · all sites" for a global job. */
export const jobPlaceLabel = (job?: DriverJob | null) =>
  job ? (job.isGlobal ? "Global · all sites" : job.site?.siteName ?? "") : ""

/** A group's job as a DriverJob: a global group's jobs carry `isGlobal` and no site. */
export const jobFromGroup = (group: SiteJobs, j: SiteJobs["jobs"][number]): DriverJob =>
  group.isGlobal
    ? { ...j, isGlobal: true, site: null }
    : { ...j, site: { _id: group._id, siteName: group.siteName } }

/**
 * jobId → DriverJob for every pickable job (shared cache), so an editor can label a stored
 * session's job with its code and site. Loads only while `enabled`.
 */
export function useDriverJobIndex(enabled: boolean): Map<string, DriverJob> {
  const [sites, setSites] = useState<SiteJobs[]>(cache?.data ?? [])
  useEffect(() => {
    if (!enabled) return
    let alive = true
    loadDriverJobs()
      .then((data) => alive && setSites(data))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [enabled])
  const index = new Map<string, DriverJob>()
  for (const s of sites) {
    for (const j of s.jobs) index.set(j._id, jobFromGroup(s, j))
  }
  return index
}
