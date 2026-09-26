/**
 * Who belongs on a site's attendance DRAFT for a business day.
 *
 * The Site Attendance page builds its draft from `GET /api/employees?site=` plus the paid-leave
 * list, then filters it (client/src/pages/SiteAttendance.tsx → loadRosterContext). The submit
 * endpoint used to trust whatever list the client posted, so a draft loaded before a roster
 * change silently created no record for a newly-added employee (and a phantom one for someone
 * who had left). `computeExpectedDraftRoster` is the server's copy of that same filter, used by
 * siteFirstSubmitAttendance to refuse a submit whose employee set no longer matches.
 *
 * KEEP IN SYNC with the client filter in SiteAttendance.tsx (loadRosterContext). A mismatch
 * would refuse every submit for the affected site.
 */
import empModel from "../models/empModel.js"
import attendanceModel from "../models/attendanceModel.js"
import siteModel from "../models/siteModel.js"

/**
 * Serialize a draft submit against roster moves touching the same site. Transactions don't
 * conflict on reads, so a submit already in flight could lock a site against the roster it read
 * just before a move committed — the destination then misses the arrival (no record), or the
 * source records them at home too. Both sides bump the site's `rosterRev` inside their
 * transaction; overlapping transactions then write the same Site doc and one aborts with a
 * WriteConflict (see isWriteConflict). `timestamps: false` keeps Site.updatedAt meaningful.
 */
export async function touchSiteRosters(siteIds, session) {
  const ids = [...new Set(siteIds.filter(Boolean).map(String))]
  if (!ids.length) return
  await siteModel.updateMany(
    { _id: { $in: ids } },
    { $inc: { rosterRev: 1 } },
    { session, timestamps: false }
  )
}

/** A transaction aborted because a concurrent one wrote the same document — safe to retry. */
export function isWriteConflict(error) {
  return !!(
    error?.hasErrorLabel?.("TransientTransactionError") ||
    error?.errorLabels?.includes?.("TransientTransactionError") ||
    error?.code === 112
  )
}

// pendingTransferSiteId is a raw ObjectId on most reads but a populated subdoc on the
// Manage-Employees roster read — resolve both.
const refIdOf = (v) => (v == null ? null : String(v._id ?? v))
const dayStrOf = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null)

/**
 * Employees (of `employees`) who have a session at a site OTHER than `anchorSiteId` on
 * `todayStr`'s record and none at the anchor — the durable "working elsewhere today" signal,
 * which survives the pendingTransfer* stash being consumed when the visited site saves.
 * Employees being placed AT the anchor today (stash points here) are arriving, not away.
 *
 * Returns Map<employeeId, otherSiteId>.
 */
export async function findRecordedElsewhere({ employees, anchorSiteId, todayStr, session = null }) {
  const anchor = String(anchorSiteId)
  const atts = await attendanceModel
    .find({ employee: { $in: employees.map((e) => e._id) }, date: new Date(todayStr) }, "employee sessions")
    .session(session)
    .lean()

  const inboundHere = new Set(
    employees
      .filter(
        (e) =>
          refIdOf(e.pendingTransferSiteId) === anchor &&
          e.pendingTransferDate &&
          dayStrOf(e.pendingTransferDate) === todayStr
      )
      .map((e) => String(e._id))
  )

  const elsewhereByEmp = new Map()
  for (const a of atts) {
    if (inboundHere.has(String(a.employee))) continue // arriving here today, not "elsewhere"
    const sessions = a.sessions || []
    if (sessions.some((s) => String(s.siteId) === anchor)) continue // a real multi-site day
    const other = sessions.find((s) => s.siteId && String(s.siteId) !== anchor)
    if (other) elsewhereByEmp.set(String(a.employee), String(other.siteId))
  }
  return elsewhereByEmp
}

/**
 * The employees a site's draft must contain on `dateStr` ("YYYY-MM-DD", the current business
 * day — recordedElsewhere is only meaningful for today). Mirrors the client:
 *   - active employees whose currentSite OR pendingTransferSiteId is this site;
 *   - minus anyone with approved paid leave that day;
 *   - home members, unless visiting another site today (stash) or recorded elsewhere today;
 *   - visitors to this site whose stash is dated today.
 *
 * Returns Map<employeeId, { _id, name, employeeId }>.
 */
export async function computeExpectedDraftRoster({ siteId, dateStr, session = null }) {
  const site = String(siteId)

  const employees = await empModel
    .find(
      { isActive: true, $or: [{ currentSite: siteId }, { pendingTransferSiteId: siteId }] },
      "_id name employeeId currentSite pendingTransferSiteId pendingTransferDate"
    )
    .session(session)
    .lean()

  const elsewhere = await findRecordedElsewhere({ employees, anchorSiteId: siteId, todayStr: dateStr, session })

  const dayStart = new Date(dateStr)
  const dayEnd = new Date(dateStr)
  dayEnd.setUTCHours(23, 59, 59, 999)
  const leaveIds = new Set(
    (
      await attendanceModel
        .distinct("employee", { isPaidLeave: true, date: { $gte: dayStart, $lte: dayEnd } })
        .session(session)
    ).map(String)
  )

  const expected = new Map()
  for (const emp of employees) {
    const id = String(emp._id)
    if (leaveIds.has(id)) continue

    const pendingSite = refIdOf(emp.pendingTransferSiteId)
    const stashIsToday = dayStrOf(emp.pendingTransferDate) === dateStr

    if (refIdOf(emp.currentSite) === site) {
      const visitingElsewhere = !!pendingSite && pendingSite !== site && stashIsToday
      if (visitingElsewhere || elsewhere.has(id)) continue
    } else if (!(pendingSite === site && stashIsToday)) {
      continue
    }
    expected.set(id, { _id: id, name: emp.name, employeeId: emp.employeeId })
  }
  return expected
}
