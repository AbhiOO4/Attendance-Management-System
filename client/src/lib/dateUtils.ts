/**
 * Night shift date/time utilities.
 * Centralizes the "Logical Business Day" concept.
 */

/**
 * Returns the "logical shift date" based on the cutoff hour.
 * If the current time is before the cutoff (e.g., 7 AM),
 * the portal still shows YESTERDAY's date.
 */
export function getLogicalShiftDate(cutoffHour: number = 7): string {
  const now = new Date();
  if (now.getHours() < cutoffHour) {
    now.setDate(now.getDate() - 1);
  }
  return now.toLocaleDateString("en-CA"); // "YYYY-MM-DD"
}

/**
 * Returns whether we're currently in the "extended" period
 * (after midnight but before cutoff), useful for UI labeling.
 */
export function isInExtendedPeriod(cutoffHour: number = 7): boolean {
  return new Date().getHours() < cutoffHour;
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
 * Combines a record date + HH:mm time string into a full Date string.
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
  const baseDate = new Date(recordDate);
  const [hours, minutes] = time.split(":").map(Number);
  baseDate.setHours(hours, minutes, 0, 0);

  if (isNightShift) {
    // Night shift: AM times before cutoff → next day
    if (hours < cutoffHour) {
      baseDate.setDate(baseDate.getDate() + 1);
    }
  } else if (referenceCheckIn) {
    // Auto cross-midnight detection
    const [inH, inM] = referenceCheckIn.split(":").map(Number);
    const inMinutes = inH * 60 + inM;
    const outMinutes = hours * 60 + minutes;
    if (outMinutes < inMinutes) {
      baseDate.setDate(baseDate.getDate() + 1);
    }
  }

  return baseDate.toISOString();
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

