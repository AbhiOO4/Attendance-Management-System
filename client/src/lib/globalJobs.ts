import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import type { SiteJobs } from "@/lib/driverJobs"

/**
 * Global jobs: jobs common to every site (general-expense hours), offered as a SESSION job on
 * every site's attendance sheet and the drivers sheet. Never an employee's roster job, and they
 * never make a job mandatory at a site (only the site's own live jobs do — see lib/siteJobs.ts).
 * Server: utils/globalJobs.js.
 */
export type GlobalJob = {
  _id: string
  name: string
  jobCode: string | null
}

// Alphanumeric segments joined by single hyphens ("GEN-EXP-01"). KEEP IN SYNC with the
// server's JOB_CODE_REGEX (server/src/utils/globalJobs.js).
export const JOB_CODE_PATTERN = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/
export const JOB_CODE_MAX_LENGTH = 40

export const GLOBAL_JOBS_GROUP_ID = "global"
export const GLOBAL_JOBS_GROUP_LABEL = "Global (all sites)"

// One fetch of GET /api/jobs/global shared by every picker on the page, refreshed at most once
// a minute (and on focus once stale, so a job created mid-day shows up without a reload).
let cache: { at: number; data: GlobalJob[] } | null = null
let inflight: Promise<GlobalJob[]> | null = null
const TTL_MS = 60_000

export function loadGlobalJobs(force = false): Promise<GlobalJob[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.data)
  if (inflight) return inflight
  inflight = api
    .get<{ data: GlobalJob[] }>("/api/jobs/global")
    .then((res) => {
      cache = { at: Date.now(), data: res.data.data || [] }
      return cache.data
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Drop the cache (after the Global Jobs page changes the list). */
export const invalidateGlobalJobs = () => {
  cache = null
}

const EMPTY: GlobalJob[] = []

/** The live global jobs; loads while `enabled`, and again on focus/visibility once stale. */
export function useGlobalJobs(enabled: boolean): GlobalJob[] {
  const [jobs, setJobs] = useState<GlobalJob[]>(cache?.data ?? EMPTY)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = () => {
      loadGlobalJobs()
        .then((data) => {
          if (alive) setJobs((prev) => (sameJobs(prev, data) ? prev : data))
        })
        .catch(() => {})
    }
    load()
    const onVisible = () => {
      if (document.visibilityState === "visible") load()
    }
    window.addEventListener("focus", load)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      alive = false
      window.removeEventListener("focus", load)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [enabled])
  return enabled ? jobs : EMPTY
}

// Same list → keep the old array so memoized consumers don't re-render.
const sameJobs = (a: GlobalJob[], b: GlobalJob[]) =>
  a.length === b.length && a.every((j, i) => j._id === b[i]._id && j.name === b[i].name && j.jobCode === b[i].jobCode)

/** The global jobs as a JobPicker group. */
export const globalJobsGroup = (jobs: GlobalJob[]): SiteJobs => ({
  _id: GLOBAL_JOBS_GROUP_ID,
  siteName: GLOBAL_JOBS_GROUP_LABEL,
  isGlobal: true,
  jobs: jobs.map((j) => ({ _id: j._id, name: j.name, jobCode: j.jobCode ?? null })),
})
