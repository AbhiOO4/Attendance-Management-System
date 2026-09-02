import Employee from '../models/empModel.js';
import { getDateLocal } from './timeLocal.js';

/**
 * Cross-site carryover access exception for supervisors.
 *
 * A supervisor is normally confined to their `assignedSite` (the inline checks in
 * getAttendanceById / updateAttendance require `assignedSite === siteId`). This grants
 * the narrow ADDITIONAL right to read/close another site's *dangling open shift* — the
 * "employee-scoped carryover" flow — but only when ALL of the following hold:
 *
 *   1. the target `siteId` genuinely has an OPEN session (check-in, no check-out) on
 *      this record — otherwise it is not a carryover and the normal same-site rule stands;
 *   2. the record's business day is BEFORE today (a real carryover, not today's live board);
 *   3. the employee is now on the supervisor's own roster (`currentSite === assignedSite`),
 *      i.e. they have since moved to the supervisor's site and dragged the open shift along.
 *
 * Admins/superadmins never reach this — they bypass the site check entirely at the call
 * site. Effect boundary: a supervisor can only reach another site's sessions for an
 * employee now on their roster, on a prior-day record that actually has a dangling shift —
 * never arbitrary other-site data.
 *
 * @param {object} record        the Attendance mongoose doc (needs `sessions[]`, `date`, `employee`)
 * @param {string} assignedSite  the supervisor's assignedSite id
 * @param {string} siteId        the target site id being accessed
 * @returns {Promise<boolean>}   true when the exception applies
 */
export async function supervisorMayCloseCarryover(record, assignedSite, siteId) {
  if (!record || !assignedSite || !siteId) return false;

  // (1) The target site must have an OPEN session on this record.
  const hasOpenAtSite = (record.sessions || []).some(
    (s) => s.siteId?.toString() === siteId.toString() && s.checkIn && !s.checkOut
  );
  if (!hasOpenAtSite) return false;

  // (2) Must be a prior business day. `date` is stored as UTC-midnight of the local
  // business day, so its ISO date part is that day string — a plain string compare works.
  const recordDateStr = new Date(record.date).toISOString().split('T')[0];
  if (recordDateStr >= getDateLocal(0)) return false;

  // (3) The employee must now be on the supervisor's roster (home site === their site).
  const employee = await Employee.findById(record.employee).select('currentSite');
  if (!employee || !employee.currentSite) return false;

  return employee.currentSite.toString() === assignedSite.toString();
}
