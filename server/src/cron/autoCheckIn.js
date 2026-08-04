import cron from 'node-cron';
import Site from '../models/siteModel.js';
import Attendance from '../models/attendanceModel.js';
import {
  getCurrentLocalTime,
  getTodayLocal,
  combineFromOffset,
} from '../utils/timeLocal.js';
import { hasSessionOverlap } from '../utils/sessionOverlap.js';
import { getEmployeeIdsByCategory } from '../utils/collar.js';

/**
 * Fill checkIn for a single category's empty night-shift sessions across a set of sites
 * today. A night check-in default is an evening time, so it belongs to the record's own
 * business day (offset 0). Scoped to one category's employee _id set so a category is
 * only auto-checked-in from its own night default.
 */
async function processSites(sites, todayStr, checkInField, employeeIds) {
  if (employeeIds.length === 0) return;

  const todayDate = new Date(todayStr);
  todayDate.setUTCHours(0, 0, 0, 0);

  for (const site of sites) {
    try {
      const checkInTimeStr = site[checkInField];
      if (!checkInTimeStr) continue;

      // Today's records that have a session at this site, scoped to this category.
      const records = await Attendance.find({
        date: todayDate,
        'sessions.siteId': site._id,
        employee: { $in: employeeIds },
      });

      let updatedCount = 0;

      for (const record of records) {
        // Never auto check-in an employee marked as sick leave.
        if (record.isSickLeave) continue;

        let recordModified = false;

        for (const session of record.sessions) {
          // Only empty night-shift sessions for this site
          if (
            session.siteId.toString() === site._id.toString() &&
            session.isNightShift === true &&
            !session.checkIn &&
            !session.checkOut
          ) {
            const checkInDate = combineFromOffset(todayStr, checkInTimeStr, false);

            // In-memory dry-run overlap check against the record's other sessions
            const candidate = record.sessions.map((s) =>
              s._id.toString() === session._id.toString()
                ? { checkIn: checkInDate, checkOut: null }
                : { checkIn: s.checkIn, checkOut: s.checkOut }
            );

            if (hasSessionOverlap(candidate)) {
              console.warn(
                `[AutoCheckIn] Skipped overlapping night check-in for record ${record._id} at site "${site.siteName}"`
              );
              continue;
            }

            session.checkIn = checkInDate;
            recordModified = true;
          }
        }

        if (recordModified) {
          await record.save();
          updatedCount++;
        }
      }

      if (updatedCount > 0) {
        console.log(
          `[AutoCheckIn] Site "${site.siteName}" (${checkInField}): auto-filled night check-in (${checkInTimeStr}) for ${updatedCount} record(s)`
        );
      }
    } catch (siteError) {
      console.error(
        `[AutoCheckIn] Error processing site "${site.siteName}":`,
        siteError
      );
    }
  }
}

// Per-category night check-in modes. Foreign Skilled on a 24h site prefill their check-in
// on the roster (supervisor submits), so their night auto check-in excludes 24h sites.
const CHECKIN_MODES = [
  { field: 'nightDefaultCheckIn',           cat: 'foreignSkilled', exclude24: true  },
  { field: 'staffNightDefaultCheckIn',      cat: 'foreignStaff',   exclude24: false },
  { field: 'omaniNightDefaultCheckIn',      cat: 'omaniSkilled',   exclude24: false },
  { field: 'omaniStaffNightDefaultCheckIn', cat: 'omaniStaff',     exclude24: false },
];

/**
 * Run the auto check-in process for night shifts. For each category's night check-in
 * default that matches the current local minute, fill that category's empty night sessions
 * (isNightShift: true, no checkIn/checkOut) today, avoiding overlaps.
 */
async function runAutoCheckIn() {
  try {
    const currentTime = getCurrentLocalTime();
    const todayStr = getTodayLocal();

    const active = { isActive: true, isDeleted: { $ne: true } };

    const modeSites = await Promise.all(
      CHECKIN_MODES.map((m) =>
        Site.find({
          ...active,
          ...(m.exclude24 ? { is24HourShift: { $ne: true } } : {}),
          [m.field]: currentTime,
        })
      )
    );

    if (modeSites.every((s) => s.length === 0)) return;

    const cats = await getEmployeeIdsByCategory();

    for (let i = 0; i < CHECKIN_MODES.length; i++) {
      const sites = modeSites[i];
      if (sites.length === 0) continue;
      const m = CHECKIN_MODES[i];
      await processSites(sites, todayStr, m.field, cats[m.cat]);
    }
  } catch (error) {
    console.error('[AutoCheckIn] Cron job error:', error);
  }
}

/**
 * Start the auto check-in cron job.
 * Runs every minute to check if any category's night check-in matches current local time.
 */
export function startAutoCheckInCron() {
  cron.schedule('* * * * *', runAutoCheckIn);
  console.log('[AutoCheckIn] Cron job started (runs every minute)');
}
