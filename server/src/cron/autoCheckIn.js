import cron from 'node-cron';
import Site from '../models/siteModel.js';
import Attendance from '../models/attendanceModel.js';
import workModel from '../models/workModel.js';
import {
  getCurrentLocalTime,
  getTodayLocal,
  combineDateAndTimeLocal,
} from '../utils/timeLocal.js';
import { hasSessionOverlap } from '../utils/sessionOverlap.js';

/**
 * Run the auto check-in process for night shifts.
 *
 * Finds active sites whose nightDefaultCheckIn matches the current local time,
 * then fills checkIn for empty night-shift sessions (isNightShift: true with no
 * checkIn/checkOut) for that site today, as long as the proposed time does not
 * overlap another session on the same record.
 */
async function runAutoCheckIn() {
  try {
    const currentTime = getCurrentLocalTime();
    const todayStr = getTodayLocal();

    // Find all active sites whose nightDefaultCheckIn matches current time
    const matchingSites = await Site.find({
      isActive: true,
      isDeleted: { $ne: true },
      nightDefaultCheckIn: currentTime,
    });

    if (matchingSites.length === 0) return;

    const workConfig = await workModel.findOne();
    const cutoffHour = (workConfig && workConfig.nightShiftCutoffHour) || 7;

    const todayDate = new Date(todayStr);
    todayDate.setUTCHours(0, 0, 0, 0);

    for (const site of matchingSites) {
      try {
        if (!site.nightDefaultCheckIn) continue;

        // Today's records that have a session at this site
        const records = await Attendance.find({
          date: todayDate,
          'sessions.siteId': site._id,
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
              const checkInDate = combineDateAndTimeLocal(
                todayStr,
                site.nightDefaultCheckIn,
                { isNightShift: true, cutoffHour }
              );

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
            `[AutoCheckIn] Site "${site.siteName}": auto-filled night check-in (${site.nightDefaultCheckIn}) for ${updatedCount} record(s)`
          );
        }
      } catch (siteError) {
        console.error(
          `[AutoCheckIn] Error processing site "${site.siteName}":`,
          siteError
        );
      }
    }
  } catch (error) {
    console.error('[AutoCheckIn] Cron job error:', error);
  }
}

/**
 * Start the auto check-in cron job.
 * Runs every minute to check if any site's nightDefaultCheckIn matches current local time.
 */
export function startAutoCheckInCron() {
  cron.schedule('* * * * *', runAutoCheckIn);
  console.log('[AutoCheckIn] Cron job started (runs every minute)');
}
