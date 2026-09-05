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
import { getEmployeeIdsByCategory } from '../utils/collar.js';
import { computeAttendanceTotals } from '../utils/attendanceMath.js';
import { recordAttendanceAudit, SYSTEM_ACTOR } from '../utils/attendanceAudit.js';

/**
 * Fill checkOut for a SINGLE roster category's open sessions across a set of sites on a
 * given date. There are four categories — (skilled|staff) × (foreign|omani) — each with
 * its own day/night default check-out time on the Site; `employeeIds` scopes the fill to
 * exactly one category so a category is never closed by another's default.
 *
 * opts:
 *  - checkOutField : Site field holding this category's default check-out ("HH:mm").
 *  - isNight       : night-type mode — check-out is the next morning (run vs yesterday).
 *  - employeeIds   : this category's employee _id set.
 */
async function processSites(sites, dateStr, opts, workConfig) {
  const { checkOutField, isNight = false, employeeIds = [] } = opts;
  if (employeeIds.length === 0) return;

  const recordDate = new Date(dateStr);
  recordDate.setUTCHours(0, 0, 0, 0);

  for (const site of sites) {
    try {
      const checkOutTimeStr = site[checkOutField];
      if (!checkOutTimeStr) continue;

      // Records for this date with a session at this site, scoped to this category.
      const records = await Attendance.find({
        date: recordDate,
        'sessions.siteId': site._id,
        employee: { $in: employeeIds },
      });

      let updatedCount = 0;

      for (const record of records) {
        let recordModified = false;

        for (const session of record.sessions) {
          // Only this site's sessions with checkIn but no checkOut
          if (session.siteId.toString() !== site._id.toString()) continue;
          if (!session.checkIn || session.checkOut) continue;

          const sessionIsNight = session.isNightShift === true;

          // Each mode only fills its own shift type.
          if (isNight && !sessionIsNight) continue;
          if (!isNight && sessionIsNight) continue;

          const checkInTimeStr = toLocalTimeString(session.checkIn);

          // Day-type shifts: skip if check-in is later than the default check-out time.
          // (Night shifts check out the next day, so this doesn't apply.)
          if (!isNight) {
            const [inH, inM] = checkInTimeStr.split(':').map(Number);
            const [outH, outM] = checkOutTimeStr.split(':').map(Number);
            if (inH * 60 + inM > outH * 60 + outM) {
              continue;
            }
          }

          // Cutoff-free — the check-out rolls to the next day exactly when it reads earlier
          // than the check-in, and the stored check-in's own offset carries through unchanged.
          const checkOutNextDay =
            deriveOffsets(checkInTimeStr, checkOutTimeStr, !!session.checkInNextDay).checkOutNextDay;
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
              `[AutoCheckOut] Skipped overlapping check-out for record ${record._id} at site "${site.siteName}"`
            );
            continue;
          }

          session.checkOut = checkOutDate;
          session.workedHours = Number(workedHours.toFixed(2));
          // A next-day check-out crosses midnight — keep the display flag in sync. (The
          // pre-save hook re-derives rawCheckOut/offsets from the absolute checkOut Date,
          // so those stay consistent either way.)
          if (checkOutNextDay) session.isNightShift = true;
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

          // --- Audit: the system closed an open shift (best-effort, System actor) ---
          await recordAttendanceAudit({
            attendance: record,
            actor: SYSTEM_ACTOR,
            type: "auto_checkout",
            summary: `Auto checked-out by system at ${checkOutTimeStr}`,
          });
        }
      }

      if (updatedCount > 0) {
        console.log(
          `[AutoCheckOut] Site "${site.siteName}" (${checkOutField}): auto-filled checkOut (${checkOutTimeStr}) for ${updatedCount} record(s)`
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

// The eight per-category day/night check-out modes. Day modes fill TODAY's open sessions;
// night modes fill YESTERDAY's (a shift that started last evening checks out this morning).
const CHECKOUT_MODES = [
  { field: 'defaultCheckOut',                isNight: false, when: 'today',     cat: 'foreignSkilled' },
  { field: 'nightDefaultCheckOut',           isNight: true,  when: 'yesterday', cat: 'foreignSkilled' },
  { field: 'staffDefaultCheckOut',           isNight: false, when: 'today',     cat: 'foreignStaff'   },
  { field: 'staffNightDefaultCheckOut',      isNight: true,  when: 'yesterday', cat: 'foreignStaff'   },
  { field: 'omaniDefaultCheckOut',           isNight: false, when: 'today',     cat: 'omaniSkilled'   },
  { field: 'omaniNightDefaultCheckOut',      isNight: true,  when: 'yesterday', cat: 'omaniSkilled'   },
  { field: 'omaniStaffDefaultCheckOut',      isNight: false, when: 'today',     cat: 'omaniStaff'     },
  { field: 'omaniStaffNightDefaultCheckOut', isNight: true,  when: 'yesterday', cat: 'omaniStaff'     },
];

/**
 * Run the auto check-out process. For each of the four categories' day/night default
 * check-out times that matches the current local minute, fill the matching open sessions.
 */
async function runAutoCheckOut() {
  try {
    const currentTime = getCurrentLocalTime();
    const todayStr = getTodayLocal();
    const yesterdayStr = getDateLocal(-1);

    const active = { isActive: true, isDeleted: { $ne: true } };

    // Sites matching each mode's check-out time this minute (queried up front so we can
    // bail cheaply when nothing matches).
    const modeSites = await Promise.all(
      CHECKOUT_MODES.map((m) =>
        Site.find({
          ...active,
          [m.field]: currentTime,
        })
      )
    );

    if (modeSites.every((s) => s.length === 0)) return;

    const workConfig = await workModel.findOne();
    if (!workConfig) {
      console.error('[AutoCheckOut] Work configuration not found');
      return;
    }

    const cats = await getEmployeeIdsByCategory();

    for (let i = 0; i < CHECKOUT_MODES.length; i++) {
      const sites = modeSites[i];
      if (sites.length === 0) continue;
      const m = CHECKOUT_MODES[i];
      await processSites(
        sites,
        m.when === 'today' ? todayStr : yesterdayStr,
        { checkOutField: m.field, isNight: m.isNight, employeeIds: cats[m.cat] },
        workConfig
      );
    }
  } catch (error) {
    console.error('[AutoCheckOut] Cron job error:', error);
  }
}

/**
 * Start the auto check-out cron job.
 * Runs every minute to check if any site's per-category default check-out (or a 24h
 * start time) matches the current local time.
 */
export function startAutoCheckOutCron() {
  cron.schedule('* * * * *', runAutoCheckOut);
  console.log('[AutoCheckOut] Cron job started (runs every minute)');
}
