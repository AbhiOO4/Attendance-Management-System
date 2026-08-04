/**
 * Date/time utilities for the app's fixed timezone.
 *
 * There is NO business-day cutoff hour: a record's business day is its `Attendance.date`,
 * and whether a punch landed on that day or the next is an explicit per-session day offset
 * (rawCheckIn/rawCheckOut + checkInNextDay/checkOutNextDay). The offset-based helpers at the
 * bottom of this file are the source of truth and mirror server/src/utils/timeLocal.js.
 */

export const APP_OFFSET = (() => {
  const envVal = import.meta.env.VITE_APP_TIMEZONE_OFFSET;
  if (envVal !== undefined && envVal !== "") {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return -330; // Fallback to IST
})();

export type WorkConfig = {
  fullDayHours: number;
  halfDayHours: number;
  overtimeThreshold: number;
  overtimeMultiplier: number;
  monthlyHoursDivisor: number;
  weeklyHolidays: string[];
  breakDurationMinutes: number;
};

/**
 * Normalize a business day to a Date at UTC midnight — matching how the server stores
 * `Attendance.date`.
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
 * Helper to get a Date object representing the current time shifted to target timezone
 * so that we can use UTC getters to read target local hours, date, etc.
 */
export function getCurrentTargetTime(): Date {
  const now = new Date();
  return new Date(now.getTime() - APP_OFFSET * 60 * 1000);
}

/**
 * Returns today's calendar date (YYYY-MM-DD) in the app's configured timezone.
 * This IS the business day: today's roster is the plain calendar day.
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
  const date = new Date(getCurrentTargetDateString() + "T12:00:00"); // noon to avoid tz edge
  return date.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
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
 * Compact "day month" label (e.g. "4 Aug") for the business day that sits
 * `offsetDays` after a record's `date` (offset 0 = the record's own day,
 * offset 1 = the following day). Used on the same-day / next-day session
 * toggles so the concrete calendar date each offset lands on is visible and
 * the user never has to guess it. Built off normalizeBusinessDate (UTC
 * midnight) and formatted in UTC so it can't drift a day.
 */
export function formatOffsetDayLabel(
  recordDate: string | Date | null | undefined,
  offsetDays: number
): string {
  const base = normalizeBusinessDate(recordDate);
  if (!base) return "";
  const dt = new Date(base.getTime());
  dt.setUTCDate(dt.getUTCDate() + offsetDays);
  return dt.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Local calendar date ("YYYY-MM-DD") of an absolute instant, in the app's timezone.
 * Mirrors server/src/utils/timeLocal.js toLocalDateString.
 */
export function toLocalDateString(dateVal?: string | Date | null): string {
  if (!dateVal) return "";
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - APP_OFFSET * 60 * 1000);
  return local.toISOString().split("T")[0];
}

/**
 * True when an absolute instant falls on a later calendar day than the record's
 * business day (its day offset is 1). Used to read back a session endpoint's next-day
 * flag from its stored/combined ISO — the cutoff-free source of truth.
 */
export function isNextDayInstant(
  dateVal: string | Date | null | undefined,
  recordDate: string | Date | null | undefined
): boolean {
  if (!dateVal || !recordDate) return false;
  const day = typeof recordDate === "string" && !recordDate.includes("T")
    ? recordDate
    : toLocalDateString(recordDate);
  const inst = toLocalDateString(dateVal);
  return !!inst && !!day && inst > day;
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

// ---------------------------------------------------------------------------
// Cutoff-free session helpers (cutoff redesign) — EXACT mirror of
// server/src/utils/timeLocal.js (combineFromOffset / deriveOffsets /
// minutesFromOffset / hoursFromOffset / validateSessionTimesV2). Keep in sync.
//
// Cross-midnight is an explicit per-session fact: each endpoint carries a 0/1 day
// offset from the record's business day. No cutoff hour is consulted.
// ---------------------------------------------------------------------------

/**
 * A single session may not span more than this many hours — a sanity net against a
 * mis-set day offset. Above the real max: genuine 24h shifts are rare but exist, so
 * 26 gives ~2h overrun headroom. A true 24h shift needs an explicit checkOutNextDay
 * marker (auto-detect can't tell 0h from 24h when check-in and check-out times match).
 */
export const MAX_SHIFT_HOURS = 26;

/**
 * Combine a business day + "HH:mm" + a day offset into an absolute ISO instant.
 * `nextDay` places the time on `recordDate + 1`. Returns null for an empty time.
 */
export function combineFromOffset(
  recordDate: string,
  time: string | null,
  nextDay: boolean = false
): string | null {
  if (!time) return null;
  const sign = APP_OFFSET <= 0 ? "+" : "-";
  const absMinutes = Math.abs(APP_OFFSET);
  const hoursOffset = String(Math.floor(absMinutes / 60)).padStart(2, "0");
  const minsOffset = String(absMinutes % 60).padStart(2, "0");
  const offsetStr = `${sign}${hoursOffset}:${minsOffset}`;

  const dateOnly = recordDate.includes("T") ? recordDate.split("T")[0] : recordDate;
  const dt = new Date(`${dateOnly}T${time}:00${offsetStr}`);
  const instant = nextDay ? new Date(dt.getTime() + 24 * 60 * 60 * 1000) : dt;
  return instant.toISOString();
}

/**
 * Derive the per-endpoint day offsets for a session from its raw times.
 * `startsAfterMidnight` is the explicit early-morning-tail intent.
 */
export function deriveOffsets(
  rawIn: string | null | undefined,
  rawOut: string | null | undefined,
  startsAfterMidnight: boolean = false
): { checkInNextDay: boolean; checkOutNextDay: boolean } {
  const checkInNextDay = !!startsAfterMidnight;
  let checkOutNextDay = checkInNextDay;
  if (rawIn && rawOut) {
    const [inH, inM] = rawIn.split(":").map(Number);
    const [outH, outM] = rawOut.split(":").map(Number);
    checkOutNextDay = checkInNextDay || outH * 60 + outM < inH * 60 + inM;
  }
  return { checkInNextDay, checkOutNextDay };
}

/** Minutes worked from raw times + offsets (no date, no cutoff). */
export function minutesFromOffset(
  rawIn: string | null | undefined,
  rawOut: string | null | undefined,
  checkInNextDay: boolean = false,
  checkOutNextDay: boolean = false
): number {
  if (!rawIn || !rawOut) return 0;
  const [inH, inM] = rawIn.split(":").map(Number);
  const [outH, outM] = rawOut.split(":").map(Number);
  const inTotal = (checkInNextDay ? 1440 : 0) + inH * 60 + inM;
  const outTotal = (checkOutNextDay ? 1440 : 0) + outH * 60 + outM;
  return outTotal - inTotal;
}

/** Hours worked (2dp) from raw times + offsets. Negative/zero → 0. */
export function hoursFromOffset(
  rawIn: string | null | undefined,
  rawOut: string | null | undefined,
  checkInNextDay: boolean = false,
  checkOutNextDay: boolean = false
): number {
  const diff = minutesFromOffset(rawIn, rawOut, checkInNextDay, checkOutNextDay);
  if (diff <= 0) return 0;
  return Math.round((diff / 60) * 100) / 100;
}

/**
 * Session-time validation — ordering and duration only, no boundary rules.
 * Returns null when valid, else a human-readable message.
 */
export function validateSessionTimesV2(
  rawIn: string | null | undefined,
  rawOut: string | null | undefined,
  checkInNextDay: boolean = false,
  checkOutNextDay: boolean = false
): string | null {
  if (!rawIn && rawOut) return "Check-out time cannot be entered without a check-in time.";
  if (!rawOut) return null; // open shift or empty — both valid
  const diff = minutesFromOffset(rawIn, rawOut, checkInNextDay, checkOutNextDay);
  if (diff <= 0) return "Check-out must be after check-in.";
  if (diff > MAX_SHIFT_HOURS * 60) {
    return `A single shift cannot exceed ${MAX_SHIFT_HOURS} hours — check the times or the next-day marker.`;
  }
  return null;
}


