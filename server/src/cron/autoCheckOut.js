import cron from 'node-cron';
import Site from '../models/siteModel.js';
import Attendance from '../models/attendanceModel.js';
import workModel from '../models/workModel.js';
import {
  getCurrentLocalTime,
  getTodayLocal,
  getDateLocal,
  combineFromOffset,
  deriveOffsets,
  toLocalTimeString,
  MAX_SHIFT_HOURS,
} from '../utils/timeLocal.js';
import { hasSessionOverlap } from '../utils/sessionOverlap.js';
import { getStaffEmployeeIds } from '../utils/collar.js';
import { computeAttendanceTotals } from '../utils/attendanceMath.js';

/**
 * Fill checkOut for matching sessions of a set of sites on a given date.
 *
 * mode "day"        -> site.defaultCheckOut, field-worker day sessions.
 * mode "night"      -> site.nightDefaultCheckOut, field-worker night sessions.
 * mode "staff"      -> site.staffDefaultCheckOut, staff (white-collar) day sessions.
 * mode "staffnight" -> site.staffNightDefaultCheckOut, staff night sessions.
 *
 * `staffIds` scopes which employees each mode touches: staff modes only fill
 * staff sessions; day/night modes exclude staff.
 */
async function processSites(sites, dateStr, mode, workConfig, staffIds = []) {
  const isNightMode = mode === 'night' || mode === 'staffnight';
  const isStaffMode = mode === 'staff' || mode === 'staffnight';

  const recordDate = new Date(dateStr);
  recordDate.setUTCHours(0, 0, 0, 0);

  for (const site of sites) {
    try {
      let checkOutTimeStr;
      if (mode === 'night') checkOutTimeStr = site.nightDefaultCheckOut;
      else if (mode === 'staff') checkOutTimeStr = site.staffDefaultCheckOut;
      else if (mode === 'staffnight') checkOutTimeStr = site.staffNightDefaultCheckOut;
      else checkOutTimeStr = site.defaultCheckOut;

      if (!checkOutTimeStr) continue;

      // Records for this date that have a session at this site, scoped by collar.
      const employeeFilter = isStaffMode
        ? { employee: { $in: staffIds } }
        : { employee: { $nin: staffIds } };

      const records = await Attendance.find({
        date: recordDate,
        'sessions.siteId': site._id,
        ...employeeFilter,
      });

      let updatedCount = 0;

      for (const record of records) {
        let recordModified = false;

        for (const session of record.sessions) {
          // Only this site's sessions with checkIn but no checkOut
          if (session.siteId.toString() !== site._id.toString()) continue;
          if (!session.checkIn || session.checkOut) continue;

          const isNight = session.isNightShift === true;

          // Each mode only fills its own shift type.
          if (isNightMode && !isNight) continue;
          if (!isNightMode && isNight) continue;

          const checkInTimeStr = toLocalTimeString(session.checkIn);

          // Day-type shifts: skip if check-in is later than the default check-out time
          if (!isNightMode) {
            const [inH, inM] = checkInTimeStr.split(':').map(Number);
            const [outH, outM] = checkOutTimeStr.split(':').map(Number);
            if (inH * 60 + inM > outH * 60 + outM) {
              continue;
            }
          }

          // Cutoff-free: the check-out rolls to the next day exactly when it reads earlier
          // than the check-in. The stored check-in's own offset carries through unchanged.
          const { checkOutNextDay } = deriveOffsets(checkInTimeStr, checkOutTimeStr, !!session.checkInNextDay);
          const checkOutDate = combineFromOffset(dateStr, checkOutTimeStr, checkOutNextDay);

          // Worked hours must be valid (check-in chronologically before check-out)
          const workedHours =
            (checkOutDate.getTime() - new Date(session.checkIn).getTime()) /
            (1000 * 60 * 60);

          if (!(workedHours > 0 && workedHours <= MAX_SHIFT_HOURS)) continue;

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
          // Recalculate totals for the entire attendance record via the shared
          // pay-math helper (breaks, OT, holiday hours all consistent with the
          // controller's save paths).
          const rawHours = record.sessions.reduce(
            (sum, s) => sum + (s.workedHours || 0),
            0
          );

          const { netWorkHours, status, overtimeHours, holidayHours } = computeAttendanceTotals(
            rawHours,
            workConfig,
            record.breaksTaken ?? null,
            { isHoliday: record.isHoliday, reason: record.holidayReason }
          );

          record.totalWorkHours = netWorkHours;
          record.status = status;
          record.overtimeHours = overtimeHours;
          record.holidayHours = holidayHours;

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

    // Sites whose staffDefaultCheckOut matches current time (staff day sessions)
    const staffSites = await Site.find({
      isActive: true,
      isDeleted: { $ne: true },
      staffDefaultCheckOut: currentTime,
    });

    // Sites whose staffNightDefaultCheckOut matches current time (staff night
    // sessions check out the next morning, like field night shifts → yesterday)
    const staffNightSites = await Site.find({
      isActive: true,
      isDeleted: { $ne: true },
      staffNightDefaultCheckOut: currentTime,
    });

    if (
      daySites.length === 0 &&
      nightSites.length === 0 &&
      staffSites.length === 0 &&
      staffNightSites.length === 0
    ) return;

    const workConfig = await workModel.findOne();
    if (!workConfig) {
      console.error('[AutoCheckOut] Work configuration not found');
      return;
    }

    const staffIds = await getStaffEmployeeIds();

    if (daySites.length > 0) {
      await processSites(daySites, todayStr, 'day', workConfig, staffIds);
    }

    if (nightSites.length > 0) {
      await processSites(nightSites, yesterdayStr, 'night', workConfig, staffIds);
    }

    if (staffSites.length > 0) {
      await processSites(staffSites, todayStr, 'staff', workConfig, staffIds);
    }

    if (staffNightSites.length > 0) {
      await processSites(staffNightSites, yesterdayStr, 'staffnight', workConfig, staffIds);
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
