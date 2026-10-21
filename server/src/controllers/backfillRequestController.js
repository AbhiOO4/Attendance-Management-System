/**
 * Supervisor backfill requests — /api/backfill-requests.
 *
 * A supervisor drafts the records they missed for their site on a PAST day (within the
 * WorkSchedule.supervisorBackfillWindowDays window, utils/backfillWindow.js) as ONE document
 * per site + day (models/backfillRequestModel.js), applying common sessions to many employees
 * at once, then sends it for approval. An admin can edit rows, reject it (back to the
 * supervisor, with a reason) or approve it — only the approval writes Attendance, one record
 * per row via utils/backfillRecord.js (shared with the admin bulk backfill). Rows that no longer
 * fit (a record appeared meanwhile, a cross-day overlap) are skipped/failed on the document;
 * the rest are created.
 *
 * Supervisor writes are confined to their assignedSite: requireSiteAccess on the siteId routes,
 * and a check against the loaded document on the :id routes.
 *
 * Driver supervisors use the same flow: their assignedSite is the hidden Drivers pool
 * (utils/driverPool.js), so their documents are keyed {pool, date}. A pool document lists only
 * drivers and every session names a job SPLIT (servedSiteId + splitJobIds, utils/jobSplit.js)
 * instead of one job — the "onPool" branches below and in utils/backfillRequestRows.js.
 */
import mongoose from "mongoose"
import BackfillRequest from "../models/backfillRequestModel.js"
import Attendance from "../models/attendanceModel.js"
import Employee from "../models/empModel.js"
import Job from "../models/jobModel.js"
import Site from "../models/siteModel.js"
import userModel from "../models/userModel.js"
import workModel from "../models/workModel.js"
import { escapeRegExp } from "../utils/escapeRegExp.js"
import { supervisorBackfillRange, isInSupervisorWindow, resolveBackfillWindowDays } from "../utils/backfillWindow.js"
import {
  parseBusinessDay,
  normalizeRawSessions,
  validateSessions,
  screenEmployees,
} from "../utils/backfillRequestRows.js"
import { createBackfilledRecord } from "../utils/backfillRecord.js"
import { checkHolidayForDate } from "../utils/holidayInfo.js"
import { buildCrossDayOverlapChecker, crossDayOverlapMessage } from "../utils/sessionOverlap.js"
import { resolveActor, recordAttendanceAuditBatch } from "../utils/attendanceAudit.js"
import { DRIVER_TITLE_REGEX, driverEmployeeFilter, isDriverPool, isDriverTitle } from "../utils/driverPool.js"
import { buildSplitLookup } from "../utils/jobSplit.js"
import { notifyBackfillSubmitted, notifyBackfillApproved, notifyBackfillRejected } from "../utils/backfillNotify.js"

const isAdminRole = (role) => role === "admin" || role === "superadmin"
const SUPERVISOR_EDITABLE = ["draft", "rejected"]

const loadWorkConfig = () => workModel.findOne({ type: "default" }).lean()

const timezoneOffsetOf = (req) =>
  process.env.APP_TIMEZONE_OFFSET !== undefined && process.env.APP_TIMEZONE_OFFSET !== ""
    ? process.env.APP_TIMEZONE_OFFSET
    : req.headers["x-timezone-offset"]

const dayKey = (date) => new Date(date).toISOString().slice(0, 10)

/** The supervisor's assigned site id (string), or null. */
async function supervisorSiteId(req) {
  if (req.user.assignedSite) return String(req.user.assignedSite)
  const user = await userModel.findById(req.user.id).select("assignedSite").lean()
  return user?.assignedSite ? String(user.assignedSite) : null
}

/** Load a request the caller may see: admins any, supervisors only their site's. */
async function loadAccessibleRequest(req, res) {
  const { id } = req.params
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ success: false, message: "Invalid backfill request id" })
    return null
  }
  const doc = await BackfillRequest.findById(id)
  if (!doc) {
    res.status(404).json({ success: false, message: "Backfill request not found" })
    return null
  }
  if (!isAdminRole(req.user.role)) {
    const siteId = await supervisorSiteId(req)
    if (!siteId || siteId !== String(doc.siteId)) {
      res.status(403).json({ success: false, message: "Forbidden: Access denied to this site" })
      return null
    }
  }
  return doc
}

/** A supervisor may edit a draft/rejected document while its day is in the window — or any time after a rejection. */
function supervisorMayEdit(doc, workConfig) {
  if (!SUPERVISOR_EDITABLE.includes(doc.status)) return false
  return doc.wasRejected || isInSupervisorWindow(dayKey(doc.date), workConfig)
}

/** May the caller edit rows of this document right now? */
function callerMayEdit(req, doc, workConfig) {
  if (isAdminRole(req.user.role)) return doc.status === "submitted"
  return supervisorMayEdit(doc, workConfig)
}

/** The last business day on which a not-yet-rejected draft can still be sent (date + N). */
function submitDeadline(doc, workConfig) {
  const d = new Date(doc.date)
  d.setUTCDate(d.getUTCDate() + resolveBackfillWindowDays(workConfig))
  return dayKey(d)
}

/** Live jobs of the site, for the session job picker. */
async function liveSiteJobs(siteId) {
  return Job.find({ site: siteId, isDeleted: { $ne: true }, isActive: true, isCompleted: { $ne: true } })
    .select("_id name jobCode")
    .sort({ name: 1 })
    .lean()
}

/** Full, populated view of one document for the detail pages. */
async function formatRequest(doc, req, workConfig) {
  const populated = await BackfillRequest.findById(doc._id)
    .populate("siteId", "siteName")
    .populate("rows.employee", "name employeeId jobTitle employmentType currentSite")
    .populate("rows.sessions.jobId", "name jobCode isGlobal")
    .populate("rows.addedBy", "name")
    .populate("createdBy", "name")
    .populate("submittedBy", "name")
    .populate("reviewedBy", "name")
    .lean()
  if (!populated) return null

  const siteIds = [
    ...new Set((populated.rows || []).map((r) => r.employee?.currentSite).filter(Boolean).map(String)),
  ]
  const sites = siteIds.length ? await Site.find({ _id: { $in: siteIds } }).select("siteName").lean() : []
  const siteName = new Map(sites.map((s) => [String(s._id), s.siteName]))

  const onPool = await isDriverPool(populated.siteId?._id || doc.siteId)
  const [siteJobs, holiday, splitInfo] = await Promise.all([
    onPool ? [] : liveSiteJobs(populated.siteId?._id || doc.siteId),
    checkHolidayForDate(populated.date),
    onPool ? buildSplitLookup((populated.rows || []).flatMap((r) => r.sessions || [])) : null,
  ])

  const editable = callerMayEdit(req, doc, workConfig)
  const isSupervisor = !isAdminRole(req.user.role)

  return {
    _id: populated._id,
    siteId: populated.siteId?._id || doc.siteId,
    siteName: populated.siteId?.siteName || "",
    date: dayKey(populated.date),
    isDriverPool: onPool,
    status: populated.status,
    wasRejected: !!populated.wasRejected,
    rejectionReason: populated.rejectionReason || "",
    createdBy: populated.createdBy ? { _id: populated.createdBy._id, name: populated.createdBy.name } : null,
    submittedBy: populated.submittedBy ? { _id: populated.submittedBy._id, name: populated.submittedBy.name } : null,
    submittedAt: populated.submittedAt,
    reviewedBy: populated.reviewedBy ? { _id: populated.reviewedBy._id, name: populated.reviewedBy.name } : null,
    reviewedAt: populated.reviewedAt,
    approvalSummary: populated.approvalSummary || { createdCount: 0, skippedCount: 0, failedCount: 0 },
    updatedAt: populated.updatedAt,
    holiday,
    siteJobs,
    submitDeadline: populated.wasRejected ? null : submitDeadline(doc, workConfig),
    permissions: {
      editable,
      canSubmit: isSupervisor && supervisorMayEdit(doc, workConfig) && (populated.rows || []).length > 0,
      canDiscard: isSupervisor && supervisorMayEdit(doc, workConfig),
      canReview: !isSupervisor && populated.status === "submitted",
    },
    rows: (populated.rows || []).map((row) => ({
      employee: row.employee
        ? {
            _id: row.employee._id,
            name: row.employee.name,
            employeeId: row.employee.employeeId,
            jobTitle: row.employee.jobTitle,
            employmentType: row.employee.employmentType,
            currentSite: row.employee.currentSite
              ? { _id: row.employee.currentSite, siteName: siteName.get(String(row.employee.currentSite)) || "" }
              : null,
          }
        : null,
      sessions: (row.sessions || []).map((s) => ({
        jobId: s.jobId?._id || null,
        jobName: s.jobId?.name || "",
        jobCode: s.jobId?.jobCode || "",
        isGlobalJob: !!s.jobId?.isGlobal,
        ...(splitInfo ? splitInfo(s) : {}),
        checkIn: s.checkIn,
        checkOut: s.checkOut,
        checkInNextDay: !!s.checkInNextDay,
        checkOutNextDay: !!s.checkOutNextDay,
      })),
      breaksTaken: row.breaksTaken ?? null,
      offRoster: !!row.offRoster,
      addedBy: row.addedBy ? { _id: row.addedBy._id, name: row.addedBy.name } : null,
      outcome: row.outcome || null,
      outcomeMessage: row.outcomeMessage || "",
      attendanceId: row.attendanceId || null,
    })),
  }
}

/** 409 for a save that lost a race with another write (optimisticConcurrency). */
function isVersionError(err) {
  return err?.name === "VersionError"
}

const versionConflict = (res) =>
  res.status(409).json({
    success: false,
    code: "REQUEST_CHANGED",
    message: "This backfill was changed by someone else meanwhile — reload and try again.",
  })

// GET /api/backfill-requests?siteId&status&from&to&page&limit
// Supervisors see only their site's documents. Each item carries a row count, not the rows.
export const listBackfillRequests = async (req, res) => {
  try {
    const { status, from, to } = req.query
    const page = Math.max(Number(req.query.page) || 1, 1)
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100)

    const filter = {}
    if (isAdminRole(req.user.role)) {
      if (req.query.siteId && mongoose.isValidObjectId(req.query.siteId)) filter.siteId = req.query.siteId
    } else {
      const siteId = await supervisorSiteId(req)
      if (!siteId) return res.status(200).json({ success: true, data: [], pagination: { page, limit, total: 0, totalPages: 0 } })
      filter.siteId = siteId
    }
    if (status) {
      const statuses = String(status).split(",").filter((s) => ["draft", "submitted", "approved", "rejected"].includes(s))
      if (statuses.length) filter.status = { $in: statuses }
    }
    const fromDay = from ? parseBusinessDay(from) : null
    const toDay = to ? parseBusinessDay(to) : null
    if (fromDay || toDay) {
      filter.date = {}
      if (fromDay) filter.date.$gte = fromDay.attendanceDate
      if (toDay) filter.date.$lte = toDay.attendanceDate
    }

    const [total, docs, workConfig] = await Promise.all([
      BackfillRequest.countDocuments(filter),
      BackfillRequest.find(filter)
        .sort({ status: 1, date: -1, submittedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("siteId date status rows.employee rows.outcome wasRejected rejectionReason createdBy submittedBy submittedAt reviewedBy reviewedAt approvalSummary updatedAt")
        .populate("siteId", "siteName")
        .populate("createdBy", "name")
        .populate("submittedBy", "name")
        .populate("reviewedBy", "name")
        .lean(),
      loadWorkConfig(),
    ])

    return res.status(200).json({
      success: true,
      data: docs.map((d) => ({
        _id: d._id,
        siteId: d.siteId?._id || d.siteId,
        siteName: d.siteId?.siteName || "",
        date: dayKey(d.date),
        status: d.status,
        rowCount: (d.rows || []).length,
        wasRejected: !!d.wasRejected,
        rejectionReason: d.rejectionReason || "",
        createdBy: d.createdBy?.name || null,
        submittedBy: d.submittedBy?.name || null,
        submittedAt: d.submittedAt,
        reviewedBy: d.reviewedBy?.name || null,
        reviewedAt: d.reviewedAt,
        approvalSummary: d.approvalSummary || null,
        updatedAt: d.updatedAt,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      window: supervisorBackfillRange(workConfig),
    })
  } catch (error) {
    console.error("listBackfillRequests error:", error)
    return res.status(500).json({ success: false, message: "Failed to load backfill requests" })
  }
}

// GET /api/backfill-requests/pending-count — documents awaiting an admin (sidebar badge).
export const getPendingBackfillCount = async (req, res) => {
  try {
    const count = await BackfillRequest.countDocuments({ status: "submitted" })
    return res.status(200).json({ success: true, data: { count } })
  } catch (error) {
    console.error("getPendingBackfillCount error:", error)
    return res.status(500).json({ success: false, message: "Failed to count backfill requests" })
  }
}

// GET /api/backfill-requests/by-day?siteId&date — the site/day document (or null) + the window.
export const getBackfillRequestByDay = async (req, res) => {
  try {
    const { siteId } = req.query
    const day = parseBusinessDay(req.query.date)
    if (!siteId || !mongoose.isValidObjectId(siteId) || !day) {
      return res.status(400).json({ success: false, message: "siteId and date (YYYY-MM-DD) are required" })
    }
    const workConfig = await loadWorkConfig()
    const doc = await BackfillRequest.findOne({ siteId, date: day.attendanceDate })
    const site = await Site.findById(siteId).select("siteName").lean()
    const inWindow = isInSupervisorWindow(day.dateStr, workConfig)
    const onPool = await isDriverPool(siteId)
    return res.status(200).json({
      success: true,
      data: doc ? await formatRequest(doc, req, workConfig) : null,
      site: site ? { _id: site._id, siteName: site.siteName } : null,
      isDriverPool: onPool,
      siteJobs: doc ? undefined : onPool ? [] : await liveSiteJobs(siteId),
      holiday: doc ? undefined : await checkHolidayForDate(day.attendanceDate),
      window: supervisorBackfillRange(workConfig),
      // With no document yet, a supervisor can start one only inside the window.
      canStart: !doc && !isAdminRole(req.user.role) && inWindow,
    })
  } catch (error) {
    console.error("getBackfillRequestByDay error:", error)
    return res.status(500).json({ success: false, message: "Failed to load the backfill" })
  }
}

// GET /api/backfill-requests/candidates?siteId&date&tier=site|recent|search&q&page
// The employee picker. Every tier leaves out: anyone with a record that day, drivers,
// inactive employees, people already in this site/day document and people in another site's
// open document that day.
//   site   — currentSite is this site (all, sorted by name)
//   recent — had a session at this site within ±N window days of the date, now elsewhere
//   search — everyone else, by name / employee ID (q ≥ 2 chars), paginated
// On the Drivers pool it is the reverse: tier "site" is EVERY active driver (drivers have no
// site, so there is nobody "recent" or left to search — those tiers come back empty).
export const getBackfillCandidates = async (req, res) => {
  try {
    const { siteId, tier = "site" } = req.query
    const day = parseBusinessDay(req.query.date)
    if (!siteId || !mongoose.isValidObjectId(siteId) || !day) {
      return res.status(400).json({ success: false, message: "siteId and date (YYYY-MM-DD) are required" })
    }
    const siteObjectId = new mongoose.Types.ObjectId(siteId)
    const workConfig = await loadWorkConfig()
    const windowDays = resolveBackfillWindowDays(workConfig)

    const [recorded, requests] = await Promise.all([
      Attendance.find({ date: day.attendanceDate }).select("employee").lean(),
      BackfillRequest.find({
        date: day.attendanceDate,
        $or: [{ siteId: siteObjectId }, { status: { $in: ["draft", "submitted", "rejected"] } }],
      })
        .select("rows.employee")
        .lean(),
    ])
    const excluded = new Set(recorded.map((r) => String(r.employee)))
    for (const r of requests) for (const row of r.rows || []) excluded.add(String(row.employee))
    const excludedIds = [...excluded].map((id) => new mongoose.Types.ObjectId(id))

    const base = {
      isActive: true,
      _id: { $nin: excludedIds },
      jobTitle: { $not: DRIVER_TITLE_REGEX },
    }
    const fields = "_id name employeeId jobTitle employmentType currentSite"

    if (await isDriverPool(siteId)) {
      if (tier !== "site") return res.status(200).json({ success: true, data: [], pagination: { page: 1, totalPages: 0, total: 0 } })
      const drivers = await Employee.find({ ...driverEmployeeFilter(), _id: { $nin: excludedIds } })
        .select(fields)
        .sort({ name: 1 })
        .limit(1000)
        .lean()
      return res.status(200).json({
        success: true,
        data: drivers.map((e) => ({
          _id: e._id,
          name: e.name,
          employeeId: e.employeeId,
          jobTitle: e.jobTitle,
          employmentType: e.employmentType,
          currentSite: null,
        })),
      })
    }

    const shape = (emps, lastSeen = null) =>
      emps
        .filter((e) => !isDriverTitle(e.jobTitle))
        .map((e) => ({
          _id: e._id,
          name: e.name,
          employeeId: e.employeeId,
          jobTitle: e.jobTitle,
          employmentType: e.employmentType,
          currentSite: e.currentSite ? { _id: e.currentSite._id, siteName: e.currentSite.siteName } : null,
          ...(lastSeen ? { lastSeenHere: lastSeen.get(String(e._id)) || null } : {}),
        }))

    if (tier === "site") {
      const emps = await Employee.find({ ...base, currentSite: siteObjectId })
        .select(fields)
        .populate("currentSite", "siteName")
        .sort({ name: 1 })
        .limit(1000)
        .lean()
      return res.status(200).json({ success: true, data: shape(emps) })
    }

    if (tier === "recent") {
      const from = new Date(day.attendanceDate)
      from.setUTCDate(from.getUTCDate() - windowDays)
      const to = new Date(day.attendanceDate)
      to.setUTCDate(to.getUTCDate() + windowDays)
      const seen = await Attendance.aggregate([
        { $match: { date: { $gte: from, $lte: to }, "sessions.siteId": siteObjectId } },
        { $group: { _id: "$employee", lastSeen: { $max: "$date" } } },
      ])
      const lastSeen = new Map(seen.map((s) => [String(s._id), dayKey(s.lastSeen)]))
      const emps = await Employee.find({
        ...base,
        _id: { $in: seen.map((s) => s._id), $nin: excludedIds },
        currentSite: { $ne: siteObjectId },
      })
        .select(fields)
        .populate("currentSite", "siteName")
        .sort({ name: 1 })
        .limit(500)
        .lean()
      return res.status(200).json({ success: true, data: shape(emps, lastSeen) })
    }

    if (tier === "search") {
      const q = String(req.query.q || "").trim()
      if (q.length < 2) return res.status(200).json({ success: true, data: [], pagination: { page: 1, totalPages: 0, total: 0 } })
      const page = Math.max(Number(req.query.page) || 1, 1)
      const limit = 25
      const rx = { $regex: escapeRegExp(q), $options: "i" }
      const filter = {
        ...base,
        currentSite: { $ne: siteObjectId },
        $or: [{ name: rx }, { employeeId: rx }, { companyId: rx }],
      }
      const [total, emps] = await Promise.all([
        Employee.countDocuments(filter),
        Employee.find(filter)
          .select(fields)
          .populate("currentSite", "siteName")
          .sort({ name: 1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ])
      return res.status(200).json({
        success: true,
        data: shape(emps),
        pagination: { page, totalPages: Math.ceil(total / limit), total },
      })
    }

    return res.status(400).json({ success: false, message: "tier must be site, recent or search" })
  } catch (error) {
    console.error("getBackfillCandidates error:", error)
    return res.status(500).json({ success: false, message: "Failed to load employees" })
  }
}

// GET /api/backfill-requests/:id
export const getBackfillRequest = async (req, res) => {
  try {
    const doc = await loadAccessibleRequest(req, res)
    if (!doc) return
    const workConfig = await loadWorkConfig()
    return res.status(200).json({
      success: true,
      data: await formatRequest(doc, req, workConfig),
      window: supervisorBackfillRange(workConfig),
    })
  } catch (error) {
    console.error("getBackfillRequest error:", error)
    return res.status(500).json({ success: false, message: "Failed to load the backfill request" })
  }
}

/**
 * Validate `sessions` and run the per-employee screens + cross-day overlap for `employeeIds`
 * against document `doc` (null = not created yet). Returns `{ error, code, rows, skipped, failed }`
 * where rows are ready-to-store row objects.
 */
async function prepareRows({ req, siteId, day, employeeIds, rawSessions, breaksTaken, doc }) {
  const onPool = await isDriverPool(siteId)
  const sessions = normalizeRawSessions(rawSessions)
  const check = await validateSessions({ dateStr: day.dateStr, siteId, sessions, strict: true, onPool })
  if (check.error) return { error: check.error, code: check.code }

  const { ok, skipped } = await screenEmployees({
    siteId,
    attendanceDate: day.attendanceDate,
    employeeIds,
    excludeRequestId: doc?._id || null,
    onPool,
  })

  const failed = []
  const rows = []
  const crossDay = await buildCrossDayOverlapChecker({
    employeeIds: ok.map((e) => String(e._id)),
    date: day.attendanceDate,
  })
  for (const emp of ok) {
    const conflict = crossDay(String(emp._id), check.built)
    if (conflict) {
      failed.push({ employeeId: String(emp._id), name: emp.name, message: crossDayOverlapMessage(conflict) })
      continue
    }
    rows.push({
      employee: emp._id,
      name: emp.name,
      sessions,
      breaksTaken: breaksTaken === undefined ? null : breaksTaken,
      offRoster: emp.offRoster,
      addedBy: req.user.id,
    })
  }
  return { error: null, rows, skipped, failed }
}

// POST /api/backfill-requests/rows  { siteId, date, employeeIds, sessions, breaksTaken }
// Supervisor bulk apply: the same sessions to every listed employee. Creates the site/day
// document (draft) on first use; an employee already in it has their row replaced.
export const addBackfillRows = async (req, res) => {
  try {
    const { siteId, employeeIds = [], sessions = [], breaksTaken = null } = req.body
    const day = parseBusinessDay(req.body.date)
    if (!siteId || !mongoose.isValidObjectId(siteId) || !day) {
      return res.status(400).json({ success: false, message: "siteId and date (YYYY-MM-DD) are required" })
    }
    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ success: false, message: "Select at least one employee" })
    }
    if (employeeIds.length > 300) {
      return res.status(400).json({ success: false, message: "At most 300 employees at a time" })
    }

    const workConfig = await loadWorkConfig()
    let doc = await BackfillRequest.findOne({ siteId, date: day.attendanceDate })

    if (doc && !SUPERVISOR_EDITABLE.includes(doc.status)) {
      return res.status(409).json({
        success: false,
        code: "BACKFILL_LOCKED",
        message:
          doc.status === "approved"
            ? "This day's backfill was already approved."
            : "This day's backfill was sent for approval — it can't be changed any more.",
      })
    }
    if (!(doc?.wasRejected) && !isInSupervisorWindow(day.dateStr, workConfig)) {
      const { days } = supervisorBackfillRange(workConfig)
      return res.status(400).json({
        success: false,
        code: "OUT_OF_WINDOW",
        message: `You can backfill only the past ${days} day${days === 1 ? "" : "s"} (not today).`,
      })
    }

    const prepared = await prepareRows({ req, siteId, day, employeeIds, rawSessions: sessions, breaksTaken, doc })
    if (prepared.error) {
      return res.status(400).json({ success: false, code: prepared.code, message: prepared.error })
    }

    const added = []
    const updated = []
    if (prepared.rows.length > 0) {
      if (!doc) {
        try {
          doc = await BackfillRequest.create({ siteId, date: day.attendanceDate, status: "draft", createdBy: req.user.id, rows: [] })
        } catch (err) {
          if (err?.code !== 11000) throw err
          doc = await BackfillRequest.findOne({ siteId, date: day.attendanceDate })
          if (!doc || !SUPERVISOR_EDITABLE.includes(doc.status)) return versionConflict(res)
        }
      }
      const index = new Map(doc.rows.map((r, i) => [String(r.employee), i]))
      for (const row of prepared.rows) {
        const { name, ...stored } = row
        const at = index.get(String(row.employee))
        if (at !== undefined) {
          doc.rows.set(at, stored)
          updated.push({ employeeId: String(row.employee), name })
        } else {
          doc.rows.push(stored)
          added.push({ employeeId: String(row.employee), name })
        }
      }
      // Editing a rejected document re-opens it as a draft (the reason stays visible).
      if (doc.status === "rejected") doc.status = "draft"
      try {
        await doc.save()
      } catch (err) {
        if (isVersionError(err)) return versionConflict(res)
        throw err
      }
    }

    const savedCount = added.length + updated.length
    return res.status(200).json({
      success: true,
      message: `Added ${savedCount} of ${new Set(employeeIds.map(String)).size} employee(s)`,
      summary: {
        addedCount: added.length,
        updatedCount: updated.length,
        skippedCount: prepared.skipped.length,
        failedCount: prepared.failed.length,
      },
      added,
      updated,
      skipped: prepared.skipped,
      failed: prepared.failed,
      data: doc ? await formatRequest(doc, req, workConfig) : null,
    })
  } catch (error) {
    console.error("addBackfillRows error:", error)
    return res.status(500).json({ success: false, message: "Failed to add to the backfill" })
  }
}

// PUT /api/backfill-requests/:id/rows/:employeeId  { sessions, breaksTaken }
// Supervisor while editable; admin while submitted.
export const updateBackfillRow = async (req, res) => {
  try {
    const doc = await loadAccessibleRequest(req, res)
    if (!doc) return
    const workConfig = await loadWorkConfig()
    if (!callerMayEdit(req, doc, workConfig)) {
      return res.status(409).json({ success: false, code: "BACKFILL_LOCKED", message: "This backfill can't be edited now." })
    }
    const at = doc.rows.findIndex((r) => String(r.employee) === String(req.params.employeeId))
    if (at < 0) return res.status(404).json({ success: false, message: "That employee is not in this backfill" })

    const day = { dateStr: dayKey(doc.date), attendanceDate: doc.date }
    const sessions = normalizeRawSessions(req.body.sessions)
    const onPool = await isDriverPool(doc.siteId)
    const check = await validateSessions({ dateStr: day.dateStr, siteId: doc.siteId, sessions, strict: true, onPool })
    if (check.error) return res.status(400).json({ success: false, code: check.code, message: check.error })

    const crossDay = await buildCrossDayOverlapChecker({ employeeIds: [String(req.params.employeeId)], date: doc.date })
    const conflict = crossDay(String(req.params.employeeId), check.built)
    if (conflict) return res.status(400).json({ success: false, code: "CROSS_DAY_OVERLAP", message: crossDayOverlapMessage(conflict) })

    doc.rows[at].sessions = sessions
    doc.rows[at].breaksTaken = req.body.breaksTaken === undefined ? doc.rows[at].breaksTaken : req.body.breaksTaken
    if (doc.status === "rejected") doc.status = "draft"
    try {
      await doc.save()
    } catch (err) {
      if (isVersionError(err)) return versionConflict(res)
      throw err
    }
    return res.status(200).json({ success: true, message: "Row updated", data: await formatRequest(doc, req, workConfig) })
  } catch (error) {
    console.error("updateBackfillRow error:", error)
    return res.status(500).json({ success: false, message: "Failed to update the row" })
  }
}

// DELETE /api/backfill-requests/:id/rows/:employeeId — same edit rule as above.
export const removeBackfillRow = async (req, res) => {
  try {
    const doc = await loadAccessibleRequest(req, res)
    if (!doc) return
    const workConfig = await loadWorkConfig()
    if (!callerMayEdit(req, doc, workConfig)) {
      return res.status(409).json({ success: false, code: "BACKFILL_LOCKED", message: "This backfill can't be edited now." })
    }
    const before = doc.rows.length
    doc.rows = doc.rows.filter((r) => String(r.employee) !== String(req.params.employeeId))
    if (doc.rows.length === before) {
      return res.status(404).json({ success: false, message: "That employee is not in this backfill" })
    }
    if (doc.status === "rejected") doc.status = "draft"
    try {
      await doc.save()
    } catch (err) {
      if (isVersionError(err)) return versionConflict(res)
      throw err
    }
    return res.status(200).json({ success: true, message: "Row removed", data: await formatRequest(doc, req, workConfig) })
  } catch (error) {
    console.error("removeBackfillRow error:", error)
    return res.status(500).json({ success: false, message: "Failed to remove the row" })
  }
}

// DELETE /api/backfill-requests/:id — the supervisor discards a draft (or a rejected one).
export const discardBackfillRequest = async (req, res) => {
  try {
    const doc = await loadAccessibleRequest(req, res)
    if (!doc) return
    const workConfig = await loadWorkConfig()
    if (isAdminRole(req.user.role) || !supervisorMayEdit(doc, workConfig)) {
      return res.status(409).json({ success: false, code: "BACKFILL_LOCKED", message: "This backfill can't be discarded." })
    }
    const result = await BackfillRequest.deleteOne({ _id: doc._id, status: { $in: SUPERVISOR_EDITABLE }, __v: doc.__v })
    if (result.deletedCount === 0) return versionConflict(res)
    return res.status(200).json({ success: true, message: "Backfill discarded" })
  } catch (error) {
    console.error("discardBackfillRequest error:", error)
    return res.status(500).json({ success: false, message: "Failed to discard the backfill" })
  }
}

// POST /api/backfill-requests/:id/submit — supervisor sends it to an admin. Locks the day.
export const submitBackfillRequest = async (req, res) => {
  try {
    const doc = await loadAccessibleRequest(req, res)
    if (!doc) return
    const workConfig = await loadWorkConfig()
    if (isAdminRole(req.user.role)) {
      return res.status(403).json({ success: false, message: "Only the site's supervisor sends a backfill for approval" })
    }
    if (!supervisorMayEdit(doc, workConfig)) {
      return res.status(409).json({
        success: false,
        code: SUPERVISOR_EDITABLE.includes(doc.status) ? "OUT_OF_WINDOW" : "BACKFILL_LOCKED",
        message: SUPERVISOR_EDITABLE.includes(doc.status)
          ? "This day is outside the backfill window — it can't be sent any more."
          : "This backfill was already sent.",
      })
    }
    if (doc.rows.length === 0) {
      return res.status(400).json({ success: false, message: "Add at least one employee before sending" })
    }
    doc.status = "submitted"
    doc.submittedBy = req.user.id
    doc.submittedAt = new Date()
    try {
      await doc.save()
    } catch (err) {
      if (isVersionError(err)) return versionConflict(res)
      throw err
    }
    const data = await formatRequest(doc, req, workConfig)
    await notifyBackfillSubmitted(doc, { siteName: data?.siteName || "a site", actorId: req.user.id })
    return res.status(200).json({ success: true, message: "Sent for approval", data })
  } catch (error) {
    console.error("submitBackfillRequest error:", error)
    return res.status(500).json({ success: false, message: "Failed to send the backfill" })
  }
}

// POST /api/backfill-requests/:id/reject  { reason } — admin; back to the supervisor.
export const rejectBackfillRequest = async (req, res) => {
  try {
    const reason = String(req.body?.reason || "").trim()
    if (!reason) return res.status(400).json({ success: false, message: "A reason is required to reject" })
    if (reason.length > 500) return res.status(400).json({ success: false, message: "Keep the reason under 500 characters" })

    const doc = await loadAccessibleRequest(req, res)
    if (!doc) return
    if (doc.status !== "submitted") {
      return res.status(409).json({ success: false, code: "NOT_SUBMITTED", message: "This backfill is not awaiting approval." })
    }
    doc.status = "rejected"
    doc.wasRejected = true
    doc.rejectionReason = reason
    doc.reviewedBy = req.user.id
    doc.reviewedAt = new Date()
    try {
      await doc.save()
    } catch (err) {
      if (isVersionError(err)) return versionConflict(res)
      throw err
    }
    const workConfig = await loadWorkConfig()
    const data = await formatRequest(doc, req, workConfig)
    await notifyBackfillRejected(doc, { siteName: data?.siteName || "your site", actorId: req.user.id, reason })
    return res.status(200).json({ success: true, message: "Sent back to the supervisor", data })
  } catch (error) {
    console.error("rejectBackfillRequest error:", error)
    return res.status(500).json({ success: false, message: "Failed to reject the backfill" })
  }
}

// POST /api/backfill-requests/:id/approve — admin. Creates one Attendance record per clean row;
// a row that no longer fits is marked skipped/failed on the document instead. Non-transactional
// and per employee, like the admin bulk backfill — re-running is safe (existing records skip).
export const approveBackfillRequest = async (req, res) => {
  try {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid backfill request id" })

    // Claim it first: only one approval can flip submitted → approved.
    const doc = await BackfillRequest.findOneAndUpdate(
      { _id: id, status: "submitted" },
      { $set: { status: "approved", reviewedBy: req.user.id, reviewedAt: new Date() }, $inc: { __v: 1 } },
      { new: true }
    )
    if (!doc) {
      const exists = await BackfillRequest.exists({ _id: id })
      return res
        .status(exists ? 409 : 404)
        .json({ success: false, code: exists ? "NOT_SUBMITTED" : undefined, message: exists ? "This backfill is not awaiting approval." : "Backfill request not found" })
    }

    const workConfig = await workModel.findOne({ type: "default" })
    const dateStr = dayKey(doc.date)
    const employeeIds = doc.rows.map((r) => String(r.employee))

    const [employees, recorded, holidayInfo, crossDay, auditActor] = await Promise.all([
      Employee.find({ _id: { $in: employeeIds } }).select("_id name employeeId jobTitle employmentType currentSite isActive").lean(),
      Attendance.find({ employee: { $in: employeeIds }, date: doc.date }).select("employee").lean(),
      checkHolidayForDate(doc.date),
      buildCrossDayOverlapChecker({ employeeIds, date: doc.date }),
      resolveActor(req),
    ])
    const empById = new Map(employees.map((e) => [String(e._id), e]))
    const hasRecord = new Set(recorded.map((r) => String(r.employee)))
    const timezoneOffset = timezoneOffsetOf(req)
    const auditRows = []
    const summary = { createdCount: 0, skippedCount: 0, failedCount: 0 }
    const onPool = await isDriverPool(doc.siteId)

    for (const row of doc.rows) {
      const empId = String(row.employee)
      const emp = empById.get(empId)
      const mark = (outcome, message = "", attendanceId = null) => {
        row.outcome = outcome
        row.outcomeMessage = message
        row.attendanceId = attendanceId
        summary[`${outcome}Count`] += 1
      }

      if (!emp || emp.isActive === false) { mark("skipped", "Employee not found or inactive"); continue }
      if (onPool && !isDriverTitle(emp.jobTitle)) { mark("skipped", "Not a driver"); continue }
      if (!onPool && isDriverTitle(emp.jobTitle)) { mark("skipped", "Driver — drivers are marked on Drivers Attendance"); continue }
      if (hasRecord.has(empId)) { mark("skipped", "Already has a record for this date"); continue }

      const markedBy = row.addedBy || doc.createdBy || req.user.id
      const rawSessions = normalizeRawSessions(row.sessions)
      const check = await validateSessions({ dateStr, siteId: doc.siteId, sessions: rawSessions, markedBy, strict: false, onPool })
      if (check.error) { mark("failed", check.error); continue }

      const conflict = crossDay(empId, check.built)
      if (conflict) { mark("failed", crossDayOverlapMessage(conflict)); continue }

      try {
        const { doc: record, auditRow } = await createBackfilledRecord({
          employee: emp,
          attendanceDate: doc.date,
          sessions: check.built,
          breaksTaken: row.breaksTaken ?? null,
          workConfig,
          holidayInfo,
          markedBy,
          auditActor,
          auditSummary: "Record backfilled (supervisor request, approved)",
          timezoneOffset,
        })
        mark("created", "", record._id)
        auditRows.push(auditRow)
      } catch (err) {
        if (err?.code === 11000) mark("skipped", "Already has a record for this date")
        else {
          console.error("approveBackfillRequest per-row error:", empId, err)
          mark("failed", err?.message || "Failed to create record")
        }
      }
    }

    doc.approvalSummary = summary
    doc.markModified("rows")
    await doc.save()
    await recordAttendanceAuditBatch(auditRows)

    const data = await formatRequest(doc, req, workConfig)
    await notifyBackfillApproved(doc, { siteName: data?.siteName || "your site", actorId: req.user.id, summary })

    return res.status(200).json({
      success: true,
      message: `Approved — ${summary.createdCount} record(s) created` +
        (summary.skippedCount || summary.failedCount ? `, ${summary.skippedCount} skipped, ${summary.failedCount} failed` : ""),
      summary,
      data,
    })
  } catch (error) {
    console.error("approveBackfillRequest error:", error)
    return res.status(500).json({ success: false, message: "Failed to approve the backfill" })
  }
}

