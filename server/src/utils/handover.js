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
import AttendanceLock from "../models/lockModel.js"
import userModel from "../models/userModel.js"
import { recordAttendanceAudit } from "./attendanceAudit.js"
import { getTodayLocal, combineFromOffset } from "./timeLocal.js"
import { categoryForEmployee } from "./collar.js"
import { dayCheckInFieldFor } from "./rosterFields.js"

// App-timezone business-day midnight — the anchor every attendance record and the
// pendingTransferDate stash use. Raw UTC midnight would resolve to the previous day in
// the early-morning window (e.g. 00:00–05:30 IST), stamping the visit on the wrong day
// so the destination draft never surfaces it.
function todayAttendanceDate() {
  return new Date(getTodayLocal())
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
 * The arrival is ALWAYS recorded now: the visitor's session is pushed straight onto the
 * employee's attendance doc (the source check-out becomes the destination check-in), so it
 * is durable and immediately visible in records/reports regardless of whether the
 * destination has submitted. When the destination is NOT locked, the pendingTransfer* stash
 * is ALSO written so that site's roster-built draft surfaces the visitor as an editable row;
 * its submit reconciles the pushed session in place (same-site sessions are replaced, not
 * duplicated). For a permanent move (!onlyForToday) the home repoints (currentSite/currentJob
 * + Job.employees[] + the supervisor's User.assignedSite).
 *
 * Runs inside the caller's mongoose transaction. Throws Error with a `.status` for
 * the caller to surface. Returns { pending } — true when the destination is unlocked (its
 * draft will also show the arrival), false when locked. The session is recorded either way.
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

  // "Has the destination LOCKED (submitted) today?" is the accurate signal for whether its
  // roster-built draft will rebuild — not "does any session exist at the site today". The
  // older proxy misread an unlocked site that had merely received an earlier arrival's
  // session as saved, which would push this session in with no stash and leave it invisible
  // in that site's draft. The lock is the true signal, and matches how a locked destination
  // shows saved records while an unlocked one shows a stash-driven draft.
  const targetLocked = !!(await AttendanceLock.findOne({
    siteId: toSiteId,
    date: attendanceDate,
    isLocked: true,
  }).session(session))

  // Never stack a second OPEN session at the destination (a completed earlier visit is fine).
  const incompleteAtTarget = doc.sessions.find(
    (s) => s.siteId.toString() === toSiteId.toString() && (!s.checkIn || !s.checkOut)
  )
  if (incompleteAtTarget) {
    const err = new Error("Employee already has an incomplete session at the target site today")
    err.status = 400
    throw err
  }

  // Record the arrival on the employee's doc NOW, whether or not the destination has locked.
  // The employee always has today's doc here (they were marked at the source), so we carry the
  // source check-out forward as an OPEN destination session — a continuous timeline. Previously
  // an UNLOCKED destination got only the pendingTransfer* stash, so the arrival had no record
  // until that site's draft was opened and submitted: invisible on an already-open page until a
  // refetch, absent from reports meanwhile, and lost if the site never marked attendance that
  // day. The locked and unlocked paths now agree on materialising the record.
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

  // UNLOCKED destination: ALSO write the pendingTransfer* stash so that site's roster-built
  // draft still surfaces the visitor as an editable row (the draft reads roster + stash, not
  // existing records). Its submit reconciles the session in place — same-site sessions are
  // replaced, not duplicated. A LOCKED destination has no draft to rebuild, so no stash.
  if (!targetLocked) {
    employee.pendingTransferCheckIn = carriedCheckIn
    employee.pendingTransferSiteId = toSiteId
    employee.pendingTransferDate = attendanceDate
    employee.pendingTransferFromSiteId = fromSiteId
    // Carry the destination job so the draft's visitor row records this site's job.
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

  return { pending: !targetLocked }
}

/**
 * Place a PRE-SAVE "Send to site" arrival (today OR permanent) when the destination's
 * attendance is ALREADY saved for today. The normal paths rely on the destination's
 * draft build to surface the arrival: a today-visit via applyHandover's pendingTransfer*
 * stash, a permanent move via the repointed currentSite roster row. But a saved/locked
 * day never rebuilds that draft, so the arrival would be orphaned with no record. Here we
 * instead create the arrival's record directly (mirroring placeMiddayArrival's
 * saved-destination branch), so they surface in the destination's saved view immediately.
 *
 * The session is OPEN (destination category default check-in, no check-out) — the
 * check-out is left for the auto-checkout cron / an admin edit, exactly like a draft row
 * the supervisor hadn't closed yet. This helper does NOT touch currentSite/currentJob and
 * writes NO pendingTransfer* stash; the caller owns any home repoint (applyHandover).
 *
 * `fromSiteId` is the source the employee is leaving, captured by the caller BEFORE a
 * permanent repoint overwrites employee.currentSite (it powers the destination record's
 * "Transferred from" badge). Falls back to employee.currentSite when not supplied.
 *
 * PUSH-OR-CREATE: the Send guard guarantees the employee is unmarked today, but a record
 * for {employee, today} may still exist (e.g. their home site already saved them
 * absent/sick). A brand-new doc would violate the unique {employee, date} index, so we
 * push onto the existing doc when present and only create a fresh one otherwise. The
 * employee is homed at the source, so any existing sessions are at the source site —
 * pushing a destination session yields a legitimate multi-site day, never a duplicate.
 *
 * Runs inside the caller's mongoose transaction. Returns the Attendance doc.
 */
export async function createPreSaveVisitRecord({
  employee,
  toSite,
  toJobId = null,
  fromSiteId = null,
  markedById,
  actor,
  session,
}) {
  const todayStr = getTodayLocal()
  const attendanceDate = new Date(todayStr)

  // Destination day check-in default for this employee's roster category (may be
  // unset on the site — then the session is created blank for manual entry).
  const checkInField = dayCheckInFieldFor(categoryForEmployee(employee))
  const checkInStr = checkInField ? toSite[checkInField] : null
  const checkInDate = checkInStr ? combineFromOffset(todayStr, checkInStr, false) : null

  const newSession = {
    siteId: toSite._id,
    jobId: toJobId || null,
    checkIn: checkInDate,
    checkOut: null,
    workedHours: 0,
    markedBy: markedById,
    transferredFromSiteId: fromSiteId ?? employee.currentSite,
  }

  let doc = await Attendance.findOne({ employee: employee._id, date: attendanceDate }).session(session)
  if (doc) {
    doc.sessions.push(newSession)
  } else {
    doc = new Attendance({
      employee: employee._id,
      date: attendanceDate,
      siteId: toSite._id,
      jobId: toJobId || null,
      markedBy: markedById,
      status: "absent",
      sessions: [newSession],
    })
  }

  await doc.save({ session })

  await recordAttendanceAudit({
    attendance: doc,
    actor,
    type: "transferred_in",
    summary: "Session added via send-to-site",
    session,
  })

  return doc
}
