# Night-shift cutoff redesign — implementation plan

## Problem

The night-shift `cutoffHour` (a single hour that splits "yesterday's night tail"
from "today's day start") cannot model a flexible workplace where the **day-start
window and night-end window overlap**. A punch at 06:00 is ambiguous — it may be
yesterday's night shift finishing late or today's day shift starting early — and no
single hour can separate two overlapping sets. `deriveSiteCutoff` literally returns
a `conflict` for such sites (day-start earlier than night-end), so the model is
structurally unable to represent them.

Concretely broken today (cutoff = 7):
- **Day shift checks in 06:00** → `validateSessionTimes` rule 2 treats it as a night
  tail and rejects it.
- **Night shift checks out 08:00** → rule 5 rejects checkout after the cutoff.

## Core idea

Stop *inferring* the business day from the clock. Make cross-midnight an **explicit
per-session fact** chosen at mark time, and demote the cutoff from a hard validation
gate to (at most) a soft default. The record's `Attendance.date` is, and stays, the
authoritative business-day anchor; the cutoff never selected records — it only ever
(a) combined `HH:mm`→timestamp and (b) validated. Both jobs are replaced.

## Target data model

`Attendance.date` — unchanged, authoritative business-day anchor (UTC midnight).

Per session (`attendanceModel.js` sessionSchema), add:
- `rawCheckIn: String`  — `"HH:mm"` as entered (or `null`)
- `rawCheckOut: String` — `"HH:mm"` as entered (or `null`)
- `checkInNextDay: Boolean`  — 0/1 day offset of check-in from `date`
- `checkOutNextDay: Boolean` — 0/1 day offset of check-out from `date`

`checkIn` / `checkOut` (absolute `Date`s) are kept **only as a derived cache** for
sorting / overlap / hours, recomputed from `date + raw + offset` on every write. The
raw fields + offsets are the source of truth. `isNightShift` is retired in favor of
the offset flags (kept transiently during migration, then removed).

Absolute instant of an endpoint:
```
instant(date, rawTime, nextDay) = localDate(date + (nextDay?1:0) days) @ rawTime, in APP_OFFSET
```

## Rules after the change (all cutoff-free)

- **Combine**: `instant = date + rawTime (+1 day if nextDay)`. No cutoff.
- **Default offsets at mark time**: `checkInNextDay = false`; `checkOutNextDay = (outMin < inMin)`.
  A manual next-day toggle is needed for two cases the auto-rule can't infer:
  (a) the all-early-morning tail (e.g. 02:00→06:00 as a night continuation → set
  `checkInNextDay = true`); (b) genuine ≥24h shifts, which are rare but exist — a
  24h shift like 08:00→08:00 has `out == in`, so `out < in` is false and it would
  otherwise read as 0h. Phase 5's UI must expose this marker.
- **Validation** (`validateSessionTimes` rewrite): checkout requires checkin; derived
  duration must be `> 0` and `<= MAX_SHIFT_HOURS` (26h — above the real 24h max, with
  overrun headroom, while still catching a full-day mis-flag at 32h+); sessions on one
  record must not overlap. No boundary/cutoff rules.
- **Overlap** (same-record and cross-day): recompute instants from `date + raw + offset`.
  Cross-day check at `attendanceController.js:3634` compares against prev/next day
  records using derived instants.

## Carryover checkout UX (SiteAttendance)

"Carryover" = a session on **yesterday's** record for this site with a check-in and
**no** check-out. Rolling one-day window only.

- **Before noon**: a pinned "Pending checkout · <yesterday>" card lists all carryovers;
  each row's close-action writes to **yesterday's** record.
- **After noon**: the pinned card is removed entirely; the per-row badge on the
  employee's normal today-row remains (it was mirrored there all along) and stays the
  only surfacing for the rest of the day. Collapse-fully-into-rows.
- Carryover employees still appear as **normal absent/markable** today-rows (no auto
  prefill of a fresh check-in), badged. Default absent = an empty markable session.
- **No auto-fill.** Incomplete carryovers stay incomplete; supervisor closes within the
  one-day window, else an **admin** corrects it in edit-past. Once today rolls over, a
  still-open yesterday session drops off the live roster (admin-only from then on).
- Data source: one extra `GET /api/attendance/reports/daily?date=<yesterday>&siteId=<id>`
  filtered to open sessions. No new endpoint.

## What gets retired

Once nothing reads them:
- `WorkSchedule.cutoffHistory`, `Site.cutoffHistory`, `nightShiftCutoffHour` mirror
- `utils/cutoff.js`: `resolveCutoffForDate`, `getCurrentCutoff`, `isEarlyMorningCheckIn`,
  boundary rules in `validateSessionTimes`, `normalizeBusinessDate` (keep if still used)
- `utils/siteCutoff.js`: `deriveSiteCutoff`, `applyDerivedCutoff`, `seedHistoryFromGlobal`
- Client mirror equivalents in `lib/dateUtils.ts` (`deriveCutoffFromDefaults`,
  `getCurrentCutoff`, `resolveCutoffForDate`, `isValidNightShiftTime`,
  `isCheckInInToggleRange`, cutoff params on combine/validate/hours)
- `combineDateAndTimeLocal`'s `cutoffHour`/`isNightShift` branch → offset-based

## Migration

One-time backfill (new script under `server/src/seed/`), for every session with a
stored `checkIn`/`checkOut`:
- `rawCheckIn = toLocalTimeString(checkIn)`, `rawCheckOut = toLocalTimeString(checkOut)`
- `checkInNextDay = localCalendarDate(checkIn) > Attendance.date`
- `checkOutNextDay = localCalendarDate(checkOut) > Attendance.date`

This reads the offset straight from the already-correct stored Dates — **no cutoff
needed**. Payroll math (`attendanceMath.js`) is untouched → **no hours recalc**.

## Phased execution (keep the app runnable at every step)

**Phase 1 — foundation (backward-compatible, additive).**
- Add the four new session fields to `attendanceModel.js` as optional.
- Add cutoff-free helpers: `combineFromOffset(date, rawTime, nextDay)` and a
  `deriveOffsets(rawIn, rawOut, startsAfterMidnight)` in `utils/timeLocal.js`; mirror
  in `lib/dateUtils.ts`. New `validateSessionTimesV2` (cutoff-free) beside the old one.
- Nothing removed; nothing switched. App behaves exactly as before.

**Phase 2 — write path populates new fields.**
- Every server write (submit, edit, add-session, transfer, both crons,
  `propagateDefaults`) sets `raw*` + `*NextDay` alongside the derived Dates.
- Client sends `rawCheckIn/rawCheckOut/checkInNextDay/checkOutNextDay`.

**Phase 3 — migration script.** Backfill existing records (above). Run once.

**Phase 4 — switch reads to the new fields.**
- Validation + overlap + hours use raw+offset (cutoff-free). Client `dateUtils`
  consumers drop the cutoff params. Combine derives Dates from offsets.

**Phase 5 — carryover UX** in `SiteAttendance.tsx` (pinned-before-noon card, per-row
badge, write-to-yesterday close action, no auto-prefill for carryover employees).

**Phase 6 — cleanup.** Remove `cutoffHistory`/`deriveSiteCutoff`/boundary rules/mirror
fields and the now-dead cutoff params once nothing references them. Update `CLAUDE.md`.

## Files in scope

Server: `models/attendanceModel.js`, `models/siteModel.js`, `models/workModel.js`,
`utils/timeLocal.js`, `utils/cutoff.js`, `utils/siteCutoff.js`, `utils/sessionOverlap.js`,
`controllers/attendanceController.js`, `controllers/siteController.js`,
`controllers/configController.js`, `cron/autoCheckOut.js`, `cron/autoCheckIn.js`,
`utils/propagateDefaults.js`, `server.js` (ensureCutoffHistory), new migration script.

Client: `lib/dateUtils.ts`, `pages/SiteAttendance.tsx`, `pages/MarkAttendance.tsx`,
`pages/DashBoard.tsx`, `components/EditSiteRecord.tsx`, `components/EditRecord.tsx`,
`components/BackfillModal.tsx`, `context/WorkConfigContext.tsx`, `pages/Configure.tsx`.

## Edge cases to hold in mind

- Transfer flow (`transferredFromSiteId`, pending transfers) writes sessions — must set
  raw+offset.
- Cross-site multi-session days: offsets are per session, per endpoint.
- Both crons: rework off `isNightShift`→offsets; they are no longer a carryover safety net.
- Edit-past remains the admin correction surface for stale open carryovers.
- The all-early-morning tail (02:00→06:00) needs the manual `checkInNextDay` toggle.
