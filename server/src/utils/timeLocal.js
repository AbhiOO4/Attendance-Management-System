/**
 * Shared local-time helpers for cron jobs.
 *
 * The app stores timestamps in UTC but operates in a configurable local
 * timezone via APP_TIMEZONE_OFFSET (in minutes; default -330 = IST, UTC+05:30).
 * These helpers were originally defined inside autoCheckOut.js and are extracted
 * here so the auto check-in and auto check-out crons stay consistent.
 */

/**
 * Get the application's timezone offset in minutes from environment variables.
 * Defaults to -330 (Indian Standard Time, UTC+05:30).
 */
export const getAppOffsetMinutes = () => {
  const envVal = process.env.APP_TIMEZONE_OFFSET;
  if (envVal !== undefined && envVal !== "") {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return -330;
};

/**
 * Convert an offset in minutes to a string (e.g. -330 -> "+05:30").
 */
export function getOffsetString(offsetVal) {
  const sign = offsetVal <= 0 ? "+" : "-";
  const absMinutes = Math.abs(offsetVal);
  const hours = String(Math.floor(absMinutes / 60)).padStart(2, "0");
  const mins = String(absMinutes % 60).padStart(2, "0");
  return `${sign}${hours}:${mins}`;
}

/**
 * Get the current local time as "HH:mm" string.
 */
export function getCurrentLocalTime() {
  const offset = getAppOffsetMinutes();
  const now = new Date();
  const localTime = new Date(now.getTime() - offset * 60 * 1000);
  const hours = String(localTime.getUTCHours()).padStart(2, "0");
  const minutes = String(localTime.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Get a local date as "YYYY-MM-DD" string, optionally offset by a number of days.
 * getDateLocal() -> today, getDateLocal(-1) -> yesterday.
 */
export function getDateLocal(daysOffset = 0) {
  const offset = getAppOffsetMinutes();
  const now = new Date();
  const localTime = new Date(now.getTime() - offset * 60 * 1000);
  localTime.setUTCDate(localTime.getUTCDate() + daysOffset);
  return localTime.toISOString().split("T")[0];
}

/**
 * Get today's local date as "YYYY-MM-DD".
 */
export function getTodayLocal() {
  return getDateLocal(0);
}

/**
 * Combines a date string ("YYYY-MM-DD") and time string ("HH:mm") into a Date
 * object using the local timezone offset.
 *
 * When isNightShift is true, AM times before cutoffHour are advanced to the next
 * calendar day. Otherwise, if referenceCheckIn is provided and the time is
 * earlier, the date is advanced by one day (auto cross-midnight detection).
 */
export function combineDateAndTimeLocal(
  dateStr,
  timeStr,
  { referenceCheckIn = null, isNightShift = false, cutoffHour = 7 } = {}
) {
  const offset = getAppOffsetMinutes();
  const offsetStr = getOffsetString(offset);
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
 * Extract "HH:mm" from a Date object in local time.
 */
export function toLocalTimeString(date) {
  const offset = getAppOffsetMinutes();
  const localTime = new Date(date.getTime() - offset * 60 * 1000);
  const hours = String(localTime.getUTCHours()).padStart(2, "0");
  const minutes = String(localTime.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
