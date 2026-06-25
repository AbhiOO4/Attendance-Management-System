/**
 * Propagate default shift time changes to existing attendance records.
 *
 * When an admin/supervisor changes a site's default check-in or check-out time
 * after the cron has already auto-filled values for the day, this utility
 * updates matching attendance records immediately.
 *
 * Matching rule: only sessions whose current time value equals the PREVIOUS
 * default are updated. Manually edited records (different from the old default)
 * are left untouched.
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
  if (field === 'nightDefaultCheckOut') {
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
  return field === 'nightDefaultCheckIn' || field === 'nightDefaultCheckOut';
}

/**
 * Determine if a field is a check-in field (vs check-out).
 */
function isCheckInField(field) {
  return field === 'defaultCheckIn' || field === 'nightDefaultCheckIn';
}

/**
 * Propagate default value changes to matching attendance records.
 *
 * @param {Object}  site          - The site document (already saved with new values)
 * @param {Object}  prevDefaults  - Previous default values before the change:
 *                                  { defaultCheckIn, defaultCheckOut,
 *                                    nightDefaultCheckIn, nightDefaultCheckOut }
 * @param {Object}  newDefaults   - New default values (same shape as prevDefaults)
 * @param {Object}  workConfig    - Work schedule config (fullDayHours, halfDayHours,
 *                                  overtimeThreshold, nightShiftCutoffHour)
 *
 * @returns {Object} { updated: number, skipped: Array<{ employeeId, employeeName, reason, field }> }
 */
export async function propagateDefaultChanges(site, prevDefaults, newDefaults, workConfig) {
  const cutoffHour = (workConfig && workConfig.nightShiftCutoffHour) || 7;
  const fullDayHours = (workConfig && workConfig.fullDayHours) || 8;
  const halfDayHours = (workConfig && workConfig.halfDayHours) || 4;
  const overtimeThreshold = (workConfig && workConfig.overtimeThreshold) || 8;

  let totalUpdated = 0;
  const allSkipped = [];

  // Determine which fields actually changed
  const fieldsToCheck = [
    'defaultCheckIn',
    'defaultCheckOut',
    'nightDefaultCheckIn',
    'nightDefaultCheckOut',
  ];

  const changedFields = fieldsToCheck.filter((field) => {
    const oldVal = prevDefaults[field] || '';
    const newVal = newDefaults[field] || '';
    // A real change: old was non-empty AND new is non-empty AND they differ
    // If old was empty, the cron never filled anything → nothing to propagate
    // If new is empty, user is clearing the default → Case 3: do nothing
    return oldVal !== '' && newVal !== '' && oldVal !== newVal;
  });

  if (changedFields.length === 0) {
    return { updated: 0, skipped: [] };
  }

  for (const field of changedFields) {
    const oldTimeStr = prevDefaults[field];
    const newTimeStr = newDefaults[field];
    const isNight = isNightField(field);
    const isCheckIn = isCheckInField(field);
    const targetDateStr = getTargetDate(field, cutoffHour);

    const targetDate = new Date(targetDateStr);
    targetDate.setUTCHours(0, 0, 0, 0);

    // Find attendance records for this site on the target date
    const records = await Attendance.find({
      date: targetDate,
      'sessions.siteId': site._id,
    }).populate('employee', 'name employeeId');

    for (const record of records) {
      let recordModified = false;

      for (const session of record.sessions) {
        // Only sessions belonging to this site
        if (session.siteId.toString() !== site._id.toString()) continue;

        // Only sessions matching the correct shift type
        if (isNight && session.isNightShift !== true) continue;
        if (!isNight && session.isNightShift === true) continue;

        // Determine the session field to check/update
        const currentDateValue = isCheckIn ? session.checkIn : session.checkOut;

        // Skip if the field is empty (cron hasn't filled it yet)
        if (!currentDateValue) continue;

        // Compare the time portion of the stored Date against the old default
        const currentTimeStr = toLocalTimeString(currentDateValue);
        if (currentTimeStr !== oldTimeStr) continue;

        // --- This session matches: compute the new Date value ---

        if (isCheckIn) {
          // Updating check-in
          const newCheckInDate = combineDateAndTimeLocal(targetDateStr, newTimeStr, {
            isNightShift: isNight,
            cutoffHour,
          });

          // Build candidate sessions for overlap check
          const candidate = record.sessions.map((s) =>
            s._id.toString() === session._id.toString()
              ? { checkIn: newCheckInDate, checkOut: s.checkOut }
              : { checkIn: s.checkIn, checkOut: s.checkOut }
          );

          if (hasSessionOverlap(candidate)) {
            allSkipped.push({
              employeeId: record.employee?.employeeId || record.employee?._id?.toString() || '',
              employeeName: record.employee?.name || 'Unknown',
              reason: 'overlap',
              field,
            });
            continue;
          }

          session.checkIn = newCheckInDate;

          // Recalculate workedHours if checkOut exists
          if (session.checkOut) {
            const workedHours =
              (new Date(session.checkOut).getTime() - newCheckInDate.getTime()) /
              (1000 * 60 * 60);

            if (!(workedHours > 0 && workedHours <= 24)) {
              allSkipped.push({
                employeeId: record.employee?.employeeId || record.employee?._id?.toString() || '',
                employeeName: record.employee?.name || 'Unknown',
                reason: 'invalid_hours',
                field,
              });
              // Revert
              session.checkIn = currentDateValue;
              continue;
            }

            session.workedHours = Number(workedHours.toFixed(2));
          }

          recordModified = true;
        } else {
          // Updating check-out
          if (!session.checkIn) {
            // Can't set checkout without check-in
            continue;
          }

          const checkInTimeStr = toLocalTimeString(session.checkIn);

          const newCheckOutDate = combineDateAndTimeLocal(targetDateStr, newTimeStr, {
            referenceCheckIn: checkInTimeStr,
            isNightShift: isNight,
            cutoffHour,
          });

          // Validate worked hours
          const workedHours =
            (newCheckOutDate.getTime() - new Date(session.checkIn).getTime()) /
            (1000 * 60 * 60);

          if (!(workedHours > 0 && workedHours <= 24)) {
            allSkipped.push({
              employeeId: record.employee?.employeeId || record.employee?._id?.toString() || '',
              employeeName: record.employee?.name || 'Unknown',
              reason: 'invalid_hours',
              field,
            });
            continue;
          }

          // Build candidate sessions for overlap check
          const candidate = record.sessions.map((s) =>
            s._id.toString() === session._id.toString()
              ? { checkIn: s.checkIn, checkOut: newCheckOutDate }
              : { checkIn: s.checkIn, checkOut: s.checkOut }
          );

          if (hasSessionOverlap(candidate)) {
            allSkipped.push({
              employeeId: record.employee?.employeeId || record.employee?._id?.toString() || '',
              employeeName: record.employee?.name || 'Unknown',
              reason: 'overlap',
              field,
            });
            continue;
          }

          session.checkOut = newCheckOutDate;
          session.workedHours = Number(workedHours.toFixed(2));
          recordModified = true;
        }
      }

      if (recordModified) {
        // Recalculate record-level totals
        const totalWorkHours = record.sessions.reduce(
          (sum, s) => sum + (s.workedHours || 0),
          0
        );

        let status = 'absent';
        if (totalWorkHours >= fullDayHours) {
          status = 'fullday';
        } else if (totalWorkHours >= halfDayHours) {
          status = 'halfday';
        }

        let overtimeHours = 0;
        if (totalWorkHours > overtimeThreshold) {
          overtimeHours = totalWorkHours - overtimeThreshold;
        }

        record.totalWorkHours = totalWorkHours;
        record.status = status;
        record.overtimeHours = overtimeHours;

        await record.save();
        totalUpdated++;
      }
    }
  }

  return { updated: totalUpdated, skipped: allSkipped };
}
