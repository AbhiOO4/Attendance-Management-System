/**
 * Driver job splits.
 *
 * A driver serves a SITE, not one job: their session on the Drivers pool names the site and
 * the hours are split EQUALLY across the ticked jobs of that site (`sessions[].splitJobIds`,
 * with `servedSiteId` = the site), or across global jobs (the "General" place,
 * `servedSiteId: null`). Every other session names at most one job (`jobId`).
 *
 * The one rule every reader follows: a session's jobs are `splitJobIds` when non-empty, else
 * `[jobId]` when set, else none — sessionJobIds(). Each of N jobs takes 1/N of the session's
 * hours (the job report and the ERPNext timesheet divide by N). KEEP IN SYNC with
 * client/src/lib/jobSplit.ts.
 */
import mongoose from "mongoose"
import jobModel from "../models/jobModel.js"
import siteModel from "../models/siteModel.js"
import { isAssignableSite } from "./siteAssignable.js"

const idOf = (v) => (v && typeof v === "object" && v._id ? v._id : v)

/** The session's jobs (ids, or the populated docs when populated), per the rule above. */
export function sessionJobIds(session) {
  if (!session) return []
  const split = Array.isArray(session.splitJobIds) ? session.splitJobIds.filter(Boolean) : []
  if (split.length) return split
  return session.jobId ? [session.jobId] : []
}

/** True when two job-id lists name the same set of jobs. */
export function sameJobSet(a, b) {
  const sa = new Set((a || []).map((v) => String(idOf(v))))
  const sb = new Set((b || []).map((v) => String(idOf(v))))
  if (sa.size !== sb.size) return false
  for (const v of sa) if (!sb.has(v)) return false
  return true
}

/** True when the request body explicitly carries a split for this session. */
export function hasSplitKey(session) {
  return !!session && Array.isArray(session.splitJobIds)
}

/**
 * Validate the jobs a driver session's hours are split across and work out the site they
 * belong to. Returns `{ servedSiteId, splitJobIds }` or null when the list is unusable:
 *   - at least one job, every one existing and not deleted;
 *   - either ALL at one real (non-pool) site, or ALL global (→ servedSiteId null, "General");
 *     a mix is refused;
 *   - `strict` (today's Drivers sheet) also needs every job live (active, not completed) and
 *     the site assignable (the old single-job findDriverJob rule). Past-day editors
 *     pass strict:false: a job completed since that day is still a true record of it.
 */
export async function resolveDriverSplit(jobIds, { strict = true, session = null } = {}) {
  if (!Array.isArray(jobIds)) return null
  const ids = [...new Set(jobIds.map((v) => String(idOf(v) ?? "")))].filter(Boolean)
  if (!ids.length || ids.some((id) => !mongoose.isValidObjectId(id))) return null

  const jobs = await jobModel
    .find({ _id: { $in: ids }, isDeleted: { $ne: true } }, "_id site isGlobal isActive isCompleted")
    .populate("site", "siteName isActive isDeleted isCompleted isDriverPool")
    .session(session || null)
  if (jobs.length !== ids.length) return null

  const isLive = (j) => j.isActive !== false && !j.isCompleted
  const globals = jobs.filter((j) => j.isGlobal)
  if (globals.length === jobs.length) {
    if (strict && jobs.some((j) => j.isActive !== true || j.isCompleted)) return null
    return { servedSiteId: null, splitJobIds: ids.map((id) => new mongoose.Types.ObjectId(id)) }
  }
  if (globals.length) return null

  const site = jobs[0].site
  if (!site || site.isDriverPool) return null
  if (jobs.some((j) => !j.site || String(j.site._id) !== String(site._id))) return null
  if (strict && (!isAssignableSite(site) || jobs.some((j) => !isLive(j)))) return null

  return { servedSiteId: site._id, splitJobIds: ids.map((id) => new mongoose.Types.ObjectId(id)) }
}

/**
 * Batch-load what a response needs to show split sessions. Returns `info(session)` →
 * `{ servedSite: { _id, siteName } | null, splitJobs: [{ _id, name, jobCode, isGlobal }] }`
 * (both empty for a session without a split).
 */
export async function buildSplitLookup(sessions, session = null) {
  const jobIds = new Set()
  const siteIds = new Set()
  for (const s of sessions || []) {
    if (!s) continue
    for (const j of s.splitJobIds || []) if (j) jobIds.add(String(idOf(j)))
    if (s.servedSiteId) siteIds.add(String(idOf(s.servedSiteId)))
  }
  const [jobs, sites] = await Promise.all([
    jobIds.size
      ? jobModel.find({ _id: { $in: [...jobIds] } }, "_id name jobCode isGlobal").session(session || null).lean()
      : [],
    siteIds.size
      ? siteModel.find({ _id: { $in: [...siteIds] } }, "_id siteName").session(session || null).lean()
      : [],
  ])
  const jobById = new Map(
    jobs.map((j) => [String(j._id), { _id: String(j._id), name: j.name, jobCode: j.jobCode || null, isGlobal: !!j.isGlobal }])
  )
  const siteById = new Map(sites.map((s) => [String(s._id), { _id: String(s._id), siteName: s.siteName }]))

  return (s) => {
    const ids = (s?.splitJobIds || []).filter(Boolean).map((j) => String(idOf(j)))
    if (!ids.length) return { servedSite: null, splitJobs: [] }
    return {
      servedSite: s.servedSiteId ? siteById.get(String(idOf(s.servedSiteId))) || null : null,
      splitJobs: ids.map((id) => jobById.get(id) || { _id: id, name: "Job", jobCode: null, isGlobal: false }),
    }
  }
}
