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
  combineFromOffset,
  deriveOffsets,
  toLocalTimeString,
  getAppOffsetMinutes,
  MAX_SHIFT_HOURS,
} from './timeLocal.js';
import { hasSessionOverlap } from './sessionOverlap.js';
import { computeAttendanceTotals } from './attendanceMath.js';
import { getEmployeeIdsByCategory } from './collar.js';
import { FIELD_META } from './rosterFields.js';
import { buildAuditRow, recordAttendanceAuditBatch } from './attendanceAudit.js';
import { buildSiteActivityRow, recordSiteActivityBatch } from './siteActivity.js';

/**
 * Determine the target business day for a given field change.
 *
 * A night shift's check-out lands the MORNING AFTER the record's own business day, so a
 * night check-out default targets whichever business day's night shift is currently
 * ending: in the morning that is yesterday's record, from noon onward it is today's.
 * Noon is the same morning/afternoon boundary the carryover UI uses.
 *
 * All other fields target today's records.
 */
function getTargetDate(field) {
  const meta = FIELD_META[field];
  if (meta && meta.night && !meta.checkIn) {
    const offset = getAppOffsetMinutes();
    const localTime = new Date(Date.now() - offset * 60 * 1000);
    if (localTime.getUTCHours() < 12) {
      // Morning: the night shift ending now belongs to yesterday's record.
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
  return !!(FIELD_META[field] && FIELD_META[field].night);
}

/**
 * Determine if a field is a check-in field (vs check-out).
 */
function isCheckInField(field) {
  return !!(FIELD_META[field] && FIELD_META[field].checkIn);
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
 * @param {Object}  site          - The site document (already saved with new values)
 * @param {Object}  prevDefaults  - Previous default values before the change
 * @param {Object}  newDefaults   - New default values (same shape as prevDefaults)
 * @param {Object}  workConfig    - Work schedule config, used only for the pay numbers
 *                                  (fullDayHours, halfDayHours, overtimeThreshold)
 * @param {Object}  actor         - { actorId, actorName } from resolveActor (the admin who
 *                                  changed the default); used only to attribute the logs.
 *
 * @returns {Object} { updated: number, skipped: Array<{ employeeId, employeeName, reason, field }> }
 */
export async function propagateDefaultChanges(site, prevDefaults, newDefaults, workConfig, actor = null) {
  const fullDayHours = (workConfig && workConfig.fullDayHours) || 8;
  const halfDayHours = (workConfig && workConfig.halfDayHours) || 4;
  const overtimeThreshold = (workConfig && workConfig.overtimeThreshold) || 8;

  let totalUpdated = 0;
  const allSkipped = [];

  // Activity trail (check-OUT changes only): a per-record edit-log row and a per-employee
  // site-feed row for each record a default change actually rewrites. Best-effort, written
  // once at the end so the propagation itself never depends on the logging succeeding.
  const auditRows = [];
  const activityRows = [];

  const fieldsToCheck = Object.keys(FIELD_META);

  // Any real difference counts — including empty→time (fill) and time→empty (clear).
  const changedFields = fieldsToCheck.filter((field) => {
    const oldVal = prevDefaults[field] || '';
    const newVal = newDefaults[field] || '';
    return oldVal !== newVal;
  });

  if (changedFields.length === 0) {
    return { updated: 0, skipped: [] };
  }

  // Roster categories: each field only ever touches its own category's
  // employees, so a category is never rewritten by another's default and the
  // two same-collar Foreign/Omani categories can't leak into each other.
  const employeeIdsByCategory = await getEmployeeIdsByCategory();

  for (const field of changedFields) {
    const oldTimeStr = prevDefaults[field] || '';
    const newTimeStr = newDefaults[field] || '';
    const isNight = isNightField(field);
    const isCheckIn = isCheckInField(field);
    const transition =
      oldTimeStr && newTimeStr ? 'update' : oldTimeStr ? 'clear' : 'fill';
    const targetDateStr = getTargetDate(field);

    // Human-readable line for the logs — check-OUT fields only (see scope above).
    const changeSummary = isCheckIn
      ? ''
      : transition === 'update'
        ? `Check-out updated to ${newTimeStr} by site default change (was ${oldTimeStr})`
        : transition === 'fill'
          ? `Check-out ${newTimeStr} filled from site default`
          : 'Check-out cleared by site default change';

    const targetDate = new Date(targetDateStr);
    targetDate.setUTCHours(0, 0, 0, 0);

    // Scope to exactly this field's roster category.
    const employeeFilter = { employee: { $in: employeeIdsByCategory[FIELD_META[field].category] } };

    // Find attendance records for this site on the target date
    const records = await Attendance.find({
      date: targetDate,
      'sessions.siteId': site._id,
      ...employeeFilter,
    }).populate('employee', 'name employeeId');

    // The site feed gets ONE summary row per field change (not per record); the
    // per-record audit log stays per record. Count the records this field actually rewrote.
    let fieldUpdatedCount = 0;

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

            // Cutoff-free: a check-in default (day or night) is a time on the record's
            // own business day, so it always combines with offset 0.
            const newCheckInDate = combineFromOffset(targetDateStr, newTimeStr, false);

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
          const newCheckInDate = combineFromOffset(targetDateStr, newTimeStr, false);

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

            if (!(workedHours > 0 && workedHours <= MAX_SHIFT_HOURS)) {
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
            // Cutoff-free: the check-out rolls to the next day exactly when it reads
            // earlier than the session's check-in.
            const { checkOutNextDay: fillNextDay } = deriveOffsets(checkInTimeStr, newTimeStr, !!session.checkInNextDay);
            const newCheckOutDate = combineFromOffset(targetDateStr, newTimeStr, fillNextDay);

            // Never pre-credit hours: only fill when the check-out time has
            // already passed (the cron handles the future case at that time).
            if (newCheckOutDate.getTime() > Date.now()) continue;

            const workedHours =
              (newCheckOutDate.getTime() - new Date(session.checkIn).getTime()) /
              (1000 * 60 * 60);

            if (!(workedHours > 0 && workedHours <= MAX_SHIFT_HOURS)) {
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
          const { checkOutNextDay: updNextDay } = deriveOffsets(checkInTimeStr, newTimeStr, !!session.checkInNextDay);
          const newCheckOutDate = combineFromOffset(targetDateStr, newTimeStr, updNextDay);

          const workedHours =
            (newCheckOutDate.getTime() - new Date(session.checkIn).getTime()) /
            (1000 * 60 * 60);

          if (!(workedHours > 0 && workedHours <= MAX_SHIFT_HOURS)) {
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

        // Per-record edit log for check-out default changes (one row per affected record).
        if (!isCheckIn) {
          auditRows.push(buildAuditRow(record, actor, 'default_propagated', changeSummary));
          fieldUpdatedCount++;
        }
      }
    }

    // Site feed: a single summary row for this field's change (not one per record).
    if (!isCheckIn && fieldUpdatedCount > 0) {
      activityRows.push(
        buildSiteActivityRow({
          type: 'default_propagated',
          actor,
          siteId: site._id,
          summary: `${changeSummary} · ${fieldUpdatedCount} record${fieldUpdatedCount === 1 ? '' : 's'}`,
          dateLocal: targetDateStr,
        })
      );
    }
  }

  // Best-effort trail writes — never affect the propagation result.
  await recordAttendanceAuditBatch(auditRows);
  await recordSiteActivityBatch(activityRows);

  return { updated: totalUpdated, skipped: allSkipped };
}
