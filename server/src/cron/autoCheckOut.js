import cron from 'node-cron';
import Site from '../models/siteModel.js';
import Attendance from '../models/attendanceModel.js';
import workModel from '../models/workModel.js';
import {
  getCurrentLocalTime,
  getTodayLocal,
  getDateLocal,
  combineDateAndTimeLocal,
  toLocalTimeString,
} from '../utils/timeLocal.js';
import { hasSessionOverlap } from '../utils/sessionOverlap.js';

/**
 * Fill checkOut for matching sessions of a set of sites on a given date.
 *
 * mode "day"   -> uses site.defaultCheckOut, processes day-shift sessions.
 * mode "night" -> uses site.nightDefaultCheckOut, processes night-shift sessions.
 */
async function processSites(sites, dateStr, mode, workConfig, cutoffHour) {
  const { fullDayHours, halfDayHours, overtimeThreshold } = workConfig;

  const recordDate = new Date(dateStr);
  recordDate.setUTCHours(0, 0, 0, 0);

  for (const site of sites) {
    try {
      const checkOutTimeStr =
        mode === 'night' ? site.nightDefaultCheckOut : site.defaultCheckOut;

      if (!checkOutTimeStr) continue;

      // Records for this date that have a session at this site
      const records = await Attendance.find({
        date: recordDate,
        'sessions.siteId': site._id,
      });

      let updatedCount = 0;

      for (const record of records) {
        let recordModified = false;

        for (const session of record.sessions) {
          // Only this site's sessions with checkIn but no checkOut
          if (session.siteId.toString() !== site._id.toString()) continue;
          if (!session.checkIn || session.checkOut) continue;

          const isNight = session.isNightShift === true;

          // Each cron only fills its own shift type
          if (mode === 'night' && !isNight) continue;
          if (mode === 'day' && isNight) continue;

          const checkInTimeStr = toLocalTimeString(session.checkIn);

          // Day shift: skip if check-in is later than the default check-out time
          if (mode === 'day') {
            const [inH, inM] = checkInTimeStr.split(':').map(Number);
            const [outH, outM] = checkOutTimeStr.split(':').map(Number);
            if (inH * 60 + inM > outH * 60 + outM) {
              continue;
            }
          }

          const checkOutDate = combineDateAndTimeLocal(dateStr, checkOutTimeStr, {
            referenceCheckIn: checkInTimeStr,
            isNightShift: isNight,
            cutoffHour,
          });

          // Worked hours must be valid (check-in chronologically before check-out)
          const workedHours =
            (checkOutDate.getTime() - new Date(session.checkIn).getTime()) /
            (1000 * 60 * 60);

          if (!(workedHours > 0 && workedHours <= 24)) continue;

          // In-memory dry-run overlap check against the record's other sessions
          const candidate = record.sessions.map((s) =>
            s._id.toString() === session._id.toString()
              ? { checkIn: s.checkIn, checkOut: checkOutDate }
              : { checkIn: s.checkIn, checkOut: s.checkOut }
          );

          if (hasSessionOverlap(candidate)) {
            console.warn(
              `[AutoCheckOut] Skipped overlapping ${mode} check-out for record ${record._id} at site "${site.siteName}"`
            );
            continue;
          }

          session.checkOut = checkOutDate;
          session.workedHours = Number(workedHours.toFixed(2));
          recordModified = true;
        }

        if (recordModified) {
          // Recalculate totals for the entire attendance record
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
          updatedCount++;
        }
      }

      if (updatedCount > 0) {
        console.log(
          `[AutoCheckOut] Site "${site.siteName}" (${mode}): auto-filled checkOut (${checkOutTimeStr}) for ${updatedCount} record(s)`
        );
      }
    } catch (siteError) {
      console.error(
        `[AutoCheckOut] Error processing site "${site.siteName}":`,
        siteError
      );
    }
  }
}

/**
 * Run the auto check-out process.
 *
 * Triggers when the current local time matches:
 *  - a site's defaultCheckOut       -> fills today's day-shift check-outs.
 *  - a site's nightDefaultCheckOut  -> fills yesterday's night-shift check-outs
 *    (a night shift that started yesterday evening checks out the next morning).
 */
async function runAutoCheckOut() {
  try {
    const currentTime = getCurrentLocalTime();
    const todayStr = getTodayLocal();
    const yesterdayStr = getDateLocal(-1);

    // Day-shift sites whose defaultCheckOut matches current time
    const daySites = await Site.find({
      isActive: true,
      isDeleted: { $ne: true },
      defaultCheckOut: currentTime,
    });

    // Night-shift sites whose nightDefaultCheckOut matches current time
    const nightSites = await Site.find({
      isActive: true,
      isDeleted: { $ne: true },
      nightDefaultCheckOut: currentTime,
    });

    if (daySites.length === 0 && nightSites.length === 0) return;

    const workConfig = await workModel.findOne();
    if (!workConfig) {
      console.error('[AutoCheckOut] Work configuration not found');
      return;
    }

    const cutoffHour = workConfig.nightShiftCutoffHour || 7;

    if (daySites.length > 0) {
      await processSites(daySites, todayStr, 'day', workConfig, cutoffHour);
    }

    if (nightSites.length > 0) {
      await processSites(nightSites, yesterdayStr, 'night', workConfig, cutoffHour);
    }
  } catch (error) {
    console.error('[AutoCheckOut] Cron job error:', error);
  }
}

/**
 * Start the auto check-out cron job.
 * Runs every minute to check if any site's defaultCheckOut / nightDefaultCheckOut
 * matches the current local time.
 */
export function startAutoCheckOutCron() {
  cron.schedule('* * * * *', runAutoCheckOut);
  console.log('[AutoCheckOut] Cron job started (runs every minute)');
}
