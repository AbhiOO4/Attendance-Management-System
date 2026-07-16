/**
 * Per-site derived night-shift cutoff.
 *
 * The cutoff hour is no longer a user-editable setting: it is derived from each site's own
 * default shift times, so it can never contradict them. The derived value still goes through
 * the same effective-dated history mechanism as the old global cutoff (see utils/cutoff.js):
 * a change applies from TOMORROW's business day, so records already written keep the cutoff
 * their stored check-in/out Dates were combined and validated with.
 *
 * Mirrored on the client in client/src/lib/dateUtils.ts (deriveCutoffFromDefaults) — keep
 * the two in sync.
 */

import { normalizeBusinessDate, getCurrentCutoff } from "./cutoff.js";
import { getDateLocal } from "./timeLocal.js";

function toMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * Derive a site's cutoff hour from its default shift times.
 *
 * - nightEnd = latest night-shift default check-out, rounded UP to the next whole hour.
 * - dayStart = earliest day-shift default check-in, floored to a whole hour.
 * - The valid cutoff range is exactly [nightEnd, dayStart] (validateSessionTimes rules 2 and 5),
 *   so the midpoint is always safe.
 * - NO night-shift default check-out → cutoff 0 (midnight): the site doesn't do night
 *   shifts, so its business day IS the calendar day and there is no early-morning window.
 *   validateSessionTimes will consequently reject cross-midnight sessions there until a
 *   night check-out is configured, which re-derives a real cutoff effective tomorrow
 *   (backfill is the cutoff-free escape hatch for historical exceptions).
 *
 * `times` may hold any subset of the site's default time fields ("" = unset).
 * Returns `{ cutoffHour }`, or `{ conflict }` with a human-readable message when the times
 * themselves are contradictory (no business-day boundary can sit between them).
 */
export function deriveSiteCutoff(times) {
  const nightOuts = [times?.nightDefaultCheckOut, times?.staffNightDefaultCheckOut]
    .map(toMinutes)
    .filter((m) => m !== null);
  const dayIns = [times?.defaultCheckIn, times?.staffDefaultCheckIn]
    .map(toMinutes)
    .filter((m) => m !== null);

  const nightEnd = nightOuts.length ? Math.ceil(Math.max(...nightOuts) / 60) : null;
  const dayStart = dayIns.length ? Math.floor(Math.min(...dayIns) / 60) : null;

  if (nightEnd !== null && nightEnd > 12) {
    return {
      conflict: "Night shift check-out must be at or before 12:00 (noon).",
    };
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

  // No night default check-out (day-only site, or no times at all) → midnight boundary.
  return { cutoffHour: 0 };
}

/**
 * Record a freshly derived cutoff on a site: append a history entry effective from
 * TOMORROW's business day, mirroring the exact semantics of the old global editor
 * (configController.updateWorkSchedule): an existing still-pending entry is replaced,
 * not stacked, and re-deriving back to the active value drops the pending entry.
 * The top-level mirror never flips before the entry's effective day.
 *
 * Mutates `site` (does not save).
 */
export function applyDerivedCutoff(site, derivedCutoff) {
  const effectiveFrom = normalizeBusinessDate(getDateLocal(1));
  const isPending = (entry) =>
    normalizeBusinessDate(entry.effectiveFrom).getTime() >= effectiveFrom.getTime();

  const activeCutoff = getCurrentCutoff(site);
  const kept = (site.cutoffHistory || []).filter((entry) => !isPending(entry));

  let cutoffChange = null;
  if (derivedCutoff !== activeCutoff) {
    kept.push({ cutoffHour: derivedCutoff, effectiveFrom });
    cutoffChange = { cutoffHour: derivedCutoff, effectiveFrom };
  }

  kept.sort(
    (a, b) =>
      normalizeBusinessDate(a.effectiveFrom).getTime() -
      normalizeBusinessDate(b.effectiveFrom).getTime()
  );

  site.cutoffHistory = kept;
  site.nightShiftCutoffHour = getCurrentCutoff(site);
  return cutoffChange;
}

/**
 * The history a site starts from: a copy of the global WorkSchedule history, because that
 * is what actually governed the site's records before cutoffs became per-site. Falls back
 * to a single legacy entry when the global history is empty (pre-migration config).
 */
export function seedHistoryFromGlobal(workConfig, legacyEpoch, defaultCutoff) {
  if (Array.isArray(workConfig?.cutoffHistory) && workConfig.cutoffHistory.length > 0) {
    return workConfig.cutoffHistory.map(({ cutoffHour, effectiveFrom }) => ({
      cutoffHour,
      effectiveFrom,
    }));
  }
  return [
    {
      cutoffHour: workConfig?.nightShiftCutoffHour ?? defaultCutoff,
      effectiveFrom: legacyEpoch,
    },
  ];
}
