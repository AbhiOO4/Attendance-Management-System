/**
 * Shared cross-site handover — the single source of truth for placing an employee
 * at a destination site for a clean full-day handover. Used by BOTH the accept path
 * (requestController.acceptRequest, a destination pull the owner approved) and the
 * source push (siteController.sendEmployeeToSite, an owner giving their own away).
 *
 *   mode 'today'     — a single-day visit via the pendingTransfer* stash; the home
 *                      currentSite/currentJob are untouched (back home tomorrow).
 *                      A fresh session → null carried check-in, so the destination
 *                      draft uses its category default check-in.
 *   mode 'permanent' — the home moves: repoint currentSite/currentJob and fix job
 *                      membership. This is the WORKER record only; a supervisor's
 *                      User.assignedSite (auth scope) is decoupled and admin-owned,
 *                      so it is deliberately NOT touched here.
 *
 * Runs inside the caller's mongoose session (a transaction). Does NOT notify — the
 * caller sends the arrival notification AFTER commit.
 */
import jobModel from "../models/jobModel.js"
import Attendance from "../models/attendanceModel.js"
import userModel from "../models/userModel.js"
import { recordAttendanceAudit } from "./attendanceAudit.js"

function todayAttendanceDate() {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d
}

export async function applyHandover({ employee, toSiteId, toJobId = null, mode, session }) {
  if (mode === "today") {
    employee.pendingTransferCheckIn = null
    employee.pendingTransferSiteId = toSiteId
    employee.pendingTransferFromSiteId = employee.currentSite
    employee.pendingTransferJobId = toJobId || null
    employee.pendingTransferDate = todayAttendanceDate()
    await employee.save({ session })
    return
  }

  // permanent
  const oldJobId = employee.currentJob
  if (oldJobId) {
    await jobModel.findByIdAndUpdate(oldJobId, { $pull: { employees: employee._id } }, { session })
  }
  employee.currentSite = toSiteId
  employee.currentJob = toJobId || null
  await employee.save({ session })
  if (toJobId) {
    await jobModel.findByIdAndUpdate(toJobId, { $addToSet: { employees: employee._id } }, { session })
  }
}

/**
 * Place a MIDDAY arrival — the single source of truth for the source-initiated
 * "Transfer" (a second session), carrying the source check-out forward as the
 * destination check-in. Used by BOTH the immediate admin path
 * (attendanceController.transferEmployee) and the accepted-request path
 * (requestController.acceptRequest for a "push" request).
 *
 * If the destination site already has ANY saved attendance today, the visitor's
 * session is pushed straight onto the employee's attendance doc; otherwise the
 * pendingTransfer* stash is written and the destination's draft consumes it when it
 * is next opened/submitted. For a permanent move (!onlyForToday) the home repoints
 * (currentSite/currentJob + Job.employees[] + the supervisor's User.assignedSite).
 *
 * Runs inside the caller's mongoose transaction. Throws Error with a `.status` for
 * the caller to surface. Returns { pending } — true when the stash path was taken.
 */
export async function placeMiddayArrival({
  employee,
  fromSiteId,
  toSiteId,
  jobId = null,
  carriedCheckIn,
  attendanceDate,
  onlyForToday,
  markedById,
  actor,
  session,
  attendanceDoc = null,
}) {
  const doc =
    attendanceDoc ||
    (await Attendance.findOne({ employee: employee._id, date: attendanceDate }).session(session))
  if (!doc) {
    const err = new Error("No attendance record found for this employee today")
    err.status = 400
    throw err
  }

  const targetHasSavedRecord = await Attendance.exists({
    date: attendanceDate,
    "sessions.siteId": toSiteId,
  }).session(session)

  if (targetHasSavedRecord) {
    const incompleteAtTarget = doc.sessions.find(
      (s) => s.siteId.toString() === toSiteId.toString() && (!s.checkIn || !s.checkOut)
    )
    if (incompleteAtTarget) {
      const err = new Error("Employee already has an incomplete session at the target site today")
      err.status = 400
      throw err
    }

    doc.sessions.push({
      siteId: toSiteId,
      jobId: jobId || null,
      checkIn: carriedCheckIn,
      checkOut: null,
      workedHours: 0,
      markedBy: markedById,
      transferredFromSiteId: fromSiteId,
    })

    await doc.save({ session })

    await recordAttendanceAudit({
      attendance: doc,
      actor,
      type: "transferred_in",
      summary: "Session added via transfer",
      session,
    })
  } else {
    employee.pendingTransferCheckIn = carriedCheckIn
    employee.pendingTransferSiteId = toSiteId
    employee.pendingTransferDate = attendanceDate
    employee.pendingTransferFromSiteId = fromSiteId
    // Carry the destination job so the visitor's session at the new site records it
    // (parity with the immediate-session branch above, which sets jobId directly).
    employee.pendingTransferJobId = jobId || null
  }

  // onlyForToday: the session is carried above (push / pendingTransfer stash), but the
  // employee's home is untouched — no currentSite/currentJob move, no job-membership
  // change, and (for a supervisor) no assignedSite change. They're visiting for the day
  // and return to their home site's roster tomorrow.
  if (!onlyForToday) {
    const oldJobId = employee.currentJob
    if (oldJobId) {
      await jobModel.findByIdAndUpdate(oldJobId, { $pull: { employees: employee._id } }, { session })
    }
    employee.currentJob = jobId || null
    employee.currentSite = toSiteId
  }

  await employee.save({ session })

  if (!onlyForToday && jobId) {
    await jobModel.findByIdAndUpdate(jobId, { $addToSet: { employees: employee._id } }, { session })
  }

  // Auth follows the home: a permanent move repoints the supervisor's assignedSite;
  // an only-for-today visit leaves it alone.
  if (!onlyForToday && employee.user) {
    await userModel.findByIdAndUpdate(employee.user, { assignedSite: toSiteId }, { session })
  }

  return { pending: !targetHasSavedRecord }
}
