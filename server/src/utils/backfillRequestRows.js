/**
 * Validation shared by every write to a supervisor backfill request
 * (controllers/backfillRequestController.js): adding rows in bulk, editing one row, and the
 * approval that turns rows into Attendance records.
 *
 * Add/edit validate STRICTLY (a picked job must be live, a site with live jobs needs one on
 * every session) so the supervisor fixes things while drafting. A document on the Drivers pool
 * (a driver supervisor's) is the mirror image: only drivers, and every session names a job
 * SPLIT (served site + ticked jobs, utils/jobSplit.js) instead of one job. The approval is LENIENT on
 * job liveness — a job closed while the request waited still bills — but re-checks
 * everything that protects the data (existing record, cross-day overlap).
 */
import mongoose from "mongoose"
import Attendance from "../models/attendanceModel.js"
import Employee from "../models/empModel.js"
import Job from "../models/jobModel.js"
import BackfillRequest from "../models/backfillRequestModel.js"
import { deriveOffsets, validateSessionTimesV2 } from "./timeLocal.js"
import { siteHasLiveJobs } from "./siteAssignable.js"
import { findSessionJob } from "./globalJobs.js"
import { isDriverTitle } from "./driverPool.js"
import { resolveDriverSplit } from "./jobSplit.js"
import { buildSessionsFromRaw } from "./backfillRecord.js"

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

const validIds = (list) =>
  Array.isArray(list)
    ? [...new Set(list.map((v) => String(v?._id ?? v ?? "")).filter((v) => mongoose.isValidObjectId(v)))]
    : []

/** "YYYY-MM-DD" → { dateStr, attendanceDate (UTC midnight) }, or null when malformed. */
export function parseBusinessDay(value) {
  const dateStr = String(value || "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
  const attendanceDate = new Date(`${dateStr}T00:00:00.000Z`)
  if (isNaN(attendanceDate.getTime())) return null
  return { dateStr, attendanceDate }
}

/**
 * Normalise raw client sessions to the stored shape. Missing day offsets are derived (a
 * check-out earlier than its check-in rolls to the next day); explicit booleans win.
 */
export function normalizeRawSessions(rawSessions) {
  if (!Array.isArray(rawSessions)) return []
  return rawSessions.map((s) => {
    const derived = deriveOffsets(s?.checkIn, s?.checkOut, s?.checkInNextDay === true)
    return {
      jobId: s?.jobId && mongoose.isValidObjectId(String(s.jobId)) ? String(s.jobId) : null,
      // Drivers pool only; the served site is always re-derived from the jobs (validateSessions).
      splitJobIds: validIds(s?.splitJobIds),
      checkIn: typeof s?.checkIn === "string" ? s.checkIn : "",
      checkOut: typeof s?.checkOut === "string" ? s.checkOut : "",
      checkInNextDay: typeof s?.checkInNextDay === "boolean" ? s.checkInNextDay : derived.checkInNextDay,
      checkOutNextDay: typeof s?.checkOutNextDay === "boolean" ? s.checkOutNextDay : derived.checkOutNextDay,
    }
  })
}

/**
 * Validate a set of (normalised) sessions for `siteId` on `dateStr`. Returns
 * `{ error, code, built }` — `built` are sessions with Dates (buildSessionsFromRaw) when valid.
 * `strict` (add/edit): picked jobs must be live (findSessionJob) and, when the site has live
 * jobs, every session must name one. Lenient (approval): a job only has to exist (not deleted)
 * and be the site's own or global.
 * `onPool` (a Drivers pool document): every session needs a job split instead — resolved with
 * resolveDriverSplit (live jobs only when strict) and written back IN PLACE as
 * `servedSiteId` + `splitJobIds`, `jobId: null`.
 */
export async function validateSessions({ dateStr, siteId, sessions, markedBy = null, strict = true, onPool = false }) {
  if (!sessions.length) return { error: "Add at least one session", code: "NO_SESSIONS", built: [] }
  if (sessions.length > 6) return { error: "At most 6 sessions per day", code: "TOO_MANY_SESSIONS", built: [] }

  for (const s of sessions) {
    if (!HHMM.test(s.checkIn) || !HHMM.test(s.checkOut)) {
      return { error: "Every session needs a check-in and a check-out (HH:mm)", code: "INVALID_TIME", built: [] }
    }
    const timeError = validateSessionTimesV2(s.checkIn, s.checkOut, s.checkInNextDay, s.checkOutNextDay)
    if (timeError) return { error: timeError, code: "INVALID_TIME", built: [] }
  }

  if (onPool) {
    for (const s of sessions) {
      const split = s.splitJobIds?.length ? await resolveDriverSplit(s.splitJobIds, { strict }) : null
      if (!split) {
        return {
          error: !s.splitJobIds?.length
            ? "Pick a site and its jobs for every session"
            : strict
            ? "Pick a site with active jobs for every session"
            : "A session's site or jobs no longer exist",
          code: s.splitJobIds?.length ? "INVALID_SPLIT" : "SPLIT_REQUIRED",
          built: [],
        }
      }
      s.servedSiteId = split.servedSiteId
      s.splitJobIds = split.splitJobIds
      s.jobId = null
    }
    const { sessions: built, error } = buildSessionsFromRaw(dateStr, siteId, sessions, markedBy)
    if (error) return { error, code: "INVALID_SESSIONS", built: [] }
    return { error: null, code: null, built }
  }

  if (strict && sessions.some((s) => !s.jobId) && (await siteHasLiveJobs(siteId))) {
    return { error: "Pick a job for every session — this site has jobs.", code: "JOB_REQUIRED", built: [] }
  }

  const jobIds = [...new Set(sessions.map((s) => s.jobId).filter(Boolean))]
  for (const jobId of jobIds) {
    const ok = strict
      ? await findSessionJob(jobId, siteId)
      : await Job.exists({
          _id: jobId,
          isDeleted: { $ne: true },
          $or: [{ site: siteId }, { isGlobal: true }],
        })
    if (!ok) {
      return {
        error: strict ? "A picked job is not open at this site any more — pick another." : "A session's job no longer exists",
        code: "INVALID_JOB",
        built: [],
      }
    }
  }

  const { sessions: built, error } = buildSessionsFromRaw(dateStr, siteId, sessions, markedBy)
  if (error) return { error, code: "INVALID_SESSIONS", built: [] }
  return { error: null, code: null, built }
}

/**
 * Screen employees for a site/day request. Returns `{ ok, skipped }`:
 *  - ok: lean employees (+ `offRoster`, true when their currentSite isn't this site);
 *  - skipped: `{ employeeId, name, reason }` — not found/inactive, driver (on the Drivers
 *    pool: NOT a driver), already has a record that day, or already in ANOTHER site's open
 *    (draft/submitted) request that day.
 */
export async function screenEmployees({ siteId, attendanceDate, employeeIds, excludeRequestId = null, onPool = false }) {
  const ids = [...new Set((employeeIds || []).filter((id) => mongoose.isValidObjectId(String(id))).map(String))]
  const skipped = []

  const employees = await Employee.find({ _id: { $in: ids } })
    .select("_id name employeeId jobTitle employmentType currentSite isActive")
    .lean()
  const byId = new Map(employees.map((e) => [String(e._id), e]))

  const [recorded, otherRequests] = await Promise.all([
    Attendance.find({ employee: { $in: ids }, date: attendanceDate }).select("employee").lean(),
    BackfillRequest.find({
      date: attendanceDate,
      status: { $in: ["draft", "submitted", "rejected"] },
      siteId: { $ne: siteId },
      ...(excludeRequestId ? { _id: { $ne: excludeRequestId } } : {}),
      "rows.employee": { $in: ids },
    })
      .select("siteId rows.employee")
      .populate("siteId", "siteName")
      .lean(),
  ])
  const hasRecord = new Set(recorded.map((r) => String(r.employee)))
  const inOther = new Map()
  for (const reqDoc of otherRequests) {
    for (const row of reqDoc.rows || []) {
      inOther.set(String(row.employee), reqDoc.siteId?.siteName || "another site")
    }
  }

  const ok = []
  for (const id of ids) {
    const emp = byId.get(id)
    if (!emp || emp.isActive === false) {
      skipped.push({ employeeId: id, name: emp?.name || null, reason: "Employee not found or inactive" })
    } else if (onPool && !isDriverTitle(emp.jobTitle)) {
      skipped.push({ employeeId: id, name: emp.name, reason: "Not a driver" })
    } else if (!onPool && isDriverTitle(emp.jobTitle)) {
      skipped.push({ employeeId: id, name: emp.name, reason: "Driver — drivers are marked on Drivers Attendance" })
    } else if (hasRecord.has(id)) {
      skipped.push({ employeeId: id, name: emp.name, reason: "Already has a record for this date" })
    } else if (inOther.has(id)) {
      skipped.push({ employeeId: id, name: emp.name, reason: `Already in ${inOther.get(id)}'s backfill for this date` })
    } else {
      // Drivers never have a site, so "not on your site now" means nothing on the pool.
      ok.push({ ...emp, offRoster: !onPool && (!emp.currentSite || String(emp.currentSite) !== String(siteId)) })
    }
  }
  return { ok, skipped }
}
