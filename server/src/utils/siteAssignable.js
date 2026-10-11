import mongoose from "mongoose"
import jobModel from "../models/jobModel.js"

/**
 * A site is a valid assignment/transfer destination only when it exists and is
 * live: not soft-deleted, active, and not marked completed. Centralised here so
 * every path that moves an employee or supervisor onto a site agrees on the rule
 * (deferred add, cross-site transfer, scheduled-assignment cron, and the
 * supervisor reassignment flow). The hidden drivers pool (utils/driverPool.js) is never a
 * destination — nobody is moved INTO it; drivers are marked there while having no site.
 */
export function isAssignableSite(site) {
  return !!site && !site.isDeleted && site.isActive === true && !site.isCompleted && !site.isDriverPool
}

/**
 * The job, when it can take an employee at `siteId`: it exists, is not soft-deleted,
 * is active, and belongs to that site. Returns null otherwise. The single rule every
 * placement path (transfer, send-to-site, requests, insta-add, bulk job assign, the
 * scheduled-assignment cron) checks a target job against.
 */
export async function findAssignableJob(jobId, siteId, session = null) {
  if (!jobId || !siteId || !mongoose.isValidObjectId(jobId)) return null
  const job = await jobModel
    .findOne({ _id: jobId, isDeleted: { $ne: true } })
    .session(session || null)
  if (!job || !job.isActive || job.site.toString() !== siteId.toString()) return null
  return job
}

/**
 * True when `siteId` has at least one live job (not soft-deleted, active, not completed).
 * On such a site every session with a time must name a job (site-sheet submit + edits);
 * a site with no jobs keeps sessions job-optional. Mirrors the client's liveSiteJobs.
 */
export async function siteHasLiveJobs(siteId, session = null) {
  if (!siteId || !mongoose.isValidObjectId(siteId)) return false
  const found = await jobModel
    .exists({ site: siteId, isDeleted: { $ne: true }, isActive: true, isCompleted: { $ne: true } })
    .session(session || null)
  return !!found
}
