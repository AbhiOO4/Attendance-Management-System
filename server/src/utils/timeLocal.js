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

// ---------------------------------------------------------------------------
// Cutoff-free session helpers (cutoff redesign).
//
// Cross-midnight is an EXPLICIT per-session fact: each endpoint carries a 0/1 day
// offset from the record's business day (Attendance.date). Nothing here consults a
// cutoff hour — the record's date is the anchor and the offset says whether a punch
// landed on that day or the next. These sit alongside the legacy cutoff helpers
// above during the migration; call sites move over in Phase 4.
// ---------------------------------------------------------------------------

// A single session may not span more than this many hours — a sanity net against a
// mis-set day offset (a normal shift wrongly pushed a full day lands at 32h+). Set
// above the real maximum: genuine 24h shifts are rare but exist, so 26 gives ~2h of
// overrun headroom while still catching the common full-day mis-flag. NOTE a true
// 24h shift (e.g. 08:00→08:00) can't be auto-detected (out is not < in), so it must
// carry an explicit checkOutNextDay marker — see deriveOffsets.
export const MAX_SHIFT_HOURS = 26;

/**
 * Combine a business day ("YYYY-MM-DD") + "HH:mm" + a day offset into an absolute Date.
 * `nextDay` places the time on `dateStr + 1` (APP_OFFSET is a fixed offset with no DST,
 * so a calendar day is exactly 24h). Returns null for an empty time.
 */
export function combineFromOffset(dateStr, timeStr, nextDay = false) {
  if (!timeStr) return null;
  const offsetStr = getOffsetString(getAppOffsetMinutes());
  const dateOnly = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
  const dt = new Date(`${dateOnly}T${timeStr}:00${offsetStr}`);
  if (nextDay) return new Date(dt.getTime() + 24 * 60 * 60 * 1000);
  return dt;
}

/**
 * Derive the per-endpoint day offsets for a session from its raw times.
 *
 * `startsAfterMidnight` is the explicit "this shift begins in the small hours of the
 * day AFTER the anchor" intent (the 02:00→06:00 night-tail case). Otherwise the
 * check-in is same-day and the check-out rolls to the next day exactly when its wall
 * time is earlier than the check-in's (a shift crossing midnight).
 */
export function deriveOffsets(rawIn, rawOut, startsAfterMidnight = false) {
  const checkInNextDay = !!startsAfterMidnight;
  let checkOutNextDay = checkInNextDay;
  if (rawIn && rawOut) {
    const [inH, inM] = rawIn.split(":").map(Number);
    const [outH, outM] = rawOut.split(":").map(Number);
    checkOutNextDay = checkInNextDay || outH * 60 + outM < inH * 60 + inM;
  }
  return { checkInNextDay, checkOutNextDay };
}

/**
 * Resolve the day offsets for a record's sessions as a MONOTONIC timeline.
 *
 * `deriveOffsets` alone cannot place an all-early-morning session: by the clock, "01:00
 * tonight" (belonging to the next day) and "01:00 this morning" are identical. But a
 * record's sessions run forward in time, so once the timeline has crossed midnight every
 * later session is on the next day too. That resolves the common case without asking:
 *
 *   19:00 → 01:00 at site A   (crosses midnight — ends next-day)
 *   01:00 → 08:00 at site B   (starts when A ended → also next-day)
 *
 * Only rolls a session forward when the timeline has ALREADY crossed midnight and this
 * session would otherwise land before that crossing. A session that merely looks out of
 * order on a day that never crossed (09:00→17:00 then 08:00→10:00) is left alone, so it is
 * reported as the overlap it probably is instead of being silently moved to tomorrow.
 *
 * `sessions` are `{ rawCheckIn, rawCheckOut, checkInNextDay?, checkOutNextDay?,
 * startsAfterMidnight? }` in chronological entry order; explicit boolean offsets always win.
 * `priorSessions` are sessions already stored on the record (e.g. other sites'), as
 * `{ checkIn, checkOut }` Dates. Returns one `{ checkInNextDay, checkOutNextDay }` per input.
 */
export function resolveDayOffsets(dateStr, sessions, priorSessions = []) {
  const dayOnly = String(dateStr).includes("T") ? String(dateStr).split("T")[0] : String(dateStr);

  // The furthest point the record's timeline has already reached PAST midnight.
  let crossedEnd = null;
  const noteCrossing = (end) => {
    if (!end) return;
    const d = new Date(end);
    if (isNaN(d.getTime())) return;
    if (toLocalDateString(d) > dayOnly && (!crossedEnd || d.getTime() > crossedEnd.getTime())) {
      crossedEnd = d;
    }
  };

  for (const p of priorSessions || []) {
    if (p && p.checkOut) noteCrossing(p.checkOut);
  }

  return (sessions || []).map((s) => {
    const explicitIn = typeof s?.checkInNextDay === "boolean" ? s.checkInNextDay : null;
    const explicitOut = typeof s?.checkOutNextDay === "boolean" ? s.checkOutNextDay : null;

    let { checkInNextDay, checkOutNextDay } = deriveOffsets(
      s?.rawCheckIn,
      s?.rawCheckOut,
      !!s?.startsAfterMidnight
    );

    // Inherit the crossing: a session that would land before the timeline's current
    // position must belong to the next day.
    if (explicitIn === null && !checkInNextDay && s?.rawCheckIn && crossedEnd) {
      const sameDayStart = combineFromOffset(dayOnly, s.rawCheckIn, false);
      if (sameDayStart && sameDayStart.getTime() < crossedEnd.getTime()) {
        ({ checkInNextDay, checkOutNextDay } = deriveOffsets(s.rawCheckIn, s.rawCheckOut, true));
      }
    }

    if (explicitIn !== null) checkInNextDay = explicitIn;
    if (explicitOut !== null) checkOutNextDay = explicitOut;

    if (checkOutNextDay && s?.rawCheckOut) {
      noteCrossing(combineFromOffset(dayOnly, s.rawCheckOut, true));
    }

    return { checkInNextDay, checkOutNextDay };
  });
}

/**
 * Minutes worked, computed purely from raw times + offsets (no date, no cutoff).
 */
export function minutesFromOffset(rawIn, rawOut, checkInNextDay = false, checkOutNextDay = false) {
  if (!rawIn || !rawOut) return 0;
  const [inH, inM] = rawIn.split(":").map(Number);
  const [outH, outM] = rawOut.split(":").map(Number);
  const inTotal = (checkInNextDay ? 1440 : 0) + inH * 60 + inM;
  const outTotal = (checkOutNextDay ? 1440 : 0) + outH * 60 + outM;
  return outTotal - inTotal;
}

/**
 * Hours worked (2dp) from raw times + offsets. Negative/zero → 0.
 */
export function hoursFromOffset(rawIn, rawOut, checkInNextDay = false, checkOutNextDay = false) {
  const diff = minutesFromOffset(rawIn, rawOut, checkInNextDay, checkOutNextDay);
  if (diff <= 0) return 0;
  return Math.round((diff / 60) * 100) / 100;
}

/**
 * Cutoff-free replacement for validateSessionTimes. Validates ordering and duration
 * only — no boundary rules, so a 06:00 day start and an 08:00 night end both pass.
 * Returns null when valid, else a human-readable message.
 */
export function validateSessionTimesV2(rawIn, rawOut, checkInNextDay = false, checkOutNextDay = false) {
  if (!rawIn && rawOut) return "Check-out cannot exist without check-in";
  if (!rawOut) return null; // open shift or empty — both valid
  const diff = minutesFromOffset(rawIn, rawOut, checkInNextDay, checkOutNextDay);
  if (diff <= 0) return "Check-out must be after check-in.";
  if (diff > MAX_SHIFT_HOURS * 60) {
    return `A single shift cannot exceed ${MAX_SHIFT_HOURS} hours — check the times or the next-day marker.`;
  }
  return null;
}

/**
 * Local calendar date ("YYYY-MM-DD") of an absolute instant, in APP_OFFSET.
 */
export function toLocalDateString(date) {
  const offset = getAppOffsetMinutes();
  const local = new Date(new Date(date).getTime() - offset * 60 * 1000);
  return local.toISOString().split("T")[0];
}

/**
 * Derive the source-of-truth session fields (raw times + day offsets) FROM a session's
 * already-computed absolute Dates and its record's business day. Because the offset is
 * read back out of the stored Date's local calendar day, the result always agrees with
 * whatever produced that Date — the legacy cutoff combine (Phase 2 / migration) or the
 * offset combine (Phase 4). No cutoff is consulted.
 *
 * `businessDate` accepts the Attendance.date Date (stored at UTC midnight), an ISO
 * string, or "YYYY-MM-DD".
 */
export function deriveRawOffsetFields(businessDate, checkInDate, checkOutDate) {
  const day =
    businessDate instanceof Date
      ? businessDate.toISOString().split("T")[0]
      : String(businessDate).includes("T")
      ? String(businessDate).split("T")[0]
      : String(businessDate);
  return {
    rawCheckIn: checkInDate ? toLocalTimeString(checkInDate) : null,
    rawCheckOut: checkOutDate ? toLocalTimeString(checkOutDate) : null,
    checkInNextDay: checkInDate ? toLocalDateString(checkInDate) > day : false,
    checkOutNextDay: checkOutDate ? toLocalDateString(checkOutDate) > day : false,
  };
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
