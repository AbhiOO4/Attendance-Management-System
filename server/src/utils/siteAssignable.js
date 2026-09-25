import mongoose from "mongoose"
import jobModel from "../models/jobModel.js"

/**
 * A site is a valid assignment/transfer destination only when it exists and is
 * live: not soft-deleted, active, and not marked completed. Centralised here so
 * every path that moves an employee or supervisor onto a site agrees on the rule
 * (deferred add, cross-site transfer, scheduled-assignment cron, and the
 * supervisor reassignment flow).
 */
export function isAssignableSite(site) {
  return !!site && !site.isDeleted && site.isActive === true && !site.isCompleted
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
