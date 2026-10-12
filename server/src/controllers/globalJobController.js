import mongoose from "mongoose"
import jobModel from "../models/jobModel.js"
import { escapeRegExp } from "../utils/escapeRegExp.js"
import { JOB_CODE_MAX_LENGTH, JOB_CODE_REGEX, listLiveGlobalJobs } from "../utils/globalJobs.js"

// Global jobs (utils/globalJobs.js): jobs common to every site, logged against per session.

// GET /api/jobs/global — the live global jobs, for every session job picker.
export const getGlobalJobs = async (req, res) => {
  try {
    const data = await listLiveGlobalJobs()
    res.status(200).json({ success: true, data })
  } catch (error) {
    console.log(error)
    res.status(500).json({ success: false, message: "Failed to fetch global jobs" })
  }
}

// GET /api/jobs/global/manage — every non-deleted global job (active or not), for the
// Global Jobs page.
export const getGlobalJobsForManage = async (req, res) => {
  try {
    const jobs = await jobModel
      .find({ isGlobal: true, isDeleted: { $ne: true } }, "_id name jobCode isActive isCompleted createdAt")
      .lean()
    const data = jobs
      .map((j) => ({
        _id: String(j._id),
        name: j.name,
        jobCode: j.jobCode || null,
        isActive: j.isActive !== false,
        isCompleted: j.isCompleted === true,
        createdAt: j.createdAt,
      }))
      .sort((a, b) => String(a.jobCode || a.name).localeCompare(String(b.jobCode || b.name)))
    res.status(200).json({ success: true, data })
  } catch (error) {
    console.log(error)
    res.status(500).json({ success: false, message: "Failed to fetch global jobs" })
  }
}

// POST /api/jobs/global { name, jobCode }
export const createGlobalJob = async (req, res) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : ""
    const jobCode = typeof req.body?.jobCode === "string" ? req.body.jobCode.trim() : ""

    if (!name) {
      return res.status(400).json({ success: false, message: "Job name is required" })
    }
    if (!jobCode) {
      return res.status(400).json({ success: false, message: "Job code is required" })
    }
    if (jobCode.length > JOB_CODE_MAX_LENGTH || !JOB_CODE_REGEX.test(jobCode)) {
      return res.status(400).json({
        success: false,
        message: `Job code may only contain letters, numbers and single hyphens between them (e.g. GEN-EXP-01), up to ${JOB_CODE_MAX_LENGTH} characters`,
      })
    }

    // Job codes are unique across site AND global jobs (the ERPNext Job Order is keyed by it).
    // The unique index is case-sensitive; refuse a code differing only in case as well.
    const clash = await jobModel.exists({
      jobCode: { $regex: `^${escapeRegExp(jobCode)}$`, $options: "i" },
    })
    if (clash) {
      return res.status(409).json({ success: false, message: "Conflict: Job Code already exists in the system." })
    }

    const job = await jobModel.create({ name, jobCode, isGlobal: true, site: null })
    res.status(201).json({
      success: true,
      message: "Global job created",
      data: { _id: String(job._id), name: job.name, jobCode: job.jobCode, isActive: true, isCompleted: false },
    })
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: "Conflict: Job Code already exists in the system." })
    }
    console.log(error)
    res.status(500).json({ success: false, message: "Internal server error" })
  }
}

async function findManagedGlobalJob(jobId) {
  if (!mongoose.isValidObjectId(jobId)) return null
  return jobModel.findOne({ _id: jobId, isGlobal: true, isDeleted: { $ne: true } })
}

// PATCH /api/jobs/global/:jobId/status — toggle active. A global job has no members, so
// unlike a site job there is nobody to unassign.
export const toggleGlobalJobStatus = async (req, res) => {
  try {
    const job = await findManagedGlobalJob(req.params.jobId)
    if (!job) {
      return res.status(404).json({ success: false, message: "Global job not found" })
    }
    job.isActive = !job.isActive
    await job.save()
    res.status(200).json({
      success: true,
      message: job.isActive ? "Global job reactivated" : "Global job deactivated",
      data: { _id: String(job._id), isActive: job.isActive },
    })
  } catch (error) {
    console.log(error)
    res.status(500).json({ success: false, message: "Internal server error" })
  }
}

// DELETE /api/jobs/global/:jobId — soft delete, like a site job. Sessions already logged
// against it keep their jobId.
export const deleteGlobalJob = async (req, res) => {
  try {
    const job = await findManagedGlobalJob(req.params.jobId)
    if (!job) {
      return res.status(404).json({ success: false, message: "Global job not found" })
    }
    job.isDeleted = true
    job.isActive = false
    await job.save()
    res.status(200).json({ success: true, message: "Global job deleted" })
  } catch (error) {
    console.log(error)
    res.status(500).json({ success: false, message: "Internal server error" })
  }
}
