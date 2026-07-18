/**
 * Propagate default shift time changes to existing attendance records.
 *
 * When an admin/supervisor changes a site's default check-in or check-out time
 * after values have been filled for the day, this utility updates matching
 * attendance records immediately.
 *
 * Three transitions are supported per field (see the matrix in the loop):
 *   update (A → B):  sessions whose current time equals the PREVIOUS default
 *                    are moved to the new default. Manually edited records
 *                    (different from the old default) are left untouched.
 *   clear  (A → ""): sessions whose current time equals the PREVIOUS default
 *                    are emptied. Check-ins are only cleared when there is no
 *                    check-out (never wipe worked data).
 *   fill   ("" → B): empty sessions are filled with the new default — EXCEPT
 *                    sessions flagged `manuallyCleared` (deliberate absence via
 *                    the Absent button) and sick-leave records. Check-outs are
 *                    only filled when the resulting time is already in the past
 *                    (mirrors the cron; never pre-credit future hours).
 *
 * Collar scoping: staff* fields only touch staff (white-collar) employees'
 * sessions; day/night fields exclude staff. There is NO fallback from staff
 * fields to the field-worker defaults.
 *
 * Overlap and validity checks are performed per-record before applying changes.
 */

import Attendance from '../models/attendanceModel.js';
import {
  getCurrentLocalTime,
  getTodayLocal,
  getDateLocal,
  combineDateAndTimeLocal,
  toLocalTimeString,
  getAppOffsetMinutes,
} from './timeLocal.js';
import { hasSessionOverlap } from './sessionOverlap.js';
import { computeAttendanceTotals } from './attendanceMath.js';
import { getStaffEmployeeIds } from './collar.js';
import { getCurrentCutoff, resolveCutoffForDate } from './cutoff.js';

/**
 * Determine the logical target date for a given field change.
 *
 * Night shift check-out targets:
 *   - yesterday's records if current local hour < cutoffHour (extended period)
 *   - today's records if current local hour >= cutoffHour
 *
 * All other fields target today's records.
 */
function getTargetDate(field, cutoffHour) {
  if (field === 'nightDefaultCheckOut' || field === 'staffNightDefaultCheckOut') {
    // Get current local hour
    const offset = getAppOffsetMinutes();
    const now = new Date();
    const localTime = new Date(now.getTime() - offset * 60 * 1000);
    const currentHour = localTime.getUTCHours();

    if (currentHour < cutoffHour) {
      // Extended period: we're still in the previous business day
      return getDateLocal(-1);
    }
    return getTodayLocal();
  }

  return getTodayLocal();
}

/**
 * Determine if a field targets night-shift sessions.
 */
function isNightField(field) {
  return (
    field === 'nightDefaultCheckIn' ||
    field === 'nightDefaultCheckOut' ||
    field === 'staffNightDefaultCheckIn' ||
    field === 'staffNightDefaultCheckOut'
  );
}

/**
 * Determine if a field is a staff (white-collar) default, which targets only
 * staff employees' sessions (day or night depending on the field).
 */
function isStaffField(field) {
  return (
    field === 'staffDefaultCheckIn' ||
    field === 'staffDefaultCheckOut' ||
    field === 'staffNightDefaultCheckIn' ||
    field === 'staffNightDefaultCheckOut'
  );
}

/**
 * Determine if a field is a check-in field (vs check-out).
 */
function isCheckInField(field) {
  return (
    field === 'defaultCheckIn' ||
    field === 'nightDefaultCheckIn' ||
    field === 'staffDefaultCheckIn' ||
    field === 'staffNightDefaultCheckIn'
  );
}

function skippedEntry(record, reason, field) {
  return {
    employeeId: record.employee?.employeeId || record.employee?._id?.toString() || '',
    employeeName: record.employee?.name || 'Unknown',
    reason,
    field,
  };
}

/**
 * Propagate default value changes to matching attendance records.
 *
 * @param {Object}  site          - The site document (already saved with new values,
 *                                  including its cutoffHistory — cutoffs are per-site)
 * @param {Object}  prevDefaults  - Previous default values before the change
 * @param {Object}  newDefaults   - New default values (same shape as prevDefaults)
 * @param {Object}  workConfig    - Work schedule config, used only for the pay numbers
 *                                  (fullDayHours, halfDayHours, overtimeThreshold)
 *
 * @returns {Object} { updated: number, skipped: Array<{ employeeId, employeeName, reason, field }> }
 */
export async function propagateDefaultChanges(site, prevDefaults, newDefaults, workConfig) {
  // Deciding WHICH day to propagate onto is a "now" question (are we in the extended
  // period?), so it uses the site's currently-active cutoff. Combining a time ONTO that day
  // is a per-day question, and is resolved separately below once the target date is known.
  // Note: `site` may already carry a freshly derived cutoff entry, but that entry is
  // effective from TOMORROW, so today's/yesterday's resolution below is unaffected.
  const currentCutoff = getCurrentCutoff(site);
  const fullDayHours = (workConfig && workConfig.fullDayHours) || 8;
  const halfDayHours = (workConfig && workConfig.halfDayHours) || 4;
  const overtimeThreshold = (workConfig && workConfig.overtimeThreshold) || 8;

  let totalUpdated = 0;
  const allSkipped = [];

  const fieldsToCheck = [
    'defaultCheckIn',
    'defaultCheckOut',
    'nightDefaultCheckIn',
    'nightDefaultCheckOut',
    'staffDefaultCheckIn',
    'staffDefaultCheckOut',
    'staffNightDefaultCheckIn',
    'staffNightDefaultCheckOut',
  ];

  // Any real difference counts — including empty→time (fill) and time→empty (clear).
  const changedFields = fieldsToCheck.filter((field) => {
    const oldVal = prevDefaults[field] || '';
    const newVal = newDefaults[field] || '';
    return oldVal !== newVal;
  });

  if (changedFields.length === 0) {
    return { updated: 0, skipped: [] };
  }

  // Staff (white-collar) employees. Staff-default changes only touch staff
  // sessions; field-worker (day/night) changes exclude staff so an identical
  // time value on a staff member isn't rewritten by the wrong default.
  const staffIds = await getStaffEmployeeIds();

  for (const field of changedFields) {
    const oldTimeStr = prevDefaults[field] || '';
    const newTimeStr = newDefaults[field] || '';
    const isNight = isNightField(field);
    const isStaff = isStaffField(field);
    const isCheckIn = isCheckInField(field);
    const transition =
      oldTimeStr && newTimeStr ? 'update' : oldTimeStr ? 'clear' : 'fill';
    const targetDateStr = getTargetDate(field, currentCutoff);

    // The cutoff in force on the day we're actually writing to — on a changeover morning
    // the night check-out target is yesterday, which may still be on the old cutoff.
    const cutoffHour = resolveCutoffForDate(site, targetDateStr);

    const targetDate = new Date(targetDateStr);
    targetDate.setUTCHours(0, 0, 0, 0);

    // Scope by collar: staff fields → only staff employees; field-worker
    // (day/night) fields → exclude staff employees.
    const employeeFilter = isStaff
      ? { employee: { $in: staffIds } }
      : { employee: { $nin: staffIds } };

    // Find attendance records for this site on the target date
    const records = await Attendance.find({
      date: targetDate,
      'sessions.siteId': site._id,
      ...employeeFilter,
    }).populate('employee', 'name employeeId');

    for (const record of records) {
      // Never fill anything on a sick-leave day.
      if (transition === 'fill' && record.isSickLeave) continue;

      let recordModified = false;

      for (const session of record.sessions) {
        // Only sessions belonging to this site
        if (session.siteId.toString() !== site._id.toString()) continue;

        // Only sessions matching the correct shift type
        if (isNight && session.isNightShift !== true) continue;
        if (!isNight && session.isNightShift === true) continue;

        if (isCheckIn) {
          // ---------- CHECK-IN FIELD ----------
          if (transition === 'fill') {
            // Only completely empty sessions, never deliberate absences.
            if (session.checkIn || session.checkOut) continue;
            if (session.manuallyCleared) continue;

            const newCheckInDate = combineDateAndTimeLocal(targetDateStr, newTimeStr, {
              isNightShift: isNight,
              cutoffHour,
            });

            const candidate = record.sessions.map((s) =>
              s._id.toString() === session._id.toString()
                ? { checkIn: newCheckInDate, checkOut: null }
                : { checkIn: s.checkIn, checkOut: s.checkOut }
            );

            if (hasSessionOverlap(candidate)) {
              allSkipped.push(skippedEntry(record, 'overlap', field));
              continue;
            }

            session.checkIn = newCheckInDate;
            session.manuallyCleared = false;
            recordModified = true;
            continue;
          }

          // update / clear both require the current value to equal the old default
          if (!session.checkIn) continue;
          if (toLocalTimeString(session.checkIn) !== oldTimeStr) continue;

          if (transition === 'clear') {
            // Never wipe worked data — only clear check-in-only sessions.
            if (session.checkOut) continue;
            session.checkIn = null;
            session.workedHours = 0;
            // Cleared by a default change, NOT a deliberate absence: leave the
            // flag false so a future default can refill this session.
            session.manuallyCleared = false;
            recordModified = true;
            continue;
          }

          // transition === 'update'
          const prevCheckIn = session.checkIn;
          const newCheckInDate = combineDateAndTimeLocal(targetDateStr, newTimeStr, {
            isNightShift: isNight,
            cutoffHour,
          });

          const candidate = record.sessions.map((s) =>
            s._id.toString() === session._id.toString()
              ? { checkIn: newCheckInDate, checkOut: s.checkOut }
              : { checkIn: s.checkIn, checkOut: s.checkOut }
          );

          if (hasSessionOverlap(candidate)) {
            allSkipped.push(skippedEntry(record, 'overlap', field));
            continue;
          }

          session.checkIn = newCheckInDate;

          // Recalculate workedHours if checkOut exists
          if (session.checkOut) {
            const workedHours =
              (new Date(session.checkOut).getTime() - newCheckInDate.getTime()) /
              (1000 * 60 * 60);

            if (!(workedHours > 0 && workedHours <= 24)) {
              allSkipped.push(skippedEntry(record, 'invalid_hours', field));
              session.checkIn = prevCheckIn; // revert
              continue;
            }

            session.workedHours = Number(workedHours.toFixed(2));
          }

          recordModified = true;
        } else {
          // ---------- CHECK-OUT FIELD ----------
          if (transition === 'fill') {
            // Only open sessions (checked in, not out).
            if (!session.checkIn || session.checkOut) continue;

            const checkInTimeStr = toLocalTimeString(session.checkIn);
            const newCheckOutDate = combineDateAndTimeLocal(targetDateStr, newTimeStr, {
              referenceCheckIn: checkInTimeStr,
              isNightShift: isNight,
              cutoffHour,
            });

            // Never pre-credit hours: only fill when the check-out time has
            // already passed (the cron handles the future case at that time).
            if (newCheckOutDate.getTime() > Date.now()) continue;

            const workedHours =
              (newCheckOutDate.getTime() - new Date(session.checkIn).getTime()) /
              (1000 * 60 * 60);

            if (!(workedHours > 0 && workedHours <= 24)) {
              allSkipped.push(skippedEntry(record, 'invalid_hours', field));
              continue;
            }

            const candidate = record.sessions.map((s) =>
              s._id.toString() === session._id.toString()
                ? { checkIn: s.checkIn, checkOut: newCheckOutDate }
                : { checkIn: s.checkIn, checkOut: s.checkOut }
            );

            if (hasSessionOverlap(candidate)) {
              allSkipped.push(skippedEntry(record, 'overlap', field));
              continue;
            }

            session.checkOut = newCheckOutDate;
            session.workedHours = Number(workedHours.toFixed(2));
            recordModified = true;
            continue;
          }

          // update / clear both require the current value to equal the old default
          if (!session.checkOut) continue;
          if (toLocalTimeString(session.checkOut) !== oldTimeStr) continue;

          if (transition === 'clear') {
            // Session goes back to open (checked in, awaiting check-out).
            session.checkOut = null;
            session.workedHours = 0;
            recordModified = true;
            continue;
          }

          // transition === 'update'
          if (!session.checkIn) continue;

          const checkInTimeStr = toLocalTimeString(session.checkIn);
          const newCheckOutDate = combineDateAndTimeLocal(targetDateStr, newTimeStr, {
            referenceCheckIn: checkInTimeStr,
            isNightShift: isNight,
            cutoffHour,
          });

          const workedHours =
            (newCheckOutDate.getTime() - new Date(session.checkIn).getTime()) /
            (1000 * 60 * 60);

          if (!(workedHours > 0 && workedHours <= 24)) {
            allSkipped.push(skippedEntry(record, 'invalid_hours', field));
            continue;
          }

          const candidate = record.sessions.map((s) =>
            s._id.toString() === session._id.toString()
              ? { checkIn: s.checkIn, checkOut: newCheckOutDate }
              : { checkIn: s.checkIn, checkOut: s.checkOut }
          );

          if (hasSessionOverlap(candidate)) {
            allSkipped.push(skippedEntry(record, 'overlap', field));
            continue;
          }

          session.checkOut = newCheckOutDate;
          session.workedHours = Number(workedHours.toFixed(2));
          recordModified = true;
        }
      }

      if (recordModified) {
        // Recalculate record-level totals via the shared pay-math helper
        // (breaks, OT, holiday hours all consistent with the controller).
        const rawHours = record.sessions.reduce(
          (sum, s) => sum + (s.workedHours || 0),
          0
        );

        const { netWorkHours, status, overtimeHours, holidayHours } = computeAttendanceTotals(
          rawHours,
          { fullDayHours, halfDayHours, overtimeThreshold, breakDurationMinutes: (workConfig && workConfig.breakDurationMinutes) || 0 },
          record.breaksTaken ?? null,
          { isHoliday: record.isHoliday, reason: record.holidayReason }
        );

        record.totalWorkHours = netWorkHours;
        record.status = status;
        record.overtimeHours = overtimeHours;
        record.holidayHours = holidayHours;

        await record.save();
        totalUpdated++;
      }
    }
  }

  return { updated: totalUpdated, skipped: allSkipped };
}
