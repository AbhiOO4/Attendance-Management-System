import cron from 'node-cron';
import Site from '../models/siteModel.js';
import Attendance from '../models/attendanceModel.js';
import workModel from '../models/workModel.js';

// IST offset: +05:30 = -330 minutes
const IST_OFFSET = -330;

/**
 * Get the current IST time as "HH:mm" string.
 */
function getCurrentISTTime() {
  const now = new Date();
  const istTime = new Date(now.getTime() - IST_OFFSET * 60 * 1000);
  const hours = String(istTime.getUTCHours()).padStart(2, '0');
  const minutes = String(istTime.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Get today's date in IST as "YYYY-MM-DD" string.
 */
function getTodayIST() {
  const now = new Date();
  const istTime = new Date(now.getTime() - IST_OFFSET * 60 * 1000);
  return istTime.toISOString().split('T')[0];
}

/**
 * Combines a date string ("YYYY-MM-DD") and time string ("HH:mm")
 * into a Date object using IST offset.
 * Replicates the logic from attendanceController's combineDateAndTime.
 */
function combineDateAndTimeIST(dateStr, timeStr, { referenceCheckIn = null, isNightShift = false, cutoffHour = 7 } = {}) {
  const offsetStr = "+05:30";
  const dt = new Date(`${dateStr}T${timeStr}:00${offsetStr}`);
  const [h] = timeStr.split(":").map(Number);

  if (isNightShift) {
    if (h < cutoffHour) {
      dt.setDate(dt.getDate() + 1);
    }
  } else if (referenceCheckIn) {
    const [inH, inM] = referenceCheckIn.split(":").map(Number);
    const [outH, outM] = timeStr.split(":").map(Number);
    if (outH * 60 + outM < inH * 60 + inM) {
      dt.setDate(dt.getDate() + 1);
    }
  }

  return dt;
}

/**
 * Extract HH:mm from a Date object in IST.
 */
function toISTTimeString(date) {
  const istTime = new Date(date.getTime() - IST_OFFSET * 60 * 1000);
  const hours = String(istTime.getUTCHours()).padStart(2, '0');
  const minutes = String(istTime.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Run the auto check-out process.
 * Finds sites whose defaultCheckOut matches the current IST time,
 * then fills in checkOut for all submitted attendance sessions
 * that have checkIn but no checkOut for that site today.
 */
async function runAutoCheckOut() {
  try {
    const currentTime = getCurrentISTTime();
    const todayStr = getTodayIST();

    // Find all active sites whose defaultCheckOut matches current time
    const matchingSites = await Site.find({
      isActive: true,
      isDeleted: { $ne: true },
      defaultCheckOut: currentTime,
    });

    if (matchingSites.length === 0) return;

    // Fetch work config for hour thresholds
    const workConfig = await workModel.findOne();
    if (!workConfig) {
      console.error('[AutoCheckOut] Work configuration not found');
      return;
    }

    const { fullDayHours, halfDayHours, overtimeThreshold, nightShiftCutoffHour: cutoffHour = 7 } = workConfig;

    const todayDate = new Date(todayStr);
    todayDate.setUTCHours(0, 0, 0, 0);

    for (const site of matchingSites) {
      try {
        // Find attendance records for today that have sessions for this site
        // where checkIn exists but checkOut is null
        const records = await Attendance.find({
          date: todayDate,
          'sessions.siteId': site._id,
        });

        let updatedCount = 0;

        for (const record of records) {
          let recordModified = false;

          for (const session of record.sessions) {
            // Only process sessions for this site with checkIn but no checkOut
            if (
              session.siteId.toString() === site._id.toString() &&
              session.checkIn &&
              !session.checkOut
            ) {
              // Get the checkIn time as HH:mm string in IST
              const checkInTimeStr = toISTTimeString(session.checkIn);

              // Build checkOut Date using the site's defaultCheckOut
              const checkOutDate = combineDateAndTimeIST(
                todayStr,
                site.defaultCheckOut,
                {
                  referenceCheckIn: checkInTimeStr,
                  isNightShift: session.isNightShift || false,
                  cutoffHour,
                }
              );

              // Calculate worked hours
              const workedHours =
                (checkOutDate.getTime() - new Date(session.checkIn).getTime()) /
                (1000 * 60 * 60);

              // Only set if result is valid (positive, <= 24h)
              if (workedHours > 0 && workedHours <= 24) {
                session.checkOut = checkOutDate;
                session.workedHours = Number(workedHours.toFixed(2));
                recordModified = true;
              }
            }
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
            `[AutoCheckOut] Site "${site.siteName}": auto-filled checkOut (${site.defaultCheckOut}) for ${updatedCount} record(s)`
          );
        }
      } catch (siteError) {
        console.error(
          `[AutoCheckOut] Error processing site "${site.siteName}":`,
          siteError
        );
      }
    }
  } catch (error) {
    console.error('[AutoCheckOut] Cron job error:', error);
  }
}

/**
 * Start the auto check-out cron job.
 * Runs every minute to check if any site's defaultCheckOut matches current IST time.
 */
export function startAutoCheckOutCron() {
  cron.schedule('* * * * *', runAutoCheckOut);
  console.log('[AutoCheckOut] Cron job started (runs every minute)');
}
