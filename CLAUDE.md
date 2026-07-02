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
  `fullDayHours`, `halfDayHours`, `overtimeThreshold`, `overtimeRatePerHour`,
  `weeklyHolidays`, `nightShiftCutoffHour`, `breakDurationMinutes`.
- **AttendanceLock** (`lockModel.js`) — one per `{siteId, date}`. Submitting
  attendance locks that site/day; only an admin can unlock it for editing.
- **Holiday** (`holidayModel.js`), **JobTitle** (`jobTitleModel.js`).

### API surface
Routes are mounted in `server/src/server.js` under `/api/{employees,user,attendance,site,config}`
→ `routes/*Routes.js` → `controllers/*Controller.js`. Controllers are the bulk of the
logic; `attendanceController.js` is by far the largest and holds the core payroll math.
Route ordering matters: specific paths are declared before `/:id`-style wildcards.

### Payroll / hours calculation (the domain core)
`computeAttendanceTotals(rawHours, workConfig, breaksTaken)` in
`attendanceController.js` is the single source of truth for pay math:
1. **Status** is derived from RAW session hours (break-agnostic) to avoid demotions.
2. **Breaks** are proportional — `floor(rawHours / fullDayHours)` breaks by default,
   each worth `breakDurationMinutes`, unless a supervisor overrides `breaksTaken`.
3. **Net hours** = raw − total break deduction (floored at 0).
4. **Overtime** = net hours over `overtimeThreshold`.
Any change to this formula requires re-running the recalculation script in
`seed/seed.js` against existing records.

### Time zones & night shifts (subtle — read carefully)
All timestamps are stored in UTC but the app operates in a single configured
timezone via `APP_TIMEZONE_OFFSET` / `VITE_APP_TIMEZONE_OFFSET` (minutes, default
`-330` = IST). These MUST match between client and server. The offset logic is
centralized:
- Server: `server/src/utils/timeLocal.js`
- Client: `client/src/lib/dateUtils.ts` (`APP_OFFSET`) — also the source of the
  `X-Timezone-Offset` header set in `client/src/lib/api.ts`.

There is a **"logical business day"** concept driven by `nightShiftCutoffHour`
(default 7am): times before the cutoff belong to the *previous* calendar day, so a
night shift spanning midnight is one attendance record. Cross-midnight is either
explicit (`isNightShift`) or auto-detected (checkout time < checkin time). When
touching any check-in/out, hours, or date handling, use the existing helpers
(`combineDateAndTime*`, `calculateHoursBetween`, `getLogicalShiftDate`, etc.) rather
than reimplementing offset math.

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
