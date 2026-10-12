import empModel from "../models/empModel.js"
import siteModel from "../models/siteModel.js"
import jobModel from "../models/jobModel.js"
import attendanceModel from "../models/attendanceModel.js"
import { findRecordedElsewhere } from "../utils/draftRoster.js"
import { getTodayLocal, getDateLocal } from "../utils/timeLocal.js"
import { driverEmployeeFilter, getDriverPoolId } from "../utils/driverPool.js"
import { isAssignableSite } from "../utils/siteAssignable.js"
import { GLOBAL_JOB_GROUP, listLiveGlobalJobs } from "../utils/globalJobs.js"

// How far back "last job used" looks for a driver's draft prefill.
const LAST_JOB_LOOKBACK_DAYS = 60

// GET /api/drivers/pool — the hidden drivers pool site (its id + default times).
export const getDriverPool = async (req, res) => {
  try {
    const poolId = await getDriverPoolId()
    if (!poolId) {
      return res.status(503).json({ success: false, message: "Drivers pool is not set up yet" })
    }
    const pool = await siteModel.findById(poolId).lean()
    res.status(200).json({ success: true, data: pool })
  } catch (error) {
    console.log(error)
    res.status(500).json({ success: false, message: "Internal server error" })
  }
}

/**
 * GET /api/drivers/roster — the drivers the Drivers Attendance draft is built from, in the
 * same shape as GET /api/employees?site= (`{ employees, totalEmployees }`, with
 * `recordedElsewhereToday` annotated) so the page's roster filter is shared with the site
 * sheet. Each driver also carries `lastJob`: the job of their most recent drivers-sheet
 * session (last 60 days) when that job is still assignable, else null.
 *
 * The draft filter applied on top of this is mirrored by the server's
 * computeExpectedDraftRoster (utils/draftRoster.js, pool branch).
 */
export const getDriverRoster = async (req, res) => {
  try {
    const poolId = await getDriverPoolId()
    if (!poolId) {
      return res.status(503).json({ success: false, message: "Drivers pool is not set up yet" })
    }

    const employeesRaw = await empModel
      .find(
        driverEmployeeFilter(),
        "_id name employeeId jobTitle currentSite currentJob user employmentType collarType nationality isActive pendingTransferCheckIn pendingTransferSiteId pendingTransferDate pendingTransferFromSiteId pendingTransferJobId"
      )
      .populate("pendingTransferFromSiteId", "siteName")
      .sort({ name: 1 })

    const todayStr = getTodayLocal()
    const elsewhereByEmp = await findRecordedElsewhere({
      employees: employeesRaw,
      anchorSiteId: poolId,
      todayStr,
    })
    const elsewhereNames = new Map()
    if (elsewhereByEmp.size) {
      const docs = await siteModel.find({ _id: { $in: [...new Set(elsewhereByEmp.values())] } }, "siteName").lean()
      for (const d of docs) elsewhereNames.set(String(d._id), d.siteName)
    }

    const lastJobByEmp = await lastDriverJobs(employeesRaw.map((e) => e._id), poolId)

    const employees = employeesRaw.map((e) => {
      const obj = e.toObject()
      const otherId = elsewhereByEmp.get(String(e._id))
      obj.recordedElsewhereToday = otherId ? { siteId: otherId, siteName: elsewhereNames.get(otherId) || null } : null
      obj.lastJob = lastJobByEmp.get(String(e._id)) || null
      return obj
    })

    res.status(200).json({ employees, totalEmployees: employees.length })
  } catch (error) {
    console.log(error)
    res.status(500).json({ success: false, message: "Failed to fetch drivers" })
  }
}

// employeeId → { _id, name, jobCode, site: { _id, siteName } } for each driver's most recent
// drivers-sheet session that still points at an assignable job (a global job comes back with
// `isGlobal: true, site: null`).
async function lastDriverJobs(employeeIds, poolId) {
  const out = new Map()
  if (!employeeIds.length) return out

  const since = new Date(getDateLocal(-LAST_JOB_LOOKBACK_DAYS))
  const records = await attendanceModel
    .find(
      { employee: { $in: employeeIds }, date: { $gte: since }, "sessions.siteId": poolId },
      "employee date sessions.siteId sessions.jobId sessions.checkIn"
    )
    .sort({ date: -1 })
    .lean()

  const candidateByEmp = new Map()
  for (const rec of records) {
    const key = String(rec.employee)
    if (candidateByEmp.has(key)) continue
    const poolSessions = (rec.sessions || []).filter((s) => String(s.siteId) === String(poolId) && s.jobId)
    if (!poolSessions.length) continue
    candidateByEmp.set(key, String(poolSessions[poolSessions.length - 1].jobId))
  }
  if (!candidateByEmp.size) return out

  const jobs = await jobModel
    .find({ _id: { $in: [...new Set(candidateByEmp.values())] }, isDeleted: { $ne: true } }, "name jobCode isActive isCompleted site isGlobal")
    .populate("site", "siteName isActive isDeleted isCompleted isDriverPool")
    .lean()
  const jobById = new Map()
  for (const j of jobs) {
    if (j.isActive === false || j.isCompleted) continue
    // A global job (no site) stays pickable from any sheet.
    if (j.isGlobal) {
      jobById.set(String(j._id), { _id: String(j._id), name: j.name, jobCode: j.jobCode || null, isGlobal: true, site: null })
      continue
    }
    if (!isAssignableSite(j.site)) continue
    jobById.set(String(j._id), {
      _id: String(j._id),
      name: j.name,
      jobCode: j.jobCode || null,
      site: { _id: String(j.site._id), siteName: j.site.siteName },
    })
  }
  for (const [emp, jobId] of candidateByEmp) {
    const job = jobById.get(jobId)
    if (job) out.set(emp, job)
  }
  return out
}

/**
 * GET /api/drivers/jobs — every job a driver session may be logged against: the live global
 * jobs (first, as one group) plus active, not completed jobs at live (assignable) sites,
 * grouped by site. Feeds the job picker.
 */
export const getDriverJobs = async (req, res) => {
  try {
    const globalJobs = await listLiveGlobalJobs()
    const sites = await siteModel
      .find(
        { isDeleted: { $ne: true }, isActive: true, isCompleted: { $ne: true }, isDriverPool: { $ne: true } },
        "_id siteName jobs isPermanent"
      )
      .populate({
        path: "jobs",
        match: { isDeleted: { $ne: true }, isActive: { $ne: false }, isCompleted: { $ne: true } },
        select: "_id name jobCode",
      })
      .sort({ isPermanent: -1, siteName: 1 })
      .lean()

    const data = sites
      .map((s) => ({
        _id: String(s._id),
        siteName: s.siteName,
        jobs: (s.jobs || [])
          .filter(Boolean)
          .map((j) => ({ _id: String(j._id), name: j.name, jobCode: j.jobCode || null }))
          .sort((a, b) => String(a.jobCode || a.name).localeCompare(String(b.jobCode || b.name))),
      }))
      .filter((s) => s.jobs.length > 0)
    if (globalJobs.length) data.unshift({ ...GLOBAL_JOB_GROUP, jobs: globalJobs })

    res.status(200).json({ success: true, data })
  } catch (error) {
    console.log(error)
    res.status(500).json({ success: false, message: "Failed to fetch jobs" })
  }
}
