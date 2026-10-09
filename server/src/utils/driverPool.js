/**
 * The Drivers Attendance pool.
 *
 * Drivers have no site, but every attendance path (the {siteId,date} lock, submit and its
 * roster guard, the saved sheet, carryovers, the activity log, default-time propagation, the
 * auto-checkout cron, requireSiteAccess) is keyed by a site, and Attendance.siteId /
 * sessions[].siteId are required. So drivers are marked against ONE hidden Site doc flagged
 * `isDriverPool`:
 *   - a driver session is stored with siteId = the pool and jobId = the job it was for, picked
 *     from ANY assignable site — so a real site's sheet, stats, manpower and auto-checkout
 *     (all keyed on sessions.siteId) never see drivers, while job-level reports
 *     (sessions.jobId) and the ERPNext timesheet still bill the job;
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
import { isAssignableSite } from "./siteAssignable.js"

export const DRIVER_POOL_NAME = "Drivers"

// A driver is an active employee with no site whose job title contains "driver".
// KEEP IN SYNC with isDriverEmployee below and the client roster (DriversAttendance).
export const DRIVER_TITLE_REGEX = /driver/i

export function driverEmployeeFilter() {
  return { isActive: true, currentSite: null, jobTitle: { $regex: "driver", $options: "i" } }
}

/** True when `emp` (a doc or lean object) is on the drivers roster. */
export function isDriverEmployee(emp) {
  return !!emp && emp.isActive !== false && !emp.currentSite && DRIVER_TITLE_REGEX.test(emp.jobTitle || "")
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
 * A job a driver session may be logged against: exists, not deleted, active, not completed,
 * at an assignable (live, non-pool) site. Returns the job (with `site` populated) or null.
 */
export async function findDriverJob(jobId, session = null) {
  if (!jobId || !mongoose.isValidObjectId(String(jobId))) return null
  const job = await jobModel
    .findOne({ _id: jobId, isDeleted: { $ne: true } })
    .populate("site", "siteName isActive isDeleted isCompleted isDriverPool")
    .session(session)
  if (!job || job.isActive === false || job.isCompleted) return null
  if (!isAssignableSite(job.site)) return null
  return job
}
