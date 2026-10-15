import empModel from "../models/empModel.js"
import siteModel from "../models/siteModel.js"
import jobModel from "../models/jobModel.js"
import attendanceModel from "../models/attendanceModel.js"
import { findRecordedElsewhere } from "../utils/draftRoster.js"
import { getTodayLocal, getDateLocal } from "../utils/timeLocal.js"
import { driverEmployeeFilter, getDriverPoolId } from "../utils/driverPool.js"
import { GLOBAL_JOB_GROUP, listLiveGlobalJobs } from "../utils/globalJobs.js"

// How far back "last place used" looks for a driver's draft prefill.
const LAST_PLACE_LOOKBACK_DAYS = 60

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
 * sheet. Each driver also carries `lastPlace` `{ siteId, siteName, jobIds }`: the site their
 * most recent drivers-sheet session served (last 60 days; siteId null = the General place of
 * global jobs) with ALL its current live jobs — the draft prefills that site with every job
 * ticked — or null when there's none or it no longer has a live job.
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

    const lastPlaceByEmp = await lastDriverPlaces(employeesRaw.map((e) => e._id), poolId)

    const employees = employeesRaw.map((e) => {
      const obj = e.toObject()
      const otherId = elsewhereByEmp.get(String(e._id))
      obj.recordedElsewhereToday = otherId ? { siteId: otherId, siteName: elsewhereNames.get(otherId) || null } : null
      obj.lastPlace = lastPlaceByEmp.get(String(e._id)) || null
      return obj
    })

    res.status(200).json({ employees, totalEmployees: employees.length })
  } catch (error) {
    console.log(error)
    res.status(500).json({ success: false, message: "Failed to fetch drivers" })
  }
}

// employeeId → `{ siteId, siteName, jobIds }` for each driver's most recent drivers-sheet session
// that names a job, resolved to the place it served (a split's servedSiteId, else a legacy
// single job's site, or General for global jobs) — only when that place still has live jobs.
async function lastDriverPlaces(employeeIds, poolId) {
  const out = new Map()
  if (!employeeIds.length) return out

  const since = new Date(getDateLocal(-LAST_PLACE_LOOKBACK_DAYS))
  const records = await attendanceModel
    .find(
      { employee: { $in: employeeIds }, date: { $gte: since }, "sessions.siteId": poolId },
      "employee date sessions.siteId sessions.jobId sessions.servedSiteId sessions.splitJobIds"
    )
    .sort({ date: -1 })
    .lean()

  // Per employee: the place key ("<siteId>" | "general") or, for a legacy session, its job id.
  const candidateByEmp = new Map()
  const legacyJobIds = new Set()
  for (const rec of records) {
    const key = String(rec.employee)
    if (candidateByEmp.has(key)) continue
    const poolSessions = (rec.sessions || []).filter(
      (s) => String(s.siteId) === String(poolId) && (s.splitJobIds?.length || s.jobId)
    )
    if (!poolSessions.length) continue
    const last = poolSessions[poolSessions.length - 1]
    if (last.splitJobIds?.length) {
      candidateByEmp.set(key, { place: last.servedSiteId ? String(last.servedSiteId) : "general" })
    } else {
      candidateByEmp.set(key, { legacyJob: String(last.jobId) })
      legacyJobIds.add(String(last.jobId))
    }
  }
  if (!candidateByEmp.size) return out

  const legacyJobs = legacyJobIds.size
    ? await jobModel.find({ _id: { $in: [...legacyJobIds] } }, "_id site isGlobal").lean()
    : []
  const legacyPlace = new Map(
    legacyJobs.map((j) => [String(j._id), j.isGlobal ? "general" : j.site ? String(j.site) : null])
  )

  const placeById = new Map()
  for (const p of await listDriverPlaces()) {
    if (!p.jobs.length) continue
    placeById.set(p.isGlobal ? "general" : p._id, {
      siteId: p.isGlobal ? null : p._id,
      siteName: p.siteName,
      jobIds: p.jobs.map((j) => j._id),
    })
  }
  for (const [emp, c] of candidateByEmp) {
    const key = c.place ?? legacyPlace.get(c.legacyJob)
    const place = key ? placeById.get(key) : null
    if (place) out.set(emp, place)
  }
  return out
}

/**
 * Every place a driver session can be logged against: the live global jobs first (the
 * "General" place, only when there is one), then every live site (permanent first, by name)
 * with its live jobs — INCLUDING sites with no live job (`jobs: []`), which the picker shows
 * muted and unpickable.
 */
async function listDriverPlaces() {
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

  const data = sites.map((s) => ({
    _id: String(s._id),
    siteName: s.siteName,
    jobs: (s.jobs || [])
      .filter(Boolean)
      .map((j) => ({ _id: String(j._id), name: j.name, jobCode: j.jobCode || null }))
      .sort((a, b) => String(a.jobCode || a.name).localeCompare(String(b.jobCode || b.name))),
  }))
  if (globalJobs.length) data.unshift({ ...GLOBAL_JOB_GROUP, jobs: globalJobs })
  return data
}

/**
 * GET /api/drivers/jobs — the places a driver session may be logged against (listDriverPlaces):
 * the General group of global jobs, then each live site with its live jobs. Sites with no live
 * job are included with `jobs: []` so the site picker can show them muted.
 */
export const getDriverJobs = async (req, res) => {
  try {
    res.status(200).json({ success: true, data: await listDriverPlaces() })
  } catch (error) {
    console.log(error)
    res.status(500).json({ success: false, message: "Failed to fetch jobs" })
  }
}
