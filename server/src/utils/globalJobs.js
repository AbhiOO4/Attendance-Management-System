/**
 * Global jobs — jobs common to every site (general-expense hours, e.g. drivers' work that
 * isn't billed to a site job).
 *
 * A global job is a Job doc with `isGlobal: true` and `site: null`, so `sessions.jobId` keeps
 * pointing at the Job collection and every populate, the job report and the ERPNext timesheet
 * (jobCode → Job Order) bill it like any other job. It is a SESSION job only: it's offered on
 * every site's attendance sheet and the drivers sheet, but it never becomes an employee's
 * currentJob / roster job (syncCurrentJobFromLatestSession skips it) and it is never a
 * placement destination (findAssignableJob rejects a job with no site). It never makes a job
 * mandatory at a site either — siteHasLiveJobs only counts the site's own jobs.
 */
import mongoose from "mongoose"
import jobModel from "../models/jobModel.js"
import { findAssignableJob } from "./siteAssignable.js"

// Alphanumeric segments joined by single hyphens ("GEN-EXP-01"). KEEP IN SYNC with the
// client's JOB_CODE_PATTERN (client/src/lib/globalJobs.ts).
export const JOB_CODE_REGEX = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/
export const JOB_CODE_MAX_LENGTH = 40

// A global job a session may be logged against: not deleted, active, not completed.
export const LIVE_GLOBAL_JOB_FILTER = {
  isGlobal: true,
  isDeleted: { $ne: true },
  isActive: true,
  isCompleted: { $ne: true },
}

// The picker group global jobs are listed under (GET /api/drivers/jobs).
export const GLOBAL_JOB_GROUP = { _id: "global", siteName: "Global (all sites)", isGlobal: true }

/** The live global jobs as `{ _id, name, jobCode }`, sorted by code. */
export async function listLiveGlobalJobs() {
  const jobs = await jobModel.find(LIVE_GLOBAL_JOB_FILTER, "_id name jobCode").lean()
  return jobs
    .map((j) => ({ _id: String(j._id), name: j.name, jobCode: j.jobCode || null }))
    .sort((a, b) => String(a.jobCode || a.name).localeCompare(String(b.jobCode || b.name)))
}

/** The job when it is a live global job, else null. */
export async function findGlobalJob(jobId, session = null) {
  if (!jobId || !mongoose.isValidObjectId(String(jobId))) return null
  return jobModel.findOne({ _id: jobId, ...LIVE_GLOBAL_JOB_FILTER }).session(session || null)
}

/** True when `jobId` names a global job (any state) — used to keep it off the roster. */
export async function isGlobalJobId(jobId, session = null) {
  if (!jobId || !mongoose.isValidObjectId(String(jobId))) return false
  return !!(await jobModel.exists({ _id: jobId, isGlobal: true }).session(session || null))
}

/**
 * A job a site-sheet session may be logged against: a live global job, or an assignable job
 * of that site. Returns the job or null.
 */
export async function findSessionJob(jobId, siteId, session = null) {
  return (await findGlobalJob(jobId, session)) || (await findAssignableJob(jobId, siteId, session))
}
