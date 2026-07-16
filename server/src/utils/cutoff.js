/**
 * Effective-dated night-shift cutoff hour.
 *
 * The cutoff decides which calendar day an HH:mm time belongs to, and that decision is
 * baked into the stored `sessions[].checkIn/checkOut` Dates at write time (the raw HH:mm
 * is never persisted). So the cutoff cannot be read as "whatever it is right now" —
 * a record must always be validated and re-combined with the cutoff that was in force on
 * its own business day, or old records become uneditable and backfills land on the wrong day.
 *
 * `WorkSchedule.cutoffHistory` is the source of truth: an append-only, day-granular list of
 * `{ cutoffHour, effectiveFrom }`. Resolution picks the last entry whose `effectiveFrom` is
 * on or before the business day in question. The top-level `nightShiftCutoffHour` field is
 * kept as a mirror of the currently-active value, but is only read as a fallback for configs
 * that predate the history (see ensureCutoffHistory in server.js).
 */

import { getAppOffsetMinutes, getTodayLocal } from "./timeLocal.js";

// LEGACY-ONLY: the cutoff that governed all records before effective-dated histories
// shipped. Used exclusively to seed migration history entries (ensureCutoffHistory /
// seedHistoryFromGlobal); never as a live fallback — sites with no night default
// check-out now derive 0 (midnight, see utils/siteCutoff.js).
export const DEFAULT_CUTOFF_HOUR = 7;

/**
 * The `effectiveFrom` of the entry seeded by the migration. Far enough in the past that
 * every existing attendance record resolves to it.
 */
export const LEGACY_CUTOFF_EPOCH = new Date("1970-01-01T00:00:00.000Z");

/**
 * Normalize a business day to a Date at UTC midnight, matching how `Attendance.date` and
 * `cutoffHistory[].effectiveFrom` are stored. Accepts "YYYY-MM-DD", an ISO string, or a Date.
 */
export function normalizeBusinessDate(dateLike) {
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
 *
 * Works on any doc shaped `{ nightShiftCutoffHour, cutoffHistory }` — cutoffs are per-site
 * (Site docs carry their own derived history, see utils/siteCutoff.js), with the global
 * WorkSchedule doc only used as a seed/fallback.
 */
export function resolveCutoffForDate(workConfig, businessDate) {
  // Post-migration every doc has a history; a truly history-less doc falls back to its
  // mirror field, and to 0 (midnight — plain calendar days) when even that is absent.
  const fallback = workConfig?.nightShiftCutoffHour ?? 0;

  const history = workConfig?.cutoffHistory;
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
 * Today's *logical* business day ("YYYY-MM-DD") for a given cutoff: before the cutoff we are
 * still inside yesterday's business day.
 */
function getLogicalDateLocal(cutoffHour) {
  const localNow = new Date(Date.now() - getAppOffsetMinutes() * 60 * 1000);
  if (localNow.getUTCHours() < cutoffHour) {
    localNow.setUTCDate(localNow.getUTCDate() - 1);
  }
  return localNow.toISOString().split("T")[0];
}

/**
 * The cutoff in force right now.
 *
 * Resolving this is circular — you need a cutoff to know which business day it currently is,
 * and you need the business day to resolve the cutoff. Two passes converge because entries
 * are day-granular. It only matters on a changeover morning: between midnight and the old
 * cutoff we are still inside the previous business day, which must keep the old value.
 */
export function getCurrentCutoff(workConfig) {
  const candidate = resolveCutoffForDate(workConfig, getTodayLocal());
  return resolveCutoffForDate(workConfig, getLogicalDateLocal(candidate));
}

/**
 * True when an HH:mm check-in falls in the early-morning window (midnight → cutoff), i.e. it
 * belongs to the previous business day and the session is a night shift.
 */
export function isEarlyMorningCheckIn(timeStr, cutoffHour) {
  if (!timeStr) return false;
  const [h] = timeStr.split(":").map(Number);
  if (Number.isNaN(h)) return false;
  return h >= 0 && h < cutoffHour;
}

/**
 * The session check-in/check-out rules, all of which are relative to the cutoff hour.
 * Mirrored on the client in client/src/lib/dateUtils.ts — keep the two in sync.
 *
 * `cutoffHour` must be resolved for the record's own business day (resolveCutoffForDate).
 * Returns null when valid, or a human-readable message.
 */
export function validateSessionTimes(checkIn, checkOut, isNightShift = false, cutoffHour) {
  // No default: validating against "today's" cutoff instead of the record's own would make
  // records written under a previous cutoff permanently uneditable.
  if (typeof cutoffHour !== "number") {
    throw new Error("validateSessionTimes requires a cutoffHour resolved for the record's date");
  }

  // 1. RULE: Check-out without check-in is NOT allowed
  if (!checkIn && checkOut) {
    return "Check-out cannot exist without check-in";
  }

  // If check-in is present but no check-out, it's valid (representing an active shift)
  if (checkIn && !checkOut) {
    return null;
  }

  // If both are empty, it's valid (representing no shift)
  if (!checkIn && !checkOut) {
    return null;
  }

  const [inH, inM] = checkIn.split(":").map(Number);
  const [outH, outM] = checkOut.split(":").map(Number);
  const inMin = inH * 60 + inM;
  const outMin = outH * 60 + outM;
  const cutoffMin = cutoffHour * 60;

  // 2. RULE (Early Morning Check-in):
  // If check-in is between 12:00 AM and cutoffHour
  if (inH >= 0 && inH < cutoffHour) {
    const isOutInCutoffRange = (outMin >= 0) && (outMin <= cutoffMin);
    if (!isOutInCutoffRange || inMin >= outMin) {
      return `Check-out time must be before or equal to the cutoff hour (${cutoffHour}:00 AM) if checked in before ${cutoffHour}:00 AM.`;
    }
    return null;
  }

  // Detect if shift crosses midnight (check-out time < check-in time)
  const crossesMidnight = outMin < inMin;

  // 3. RULE (Through Midnight Shift):
  // If check-out is between 12:00 AM and cutoffHour and the shift crosses midnight
  if (crossesMidnight && (outMin >= 0 && outMin <= cutoffMin)) {
    if (inH < 12) {
      return `For night shifts crossing midnight and ending before ${cutoffHour}:00 AM, the check-in time must be 12:00 PM (noon) or later.`;
    }
  }

  // 4. RULE (Night Shift Check-in):
  if (isNightShift || crossesMidnight) {
    if (inH >= cutoffHour && inH < 12) {
      return `Check-in time must be before the cutoff hour (${cutoffHour}:00 AM) for night shifts.`;
    }
  }

  // 5. RULE (Night Shift Check-out):
  if (isNightShift || crossesMidnight) {
    if (outMin > cutoffMin && outH < 12) {
      return `Check-out time must be before or equal to the cutoff hour (${cutoffHour}:00 AM) for night shifts.`;
    }
  }

  return null;
}

// NOTE: the old validateSiteDefaultsAgainstCutoff helper is gone. The cutoff is now
// per-site and DERIVED from the site's default times (utils/siteCutoff.js), so site
// defaults can no longer contradict "the" cutoff — only each other (see deriveSiteCutoff
// and the cutoff-free sanity rules in siteController.updateSite).
