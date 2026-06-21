/**
 * Night shift date/time utilities.
 * Centralizes the "Logical Business Day" concept.
 */

export const APP_OFFSET = (() => {
  const envVal = import.meta.env.VITE_APP_TIMEZONE_OFFSET;
  if (envVal !== undefined && envVal !== "") {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return -330; // Fallback to IST
})();

/**
 * Helper to get a Date object representing the current time shifted to target timezone
 * so that we can use UTC getters to read target local hours, date, etc.
 */
export function getCurrentTargetTime(): Date {
  const now = new Date();
  return new Date(now.getTime() - APP_OFFSET * 60 * 1000);
}

/**
 * Returns today's calendar date (YYYY-MM-DD) in the app's configured timezone.
 * Unlike getLogicalShiftDate, this does NOT apply the cutoff-hour rollback.
 */
export function getCurrentTargetDateString(): string {
  const target = getCurrentTargetTime();
  const y = target.getUTCFullYear();
  const m = String(target.getUTCMonth() + 1).padStart(2, "0");
  const d = String(target.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Formats the current date (in the app's configured timezone) as a human-readable label.
 * e.g., "Saturday, June 21, 2026"
 */
export function formatCurrentDateLabel(): string {
  const dateStr = getCurrentTargetDateString();
  const date = new Date(dateStr + "T12:00:00"); // noon to avoid timezone edge
  return date.toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Returns the day-of-week name (lowercase) for the current date in the app's timezone.
 * e.g., "saturday"
 */
export function getCurrentTargetDayName(): string {
  const dateStr = getCurrentTargetDateString();
  const date = new Date(dateStr + "T12:00:00"); // noon to avoid timezone edge
  return date.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
}

/**
 * Returns the "logical shift date" based on the cutoff hour.
 * If the current time is before the cutoff (e.g., 7 AM),
 * the portal still shows YESTERDAY's date.
 */
export function getLogicalShiftDate(cutoffHour: number = 7): string {
  const target = getCurrentTargetTime();
  if (target.getUTCHours() < cutoffHour) {
    target.setUTCDate(target.getUTCDate() - 1);
  }
  const y = target.getUTCFullYear();
  const m = String(target.getUTCMonth() + 1).padStart(2, "0");
  const d = String(target.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`; // "YYYY-MM-DD"
}

/**
 * Returns whether we're currently in the "extended" period
 * (after midnight but before cutoff), useful for UI labeling.
 */
export function isInExtendedPeriod(cutoffHour: number = 7): boolean {
  return getCurrentTargetTime().getUTCHours() < cutoffHour;
}

/**
 * Calculates hours between two HH:mm time strings.
 * 
 * When isNightShift = true:
 *   Times < cutoffHour are treated as next-day times (+24h).
 * When isNightShift = false:
 *   Auto-detects cross-midnight (checkOut < checkIn → +24h to checkOut).
 */
export function calculateHoursBetween(
  checkIn: string,
  checkOut: string,
  isNightShift: boolean = false,
  cutoffHour: number = 7
): number {
  if (!checkIn || !checkOut) return 0;
  const [inH, inM] = checkIn.split(":").map(Number);
  const [outH, outM] = checkOut.split(":").map(Number);
  let inMinutes = inH * 60 + inM;
  let outMinutes = outH * 60 + outM;

  if (isNightShift) {
    // Night shift: times < cutoff are on next day (+24h)
    if (inH < cutoffHour) inMinutes += 24 * 60;
    if (outH < cutoffHour) outMinutes += 24 * 60;
  } else {
    // Auto-detect cross-midnight
    if (outMinutes < inMinutes) {
      outMinutes += 24 * 60;
    }
  }

  const diff = outMinutes - inMinutes;
  if (diff < 0) return 0;
  return Math.round((diff / 60) * 100) / 100;
}

/**
 * Detects if a session is a night shift.
 * Returns true if isNightShift flag is set, OR if checkOut < checkIn (auto-detect).
 */
export function isCrossMidnight(
  checkIn: string,
  checkOut: string,
  isNightShift: boolean = false
): boolean {
  if (isNightShift) return true;
  if (!checkIn || !checkOut) return false;
  const [inH, inM] = checkIn.split(":").map(Number);
  const [outH, outM] = checkOut.split(":").map(Number);
  return (outH * 60 + outM) < (inH * 60 + inM);
}

/**
 * Formats a logical date label for the night shift banner.
 * e.g., "Tuesday, June 3"
 */
export function formatLogicalDateLabel(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00"); // noon to avoid timezone edge
  return date.toLocaleDateString("en-IN", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * Combines a record date + HH:mm time string into a full Date string using APP_OFFSET.
 * 
 * When isNightShift = true:
 *   Times < cutoffHour are placed on the next calendar day.
 * When isNightShift = false:
 *   If referenceCheckIn is provided and time is before it, advances by one day.
 */
export function combineDateAndTime(
  recordDate: string,
  time: string | null,
  referenceCheckIn?: string | null,
  isNightShift: boolean = false,
  cutoffHour: number = 7
): string | null {
  if (!time) return null;

  const sign = APP_OFFSET <= 0 ? "+" : "-";
  const absMinutes = Math.abs(APP_OFFSET);
  const hoursOffset = String(Math.floor(absMinutes / 60)).padStart(2, "0");
  const minsOffset = String(absMinutes % 60).padStart(2, "0");
  const offsetStr = `${sign}${hoursOffset}:${minsOffset}`;

  const dateOnly = recordDate.includes("T") ? recordDate.split("T")[0] : recordDate;
  const dt = new Date(`${dateOnly}T${time}:00${offsetStr}`);
  const [hours] = time.split(":").map(Number);

  if (isNightShift) {
    // Night shift: AM times before cutoff → next day
    if (hours < cutoffHour) {
      dt.setDate(dt.getDate() + 1);
    }
  } else if (referenceCheckIn) {
    // Auto cross-midnight detection
    const [inH, inM] = referenceCheckIn.split(":").map(Number);
    const inMinutes = inH * 60 + inM;
    const outMinutes = hours * 60 + (parseInt(time.split(":")[1]) || 0);
    if (outMinutes < inMinutes) {
      dt.setDate(dt.getDate() + 1);
    }
  }

  return dt.toISOString();
}

/**
 * Formats a Date object or ISO string to HH:mm in the app's timezone.
 */
export function toLocalTimeString(dateVal?: string | Date | null): string {
  if (!dateVal) return "";
  const dateObj = new Date(dateVal);
  if (isNaN(dateObj.getTime())) return "";

  // Shift UTC time to target local time
  const localTime = new Date(dateObj.getTime() - APP_OFFSET * 60 * 1000);
  const hours = String(localTime.getUTCHours()).padStart(2, "0");
  const minutes = String(localTime.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Formats a Date object or ISO string to "hh:mm AM/PM" in the app's timezone.
 */
export function formatLocalTime12h(dateVal?: string | Date | null): string {
  if (!dateVal) return "";
  const dateObj = new Date(dateVal);
  if (isNaN(dateObj.getTime())) return "";

  // Shift UTC time to target local time
  const localTime = new Date(dateObj.getTime() - APP_OFFSET * 60 * 1000);
  const rawHours = localTime.getUTCHours();
  const minutes = String(localTime.getUTCMinutes()).padStart(2, "0");
  const ampm = rawHours >= 12 ? "PM" : "AM";
  const hours = rawHours % 12 || 12;
  const hoursStr = String(hours).padStart(2, "0");
  return `${hoursStr}:${minutes} ${ampm}`;
}

/**
 * Checks if a time string is valid for a night shift.
 * Morning/AM times must be strictly before the cutoff hour.
 */
export function isValidNightShiftTime(time: string | null, cutoffHour: number = 7): boolean {
  if (!time) return true;
  const [h] = time.split(":").map(Number);
  // AM hours (0 to 11) must be before cutoff
  if (h >= cutoffHour && h < 12) {
    return false;
  }
  return true;
}

/**
 * Checks if check-in time is within the day/night toggle range (12:00 AM to cutoffHour).
 * In 24h format, 12:00 AM is 00:00.
 */
export function isCheckInInToggleRange(checkIn: string | null, cutoffHour: number = 7): boolean {
  if (!checkIn) return false;
  const [h] = checkIn.split(":").map(Number);
  return h >= 0 && h < cutoffHour;
}

export function validateSessionTimes(
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
  isNightShift: boolean = false,
  cutoffHour: number = 7
): string | null {
  // 1. RULE: Check-out without check-in is NOT allowed
  if (!checkIn && checkOut) {
    return "Check-out time cannot be entered without a check-in time.";
  }

  // If check-in is present but no check-out, it's valid (representing an active shift)
  if (checkIn && !checkOut) {
    return null;
  }

  // If both are empty, it's valid (representing no shift)
  if (!checkIn && !checkOut) {
    return null;
  }

  const [inH, inM] = checkIn!.split(":").map(Number);
  const [outH, outM] = checkOut!.split(":").map(Number);
  const inMin = inH * 60 + inM;
  const outMin = outH * 60 + outM;
  const cutoffMin = cutoffHour * 60;

  // 2. RULE (New - Early Morning Check-in):
  // If check-in is between 12:00 AM and cutoffHour (00:00 - 07:00)
  if (inH >= 0 && inH < cutoffHour) {
    const isOutInCutoffRange = (outMin >= 0) && (outMin <= cutoffMin);
    if (!isOutInCutoffRange || inMin >= outMin) {
      return `For early morning shifts starting between 12:00 AM and ${cutoffHour}:00 AM, the check-out time must be between 12:00 AM and ${cutoffHour}:00 AM, and must be after the check-in time.`;
    }
    return null;
  }

  // Detect if shift crosses midnight (check-out time < check-in time)
  const crossesMidnight = outMin < inMin;

  // 3. RULE (Corrected - Through Midnight Shift):
  // If check-out is between 12:00 AM and cutoffHour (00:00 - 07:00) and shift crosses midnight
  if (crossesMidnight && (outMin >= 0 && outMin <= cutoffMin)) {
    if (inH < 12) {
      return `For night shifts crossing midnight and ending before ${cutoffHour}:00 AM, the check-in time must be 12:00 PM (noon) or later.`;
    }
  }

  // 4. RULE (Existing - Night Shift Check-in):
  if (isNightShift || crossesMidnight) {
    if (inH >= cutoffHour && inH < 12) {
      return `Check-in time must be before the cutoff hour (${cutoffHour}:00 AM) for night shifts.`;
    }
  }

  // 5. RULE (Existing - Night Shift Check-out):
  if (isNightShift || crossesMidnight) {
    if (outMin > cutoffMin && outH < 12) {
      return `Check-out time must be before or equal to the cutoff hour (${cutoffHour}:00 AM) for night shifts.`;
    }
  }

  return null;
}


