# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Attendance tracking system ("NGDP AMS") for a construction/workshop
company. Supervisors mark daily attendance per site; admins manage sites,
employees and users; superadmins configure the work schedule and pull monthly
attendance reports. There is NO payroll/pay-rate logic — the app tracks hours
(worked, overtime, holiday) only, not money. Monorepo with two independent
packages: `server/` (Express + MongoDB API) and `client/` (React + Vite PWA).
There is no root package.json — each is installed and run separately.

## Commands

**Server** (`cd server`):
- `npm run dev` — start API with nodemon (`src/server.js`)
- `npm start` — start API with node
- Requires `server/.env` with `MONGO_URI`, `JWT_SECRET`, `PORT`, `CLIENT_URL`, and optionally `APP_TIMEZONE_OFFSET` (minutes, default `-330` = IST). For PWA push reminders it also reads `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` or URL) — generate a keypair with `npx web-push generate-vapid-keys`. If VAPID vars are absent, push is a no-op and the app still boots.

**Client** (`cd client`):
- `npm run dev` — Vite dev server (default http://localhost:5173)
- `npm run build` — `tsc -b && vite build`
- `npm run lint` — ESLint over the project
- `npm run preview` — preview the production build
- Requires `client/.env` with `VITE_API_URL` (default `http://localhost:3000`) and optionally `VITE_APP_TIMEZONE_OFFSET` (must match the server's offset).

There is no test suite. `server/src/seed/seed.js` is a scratch script (edit the
commented calls at the bottom, then `node src/seed/seed.js`) used to seed
users/work schedule and to recalculate all existing attendance after a
config-formula change — it currently connects via a hardcoded empty `real_db_url`,
so set that before running.

## Architecture

### Roles & auth
Three roles: `superadmin` > `admin` > `supervisor`. Auth is JWT stored in an
httpOnly cookie (`token`); the client uses axios with `withCredentials: true`
and never sees the token. Key pieces:
- `server/src/middlewares/verifyToken.js` — verifies the cookie, sets `req.user`.
- `server/src/middlewares/rbac.js` — `authorizeRoles(...)` (note: any route allowing
  `admin` implicitly allows `superadmin`) and `requireSiteAccess` (supervisors are
  restricted to their single `assignedSite`; admins/superadmins bypass it).
- Client mirrors this: `AuthContext` fetches `/api/user/me` on load; `ProtectedRoute`
  gates routes by `allowedRoles`; route table lives in `client/src/App.tsx`.

### Data model (`server/src/models/`)
- **Employee** — `employeeId` (unique), `jobTitle`, `currentSite`, `currentJob`,
  `employmentType` (permanent|temporary), `collarType` (skilled|staff, derived from the
  job title), `nationality` (foreign|omani, set on the employee), plus `pendingTransfer*`
  fields used by the cross-site transfer flow. `collarType × nationality` gives the FOUR
  roster categories: Foreign Skilled Labours, Foreign Staffs, Omani Labours, Omani Staffs.
- **Site** — has `jobs[]`, day/night default check-in/out time strings, and flags
  (`isPermanent`, `isActive`, `isDeleted`, `isCompleted`). A permanent site
  ("Workshop Phase 7") is auto-created on server boot. There are FOUR sets of day/night
  defaults, one per category: `defaultCheck*`/`nightDefaultCheck*` (foreign skilled),
  `staff*` (foreign staff), `omani*` (Omani labours), `omaniStaff*` (Omani staffs).
- **Job** — belongs to a Site, holds `employees[]`.
- **User** — supervisor/admin/superadmin; supervisors have `assignedSite` and an
  `employeeId`. Password is bcrypt-hashed in a pre-save hook and `select: false`.
- **Attendance** — one doc per employee per day (unique index on `{employee, date}`).
  Contains a `sessions[]` array (each session = one site's check-in/out, so an
  employee can work multiple sites in a day), plus derived `status`
  (fullday|halfday|absent), `totalWorkHours`, `overtimeHours`, `breaksTaken`,
  `isHoliday`, `isSickLeave`, and night-shift fields. A pre-save hook enforces the
  invariant that `isSickLeave` is only valid when no session has any check-in/out.
- **WorkSchedule** (`workModel.js`) — single `type: "default"` config doc:
  `fullDayHours`, `halfDayHours`, `overtimeThreshold`, `weeklyHolidays`,
  `breakDurationMinutes`. (The pay knobs `overtimeMultiplier` /
  `monthlyHoursDivisor` were removed with the payroll teardown.)
- **AttendanceLock** (`lockModel.js`) — one per `{siteId, date}`. Submitting
  attendance locks that site/day; only an admin can unlock it for editing.
- **Holiday** (`holidayModel.js`), **JobTitle** (`jobTitleModel.js`).

### API surface
Routes are mounted in `server/src/server.js` under `/api/{employees,user,attendance,site,config}`
→ `routes/*Routes.js` → `controllers/*Controller.js`. Controllers are the bulk of the
logic; `attendanceController.js` is by far the largest and holds the core hours math.
Route ordering matters: specific paths are declared before `/:id`-style wildcards.

### Hours calculation (the domain core)
`computeAttendanceTotals(rawHours, workConfig, breaksTaken, holidayInfo)` in
`server/src/utils/attendanceMath.js` is the single source of truth for the hours math
(used by the controller, crons, default propagation, and the seed recalc script):
1. **Status** is derived from RAW session hours (break-agnostic) to avoid demotions.
2. **Breaks** are one-per-day — `computeAutoBreaks(rawHours, fullDayHours)`: the first
   break is earned at a full day (`fullDayHours`), then +1 for each additional two full
   days, i.e. `rawHours < fullDay ? 0 : 1 + floor((rawHours − fullDay) / (2·fullDay))`
   (with a full day of 8h: <8h→0, 8–23h→1, 24h→2, 40h→3). Each worth
   `breakDurationMinutes`, unless a supervisor overrides `breaksTaken`. The client
   mirrors `computeAutoBreaks` in `client/src/lib/attendanceUtils.ts` — keep in sync.
3. **Net hours** = raw − total break deduction (floored at 0).
4. **Overtime** = net hours over `overtimeThreshold`; forced to 0 on holidays.
5. **Holiday hours** (`holidayHours` + `holidayReason` on the record): public
   holiday → net hours; weekly holiday → flat `WEEKLY_HOLIDAY_HOURS` credit
   (15 fullday / 10 halfday), with no payable day. The client mirrors this in
   `client/src/lib/attendanceUtils.ts` — keep the constants in sync.
Any change to this formula requires re-running the recalculation script in
`seed/seed.js` against existing records.

**No pay/money logic.** There is no per-employee salary, no OT rate and no pay
pricing (the old `server/src/utils/payMath.js`, `monthlySalary`, `overtimeMultiplier`
and `monthlyHoursDivisor` were all removed). The monthly report (`monthlyReport` in
`attendanceController.js`) is an HOURS report: per employee it returns `fullDays`,
`halfDays`, `absentDays`, `attendancePercentage`, `overtimeHours`, `holidayHours`,
and `totalOvertimeHours` (= `overtimeHours` + `holidayHours`, since OT and holiday
hours were paid at the same rate). `payableDays` is still computed internally to
derive `attendancePercentage` but is not returned.

### Time zones & night shifts (subtle — read carefully)
All timestamps are stored in UTC but the app operates in a single configured
timezone via `APP_TIMEZONE_OFFSET` / `VITE_APP_TIMEZONE_OFFSET` (minutes, default
`-330` = IST). These MUST match between client and server. The offset logic is
centralized:
- Server: `server/src/utils/timeLocal.js`
- Client: `client/src/lib/dateUtils.ts` (`APP_OFFSET`) — also the source of the
  `X-Timezone-Offset` header set in `client/src/lib/api.ts`.

**Business day = `Attendance.date`, and cross-midnight is an EXPLICIT per-session
fact — there is no cutoff hour.** (A `nightShiftCutoffHour` used to define a
"logical business day"; it was removed because a flexible workplace's day-start and
night-end windows overlap, so no single hour can separate them.)

Each session stores its times as entered plus a day offset from the record's
business day:
- `rawCheckIn` / `rawCheckOut` — `"HH:mm"` exactly as entered (source of truth)
- `checkInNextDay` / `checkOutNextDay` — `false` = on `date`, `true` = on `date + 1`
- `checkIn` / `checkOut` (Dates) are a DERIVED CACHE, recomputed from the above on
  every write by the `pre("save")` hook in `attendanceModel.js` (which covers every
  write path). `isNightShift` is retained only as a display convenience meaning
  "either endpoint is next-day".

Offsets are resolved per record by `resolveDayOffsets()` as a MONOTONIC timeline:
`deriveOffsets()` rolls a check-out to the next day when its wall time reads earlier
than the check-in, and any later session that would land before a crossing already
made inherits it. That places a site-switch continuation automatically —
`19:00→01:00` then `01:00→08:00` resolves to offsets `0/1` then `1/1`. It only rolls
forward when the timeline actually crossed midnight, so `09:00→17:00` followed by
`08:00→10:00` is left alone and reported as the overlap it probably is.

Clients may send explicit `checkInNextDay`/`checkOutNextDay`, which always win. That
is how the two cases nothing can infer are expressed: a STANDALONE early-morning tail
(`01:00→08:00` with no earlier session to inherit from) and shifts of 24h+
(`08:00→08:00`, where `out < in` is false). Both have toggles in `EditSiteRecord`.
NOTE: never re-derive a stored check-in's offset from its times on edit — an
early-morning session is indistinguishable from an ordinary morning shift and would
silently jump back 24h.

Validation is ordering + duration only (`MAX_SHIFT_HOURS = 26`); there are no boundary
rules, so a 06:00 day start and an 08:00 night check-out both pass. Overlap is checked
twice: within the record, and ACROSS days via `buildCrossDayOverlapChecker`
(`utils/sessionOverlap.js`) on submit/edit/backfill — sessions extending past midnight
live on different records, so the same hours could otherwise be paid twice.

Use the existing helpers rather than reimplementing offset math — server
`utils/timeLocal.js` (`combineFromOffset`, `deriveOffsets`, `hoursFromOffset`,
`validateSessionTimesV2`, `deriveRawOffsetFields`) mirrored in client
`lib/dateUtils.ts`; keep the two in sync.

**Carryover:** a session left open (check-in, no check-out) on YESTERDAY's record
surfaces on today's Site Attendance page — a pinned "pending check-out" card before
noon, and a clickable ⏳ Carryover badge on the employee's row all day. Closing it
writes to yesterday's record. Carryover employees are not auto-prefilled (they
default to absent) and their today inputs are locked until it is closed. The window
is a rolling one day; after that it is admin-only via edit-past. Nothing is
auto-filled — an unclosed session stays incomplete by design.

### Cron jobs (`server/src/cron/`)
Started on boot from `server.js`. `autoCheckOut.js` and `autoCheckIn.js` fill in
missing check-out/check-in times from each site's day/night default times for
sessions left open. Both are config-driven and CATEGORY-SCOPED: they run one mode per
roster category (foreign skilled / foreign staff / omani skilled / omani staff), using
`getEmployeeIdsByCategory()` (`utils/collar.js`) to touch only that category's employees
with its own default time. Day modes fill today's sessions; night modes fill yesterday's
(a shift started last evening checks out this morning). They reuse the `timeLocal.js`
helpers.

`checkoutReminder.js` (every 10 min) is the flip side: it PUSH-notifies about open
sessions the auto-checkout will NOT close. `utils/openSessionAudit.js` reproduces the
cron's decision — a session is "forgotten" when its category has no check-out default
(flagged after the config fallback `checkoutReminderTime`), a day default already
passed by `checkoutReminderGraceMinutes` and it's still open, or it's an open session
left on yesterday's record. It notifies the site's supervisor (deep-link
`/attendance/<siteId>`) and an admin/superadmin digest (`/site`), capped 3×/day and
≥1h apart via `User.checkoutReminder`. Delivery is `web-push` via `utils/webPush.js`
(needs the VAPID env); subscriptions live on `User.pushSubscriptions`
(`controllers/pushController.js`, routes under `/api/user/{vapid-public-key,
push-subscription}`). The roster field↔category map is shared in `utils/rosterFields.js`
(also used by `propagateDefaults.js`).

### Frontend
React 19 + React Router 7 + Vite 8, Tailwind v4, shadcn/ui components (Radix) under
`client/src/components/ui/`, `@` aliased to `client/src`. It's a PWA
(`vite-plugin-pwa`, `registerType: 'autoUpdate'`, `skipWaiting`/`clientsClaim` so
mobile clients auto-update). Pages in `client/src/pages/`, feature components in
`client/src/components/`, API calls go through the shared `api` axios instance.
Excel export via `exceljs`/`xlsx` for reports. PWA push: the generated Workbox SW is
kept (`generateSW`) and the `push`/`notificationclick` handlers are layered on via
`workbox.importScripts: ['push-sw.js']` → `client/public/push-sw.js`; the browser
subscribe/unsubscribe flow is `client/src/lib/push.ts`, surfaced by the
`PushReminderToggle` in the sidebar (self-hides where Web Push is unsupported, e.g.
iOS before the PWA is installed to the home screen).

## Conventions
- Server is ESM (`"type": "module"`) — use `import`/`export`, include `.js` extensions
  in relative imports.
- Controllers return `{ success, message, data? }` JSON and handle their own
  try/catch; follow that shape.
- Supervisor-writable endpoints must go through `requireSiteAccess`; keep specific
  Express routes above wildcard `/:id` routes.
