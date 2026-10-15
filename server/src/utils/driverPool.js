/**
 * The Drivers Attendance pool.
 *
 * Drivers have no site, but every attendance path (the {siteId,date} lock, submit and its
 * roster guard, the saved sheet, carryovers, the activity log, default-time propagation, the
 * auto-checkout cron, requireSiteAccess) is keyed by a site, and Attendance.siteId /
 * sessions[].siteId are required. So drivers are marked against ONE hidden Site doc flagged
 * `isDriverPool`:
 *   - a driver session is stored with siteId = the pool, `servedSiteId` = the site the driver
 *     served and `splitJobIds` = the jobs of that site (or global jobs, the "General" place)
 *     its hours are split equally across (utils/jobSplit.js) — so a real site's sheet, stats,
 *     manpower and auto-checkout (all keyed on sessions.siteId) never see drivers, while the
 *     job report and the ERPNext timesheet still bill the jobs;
 *   - a driverSupervisor's User.assignedSite is pinned to the pool, so the existing site
 *     scoping confines them to it;
 *   - the pool keeps the usual 16 default-time fields. The drivers UI edits two categories
 *     (Foreign / Omani) and writes each into both of that nationality's categories (skilled +
 *     staff), so every category-keyed default reader works unchanged.
 * The pool is never listed with the sites and is never an assignment destination
 * (isAssignableSite rejects it). It is NOT `isPermanent` — that flag identifies the workshop.
 */
import mongoose from "mongoose"
import siteModel from "../models/siteModel.js"
import jobModel from "../models/jobModel.js"
import attendanceModel from "../models/attendanceModel.js"
import { resolveDriverSplit, sessionJobIds } from "./jobSplit.js"

export const DRIVER_POOL_NAME = "Drivers"

// A driver is an active employee whose job title contains "driver" — by title alone. Drivers
// live ONLY on the Drivers sheet: every path that would place one on a real site (assignments,
// transfers, requests, send-to-site, the scheduled-assignment cron, site-sheet sessions) refuses
// them, so they never have a currentSite. KEEP IN SYNC with isDriverEmployee below and the
// client's isDriverTitle (client/src/lib/driverJobs.ts).
export const DRIVER_TITLE_REGEX = /driver/i

export const DRIVER_ONLY_MESSAGE = "Drivers can only be marked on Drivers Attendance"

/** True when a job title is a driver's. */
export const isDriverTitle = (jobTitle) => DRIVER_TITLE_REGEX.test(jobTitle || "")

export function driverEmployeeFilter() {
  return { isActive: true, jobTitle: { $regex: "driver", $options: "i" } }
}

/** True when `emp` (a doc or lean object) is on the drivers roster. */
export function isDriverEmployee(emp) {
  return !!emp && emp.isActive !== false && isDriverTitle(emp.jobTitle)
}

/**
 * The reverse of validateDriverPoolSessions: a driver's session with a time at a REAL site (not
 * the pool) is refused — drivers are marked only on the Drivers sheet. Returns
 * DRIVER_ONLY_MESSAGE, or null when there's nothing wrong (or the employee isn't a driver).
 */
export function nonPoolDriverSessionError({ sessions, poolId, employee }) {
  if (!employee || !isDriverTitle(employee.jobTitle) || !Array.isArray(sessions)) return null
  const offPool = sessions.some(
    (s) => s && s.siteId && String(s.siteId) !== String(poolId) && (s.checkIn || s.checkOut)
  )
  return offPool ? DRIVER_ONLY_MESSAGE : null
}

// Every Employee field that places someone on (or schedules them onto) a real site.
const PLACEMENT_RESET = {
  currentSite: null,
  currentJob: null,
  pendingTransferCheckIn: null,
  pendingTransferSiteId: null,
  pendingTransferFromSiteId: null,
  pendingTransferDate: null,
  pendingTransferJobId: null,
  scheduledSiteId: null,
  scheduledJobId: null,
  scheduledEffectiveDate: null,
  scheduledRemoval: false,
  scheduledVisit: false,
  scheduledBySiteId: null,
}

/** True when the employee is on, visiting, or scheduled onto a real site. */
export function hasSitePlacement(emp) {
  return !!(emp && (emp.currentSite || emp.currentJob || emp.pendingTransferSiteId || emp.scheduledEffectiveDate))
}

/**
 * Take an employee off every site placement so they live only on the Drivers sheet: clears
 * currentSite/currentJob, the one-day visit stash and any scheduled change, and pulls them out
 * of every Job's member list. Mutates the employee doc — the CALLER saves it and runs
 * syncSupervisorScope. Attendance history is never touched. Used when a title becomes a driver
 * title (empController.editEmployee) and by the seed/moveDriversToPool.js clean-up.
 */
export async function releaseSitePlacement(employee, session = null) {
  await jobModel.updateMany({ employees: employee._id }, { $pull: { employees: employee._id } }, { session })
  Object.assign(employee, PLACEMENT_RESET)
}

/**
 * employeeId → `{ siteId, siteName, date }`: the site each driver's LATEST drivers-sheet session
 * served (its split's servedSiteId; a legacy single job → that job's site; global jobs →
 * siteId null, "General"). No lookback limit and no liveness filter — it's history, shown as
 * the driver's current site on the Employees list. Drivers never marked yet are absent.
 */
export async function latestServedPlaces(employeeIds) {
  const out = new Map()
  const poolId = await getDriverPoolId()
  if (!poolId || !employeeIds?.length) return out
  const pool = new mongoose.Types.ObjectId(poolId)
  const ids = employeeIds.map((id) => new mongoose.Types.ObjectId(String(id)))

  const rows = await attendanceModel.aggregate([
    { $match: { employee: { $in: ids }, "sessions.siteId": pool } },
    { $sort: { date: -1 } },
    {
      $project: {
        employee: 1,
        date: 1,
        sessions: {
          $filter: {
            input: "$sessions",
            as: "s",
            cond: {
              $and: [
                { $eq: ["$$s.siteId", pool] },
                {
                  $or: [
                    { $gt: [{ $size: { $ifNull: ["$$s.splitJobIds", []] } }, 0] },
                    { $ne: [{ $ifNull: ["$$s.jobId", null] }, null] },
                  ],
                },
              ],
            },
          },
        },
      },
    },
    { $match: { "sessions.0": { $exists: true } } },
    { $group: { _id: "$employee", date: { $first: "$date" }, sessions: { $first: "$sessions" } } },
  ])
  if (!rows.length) return out

  // The last pool session of the latest day → a site id, "general", or a legacy job to resolve.
  const pick = new Map()
  const legacyJobIds = new Set()
  for (const r of rows) {
    const s = r.sessions[r.sessions.length - 1]
    if (s.splitJobIds?.length) pick.set(String(r._id), { date: r.date, siteId: s.servedSiteId ? String(s.servedSiteId) : null })
    else {
      pick.set(String(r._id), { date: r.date, legacyJob: String(s.jobId) })
      legacyJobIds.add(String(s.jobId))
    }
  }
  const legacyJobs = legacyJobIds.size
    ? await jobModel.find({ _id: { $in: [...legacyJobIds] } }, "_id site isGlobal").lean()
    : []
  const legacySite = new Map(legacyJobs.map((j) => [String(j._id), j.isGlobal || !j.site ? null : String(j.site)]))
  for (const p of pick.values()) if (p.legacyJob) p.siteId = legacySite.get(p.legacyJob) ?? null

  const siteIds = [...new Set([...pick.values()].map((p) => p.siteId).filter(Boolean))]
  const sites = siteIds.length ? await siteModel.find({ _id: { $in: siteIds } }, "_id siteName").lean() : []
  const nameById = new Map(sites.map((s) => [String(s._id), s.siteName]))
  for (const [emp, p] of pick) {
    out.set(emp, {
      siteId: p.siteId,
      siteName: p.siteId ? nameById.get(p.siteId) ?? "Unknown site" : "General",
      date: p.date,
    })
  }
  return out
}

let cachedPoolId = null

/** Create the pool on boot if missing (idempotent). Seeds its defaults from the workshop. */
export async function ensureDriverPool() {
  try {
    let pool = await siteModel.findOne({ isDriverPool: true })
    if (!pool) {
      // Seed day/night defaults from the permanent workshop so the first draft isn't blank.
      const workshop = await siteModel.findOne({ isPermanent: true }).lean()
      const pick = (f) => (workshop && workshop[f]) || ""
      pool = await siteModel.create({
        siteName: DRIVER_POOL_NAME,
        locationDetails: "Drivers (no site) — hidden pool for driver attendance",
        isDriverPool: true,
        isActive: true,
        ...mirrorDriverDefaults({
          foreignDayIn: pick("defaultCheckIn"),
          foreignDayOut: pick("defaultCheckOut"),
          foreignNightIn: pick("nightDefaultCheckIn"),
          foreignNightOut: pick("nightDefaultCheckOut"),
          omaniDayIn: pick("omaniDefaultCheckIn"),
          omaniDayOut: pick("omaniDefaultCheckOut"),
          omaniNightIn: pick("omaniNightDefaultCheckIn"),
          omaniNightOut: pick("omaniNightDefaultCheckOut"),
        }),
      })
      console.log(`Drivers pool site created (${pool._id}).`)
    }
    cachedPoolId = String(pool._id)
    return cachedPoolId
  } catch (error) {
    console.error("Failed to initialize drivers pool site:", error)
    return null
  }
}

/** The pool's id as a string (looked up once, then cached). */
export async function getDriverPoolId(session = null) {
  if (cachedPoolId) return cachedPoolId
  const pool = await siteModel.findOne({ isDriverPool: true }).select("_id").session(session)
  cachedPoolId = pool ? String(pool._id) : null
  return cachedPoolId
}

/** True when `siteOrId` is the pool (a Site doc with the flag, or its id). */
export async function isDriverPool(siteOrId, session = null) {
  if (!siteOrId) return false
  if (typeof siteOrId === "object" && "isDriverPool" in siteOrId) return siteOrId.isDriverPool === true
  const poolId = await getDriverPoolId(session)
  return !!poolId && String(siteOrId._id ?? siteOrId) === poolId
}

/**
 * The 16 Site default fields from the 8 driver values: Foreign → foreign skilled + foreign
 * staff, Omani → omani skilled + omani staff. Undefined inputs are left out.
 */
export function mirrorDriverDefaults(v) {
  const out = {}
  const set = (fields, value) => {
    if (value === undefined) return
    for (const f of fields) out[f] = value
  }
  set(["defaultCheckIn", "staffDefaultCheckIn"], v.foreignDayIn)
  set(["defaultCheckOut", "staffDefaultCheckOut"], v.foreignDayOut)
  set(["nightDefaultCheckIn", "staffNightDefaultCheckIn"], v.foreignNightIn)
  set(["nightDefaultCheckOut", "staffNightDefaultCheckOut"], v.foreignNightOut)
  set(["omaniDefaultCheckIn", "omaniStaffDefaultCheckIn"], v.omaniDayIn)
  set(["omaniDefaultCheckOut", "omaniStaffDefaultCheckOut"], v.omaniDayOut)
  set(["omaniNightDefaultCheckIn", "omaniStaffNightDefaultCheckIn"], v.omaniNightIn)
  set(["omaniNightDefaultCheckOut", "omaniStaffNightDefaultCheckOut"], v.omaniNightOut)
  return out
}

/**
 * Make a pool site update keep the staff fields equal to the skilled ones: whichever of a
 * pair was sent wins for both (the skilled field when both were sent). Mutates `body`.
 */
export function mirrorPoolDefaultsInBody(body) {
  const pairs = [
    ["defaultCheckIn", "staffDefaultCheckIn"],
    ["defaultCheckOut", "staffDefaultCheckOut"],
    ["nightDefaultCheckIn", "staffNightDefaultCheckIn"],
    ["nightDefaultCheckOut", "staffNightDefaultCheckOut"],
    ["omaniDefaultCheckIn", "omaniStaffDefaultCheckIn"],
    ["omaniDefaultCheckOut", "omaniStaffDefaultCheckOut"],
    ["omaniNightDefaultCheckIn", "omaniStaffNightDefaultCheckIn"],
    ["omaniNightDefaultCheckOut", "omaniStaffNightDefaultCheckOut"],
  ]
  for (const [skilled, staff] of pairs) {
    if (body[skilled] !== undefined) body[staff] = body[skilled]
    else if (body[staff] !== undefined) body[skilled] = body[staff]
  }
  return body
}

/**
 * Driver sessions on the pool (submit, edits, Backfill). Each pool session with a time needs a
 * driver employee (job title only — a past day doesn't care where they sit today) and a usable
 * job split (utils/jobSplit.js resolveDriverSplit): the jobs of ONE real site, or global jobs.
 * A legacy single `jobId` counts as a one-job split. On success each pool session is rewritten
 * IN PLACE to the resolved form (`servedSiteId`, `splitJobIds`, `jobId: null`).
 *
 * `strict` (default false = past days) also needs every job live; a job completed since that
 * day is still a valid record of it. `isStrict(s)` applies the live check per session instead
 * (an edit only re-checks liveness where the split changed).
 * Returns an error message, or null when every pool session is fine.
 */
export async function validateDriverPoolSessions({
  sessions,
  poolId,
  employee,
  requireDriver = true,
  strict = false,
  isStrict = null,
  session = null,
}) {
  if (!poolId || !Array.isArray(sessions)) return null
  const poolSessions = sessions.filter(
    (s) => s && s.siteId && String(s.siteId) === String(poolId) && (s.checkIn || s.checkOut)
  )
  if (poolSessions.length === 0) return null
  // `requireDriver: false` lets an edit keep a record that is ALREADY on the pool even if the
  // employee's title has since changed — only placing someone new on Drivers is gated.
  if (requireDriver && !DRIVER_TITLE_REGEX.test(employee?.jobTitle || "")) {
    return "Only drivers can be marked on Drivers"
  }
  for (const s of poolSessions) {
    const live = isStrict ? isStrict(s) : strict
    const split = await resolveDriverSplit(sessionJobIds(s), { strict: live, session })
    if (!split) {
      return live
        ? "Pick a site with active jobs for every driver session"
        : "Pick a site and its jobs for every driver session"
    }
    s.servedSiteId = split.servedSiteId
    s.splitJobIds = split.splitJobIds
    s.jobId = null
  }
  return null
}
