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
