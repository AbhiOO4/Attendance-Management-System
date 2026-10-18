import Attendance from '../models/attendanceModel.js';
import { toLocalTimeString, MAX_SHIFT_HOURS } from './timeLocal.js';

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
 * A session with a check-in but no check-out yet (the usual state of a morning save — the
 * check-out comes later, often from the auto-checkout cron) is compared as an INSTANT at its
 * check-in, on either side: a 06:00 check-in inside last night's 19:00→08:00 is a conflict,
 * an 08:00 check-in (the exact end) is a continuation and passes. Two open sessions have no
 * intervals to compare.
 *
 * `{ blockOpenPrevious: true }` (per call; today's sheet submit, for the sessions it writes): a
 * session still OPEN on the previous day means the employee may still be on that shift, so
 * any check-in after it (within MAX_SHIFT_HOURS) is refused until it is closed — the server
 * side of the client's carryover rule.
 *
 * Batched: one query for every employee being written, then a pure in-memory test per
 * employee. Returns `(employeeId, candidateSessions, opts?) => conflict | null`, where a
 * conflict is `{ kind, day, checkIn, checkOut }` describing the already-recorded session that
 * collides. `kind`: 'overlap' (closed session), 'checkin' (a stored check-in with no
 * check-out yet falls inside the candidate), 'open' (blockOpenPrevious).
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

  return (employeeId, candidateSessions, { blockOpenPrevious = false } = {}) => {
    const records = byEmployee.get(String(employeeId));
    if (!records || records.length === 0) return null;

    for (const rec of records) {
      const isPrevious = new Date(rec.date).getTime() === prevDate.getTime();
      for (const stored of rec.sessions || []) {
        if (!stored.checkIn) continue;
        const stored_ = toSpan(stored);

        for (const candidate of candidateSessions || []) {
          if (!candidate.checkIn) continue;
          const cand = toSpan(candidate);

          let kind = null;
          if (spansCollide(stored_, cand)) {
            kind = stored_.open ? 'checkin' : 'overlap';
          } else if (
            blockOpenPrevious &&
            isPrevious &&
            stored_.open &&
            cand.start >= stored_.start &&
            cand.start - stored_.start <= MAX_SHIFT_HOURS * HOUR_MS
          ) {
            kind = 'open';
          }

          if (kind) {
            return {
              kind,
              day: new Date(rec.date).toISOString().split('T')[0],
              checkIn: stored.checkIn,
              checkOut: stored.checkOut || null,
            };
          }
        }
      }
    }
    return null;
  };
}

const HOUR_MS = 60 * 60 * 1000;

// A session as a span; an open one (no check-out) is the instant at its check-in.
function toSpan(s) {
  const start = new Date(s.checkIn).getTime();
  return s.checkOut
    ? { start, end: new Date(s.checkOut).getTime(), open: false }
    : { start, end: start, open: true };
}

// Two closed spans overlap when they share any time (touching ends is fine). An instant
// collides with a closed span when it falls inside [start, end). Two instants never do.
function spansCollide(a, b) {
  if (a.open && b.open) return false;
  if (a.open) return a.start >= b.start && a.start < b.end;
  if (b.open) return b.start >= a.start && b.start < a.end;
  return a.start < b.end && a.end > b.start;
}

/**
 * Human-readable message for a conflict returned by the cross-day checker. `who` names the
 * employee on multi-employee writes (a whole sheet), so the supervisor knows which row.
 */
export function crossDayOverlapMessage(conflict, who = null) {
  const lead = who ? `${who}: these times` : 'These times';
  const forWhom = who ? '' : ' for this employee';
  const at = toLocalTimeString(conflict.checkIn);
  if (conflict.kind === 'open') {
    return (
      `${who || 'This employee'} still has an open session from ${conflict.day} (checked in ` +
      `${at}, no check-out). Close that session before recording these times.`
    );
  }
  if (conflict.kind === 'checkin') {
    return (
      `${lead} cover a check-in already recorded${forWhom} on ` +
      `${conflict.day} at ${at}. The same hours cannot be paid twice.`
    );
  }
  return (
    `${lead} overlap a session already recorded${forWhom} on ` +
    `${conflict.day} (${at}–${toLocalTimeString(conflict.checkOut)}). ` +
    `The same hours cannot be paid twice.`
  );
}
