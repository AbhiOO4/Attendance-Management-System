/**
 * Cross-site transfer requests (the "Request" lane).
 *
 * A destination site's supervisor asks the home site's supervisor (the employee's
 * owner) to hand an employee over for TODAY — a complete handover, distinct from
 * the source-initiated midday Transfer (a second session). Requester picks
 * mode = "today" (a full-day visit; home unchanged) or "permanent" (home moves).
 *
 * The employee may already have checked in at their home site (its sheet was saved).
 * The home supervisor then chooses on accept: "move" the whole day (the home session is
 * removed) or "split" it at the time they left (a midday transfer). A check-in at any
 * OTHER site blocks the request — that site has them now and must Transfer them.
 *
 * These endpoints do their own two-site authorization (a request spans two sites,
 * so requireSiteAccess — which validates a single site — is not used). All routes
 * sit below verifyToken, so req.user is the acting user ({ id, role }).
 */
import mongoose from "mongoose"
import empModel from "../models/empModel.js"
import Site from "../models/siteModel.js"
import userModel from "../models/userModel.js"
import Attendance from "../models/attendanceModel.js"
import TransferRequest from "../models/transferRequestModel.js"
import AttendanceLock from "../models/lockModel.js"
import notificationModel from "../models/notificationModel.js"
import workModel from "../models/workModel.js"
import { isAssignableSite, findAssignableJob } from "../utils/siteAssignable.js"
import {
  getTodayLocal,
  isWithinCarryoverWindow,
  deriveOffsets,
  combineFromOffset,
  toLocalTimeString,
} from "../utils/timeLocal.js"
import { notifyUser, notifyAdmins, findSiteSupervisors } from "../utils/notify.js"
import {
  applyHandover,
  placeMiddayArrival,
  createPreSaveVisitRecord,
  assertNotMovedOn,
} from "../utils/handover.js"
import { recordSiteActivity, resolveActor } from "../utils/siteActivity.js"
import { recordAttendanceAudit } from "../utils/attendanceAudit.js"
import { recomputeRecordTotals } from "../utils/attendanceMath.js"
import {
  hasSessionOverlap,
  buildCrossDayOverlapChecker,
  crossDayOverlapMessage,
} from "../utils/sessionOverlap.js"
import { openEventStream } from "../utils/realtime.js"
import { touchSiteRosters, isWriteConflict } from "../utils/draftRoster.js"

const isAdmin = (role) => role === "admin" || role === "superadmin"

/**
 * App-timezone business-day midnight — the anchor every attendance record and the
 * pendingTransferDate stash use (matches siteFirstSubmitAttendance and the client draft).
 * Raw UTC midnight would resolve to the previous day in the early-morning window
 * (e.g. 00:00–05:30 IST), so the marked-today guard and the midday-arrival record would
 * land on the wrong day.
 */
function todayAttendanceDate() {
  return new Date(getTodayLocal())
}

/**
 * Today's check-ins for an employee, split by where they happened. A check-in at their
 * HOME site no longer blocks a pull request — on accept, the home supervisor decides
 * whether that day moves to the requester whole or is split at the time they left. A
 * check-in anywhere ELSE means they're working at that site now, and only that site can
 * move them on (Transfer). getAvailableEmployeesForSite's `markedAway` (siteController.js)
 * mirrors the `elsewhere` rule so the Request dialog can say so up front.
 */
async function todayCheckIns(employee, session = null) {
  const doc = await Attendance.findOne({
    employee: employee._id,
    date: todayAttendanceDate(),
  }).session(session || null)
  const home = employee.currentSite ? String(employee.currentSite) : null
  const checkedIn = (doc?.sessions || []).filter((s) => s.checkIn)
  return {
    doc,
    homeSessions: checkedIn.filter((s) => String(s.siteId) === home),
    elsewhere: checkedIn.find((s) => String(s.siteId) !== home) || null,
  }
}

const siteNameOf = async (siteId, session = null) =>
  (await Site.findById(siteId).select("siteName").session(session || null))?.siteName || "another site"

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/** An Error carrying the HTTP status acceptRequest's catch replies with. */
function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

/**
 * "Didn't work here": drop every session at the home site from today's record, so the
 * destination (placed next by the normal accept path) takes the whole day. Totals are
 * recomputed through the shared maths, as removeEmployee does.
 */
async function removeHomeDay({ doc, fromSiteId, toSiteName, workConfig, actor, session }) {
  const fromSiteName = await siteNameOf(fromSiteId, session)
  doc.sessions = doc.sessions.filter((s) => String(s.siteId) !== String(fromSiteId))
  recomputeRecordTotals(doc, workConfig)
  await doc.save({ session })
  await recordAttendanceAudit({
    attendance: doc,
    actor,
    type: "edited",
    summary: `Session at ${fromSiteName} removed — whole day moved to ${toSiteName} (transfer request accepted)`,
    session,
  })
}

/**
 * "Worked here until splitAt": close the latest home session today at `splitAt` and return
 * that check-out, which becomes the destination's check-in (placeMiddayArrival). Overwrites
 * an existing check-out — it is the decider's explicit time. The time must fall after the
 * check-in on the same day: a wall time before it would otherwise roll to tomorrow and
 * silently record a ~24h shift.
 */
async function closeHomeSessionAt({ doc, homeSessions, splitAt, toSiteName, workConfig, actor, employeeId, session }) {
  const target = homeSessions.reduce((a, b) =>
    new Date(b.checkIn).getTime() > new Date(a.checkIn).getTime() ? b : a
  )
  const checkInStr = toLocalTimeString(new Date(target.checkIn))
  const recordDay = new Date(doc.date).toISOString().slice(0, 10)
  const { checkInNextDay, checkOutNextDay } = deriveOffsets(checkInStr, splitAt, !!target.checkInNextDay)
  if (checkOutNextDay !== checkInNextDay) {
    throw httpError(400, `The time they left must be later than their check-in (${checkInStr})`)
  }
  const checkOut = combineFromOffset(recordDay, splitAt, checkOutNextDay)
  const workedHours = (checkOut.getTime() - new Date(target.checkIn).getTime()) / (1000 * 60 * 60)
  if (!(workedHours > 0)) {
    throw httpError(400, `The time they left must be later than their check-in (${checkInStr})`)
  }

  const candidate = doc.sessions.map((s) =>
    String(s._id) === String(target._id)
      ? { checkIn: s.checkIn, checkOut }
      : { checkIn: s.checkIn, checkOut: s.checkOut }
  )
  if (hasSessionOverlap(candidate)) {
    throw httpError(400, "That time overlaps another session they have today")
  }
  const crossDay = await buildCrossDayOverlapChecker({ employeeIds: [employeeId], date: doc.date, dbSession: session })
  const conflict = crossDay(employeeId, [{ checkIn: target.checkIn, checkOut }])
  if (conflict) throw httpError(400, crossDayOverlapMessage(conflict))

  target.checkOut = checkOut
  target.workedHours = Number(workedHours.toFixed(2))
  recomputeRecordTotals(doc, workConfig)
  await doc.save({ session })

  const fromSiteName = await siteNameOf(target.siteId, session)
  await recordAttendanceAudit({
    attendance: doc,
    actor,
    type: "edited",
    summary: `Checked out at ${fromSiteName} at ${splitAt} for transfer to ${toSiteName} (transfer request accepted)`,
    session,
  })
  return checkOut
}

// ---------------------------------------------------------------------------
// POST /api/requests — create a request (supervisors only; admins direct-add)
// ---------------------------------------------------------------------------
export const createRequest = async (req, res) => {
  try {
    const { employeeId, toSiteId, toJobId = null, mode } = req.body || {}

    if (!employeeId || !toSiteId || !mode) {
      return res.status(400).json({
        success: false,
        message: "employeeId, toSiteId and mode are required",
      })
    }
    if (mode !== "today" && mode !== "permanent") {
      return res.status(400).json({ success: false, message: "mode must be 'today' or 'permanent'" })
    }

    // Requester must own the destination site (supervisors are the only role here).
    const requester = await userModel.findById(req.user.id)
    if (!requester) {
      return res.status(401).json({ success: false, message: "Unauthorized" })
    }
    if (
      !isAdmin(requester.role) &&
      (!requester.assignedSite || requester.assignedSite.toString() !== toSiteId.toString())
    ) {
      return res.status(403).json({ success: false, message: "You can only request into your own site" })
    }

    const employee = await empModel.findById(employeeId)
    if (!employee || !employee.isActive) {
      return res.status(404).json({ success: false, message: "Employee not found" })
    }

    if (!employee.currentSite) {
      return res.status(400).json({
        success: false,
        message: "This employee is unassigned — add them directly, no request needed",
      })
    }
    if (employee.currentSite.toString() === toSiteId.toString()) {
      return res.status(400).json({ success: false, message: "Employee is already at this site" })
    }

    const toSite = await Site.findById(toSiteId)
    if (!isAssignableSite(toSite)) {
      return res.status(400).json({ success: false, message: "Destination site is not a valid transfer target" })
    }

    if (toJobId && !(await findAssignableJob(toJobId, toSiteId))) {
      return res.status(400).json({ success: false, message: "That job is not active at the destination site" })
    }

    // Checked in at their home site → fine; the home supervisor chooses how the day splits
    // when they accept. Checked in anywhere else → that site has them now (Transfer).
    const { elsewhere } = await todayCheckIns(employee)
    if (elsewhere) {
      const where = await siteNameOf(elsewhere.siteId)
      return res.status(409).json({
        success: false,
        code: "MARKED_ELSEWHERE",
        message:
          String(elsewhere.siteId) === String(toSiteId)
            ? `${employee.name} already has a session at your site today`
            : `${employee.name} is working at ${where} today, so they can't be requested. Ask ${where}'s supervisor to Transfer them.`,
      })
    }

    const fromSite = employee.currentSite
    // A site may have several supervisors; any of them (or an admin) decides
    // (resolved by fromSite === assignedSite in the inbox/mayDecide). We record ONE
    // representative `approver` for display + the admin fallback, and notify all of
    // them below so no one is left unaware.
    const supervisors = await findSiteSupervisors(fromSite)

    let request
    try {
      request = await TransferRequest.create({
        employee: employee._id,
        fromSite,
        fromJob: employee.currentJob || null,
        toSite: toSiteId,
        toJob: toJobId || null,
        mode,
        requestedBy: req.user.id,
        approver: supervisors[0]?._id ?? null,
        status: "pending",
        dateLocal: getTodayLocal(),
      })
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({
          success: false,
          message: "A request for this employee is already pending",
        })
      }
      throw err
    }

    // Best-effort notify the decider(s).
    const fromSiteDoc = await Site.findById(fromSite).select("siteName")
    const title = "New transfer request"
    const body = `${requester.name || "A supervisor"} requests ${employee.name} (${mode === "permanent" ? "permanent" : "for today"}) from ${fromSiteDoc?.siteName || "their site"} to ${toSite.siteName}`
    const payload = { type: "request_received", title, body, url: "/requests", relatedRequest: request._id }
    if (supervisors.length) await Promise.all(supervisors.map((s) => notifyUser(s._id, payload)))
    else await notifyAdmins(payload)

    // --- Site activity: a transfer request was sent (best-effort; shows in both sites' feeds) ---
    await recordSiteActivity({
      type: "request_sent",
      actor: { actorId: req.user.id, actorName: requester.name || "Unknown" },
      employee: employee._id,
      employeeName: employee.name,
      fromSiteId: fromSite,
      toSiteId,
      summary: `${requester.name || "A supervisor"} requested transfer of ${employee.name} from ${fromSiteDoc?.siteName || "their site"} to ${toSite.siteName} (${mode === "permanent" ? "permanent" : "for today"})`,
    })

    return res.status(201).json({ success: true, message: "Request sent", data: request })
  } catch (error) {
    console.error("[requests] createRequest error:", error)
    return res.status(500).json({ success: false, message: "Failed to create request" })
  }
}

/**
 * The "incoming" filter — requests this user can see and decide.
 * - Admins: EVERY request, across all sites. Any admin may step in on any request, so
 *   nothing can sit unseen (this replaced the old stale-request escalation cron).
 * - Supervisors: EVERY request whose DECIDING site is theirs. The deciding site is
 *   fromSite for a "pull" (a destination asking for their employee) and toSite for a
 *   "push" (a source sending an employee into their site). Site-based rather than the
 *   single stored `approver` (a representative kept for display), since a site may have
 *   several supervisors and any may decide. A missing `direction` on legacy docs is
 *   treated as "pull". Matches nothing when a supervisor has no assigned site.
 */
async function incomingFilterFor(user) {
  if (isAdmin(user.role)) {
    return {}
  }
  const me = await userModel.findById(user.id).select("assignedSite")
  if (!me?.assignedSite) return { _id: { $in: [] } }
  return {
    $or: [
      { fromSite: me.assignedSite, direction: { $ne: "push" } },
      { toSite: me.assignedSite, direction: "push" },
    ],
  }
}

// ---------------------------------------------------------------------------
// GET /api/requests?box=incoming|outgoing&status= — list requests
// ---------------------------------------------------------------------------
export const listRequests = async (req, res) => {
  try {
    const { box = "incoming", status } = req.query
    const me = req.user

    let filter
    if (box === "outgoing") {
      filter = { requestedBy: me.id }
    } else {
      filter = await incomingFilterFor(me)
    }

    if (status && ["pending", "accepted", "rejected", "cancelled", "expired"].includes(status)) {
      filter = { $and: [filter, { status }] }
    }

    const requests = await TransferRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("employee", "name employeeId jobTitle")
      .populate("fromSite", "siteName")
      .populate("toSite", "siteName")
      .populate("fromJob", "name")
      .populate("toJob", "name")
      .populate("requestedBy", "name")
      .populate("approver", "name")
      .lean()

    // Attach the CURRENT supervisors of each request's DECIDING site (fromSite for a
    // "pull", toSite for a "push"). A site may have several, and any of them can
    // decide — the client shows "Awaiting X +N more". Computed fresh here so it
    // reflects who can act right now, which is truer than the single representative
    // `approver` stored at creation (assignments can change afterwards).
    const decidingSiteOf = (r) => (r.direction === "push" ? r.toSite?._id : r.fromSite?._id)
    const decidingSiteIds = [
      ...new Set(requests.map(decidingSiteOf).filter(Boolean).map((id) => id.toString())),
    ]
    const supsBySite = new Map()
    if (decidingSiteIds.length) {
      const sups = await userModel
        .find({ role: "supervisor", assignedSite: { $in: decidingSiteIds } })
        .select("_id name assignedSite")
        .lean()
      for (const s of sups) {
        const key = s.assignedSite.toString()
        if (!supsBySite.has(key)) supsBySite.set(key, [])
        supsBySite.get(key).push({ _id: s._id, name: s.name })
      }
    }
    for (const r of requests) {
      const site = decidingSiteOf(r)
      r.deciders = site ? supsBySite.get(site.toString()) || [] : []
    }

    // Incoming pending PULL requests for today: the employee's latest check-in at the home
    // (deciding) site today, if any. Accepting one then needs a choice — move the whole day
    // or split it — so the card asks up front instead of bouncing off DAY_CHOICE_REQUIRED.
    if (box !== "outgoing") {
      const today = getTodayLocal()
      const decidable = requests.filter(
        (r) => r.status === "pending" && r.direction !== "push" && r.dateLocal === today && r.employee?._id
      )
      if (decidable.length) {
        const atts = await Attendance.find({
          employee: { $in: decidable.map((r) => r.employee._id) },
          date: todayAttendanceDate(),
        })
          .select("employee sessions.siteId sessions.checkIn sessions.checkOut")
          .lean()
        const attByEmp = new Map(atts.map((a) => [String(a.employee), a]))
        for (const r of decidable) {
          const home = String(r.fromSite?._id || "")
          const latest = (attByEmp.get(String(r.employee._id))?.sessions || [])
            .filter((s) => s.checkIn && String(s.siteId) === home)
            .sort((a, b) => new Date(b.checkIn).getTime() - new Date(a.checkIn).getTime())[0]
          r.sourceDay = latest ? { checkIn: latest.checkIn, checkOut: latest.checkOut || null } : null
        }
      }
    }

    return res.status(200).json({ success: true, data: requests })
  } catch (error) {
    console.error("[requests] listRequests error:", error)
    return res.status(500).json({ success: false, message: "Failed to list requests" })
  }
}

/**
 * Authorization for accept/reject: an admin, or ANY supervisor of the request's
 * DECIDING site (toSite for a "push", fromSite for a "pull"). Site-based so every
 * supervisor of that site qualifies — not just the single stored `approver`.
 */
async function mayDecide(request, user) {
  if (isAdmin(user.role)) return true
  const me = await userModel.findById(user.id).select("assignedSite role")
  if (!me || me.role !== "supervisor" || !me.assignedSite) return false
  const decidingSite = request.direction === "push" ? request.toSite : request.fromSite
  return me.assignedSite.toString() === decidingSite.toString()
}

/**
 * Inside acceptRequest's transaction: close a request the situation has overtaken as
 * `expired` (with a reason), COMMIT that, and reply 409 — so the card leaves the inbox
 * instead of offering an Accept that can only fail.
 */
async function expireAndRespond({ request, req, res, session, note, message }) {
  request.status = "expired"
  request.decidedBy = req.user.id
  request.decidedAt = new Date()
  request.note = note
  await request.save({ session })
  await session.commitTransaction()
  session.endSession()
  return res.status(409).json({ success: false, message })
}

// ---------------------------------------------------------------------------
// POST /api/requests/:id/accept — execute the handover
// ---------------------------------------------------------------------------
export const acceptRequest = async (req, res) => {
  const session = await mongoose.startSession()
  session.startTransaction()
  try {
    const request = await TransferRequest.findById(req.params.id).session(session)
    if (!request || request.status !== "pending") {
      await session.abortTransaction()
      session.endSession()
      return res.status(404).json({ success: false, message: "Request not found or already handled" })
    }

    if (!(await mayDecide(request, req.user))) {
      await session.abortTransaction()
      session.endSession()
      return res.status(403).json({ success: false, message: "You are not allowed to decide this request" })
    }

    const isPush = request.direction === "push"

    // A request only makes sense for the day it was made. A pull is a same-day handover. A
    // push (midday/night transfer) continues its SOURCE record's timeline, which stays live
    // until the carryover window closes (local noon the next day) — so a night transfer sent
    // at 23:30 can still be accepted at 00:15 and lands on that night's record. The hourly
    // expiry cron may not have run yet, so the window is enforced here too.
    const recordDay = isPush ? request.attendanceDate || request.dateLocal : request.dateLocal
    const stillLive = isPush ? isWithinCarryoverWindow(recordDay) : recordDay === getTodayLocal()
    if (!stillLive) {
      return expireAndRespond({
        request, req, res, session,
        note: "Expired — the day it was for has ended",
        message: `This request was for ${recordDay} and has expired`,
      })
    }

    const employee = await empModel.findById(request.employee).session(session)
    if (!employee) {
      await session.abortTransaction()
      session.endSession()
      return res.status(404).json({ success: false, message: "Employee not found" })
    }
    if (!employee.isActive) {
      return expireAndRespond({
        request, req, res, session,
        note: "Employee was deactivated",
        message: "This employee has been deactivated — request expired",
      })
    }

    const toSite = await Site.findById(request.toSite).session(session)
    if (!isAssignableSite(toSite)) {
      return expireAndRespond({
        request, req, res, session,
        note: "Destination site is no longer active",
        message: "The destination site is no longer active — request expired",
      })
    }

    // A job deactivated after the request was made is dropped (placed with no job) rather
    // than failing the accept; the decider is told in the success message.
    const toJob = request.toJob ? await findAssignableJob(request.toJob, request.toSite, session) : null
    const jobNote =
      request.toJob && !toJob ? " The requested job is no longer active, so no job was assigned." : ""

    // A source-initiated midday transfer (push): the employee is marked at the source
    // by design, so the pull-lane drift/marked-today guards below don't apply. Place the
    // arrival exactly as the immediate transfer does (carried check-in, second session).
    if (isPush) {
      const toSitePush = toSite
      const attendanceDate = new Date(recordDay)
      const doc = await Attendance.findOne({ employee: employee._id, date: attendanceDate }).session(session)

      // The source check-out snapshotted at request time must still stand — if it was edited
      // or removed since, replaying it would start the destination session at the wrong time.
      const carriedMs = request.carriedCheckIn ? new Date(request.carriedCheckIn).getTime() : NaN
      const sourceIntact =
        !!doc &&
        doc.sessions.some(
          (s) =>
            String(s.siteId) === String(request.fromSite) &&
            s.checkOut &&
            new Date(s.checkOut).getTime() === carriedMs
        )
      if (!sourceIntact) {
        return expireAndRespond({
          request, req, res, session,
          note: "The source check-out changed after the request was sent",
          message:
            "The employee's check-out at the source site has changed since this was sent — request expired. Ask them to transfer again.",
        })
      }

      // Already placed somewhere else since the request was made → the request is moot.
      try {
        await assertNotMovedOn({
          doc,
          fromSiteId: request.fromSite,
          toSiteId: request.toSite,
          carriedCheckIn: request.carriedCheckIn,
          session,
        })
      } catch (err) {
        if (err.status !== 409) throw err
        return expireAndRespond({
          request, req, res, session,
          note: err.message.replace(" — refresh the page", ""),
          message: err.message.replace("refresh the page", "request expired"),
        })
      }

      const pushActor = await resolveActor(req)
      await placeMiddayArrival({
        employee,
        fromSiteId: request.fromSite,
        toSiteId: request.toSite,
        jobId: toJob?._id || null,
        carriedCheckIn: request.carriedCheckIn,
        attendanceDate,
        onlyForToday: request.mode === "today",
        markedById: req.user.id,
        actor: pushActor,
        session,
        attendanceDoc: doc,
      })

      request.status = "accepted"
      request.decidedBy = req.user.id
      request.decidedAt = new Date()
      await request.save({ session })

      await session.commitTransaction()
      session.endSession()

      const empNamePush = employee.name
      await notifyUser(request.requestedBy, {
        type: "request_accepted",
        title: "Transfer request accepted",
        body: `${empNamePush} was accepted at ${toSitePush?.siteName || "the destination site"}${request.mode === "permanent" ? " (permanent)" : " for today"}.`,
        url: "/requests",
        relatedRequest: request._id,
      })

      const pushFromSite = await Site.findById(request.fromSite).select("siteName")
      await recordSiteActivity({
        type: "request_accepted",
        actor: pushActor,
        employee: employee._id,
        employeeName: empNamePush,
        fromSiteId: request.fromSite,
        toSiteId: request.toSite,
        summary: `${pushActor.actorName} accepted the midday transfer of ${empNamePush} from ${pushFromSite?.siteName || "their site"} to ${toSitePush?.siteName || "the site"} (${request.mode === "permanent" ? "permanent" : "for today"})`,
      })

      return res.status(200).json({ success: true, message: `Request accepted.${jobNote}`, data: request })
    }

    // Drift guard: the employee must still be homed at the requested site.
    if (!employee.currentSite || employee.currentSite.toString() !== request.fromSite.toString()) {
      return expireAndRespond({
        request, req, res, session,
        note: "Employee moved before the request was accepted",
        message: "Employee has since moved home site — request expired",
      })
    }

    // Working at another site now → only that site can move them on (Transfer).
    const { doc: todayDoc, homeSessions, elsewhere } = await todayCheckIns(employee, session)
    if (elsewhere) {
      const where = await siteNameOf(elsewhere.siteId, session)
      return expireAndRespond({
        request, req, res, session,
        note: `${employee.name} is working at ${where} today`,
        message: `${employee.name} is working at ${where} today — request expired. Ask ${where}'s supervisor to Transfer them.`,
      })
    }

    const acceptActor = await resolveActor(req)

    // Already checked in at home today: the decider says how the day splits. "move" = they
    // didn't really work here, so the home session goes and the destination takes the whole
    // day; "split" = they worked here until `splitAt`, which closes the home session and
    // starts the destination one (a midday transfer). Missing → ask; the request stays
    // pending (the client refetches and shows the choice).
    let dayHandling = null
    let splitCheckOut = null
    if (homeSessions.length) {
      const { dayHandling: choice, splitAt } = req.body || {}
      if (choice !== "move" && !(choice === "split" && HHMM.test(String(splitAt || "")))) {
        await session.abortTransaction()
        session.endSession()
        return res.status(409).json({
          success: false,
          code: "DAY_CHOICE_REQUIRED",
          message: `${employee.name} has checked in at their site today — choose whether to move their whole day or split it`,
        })
      }
      dayHandling = choice
      const workConfig = await workModel.findOne().session(session)
      if (dayHandling === "move") {
        await removeHomeDay({
          doc: todayDoc,
          fromSiteId: request.fromSite,
          toSiteName: toSite.siteName,
          workConfig,
          actor: acceptActor,
          session,
        })
      } else {
        splitCheckOut = await closeHomeSessionAt({
          doc: todayDoc,
          homeSessions,
          splitAt,
          toSiteName: toSite.siteName,
          workConfig,
          actor: acceptActor,
          employeeId: employee._id,
          session,
        })
      }
    }

    if (dayHandling === "split") {
      // A midday transfer: the home check-out just set becomes the destination check-in.
      // Shared with the push path — carries the session, stashes for an unlocked
      // destination, and repoints the home for a permanent move.
      await placeMiddayArrival({
        employee,
        fromSiteId: request.fromSite,
        toSiteId: request.toSite,
        jobId: toJob?._id || null,
        carriedCheckIn: splitCheckOut,
        attendanceDate: todayAttendanceDate(),
        onlyForToday: request.mode === "today",
        markedById: req.user.id,
        actor: acceptActor,
        session,
        attendanceDoc: todayDoc,
      })
      request.carriedCheckIn = splitCheckOut
    } else {
      // Both rosters change: conflict with a submit of either site that's in flight, so it
      // can't lock that day against the roster from just before this move (see touchSiteRosters).
      await touchSiteRosters([request.fromSite, request.toSite], session)

      // Place the employee at the destination (shared with the source-push path).
      await applyHandover({
        employee,
        toSiteId: request.toSite,
        toJobId: toJob?._id || null,
        mode: request.mode,
        session,
      })

      // Same rule as Send-to-site: applyHandover repoints the home (permanent) or writes the
      // pendingTransfer stash (today), which puts the arrival on an UNLOCKED destination's
      // draft — its record is created when that site saves, so none is written here. A
      // LOCKED destination never rebuilds its draft, so there the arrival would be orphaned:
      // materialize it now. request.fromSite is the stored source (unaffected by the permanent
      // repoint above), so it powers the destination record's "Transferred from" badge.
      // createPreSaveVisitRecord PUSH-or-CREATEs onto today's doc (re-read inside this
      // transaction, so a "move" above is already applied), respecting the unique
      // {employee, date} index.
      const destLocked = !!(await AttendanceLock.findOne({
        siteId: request.toSite,
        date: todayAttendanceDate(),
        isLocked: true,
      }).session(session))
      if (destLocked) {
        await createPreSaveVisitRecord({
          employee,
          toSite,
          toJobId: toJob?._id || null,
          fromSiteId: request.fromSite,
          markedById: req.user.id,
          actor: acceptActor,
          session,
        })
      }
    }

    request.status = "accepted"
    request.decidedBy = req.user.id
    request.decidedAt = new Date()
    request.dayHandling = dayHandling
    await request.save({ session })

    await session.commitTransaction()
    session.endSession()

    // How the home day was handled, for the notification / feed / reply wording.
    const splitAtStr = splitCheckOut ? toLocalTimeString(splitCheckOut) : null
    const handledNote =
      dayHandling === "move" ? " — whole day moved" : splitAtStr ? ` from ${splitAtStr}` : ""

    // Notify the requester (their employee is arriving).
    const empName = employee.name
    await notifyUser(request.requestedBy, {
      type: "request_accepted",
      title: "Transfer request accepted",
      body: `${empName} is now on your site${request.mode === "permanent" ? " (permanent)" : " for today"}${handledNote}.`,
      url: "/requests",
      relatedRequest: request._id,
    })

    // --- Site activity: request accepted, employee handed over (best-effort, after commit) ---
    const acceptFromSite = await Site.findById(request.fromSite).select("siteName")
    await recordSiteActivity({
      type: "request_accepted",
      actor: acceptActor,
      employee: employee._id,
      employeeName: empName,
      fromSiteId: request.fromSite,
      toSiteId: request.toSite,
      summary: `${acceptActor.actorName} accepted transfer of ${empName} from ${acceptFromSite?.siteName || "their site"} to ${toSite?.siteName || "the site"} (${request.mode === "permanent" ? "permanent" : "for today"})${handledNote}`,
    })

    const acceptedMsg =
      dayHandling === "move"
        ? `Request accepted — ${empName}'s whole day moved to ${toSite.siteName}.`
        : dayHandling === "split"
        ? `Request accepted — ${empName} checked out here at ${splitAtStr} and starts at ${toSite.siteName} from then.`
        : "Request accepted."
    return res.status(200).json({ success: true, message: `${acceptedMsg}${jobNote}`, data: request })
  } catch (error) {
    await session.abortTransaction()
    session.endSession()
    if (isWriteConflict(error)) {
      return res.status(409).json({
        success: false,
        message: "One of these sites was being saved at the same moment — please try again.",
      })
    }
    console.error("[requests] acceptRequest error:", error)
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Failed to accept request",
    })
  }
}

// ---------------------------------------------------------------------------
// POST /api/requests/:id/reject
// ---------------------------------------------------------------------------
export const rejectRequest = async (req, res) => {
  try {
    const note = String(req.body?.note ?? "").trim().slice(0, 500)
    const request = await TransferRequest.findById(req.params.id)
    if (!request || request.status !== "pending") {
      return res.status(404).json({ success: false, message: "Request not found or already handled" })
    }
    if (!(await mayDecide(request, req.user))) {
      return res.status(403).json({ success: false, message: "You are not allowed to decide this request" })
    }

    // Conditional on still-pending: an Accept committing in the meantime must win, not be
    // overwritten by this (already-read) "pending" snapshot.
    const decided = await TransferRequest.findOneAndUpdate(
      { _id: request._id, status: "pending" },
      { $set: { status: "rejected", decidedBy: req.user.id, decidedAt: new Date(), note } },
      { new: true }
    )
    if (!decided) {
      return res.status(404).json({ success: false, message: "Request not found or already handled" })
    }

    const employee = await empModel.findById(request.employee).select("name")
    await notifyUser(request.requestedBy, {
      type: "request_rejected",
      title: "Transfer request declined",
      body: `Your request for ${employee?.name || "the employee"} was declined${note ? `: ${note}` : "."}`,
      url: "/requests",
      relatedRequest: request._id,
    })

    // --- Site activity: request rejected (best-effort) ---
    const rejectActor = await resolveActor(req)
    const [rejFromSite, rejToSite] = await Promise.all([
      Site.findById(request.fromSite).select("siteName"),
      Site.findById(request.toSite).select("siteName"),
    ])
    await recordSiteActivity({
      type: "request_rejected",
      actor: rejectActor,
      employee: request.employee,
      employeeName: employee?.name || "",
      fromSiteId: request.fromSite,
      toSiteId: request.toSite,
      summary: `${rejectActor.actorName} rejected the transfer request for ${employee?.name || "the employee"} (${rejFromSite?.siteName || "?"} → ${rejToSite?.siteName || "?"})${note ? `: ${note}` : ""}`,
    })

    return res.status(200).json({ success: true, message: "Request rejected", data: decided })
  } catch (error) {
    console.error("[requests] rejectRequest error:", error)
    return res.status(500).json({ success: false, message: "Failed to reject request" })
  }
}

// ---------------------------------------------------------------------------
// POST /api/requests/:id/cancel — the requester withdraws their own request
// ---------------------------------------------------------------------------
export const cancelRequest = async (req, res) => {
  try {
    const request = await TransferRequest.findById(req.params.id)
    if (!request || request.status !== "pending") {
      return res.status(404).json({ success: false, message: "Request not found or already handled" })
    }
    if (!isAdmin(req.user.role) && request.requestedBy.toString() !== req.user.id.toString()) {
      return res.status(403).json({ success: false, message: "You can only cancel your own requests" })
    }

    // Conditional on still-pending, so a concurrently committing Accept isn't overwritten.
    const cancelled = await TransferRequest.findOneAndUpdate(
      { _id: request._id, status: "pending" },
      { $set: { status: "cancelled", decidedBy: req.user.id, decidedAt: new Date() } },
      { new: true }
    )
    if (!cancelled) {
      return res.status(404).json({ success: false, message: "Request not found or already handled" })
    }

    // --- Site activity: requester withdrew the request (best-effort) ---
    const cancelActor = await resolveActor(req)
    const [canEmp, canFromSite, canToSite] = await Promise.all([
      empModel.findById(request.employee).select("name"),
      Site.findById(request.fromSite).select("siteName"),
      Site.findById(request.toSite).select("siteName"),
    ])
    await recordSiteActivity({
      type: "request_cancelled",
      actor: cancelActor,
      employee: request.employee,
      employeeName: canEmp?.name || "",
      fromSiteId: request.fromSite,
      toSiteId: request.toSite,
      summary: `${cancelActor.actorName} cancelled the transfer request for ${canEmp?.name || "the employee"} (${canFromSite?.siteName || "?"} → ${canToSite?.siteName || "?"})`,
    })

    return res.status(200).json({ success: true, message: "Request cancelled", data: cancelled })
  } catch (error) {
    console.error("[requests] cancelRequest error:", error)
    return res.status(500).json({ success: false, message: "Failed to cancel request" })
  }
}

// ---------------------------------------------------------------------------
// GET /api/requests/summary — badge counts { pendingIncoming, unread }
// ---------------------------------------------------------------------------
export const getSummary = async (req, res) => {
  try {
    const me = req.user
    const incoming = { status: "pending", ...(await incomingFilterFor(me)) }

    // A "request_received" notification's request is already counted by pendingIncoming —
    // counting both showed one new request as 2. The Requests page's tab alerts add up to this.
    const [pendingIncoming, unread] = await Promise.all([
      TransferRequest.countDocuments(incoming),
      notificationModel.countDocuments({ user: me.id, read: false, type: { $ne: "request_received" } }),
    ])

    return res.status(200).json({ success: true, data: { pendingIncoming, unread } })
  } catch (error) {
    console.error("[requests] getSummary error:", error)
    return res.status(500).json({ success: false, message: "Failed to load summary" })
  }
}

// ---------------------------------------------------------------------------
// GET /api/requests/notifications — the in-app activity feed
// ---------------------------------------------------------------------------
export const listNotifications = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100)
    const notifications = await notificationModel
      .find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(limit)
    return res.status(200).json({ success: true, data: notifications })
  } catch (error) {
    console.error("[requests] listNotifications error:", error)
    return res.status(500).json({ success: false, message: "Failed to load notifications" })
  }
}

// ---------------------------------------------------------------------------
// POST /api/requests/notifications/read — mark notifications read
// ---------------------------------------------------------------------------
export const markNotificationsRead = async (req, res) => {
  try {
    const { ids } = req.body || {}
    const filter = { user: req.user.id, read: false }
    if (Array.isArray(ids) && ids.length > 0) filter._id = { $in: ids }
    await notificationModel.updateMany(filter, { $set: { read: true } })
    return res.status(200).json({ success: true, message: "Marked read" })
  } catch (error) {
    console.error("[requests] markNotificationsRead error:", error)
    return res.status(500).json({ success: false, message: "Failed to mark read" })
  }
}

// ---------------------------------------------------------------------------
// GET /api/requests/stream — live updates (server-sent events). Held open; each
// event only names what changed, and the client refetches the endpoints above.
// ---------------------------------------------------------------------------
export const streamRequestEvents = (req, res) => {
  openEventStream(req, res)
}
