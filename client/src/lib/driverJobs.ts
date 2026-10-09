import { useEffect, useState } from "react"
import { api } from "@/lib/api"

/** A job a driver session can be logged against (any live site). */
export type DriverJob = {
  _id: string
  name: string
  jobCode?: string | null
  site?: { _id: string; siteName: string } | null
}

export type SiteJobs = {
  _id: string
  siteName: string
  jobs: { _id: string; name: string; jobCode: string | null }[]
}

// One fetch of GET /api/drivers/jobs shared by every picker on the page (a drivers sheet can
// have dozens of rows), refreshed at most once a minute.
let cache: { at: number; data: SiteJobs[] } | null = null
let inflight: Promise<SiteJobs[]> | null = null
const TTL_MS = 60_000

export const cachedDriverJobs = (): SiteJobs[] | null => cache?.data ?? null

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

export const jobLabel = (job?: DriverJob | null) =>
  job ? [job.jobCode, job.name].filter(Boolean).join(" · ") : ""

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
    for (const j of s.jobs) index.set(j._id, { ...j, site: { _id: s._id, siteName: s.siteName } })
  }
  return index
}
