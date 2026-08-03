import Attendance from '../models/attendanceModel.js';
import { toLocalTimeString } from './timeLocal.js';

/**
 * In-memory dry-run overlap detection for attendance sessions.
 *
 * Sessions without a checkIn are ignored. A session that has a checkIn but no
 * checkOut is treated as an instant at checkIn. Returns true if any two
 * sessions overlap in time.
 *
 * Used by the auto check-in / check-out crons to validate a proposed time
 * before persisting it, mirroring the overlap checks done on manual submits.
 */
export function hasSessionOverlap(sessions) {
  const intervals = sessions
    .filter((s) => s.checkIn)
    .map((s) => {
      const start = new Date(s.checkIn).getTime();
      const end = s.checkOut ? new Date(s.checkOut).getTime() : start;
      return { start, end };
    })
    .sort((a, b) => a.start - b.start);

  for (let i = 0; i < intervals.length - 1; i++) {
    const a = intervals[i];
    const b = intervals[i + 1];
    if (a.start < b.end && a.end > b.start) {
      return true;
    }
  }

  return false;
}

/**
 * CROSS-DAY overlap detection.
 *
 * A session is anchored to its record's business day but can extend past midnight (an
 * explicit day offset), so two sessions that collide in real time may live on DIFFERENT
 * attendance records — e.g. a night shift on the 19th running to 08:00, versus a day shift
 * on the 20th starting at 06:00. The within-record overlap check cannot see that pair, so
 * without this guard the same hours could be recorded (and paid) twice.
 *
 * Only the NEIGHBOURING days need checking: a session may not exceed MAX_SHIFT_HOURS, so it
 * can never reach beyond the adjacent calendar days. The record's own day is excluded — that
 * is what the within-record check already covers.
 *
 * Batched: one query for every employee being written, then a pure in-memory test per
 * employee. Returns `(employeeId, candidateSessions) => conflict | null`, where a conflict is
 * `{ day, checkIn, checkOut }` describing the already-recorded session that collides.
 */
export async function buildCrossDayOverlapChecker({ employeeIds, date, dbSession = null }) {
  const anchor = new Date(date);
  anchor.setUTCHours(0, 0, 0, 0);
  const prevDate = new Date(anchor);
  prevDate.setUTCDate(prevDate.getUTCDate() - 1);
  const nextDate = new Date(anchor);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);

  const ids = [...new Set((employeeIds || []).filter(Boolean).map(String))];

  let neighbours = [];
  if (ids.length > 0) {
    let query = Attendance.find({
      employee: { $in: ids },
      date: { $in: [prevDate, nextDate] },
    })
      .select('employee date sessions.checkIn sessions.checkOut')
      .lean();
    if (dbSession) query = query.session(dbSession);
    neighbours = await query;
  }

  const byEmployee = new Map();
  for (const rec of neighbours) {
    const key = String(rec.employee);
    if (!byEmployee.has(key)) byEmployee.set(key, []);
    byEmployee.get(key).push(rec);
  }

  return (employeeId, candidateSessions) => {
    const records = byEmployee.get(String(employeeId));
    if (!records || records.length === 0) return null;

    for (const rec of records) {
      for (const stored of rec.sessions || []) {
        // An open session (no check-out) has no interval yet — nothing to collide with.
        if (!stored.checkIn || !stored.checkOut) continue;
        const nStart = new Date(stored.checkIn).getTime();
        const nEnd = new Date(stored.checkOut).getTime();

        for (const candidate of candidateSessions || []) {
          if (!candidate.checkIn || !candidate.checkOut) continue;
          const cStart = new Date(candidate.checkIn).getTime();
          const cEnd = new Date(candidate.checkOut).getTime();

          if (cStart < nEnd && cEnd > nStart) {
            return {
              day: new Date(rec.date).toISOString().split('T')[0],
              checkIn: stored.checkIn,
              checkOut: stored.checkOut,
            };
          }
        }
      }
    }
    return null;
  };
}

/**
 * Human-readable message for a conflict returned by the cross-day checker.
 */
export function crossDayOverlapMessage(conflict) {
  return (
    `These times overlap a session already recorded for this employee on ${conflict.day} ` +
    `(${toLocalTimeString(conflict.checkIn)}–${toLocalTimeString(conflict.checkOut)}). ` +
    `The same hours cannot be paid twice.`
  );
}
