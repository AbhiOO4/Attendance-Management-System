# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Attendance & payroll automation system ("NGDP AMS") for a construction/workshop
company. Supervisors mark daily attendance per site; admins manage sites,
employees and users; superadmins configure the work schedule and pull monthly
payroll reports. Monorepo with two independent packages: `server/` (Express +
MongoDB API) and `client/` (React + Vite PWA). There is no root package.json —
each is installed and run separately.

## Commands

**Server** (`cd server`):
- `npm run dev` — start API with nodemon (`src/server.js`)
- `npm start` — start API with node
- Requires `server/.env` with `MONGO_URI`, `JWT_SECRET`, `PORT`, `CLIENT_URL`, and optionally `APP_TIMEZONE_OFFSET` (minutes, default `-330` = IST).

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
  `employmentType` (permanent|temporary), plus `pendingTransfer*` fields used by the
  cross-site transfer flow.
- **Site** — has `jobs[]`, day/night default check-in/out time strings, and flags
  (`isPermanent`, `isActive`, `isDeleted`, `isCompleted`). A permanent site
  ("Workshop Phase 7") is auto-created on server boot.
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
  `fullDayHours`, `halfDayHours`, `overtimeThreshold`, `overtimeMultiplier`,
  `monthlyHoursDivisor`, `weeklyHolidays`, `breakDurationMinutes`.
- **AttendanceLock** (`lockModel.js`) — one per `{siteId, date}`. Submitting
  attendance locks that site/day; only an admin can unlock it for editing.
- **Holiday** (`holidayModel.js`), **JobTitle** (`jobTitleModel.js`).

### API surface
Routes are mounted in `server/src/server.js` under `/api/{employees,user,attendance,site,config}`
→ `routes/*Routes.js` → `controllers/*Controller.js`. Controllers are the bulk of the
logic; `attendanceController.js` is by far the largest and holds the core payroll math.
Route ordering matters: specific paths are declared before `/:id`-style wildcards.

### Payroll / hours calculation (the domain core)
`computeAttendanceTotals(rawHours, workConfig, breaksTaken, holidayInfo)` in
`server/src/utils/attendanceMath.js` is the single source of truth for pay math
(used by the controller, crons, default propagation, and the seed recalc script):
1. **Status** is derived from RAW session hours (break-agnostic) to avoid demotions.
2. **Breaks** are proportional — `floor(rawHours / fullDayHours)` breaks by default,
   each worth `breakDurationMinutes`, unless a supervisor overrides `breaksTaken`.
3. **Net hours** = raw − total break deduction (floored at 0).
4. **Overtime** = net hours over `overtimeThreshold`; forced to 0 on holidays.
5. **Holiday hours** (`holidayHours` + `holidayReason` on the record): public
   holiday → net hours; weekly holiday → flat `WEEKLY_HOLIDAY_HOURS` credit
   (15 fullday / 10 halfday). The monthly report pays `holidayHours` at the OT
   rate with no payable day. The client mirrors this in
   `client/src/lib/attendanceUtils.ts` — keep the constants in sync.
Any change to this formula requires re-running the recalculation script in
`seed/seed.js` against existing records.

**Pay rates** (`server/src/utils/payMath.js`) are RELATIVE to each employee — there
is no flat company-wide OT rate. `computeOvertimeRate` derives it per employee:
`(monthlySalary / monthlyHoursDivisor) × overtimeMultiplier` (defaults 240 / 1.25,
both configurable). The monthly report is the only consumer; it prices both
`overtimeHours` and `holidayHours` at this rate. An employee with no `monthlySalary`
earns no OT pay. Pay is computed on READ, so a rate change re-prices past months —
no recalculation script needed, unlike the hours math above. Note `SALARY_DIVISOR = 26`
in the report is a separate thing: payable DAYS → daily salary.

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
sessions left open. They reuse the same `timeLocal.js` helpers.

### Frontend
React 19 + React Router 7 + Vite 8, Tailwind v4, shadcn/ui components (Radix) under
`client/src/components/ui/`, `@` aliased to `client/src`. It's a PWA
(`vite-plugin-pwa`, `registerType: 'autoUpdate'`, `skipWaiting`/`clientsClaim` so
mobile clients auto-update). Pages in `client/src/pages/`, feature components in
`client/src/components/`, API calls go through the shared `api` axios instance.
Excel export via `exceljs`/`xlsx` for reports.

## Conventions
- Server is ESM (`"type": "module"`) — use `import`/`export`, include `.js` extensions
  in relative imports.
- Controllers return `{ success, message, data? }` JSON and handle their own
  try/catch; follow that shape.
- Supervisor-writable endpoints must go through `requireSiteAccess`; keep specific
  Express routes above wildcard `/:id` routes.
