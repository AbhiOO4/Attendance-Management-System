/**
 * Night shift date/time utilities.
 * Centralizes the "Logical Business Day" concept.
 *
 * NOTE: every cutoffHour parameter below is REQUIRED, deliberately. The cutoff is baked into
 * each attendance record's stored check-in/out timestamps at write time, so a record must be
 * interpreted with the cutoff that was in force on ITS OWN business day — not today's.
 * Cutoffs are PER-SITE: resolve from the relevant Site doc (it carries nightShiftCutoffHour +
 * cutoffHistory) via getCurrentCutoff(site) / resolveCutoffForDate(site, record.date).
 * useWorkConfig()'s currentCutoff/cutoffFor are only for pages with no single site in scope.
 * A default here would silently reinterpret old records after an admin changes the cutoff.
 */

export const APP_OFFSET = (() => {
  const envVal = import.meta.env.VITE_APP_TIMEZONE_OFFSET;
  if (envVal !== undefined && envVal !== "") {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return -330; // Fallback to IST
})();

export type CutoffEntry = {
  cutoffHour: number;
  effectiveFrom: string | Date;
};

/**
 * Anything carrying an effective-dated cutoff. Cutoffs are PER-SITE (each Site doc holds
 * its own machine-derived history); the global WorkConfig still satisfies this shape but
 * is only the fallback for consumers with no single site in scope.
 */
export type CutoffSource = {
  nightShiftCutoffHour?: number;
  cutoffHistory?: CutoffEntry[];
};

export type WorkConfig = {
  fullDayHours: number;
  halfDayHours: number;
  overtimeThreshold: number;
  overtimeRatePerHour: number;
  weeklyHolidays: string[];
  nightShiftCutoffHour: number;
  breakDurationMinutes: number;
  cutoffHistory?: CutoffEntry[];
};

/**
 * Normalize a business day to a Date at UTC midnight — matching how the server stores
 * `Attendance.date` and `cutoffHistory[].effectiveFrom`.
 */
export function normalizeBusinessDate(dateLike: string | Date | null | undefined): Date | null {
  if (!dateLike) return null;

  if (typeof dateLike === "string") {
    const dateOnly = dateLike.includes("T") ? dateLike.split("T")[0] : dateLike;
    const dt = new Date(`${dateOnly}T00:00:00.000Z`);
    return isNaN(dt.getTime()) ? null : dt;
  }

  const dt = new Date(dateLike);
  if (isNaN(dt.getTime())) return null;
  dt.setUTCHours(0, 0, 0, 0);
  return dt;
}

/**
 * The cutoff hour that was (or will be) in force on a given business day.
 * Mirrors server/src/utils/cutoff.js — keep the two in sync.
 */
export function resolveCutoffForDate(
  config: CutoffSource | null | undefined,
  businessDate: string | Date | null | undefined
): number {
  // A doc with neither history nor mirror falls back to 0: midnight boundary, plain
  // calendar days (the derived value for a site with no night default check-out).
  const fallback = config?.nightShiftCutoffHour ?? 0;

  const history = config?.cutoffHistory;
  if (!Array.isArray(history) || history.length === 0) return fallback;

  const target = normalizeBusinessDate(businessDate);
  if (!target) return fallback;

  const sorted = [...history].sort(
    (a, b) => new Date(a.effectiveFrom).getTime() - new Date(b.effectiveFrom).getTime()
  );

  // Days that predate every entry fall back to the oldest known value.
  let resolved = sorted[0];
  for (const entry of sorted) {
    if (new Date(entry.effectiveFrom).getTime() <= target.getTime()) {
      resolved = entry;
    } else {
      break;
    }
  }

  return resolved.cutoffHour;
}

/**
 * The cutoff in force right now.
 *
 * Two passes: you need a cutoff to know which business day it currently is, and the business
 * day to resolve the cutoff. It only matters on a changeover morning, when the hours between
 * midnight and the old cutoff still belong to the previous business day.
 */
export function getCurrentCutoff(config: CutoffSource | null | undefined): number {
  const candidate = resolveCutoffForDate(config, getCurrentTargetDateString());
  return resolveCutoffForDate(config, getLogicalShiftDate(candidate));
}

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
export function getCurrentTargetDayName(cutoffHour: number): string {
  const dateStr = getLogicalShiftDate(cutoffHour);
  const date = new Date(dateStr + "T12:00:00"); // noon to avoid timezone edge
  return date.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
}

/**
 * Returns the "logical shift date" based on the cutoff hour.
 * If the current time is before the cutoff (e.g., 7 AM),
 * the portal still shows YESTERDAY's date.
 */
export function getLogicalShiftDate(cutoffHour: number): string {
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
export function isInExtendedPeriod(cutoffHour: number): boolean {
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
  cutoffHour: number
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
  referenceCheckIn: string | null | undefined,
  isNightShift: boolean,
  cutoffHour: number
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
export function isValidNightShiftTime(time: string | null, cutoffHour: number): boolean {
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
export function isCheckInInToggleRange(checkIn: string | null, cutoffHour: number): boolean {
  if (!checkIn) return false;
  const [h] = checkIn.split(":").map(Number);
  return h >= 0 && h < cutoffHour;
}

export function validateSessionTimes(
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
  isNightShift: boolean = false,
  cutoffHour: number
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

/**
 * Derive a site's business-day cutoff from its default shift times.
 * EXACT mirror of server/src/utils/siteCutoff.js deriveSiteCutoff — keep the two in sync.
 *
 * - nightEnd = latest night default check-out, rounded UP to the next whole hour.
 * - dayStart = earliest day default check-in, floored to a whole hour.
 * - Valid cutoff range is [nightEnd, dayStart]; the midpoint is always safe.
 *
 * Returns { cutoffHour } or { conflict } with a human-readable message.
 */
export type SiteDefaultTimes = {
  defaultCheckIn?: string;
  staffDefaultCheckIn?: string;
  nightDefaultCheckOut?: string;
  staffNightDefaultCheckOut?: string;
};

export function deriveCutoffFromDefaults(
  times: SiteDefaultTimes
): { cutoffHour: number; conflict?: undefined } | { conflict: string; cutoffHour?: undefined } {
  const toMin = (t?: string): number | null => {
    if (!t) return null;
    const [h, m] = t.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  };

  const nightOuts = [times.nightDefaultCheckOut, times.staffNightDefaultCheckOut]
    .map(toMin)
    .filter((m): m is number => m !== null);
  const dayIns = [times.defaultCheckIn, times.staffDefaultCheckIn]
    .map(toMin)
    .filter((m): m is number => m !== null);

  const nightEnd = nightOuts.length ? Math.ceil(Math.max(...nightOuts) / 60) : null;
  const dayStart = dayIns.length ? Math.floor(Math.min(...dayIns) / 60) : null;

  if (nightEnd !== null && nightEnd > 12) {
    return { conflict: "Night shift check-out must be at or before 12:00 (noon)." };
  }

  if (nightEnd !== null && dayStart !== null) {
    if (nightEnd > dayStart) {
      return {
        conflict:
          `These times are contradictory: the night shift runs until ${nightEnd}:00 but the ` +
          `day shift starts at ${dayStart}:00 — the business-day boundary cannot sit between them.`,
      };
    }
    return { cutoffHour: Math.floor((nightEnd + dayStart) / 2) };
  }

  if (nightEnd !== null) {
    return { cutoffHour: nightEnd };
  }

  // No night default check-out (day-only site, or no times at all) → midnight boundary:
  // the business day is the calendar day, with no early-morning window.
  return { cutoffHour: 0 };
}


