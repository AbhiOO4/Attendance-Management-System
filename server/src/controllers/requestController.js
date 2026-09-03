/**
 * Cross-site transfer requests (the "Request" lane).
 *
 * A destination site's supervisor asks the home site's supervisor (the employee's
 * owner) to hand an employee over for TODAY — a complete handover, distinct from
 * the source-initiated midday Transfer (a second session). Requester picks
 * mode = "today" (a full-day visit; home unchanged) or "permanent" (home moves).
 *
 * These endpoints do their own two-site authorization (a request spans two sites,
 * so requireSiteAccess — which validates a single site — is not used). All routes
 * sit below verifyToken, so req.user is the acting user ({ id, role }).
 */
import mongoose from "mongoose"
import empModel from "../models/empModel.js"
import Site from "../models/siteModel.js"
import Job from "../models/jobModel.js"
import userModel from "../models/userModel.js"
import Attendance from "../models/attendanceModel.js"
import TransferRequest from "../models/transferRequestModel.js"
import notificationModel from "../models/notificationModel.js"
import { isAssignableSite } from "../utils/siteAssignable.js"
import { getTodayLocal } from "../utils/timeLocal.js"
import { notifyUser, notifyAdmins, findSiteSupervisor } from "../utils/notify.js"

const isAdmin = (role) => role === "admin" || role === "superadmin"

/** UTC-midnight anchor for today's attendance records (matches the rest of the app). */
function todayAttendanceDate() {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  return today
}

/** True when the employee has checked in ANYWHERE today (a day already in progress). */
async function isMarkedToday(employeeId, session = null) {
  const doc = await Attendance.findOne({
    employee: employeeId,
    date: todayAttendanceDate(),
  }).session(session || null)
  return !!(doc && doc.sessions.some((s) => s.checkIn))
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

    if (toJobId) {
      const job = await Job.findById(toJobId)
      if (!job || job.site.toString() !== toSiteId.toString()) {
        return res.status(400).json({ success: false, message: "Job does not belong to the destination site" })
      }
    }

    // Clean handover only — a marked employee is a midday case (use Transfer).
    if (await isMarkedToday(employeeId)) {
      return res.status(409).json({
        success: false,
        message:
          "Employee is already marked at their site today. This is now a midday transfer — ask their site's supervisor to Transfer them.",
      })
    }

    const fromSite = employee.currentSite
    const supervisor = await findSiteSupervisor(fromSite)

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
        approver: supervisor ? supervisor._id : null,
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
    if (supervisor) await notifyUser(supervisor._id, payload)
    else await notifyAdmins(payload)

    return res.status(201).json({ success: true, message: "Request sent", data: request })
  } catch (error) {
    console.error("[requests] createRequest error:", error)
    return res.status(500).json({ success: false, message: "Failed to create request" })
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
    } else if (isAdmin(me.role)) {
      filter = { $or: [{ approver: me.id }, { approver: null }] }
    } else {
      filter = { approver: me.id }
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

    return res.status(200).json({ success: true, data: requests })
  } catch (error) {
    console.error("[requests] listRequests error:", error)
    return res.status(500).json({ success: false, message: "Failed to list requests" })
  }
}

/** Shared authorization for accept/reject: the resolved approver, or any admin. */
function mayDecide(request, user) {
  if (isAdmin(user.role)) return true
  return request.approver && request.approver.toString() === user.id.toString()
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

    if (!mayDecide(request, req.user)) {
      await session.abortTransaction()
      session.endSession()
      return res.status(403).json({ success: false, message: "You are not allowed to decide this request" })
    }

    const employee = await empModel.findById(request.employee).session(session)
    if (!employee) {
      await session.abortTransaction()
      session.endSession()
      return res.status(404).json({ success: false, message: "Employee not found" })
    }

    // Drift guard: the employee must still be homed at the requested site.
    if (!employee.currentSite || employee.currentSite.toString() !== request.fromSite.toString()) {
      request.status = "expired"
      request.decidedBy = req.user.id
      request.decidedAt = new Date()
      request.note = "Employee moved before the request was accepted"
      await request.save({ session })
      await session.commitTransaction()
      session.endSession()
      return res.status(409).json({
        success: false,
        message: "Employee has since moved home site — request expired",
      })
    }

    // Marked-today guard: a day already in progress is a midday case, not a handover.
    if (await isMarkedToday(employee._id, session)) {
      request.status = "expired"
      request.decidedBy = req.user.id
      request.decidedAt = new Date()
      request.note = "Employee was already marked today"
      await request.save({ session })
      await session.commitTransaction()
      session.endSession()
      return res.status(409).json({
        success: false,
        message: "Employee has already been marked today — request expired. Use Transfer for a midday move.",
      })
    }

    const toSite = await Site.findById(request.toSite).session(session)
    if (!isAssignableSite(toSite)) {
      await session.abortTransaction()
      session.endSession()
      return res.status(400).json({ success: false, message: "Destination site is no longer a valid target" })
    }

    if (request.mode === "today") {
      // Full-day visit via the pendingTransfer* stash (same rails as transferEmployee's
      // no-saved-record branch). Fresh session → null carried check-in, so the
      // destination draft uses its category default check-in. Home stays put.
      employee.pendingTransferCheckIn = null
      employee.pendingTransferSiteId = request.toSite
      employee.pendingTransferFromSiteId = request.fromSite
      employee.pendingTransferJobId = request.toJob || null
      employee.pendingTransferDate = todayAttendanceDate()
      await employee.save({ session })
    } else {
      // Permanent move: repoint home + job membership + supervisor auth (mirrors
      // instaAddEmployee / transferEmployee's !onlyForToday branch).
      const oldJobId = employee.currentJob
      if (oldJobId) {
        await Job.findByIdAndUpdate(oldJobId, { $pull: { employees: employee._id } }, { session })
      }
      employee.currentSite = request.toSite
      employee.currentJob = request.toJob || null
      await employee.save({ session })
      if (request.toJob) {
        await Job.findByIdAndUpdate(request.toJob, { $addToSet: { employees: employee._id } }, { session })
      }
      if (employee.user) {
        await userModel.findByIdAndUpdate(employee.user, { assignedSite: request.toSite }, { session })
      }
    }

    request.status = "accepted"
    request.decidedBy = req.user.id
    request.decidedAt = new Date()
    await request.save({ session })

    await session.commitTransaction()
    session.endSession()

    // Notify the requester (their employee is arriving).
    const empName = employee.name
    await notifyUser(request.requestedBy, {
      type: "request_accepted",
      title: "Transfer request accepted",
      body: `${empName} is now on your site${request.mode === "permanent" ? " (permanent)" : " for today"}.`,
      url: "/requests",
      relatedRequest: request._id,
    })

    return res.status(200).json({ success: true, message: "Request accepted", data: request })
  } catch (error) {
    await session.abortTransaction()
    session.endSession()
    console.error("[requests] acceptRequest error:", error)
    return res.status(500).json({ success: false, message: "Failed to accept request" })
  }
}

// ---------------------------------------------------------------------------
// POST /api/requests/:id/reject
// ---------------------------------------------------------------------------
export const rejectRequest = async (req, res) => {
  try {
    const { note = "" } = req.body || {}
    const request = await TransferRequest.findById(req.params.id)
    if (!request || request.status !== "pending") {
      return res.status(404).json({ success: false, message: "Request not found or already handled" })
    }
    if (!mayDecide(request, req.user)) {
      return res.status(403).json({ success: false, message: "You are not allowed to decide this request" })
    }

    request.status = "rejected"
    request.decidedBy = req.user.id
    request.decidedAt = new Date()
    request.note = note
    await request.save()

    const employee = await empModel.findById(request.employee).select("name")
    await notifyUser(request.requestedBy, {
      type: "request_rejected",
      title: "Transfer request declined",
      body: `Your request for ${employee?.name || "the employee"} was declined${note ? `: ${note}` : "."}`,
      url: "/requests",
      relatedRequest: request._id,
    })

    return res.status(200).json({ success: true, message: "Request rejected", data: request })
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

    request.status = "cancelled"
    request.decidedBy = req.user.id
    request.decidedAt = new Date()
    await request.save()

    return res.status(200).json({ success: true, message: "Request cancelled", data: request })
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
    const incoming = isAdmin(me.role)
      ? { status: "pending", $or: [{ approver: me.id }, { approver: null }] }
      : { status: "pending", approver: me.id }

    const [pendingIncoming, unread] = await Promise.all([
      TransferRequest.countDocuments(incoming),
      notificationModel.countDocuments({ user: me.id, read: false }),
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
