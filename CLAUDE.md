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
- Requires `server/.env` with `MONGO_URI`, `JWT_SECRET`, `PORT`, `CLIENT_URL`, and optionally `APP_TIMEZONE_OFFSET` (minutes, default `-330` = IST). `SAME_SITE` (`strict`|`lax`|`none`) sets the auth cookie's SameSite per deployment (`authCookieOptions()` in `utils/generateTokenAndSetCookie.js`): `lax` when client and API share a registrable domain (live: `ngdp.online` → `api.ngdp.online`), `none` when they're cross-site (forces `Secure`); unset/invalid keeps the legacy default (`none` in production, `strict` otherwise). For PWA push reminders it also reads `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` or URL) — generate a keypair with `npx web-push generate-vapid-keys`. If VAPID vars are absent, push is a no-op and the app still boots.

**Client** (`cd client`):
- `npm run dev` — Vite dev server (default http://localhost:5173)
- `npm run build` — `tsc -b && vite build`
- `npm run lint` — ESLint over the project
- `npm run preview` — preview the production build
- Requires `client/.env` with `VITE_API_URL` (default `http://localhost:3000`) and optionally `VITE_APP_TIMEZONE_OFFSET` (must match the server's offset).

There is no test suite. `server/src/seed/seed.js` is a scratch script (edit the
commented calls at the bottom, then `node src/seed/seed.js`) used to seed
users/work schedule and to recalculate attendance after a config-formula change.
Nothing connects on import: the one-off seed helpers need `await connectDB(url)` first,
while `recalculateAttendanceInRange(dbUrl, "YYYY-MM-DD", "YYYY-MM-DD")` (business days,
both inclusive) and `recalculateExistingAttendance(dbUrl)` connect themselves. The
recalc writes only the day-total fields via `bulkWrite` (timestamps off), never
`record.save()`. The save hook re-derives session raw times from THIS machine's
`APP_TIMEZONE_OFFSET`, which would corrupt live (Oman) records from an IST `.env`.

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
  fields used by the cross-site transfer / "only for today" visit flow — including
  `pendingTransferJobId`, the job the visitor works at the visited site today (kept out of
  `currentJob` so a visit never touches the home-site job/membership; it becomes the
  session's `jobId` when that site's draft is built, and is cleared with the rest of the
  stash on submit). `collarType × nationality` gives the FOUR
  roster categories: Foreign Skilled Labours, Foreign Staffs, Omani Labours, Omani Staffs.
- **Site** — has `jobs[]`, day/night default check-in/out time strings, and flags
  (`isPermanent`, `isActive`, `isDeleted`, `isCompleted`). A permanent site
  ("Workshop Phase 7") is auto-created on server boot. There are FOUR sets of day/night
  defaults, one per category: `defaultCheck*`/`nightDefaultCheck*` (foreign skilled),
  `staff*` (foreign staff), `omani*` (Omani labours), `omaniStaff*` (Omani staffs).
- **Job** — belongs to a Site, holds `employees[]`. A GLOBAL job (`isGlobal: true`, `site: null`)
  belongs to no site and is a session-only job offered everywhere — see "Global jobs" below.
- **User** — supervisor/admin/superadmin; supervisors have `assignedSite` and an
  `employeeId`. Password is bcrypt-hashed in a pre-save hook and `select: false`.
- **Attendance** — one doc per employee per day (unique index on `{employee, date}`).
  Contains a `sessions[]` array (each session = one site's check-in/out, so an
  employee can work multiple sites in a day), plus derived `status`
  (fullday|halfday|absent), `totalWorkHours`, `overtimeHours`, `breaksTaken`,
  `isHoliday`, the leave flags `isPaidLeave` / `isEmergencyLeave` / `isSickLeave` /
  `isLop`, and night-shift fields. A pre-save hook enforces the invariant that a leave
  flag is only valid when no session has any check-in/out, and that they are mutually
  exclusive (precedence paid > emergency > sick > lop).
- **Leave** (`leaveModel.js`) — the ledger of leave APPLICATIONS over a range: `type`
  `annual` (PAID → `isPaidLeave`, capped by allocations) or `emergency` (excused but
  UNPAID like sick leave, no cap → `isEmergencyLeave`, counts as an absent day in
  reports). Managed ONLY on the Leave page (`/leave`, `pages/Leave.tsx`, admin+superadmin,
  sidebar "Leave"): tab Applications (create `POST /leave`, EDIT `PUT /leave/:id` = revert +
  re-apply in one transaction via `revertLeaveDays`/`applyLeaveDays`, cancel, DELETE `/leave/:id`
  — only a cancelled one (409 otherwise), list `GET /leave`; row actions in a kebab menu)
  and tab Allocations. The employee timesheet only shows the balance chip + a read-only history.
- **LeaveAllocation** (`leaveAllocationModel.js`, `controllers/leaveAllocationController.js`,
  routes `/api/attendance/leave/allocations*`) — the ONLY source of annual allowance: one
  employee, `fromDate`–`toDate`, `days`. One employee's allocations NEVER overlap (409
  `ALLOCATION_OVERLAP`); an allocation can't be cut below / shrunk away from annual days already
  taken, nor deleted while used. "Used" is derived (count `isPaidLeave` inside the range), never
  stored — `utils/leaveBalance.js` (`checkAnnualAgainstAllocations`: every annual day must sit in
  an allocation with room; `allocationSummaries` for `GET /leave/balance/:id`). The old
  `Employee.annualLeaveEntitlement` / `WorkSchedule.annualLeaveDefaultDays` were removed;
  production was moved over by `seed/migrateLeaveAllocations.js "<url>" [--apply]` (60 days,
  2026, for employees with an active annual grant). Endpoints under `/api/attendance/leave/*`
  take `type`. A granted day of
  either type is LOCKED: submit skips it, edits 409, the crons skip it, and the
  Site Attendance draft excludes it (`GET /leave/on-date`, mirrored by
  `utils/draftRoster.js`). Grant/cancel run in `session.withTransaction` with strictly
  SEQUENTIAL operations — never `Promise.all` on a transaction session (the driver
  doesn't support it; it made grants fail intermittently with NoSuchTransaction).
- **WorkSchedule** (`workModel.js`) — single `type: "default"` config doc:
  `fullDayHours`, `halfDayHours`, `overtimeThreshold`, `weeklyHolidays`,
  `breakDurationMinutes`, `breakMinHours` (see Hours calculation §2, §5), plus the ERPNext
  export labels and `overtimeActivityMultiplier` (see "Activity types"), and
  `supervisorBackfillWindowDays` (see "Supervisor backfill requests"). (The weekly-holiday award knobs
  `weeklyHolidayAwardEnabled` / `weeklyHolidayAwardHours` / `weeklyHolidayMinHours`,
  and the pay knobs `overtimeMultiplier` / `monthlyHoursDivisor`, were removed.)
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
2. **Breaks** are 0 or 1 per day, NEVER more (`MAX_BREAKS_PER_DAY = 1`; a 24h shift
   still deducts one). `computeAutoBreaks(rawHours, breakMinHours)` gives 1 once raw hours
   reach the configurable `WorkSchedule.breakMinHours` (Configure → "Break After (hours)"),
   else 0; `resolveBreakMinHours(workConfig)` falls back to `fullDayHours` when it is
   null/unset (also covers `.lean()` reads and hand-built config objects). The break is
   worth `breakDurationMinutes`. A supervisor `breaksTaken` override is clamped to 0–1 in
   the math, and the Attendance schema setter clamps new writes (legacy stored 2+ values
   are left alone — the cap was rolled out going-forward only, no recalc was run; old
   records pick it up when next recomputed). The client mirrors `MAX_BREAKS_PER_DAY`,
   `resolveBreakMinHours`, `computeAutoBreaks` and `clampBreaks` in
   `client/src/lib/attendanceUtils.ts` — keep in sync.
3. **Net hours** = raw − total break deduction (floored at 0).
4. **Overtime** = net hours over `overtimeThreshold`; forced to 0 on holidays.
5. **Holiday hours** (`holidayHours` + `holidayReason` on the record): any holiday,
   public or weekly, credits the day's net worked hours (the `weekly` vs `public`
   `reason` is retained only for display). The client mirrors this in
   `client/src/lib/attendanceUtils.ts` (`computeHolidayHours`) — keep it in sync.
Any change to this formula requires re-running the recalculation script in
`seed/seed.js` against existing records.

**No pay/money logic.** There is no per-employee salary, no OT rate and no pay
pricing (the old `server/src/utils/payMath.js`, `monthlySalary`, `overtimeMultiplier`
and `monthlyHoursDivisor` were all removed). The only stored money values are the
activity-type rates (see "Activity types" below), which are ERPNext master data — nothing
in AMS computes with them. The monthly report (`monthlyReport` in
`attendanceController.js`) is an hours + PAYMENT-DAYS report, built to be cross-checked
against the ERPNext salary slip. Every day is classified by `classifyPayrollDay(record)`
(`server/src/utils/payrollDay.js`) — the SAME function the ERPNext Attendance CSV
(`erpAttendanceStatus`) uses, so the two cannot drift; the client mirrors it in
`client/src/lib/payrollDay.ts` (employee timesheet tiles) — keep in sync. Kinds, in order:
`holiday` (any `isHoliday` record, worked or not — never deducted, in NO day bucket; a day
off is paid and holiday work is paid as `holidayHours`, which the CSV sends as overtime) →
`annual` (paid leave, `leaveDays`, "On Leave") → `full` → `half` ("Half Day" + LWP) →
`absent` with a reason: emergency > sick > lop > none ("none" includes a PENDING day —
checked in, no check-out — which the CSV also sends as Absent). Per employee it returns
`workingDays` (EVERY calendar day of the span, holidays included, the whole span — like
ERPNext "Include holidays in Total no. of Working Days"), `paymentDays` = workingDays −
`absentDays` − 0.5 × `halfDays`, `absentDays` = `noReasonAbsentDays` + `emergencyLeaveDays`
+ `sickLeaveDays` + `lopDays` (ALL unpaid days; annual leave is never in it), `pendingDays`
(subset of no-reason, flagged so it's closed before export), `fullDays`, `unmarkedDays`
(days BEFORE today with NO record, holidays excluded except for temporaries, from the
employee's `createdAt`, active only — `utils/unmarkedDays.js`, shared with the employee
timesheet endpoint's `payroll` field). `WorkSchedule.countUnmarkedAsAbsent` (Configure →
ERPNext Export, default ON, read as `!== false`) mirrors ERPNext "Consider Unmarked
Attendance As": ON = Absent → they are added to `noReasonAbsentDays` (so to `absentDays`);
OFF = Present → counted as paid. Responses carry `unmarkedAsAbsent`), `attendancePercentage` =
paymentDays ÷ workingDays, and `overtimeHours`, `holidayHours`, `totalOvertimeHours`
(= OT + holiday hours, paid at the same rate). Known slip differences: ERPNext prorates
working days from the joining/relieving date (AMS has no joining date), and temporary
workers have no ERPNext slip. A WORKED holiday goes into the ERPNext Attendance CSV as
"Present" with `holidayHours` as the Actual Overtime Duration (needs `erpOvertimeType`; the
Overtime Slip only reads Present rows); unworked holidays stay skipped. The tally lives in
`buildAttendanceReport(fromDay, toDay)` (inclusive UTC-midnight bounds), shared by
`GET /reports/monthly/:month/:year` and `GET /reports/range?from&to`
(`rangeReport`, superadmin, strict `YYYY-MM-DD`, ≤ 366 days). The Reports page offers
Month | Date range (`components/DateRangePicker.tsx`); ERPNext export stays per-month and
is disabled in range mode. It writes two files (Attendance, Timesheet — no OT summary) for
the employees ticked in the table or everyone the page's filters list:
`POST /reports/erpnext/:month/:year { type, employeeIds }` (Mongo ids; report rows carry `_id`).
Absent-reason and annual-leave labels/colors are shared in `client/src/lib/leaveComposition.ts`
(`ABSENT_REASONS`, `ANNUAL_LEAVE`; also used by the employee timesheet's tiles).

**Site manpower report.** `GET /api/site/:siteId/manpower` (admin/superadmin) is TODAY's
headcount for a site by trade (job title) and roster category, built by
`server/src/utils/siteManpower.js`. People = the draft roster (`computeExpectedDraftRoster`)
∪ anyone with a session at the site today ∪ home members on paid leave. Status per person:
`leave`/`sick` (paid/sick leave) → `present` (a session here with a check-in) → `absent` (a
session here, no check-in; includes LOP) → `notMarked` (no session here yet — everyone before
the first save). The "Manpower" button on Site Detail (`components/site/SiteManpowerReport.tsx`)
shows it and exports Excel/PDF via `client/src/lib/manpowerExport.ts` (exceljs / jsPDF loaded
on demand). A midday transfer counts as present at both sites for the day.

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

### Draft freshness & submit guards
The Site Attendance draft is built client-side from the roster (`loadRosterContext` →
`mergeDraftWithRoster` in `SiteAttendance.tsx`) and a page can sit open for hours, so:
- **Submit roster guard** — `siteFirstSubmitAttendance` compares the posted employee set with
  `computeExpectedDraftRoster` (`server/src/utils/draftRoster.js`, today only) and refuses a
  mismatch with 409 `ROSTER_CHANGED` `{ rosterChange: { added, removed } }` before any write.
  The client merges the change, flags rows "New" and asks for another Save (never auto-resubmits).
  `draftRoster.js` MUST mirror the client draft filter exactly or every submit for a site is
  refused — `findRecordedElsewhere` there is also what `GET /api/employees` uses.
- **Same-day moves write no attendance into an UNSAVED site** — Send-to-site and an accepted
  pull request only change the Employee (`currentSite` repoint, or the `pendingTransfer*` stash);
  the destination's Save creates the record. Only a LOCKED destination gets the record directly
  (`createPreSaveVisitRecord`), since it never rebuilds a draft. (A midday Transfer always writes:
  it carries a real source check-out onto an existing record.) Submit and these moves both bump
  `Site.rosterRev` (`touchSiteRosters`) so a concurrent pair write-conflicts and one gets a 409.
- **Already submitted** — any lock doc → 409 `ALREADY_SUBMITTED` `{ lockedByName, lockedAt }`
  (a race's E11000 maps to the same; a write conflict → `SUBMIT_CONFLICT`). The page drops its
  draft and shows the saved sheet.
- **Saved-row edits** carry `expectedUpdatedAt` (the record's `updatedAt` as loaded);
  `updateAttendance` answers 409 `RECORD_CHANGED` when it moved, instead of overwriting newer
  times from another device or the auto-checkout cron. The remark endpoint writes with
  `timestamps: false` so a remark doesn't trip it.
- **Refresh** — the page re-checks lock/roster/carryovers (draft) or reloads the sheet (saved)
  on visibility/focus/online/pageshow and on a timer; failures to load the day's state show a
  Retry card rather than a guessed draft. Rows exactly equal to their previous derived default
  (untouched) follow a changed default on refresh. API responses are `Cache-Control: no-store`
  and the service worker deliberately has no `/api` runtime cache.

**Mandatory session job.** Once a site has a live job (not deleted, active, not completed —
server `siteHasLiveJobs` in `utils/siteAssignable.js`, client `liveSiteJobs` in `lib/siteJobs.ts`;
keep in sync), every session there with a check-in/out must name a job: the draft submit, the
saved-row inline editor and `EditSiteRecord` refuse it client-side, and `siteFirstSubmitAttendance`
/ `updateAttendance` (only when called with `?siteId`) answer 400 `JOB_REQUIRED`. Transfers,
send-to-site and pull requests stay job-optional; a saved session left without one shows a red
"No job · Assign" chip. The drivers sheet keeps its own any-site job rule.

**Drivers live ONLY on Drivers Attendance.** A driver = active + job title contains "driver" (title
only — `driverEmployeeFilter` / `isDriverEmployee` / `isDriverTitle` in `utils/driverPool.js`, client
`isDriverTitle` in `lib/driverJobs.ts`). They never get a site: every placement path refuses them with
400 `DRIVER_ONLY` (`DRIVER_ONLY_MESSAGE`) — insta-add (and its candidate list), assign/assign-supervisor,
send-to-site, requests (create; accept expires it), `transferEmployee` (also from the pool), temp-worker
assign/pool, `addEmployee` with a site, plus a backstop in `utils/handover.js`; the scheduled-assignment
cron DROPS a driver's schedule. Attendance writers refuse a driver's session at a real site
(`nonPoolDriverSessionError`): site-sheet submit, `updateAttendance` (NEW/moved sessions only — history
already at a site stays editable), backfill, add-session; bulk backfill / night shift / bulk edit skip
them. Editing a title INTO a driver title clears every placement (`releaseSitePlacement`: site, job,
Job.employees, visit stash, schedule) and re-syncs supervisor scope. `seed/moveDriversToPool.js
"<mongo url>" [--apply]` does the same for drivers placed before the rule (dry run by default). The
Employees list shows a driver's site as the one their LATEST pool session served
(`latestServedPlaces` → `driverSite` on `GET /api/employees` rows), with no job.

**Drivers in the past-day editors.** Driver sessions live on the hidden Drivers pool site
(`utils/driverPool.js`), which `GET /api/site` hides unless `?includeDriverPool=true` (admins
only; appended last, flagged `isDriverPool`). Edit past (`EditRecord`), Backfill and Bulk backfill
fetch it that way and render it as a "No site → Drivers" place via
`components/SessionSiteJobFields.tsx` — offered only for drivers (job title contains "driver",
client `isDriverTitle` in `lib/driverJobs.ts` ↔ server `DRIVER_TITLE_REGEX`) or a session already
on it, and preselected for drivers. A Drivers session names a site + job split (below) and needs one.
Server: `validateDriverPoolSessions` (backfill, admin edit without `?siteId`) and the bulk backfill
pool branch (non-drivers skipped "Not a driver") check it — LENIENT on liveness for past days.
Edit past + Missing offer a "Drivers" filter (Missing maps it to `driverEmployeeFilter()`).

**Driver job splits** (`utils/jobSplit.js`, client `lib/jobSplit.ts` — keep in sync). A driver serves a
SITE, not one job: a Drivers-pool session stores `servedSiteId` + `splitJobIds` (`jobId: null`) and its
hours are split EQUALLY across those jobs. `servedSiteId: null` = the "General" place (global jobs).
A session's jobs are ALWAYS read via `sessionJobIds`: `splitJobIds` when non-empty, else `[jobId]` —
legacy single-job driver sessions still work and convert to a one-job split when next saved.
`resolveDriverSplit(jobIds, { strict })` derives the site server-side (all jobs at ONE real site, or all
global; mixes refused); `strict` (today's sheet) also needs every job live + the site assignable.
Clients send only `splitJobIds`. `updateAttendance` CARRIES a stored split forward when a body session
omits `splitJobIds` (sick/LOP toggles, carryover closes, times-only edits) and re-checks liveness only
when the split changed. Picker: `components/drivers/SiteSplitPicker.tsx` (sites with no live job are
listed muted + unpickable — `GET /api/drivers/jobs` now includes them with `jobs: []`; a fresh pick
ticks every live job; the last tick can't be removed). Used by the Drivers sheet (draft + inline),
`EditSiteRecord`, `SessionSiteJobFields` (Edit past, Backfill) and Bulk backfill. Draft prefill =
`lastPlace` from `GET /api/drivers/roster` (last site served, ALL its current live jobs ticked).
Readers that divide by N: `jobReport` (`_jobs`/`_n` after `$unwind`), `jobManHoursAndDays`, and
`buildTimesheetCsv`, which lays the N slices ONE AFTER ANOTHER from check-in (each in its own job's
Timesheet) so ERPNext never sees overlapping time logs. Responses carry `servedSite` + `splitJobs`
(`buildSplitLookup`); `sessionJobCell` renders them in tables/exports.

**Global jobs** (`utils/globalJobs.js`, client `lib/globalJobs.ts`) — jobs common to every site,
for hours tracked against general expenses (e.g. drivers). A `Job` with `isGlobal: true, site: null`,
so populates, the Jobs report and the ERPNext timesheet (jobCode → Job Order) bill it like any job.
Code = alphanumeric segments joined by single hyphens (`JOB_CODE_REGEX` / `JOB_CODE_PATTERN`, keep in
sync), unique across ALL jobs, case-insensitively checked on create. Managed by admins on Sites →
Global Jobs (`/site/global-jobs`, `pages/GlobalJobs.tsx`) via `/api/jobs/global` (GET live list for
every role; `/manage`, POST, `PATCH /:jobId/status`, DELETE soft — admin). Offered as a "Global (all
sites)" group in every session job picker (site sheet draft/inline/`EditSiteRecord`, admin
`EditRecord`; for drivers, the "General" place of the site split picker). SESSION-ONLY: never a `currentJob` —
`syncCurrentJobFromLatestSession` skips it, `findAssignableJob` rejects a job with no site, and the
site job-assignment endpoints 400 it. It never makes a job MANDATORY: a site with no jobs of its own
shows the Job column (`showJobColumn`) with an optional picker ("No job" clears it); `siteHasJobs` /
`siteHasLiveJobs` still count only the site's own jobs. Submit validates a picked job with
`findSessionJob` (global or the site's). The Jobs report lists them first as one "Global jobs (all
sites)" group; Site Detail's per-job stats show only the site's own jobs.

**Activity types** (`models/activityTypeModel.js`, `utils/activityTypes.js`, client
`lib/activityTypes.ts` — keep in sync) — ERPNext Activity Types as rate bands (`name`,
mandatory `costingRate` + `billingRate`) allocated per employee (`Employee.activityType`), so
ERPNext costs time-logs at the type's DEFAULT rates with no per-employee Activity Cost. Every
type has an automatic OVERTIME twin that is never stored: name = `name + " - Overtime"`
(`overtimeNameFor`; a name ending in the suffix is refused), rates = base ×
`WorkSchedule.overtimeActivityMultiplier` (default 1.25, Configure → ERPNext Export), derived on
read so changing the multiplier re-rates every twin. Superadmin only: the Activity Types page
(`/activity-types`, `pages/ActivityTypes.tsx`), `/api/activity-types` (list, create, PATCH rates
— names are fixed ERPNext keys, DELETE refused while allocated, `POST /allocate`
`{ activityTypeId|null, employeeIds }`, `GET /erpnext?mode=insert|update` = the Activity Type
master Data Import CSV, two rows per type), and the multiplier (`updateWorkSchedule` 403s anyone
else). `buildTimesheetCsv` picks names PER RECORD: an allocated employee's regular hours go under
their type and OT/holiday hours under its twin (split always on); unallocated employees keep the
`erpDefaultActivityType` / `erpOvertimeActivityType` fallback. CURRENT allocation only — no history,
so a mid-month change re-types the whole month. `GET /api/employees` takes `activityType` (id |
`none`), `collarType`, `nationality`. Verify the master CSV labels against ERPNext's Download
Template, and import it before a timesheet that uses new names.

### Supervisor backfill requests (draft → admin approval)
Supervisors fix days they forgot to mark WITHOUT writing attendance themselves. One
**BackfillRequest** (`models/backfillRequestModel.js`) per `{siteId, date}` (unique): rows of
`{ employee, sessions[{ jobId, checkIn, checkOut, checkInNextDay, checkOutNextDay }], breaksTaken,
offRoster, outcome }` — raw `HH:mm` + explicit offsets, Dates only derived at approval.
`optimisticConcurrency` is on, so concurrent edits 409 `REQUEST_CHANGED`.
- **Lifecycle** — `draft` → `submitted` → `approved`, or `submitted` → `rejected` (admin, reason
  required; `wasRejected` set) → edited back to `draft` → resubmitted. Supervisor edits only
  draft/rejected; admin edits only submitted. Once submitted/approved the supervisor can't touch
  the day again (`POST /rows` → 409 `BACKFILL_LOCKED`).
- **Window** — `WorkSchedule.supervisorBackfillWindowDays` (default 3, Configure → Supervisor
  Backfill; 1–10, `MAX_SUPERVISOR_BACKFILL_WINDOW_DAYS = 10` hard-coded): yesterday back to N days
  ago, never today, keyed off `getDateLocal` (`utils/backfillWindow.js` ↔ client
  `lib/backfillWindow.ts`, keep in sync). Starting a document and sending a never-rejected draft
  both need the day inside the window (else 400/409 `OUT_OF_WINDOW`); a rejected one can always
  be fixed and resent.
- **Picking people** — NOT limited to `currentSite` (it may have changed since the missed day):
  `GET /candidates?tier=site|recent|search` = on the site now / had a session here within ±N days
  of the date / search everyone (q ≥ 2, paginated). All tiers drop: a record that day, drivers,
  inactive, people in this document or another site's open (draft/submitted/rejected) one. Rows
  for someone not on the site now get `offRoster` ("Not on your site now" chip for the admin).
- **Bulk only** — `POST /rows` applies the SAME 1–6 sessions to every picked employee (per-employee
  added/skipped/failed result); rows are then edited one at a time (`PUT/DELETE /:id/rows/:employeeId`).
  Validation (`utils/backfillRequestRows.js`): strict on add/edit (live job via `findSessionJob`;
  `JOB_REQUIRED` when the site has live jobs; no overlap within the day; cross-day overlap via
  `buildCrossDayOverlapChecker`), LENIENT on job liveness at approval.
- **Approval** — `POST /:id/approve` claims `submitted → approved` atomically, then per row
  (non-transactional, like the admin bulk backfill): re-screen (record exists → skipped; cross-day
  overlap → failed) and create via `createBackfilledRecord` (`utils/backfillRecord.js`, SHARED with
  `bulkBackfillAttendance` so both price a day identically; sessions `markedBy` = the supervisor,
  audit "backfilled" by the admin). Outcomes + `approvalSummary` stay on the document.
- `checkHolidayForDate` / `holidayInfoForEmployee` (`utils/holidayInfo.js`), `detectCrossedMidnight`
  (`utils/crossedMidnight.js`) and `syncCurrentJobFromLatestSession` (`utils/currentJobSync.js`)
  moved out of `attendanceController.js` for this; the controller imports them.
- **UI** — supervisor sidebar "Backfill" → `/backfill` (days in the window + status) →
  `/backfill/:date` (`BackfillEmployeePicker` → `BackfillRowDialog` bulk, `BackfillDocumentView`,
  Send for approval / Discard). Admin sidebar "Past Attendance" (`/attendance/edit`, red badge =
  `GET /pending-count`) → header "Backfill approvals" → `/attendance/edit/backfill-requests[/:id]`
  (edit rows, Send back, Approve). Components in `client/src/components/backfill/`, shared types +
  the totals preview (`previewDay`, a `computeAttendanceTotals` mirror) in `lib/backfillRequests.ts`.

### Shared cloud draft (runtime switch `CLOUD_DRAFT_ENABLED`)
Lets several supervisors mark one site/day from different devices. Off by default; the server
reports it as `features.cloudDraft` on `GET /api/config` (`utils/features.js`,
`WorkConfigContext`). Off → draft endpoints 404, the submit draft guard is skipped, and the page
keeps on-device drafts exactly as before.
- **Storage** — `AttendanceDraftRow` (`models/attendanceDraftRowModel.js`): only rows someone
  TOUCHED (overrides), each with a `rev`; unique `{siteId, date, employee}`, 3-day TTL. Every
  device derives untouched rows itself (`makeBuildRow`), so roster changes need no draft writes.
  Submit deletes the site/day's rows in its transaction.
- **API** (`controllers/draftController.js`) — `GET /api/attendance/draft?siteId&date` (rows +
  lock) and `PUT /api/attendance/draft/rows` (per-row `baseRev`; a stale write comes back in
  `conflicts` with the current row). Both `requireSiteAccess`.
- **Client** (`lib/cloudDraft.ts` + the sync engine in `SiteAttendance.tsx`) — a row is an
  unsynced edit iff its fields differ from its baseline (the remote row, else the derived
  default); diffing covers every draft writer. Edits push 600ms after typing, other devices'
  edits are pulled every 15s and on resume, merged per unit (sessions / breaks / sick) with a
  "Keep mine" toast on a true clash. Unsynced edits live in the localStorage outbox
  (`attendance_outbox_<site>_<date>`, with the base they were made from) until acknowledged.
- **Submit** sends each row's `draftRev`; the server answers 409 `DRAFT_CHANGED` if any stored
  row moved on, so nobody saves over a change they haven't seen.
- The mode is chosen at page load; the switch turning OFF stops syncing immediately (the
  on-device draft, kept current throughout, takes over). `WorkConfigContext` reports `loading`
  until the first config fetch for the signed-in user completes, so pages never initialise
  without the schedule or the feature switches.

### Live Requests updates (server-sent events)
The Requests page and the sidebar Requests badge update without a reload. Each signed-in
tab holds `GET /api/requests/stream` open (`client/src/lib/requestsLive.ts`, started in
`SidebarLayout`). `server/src/utils/realtime.js` watches the `transferrequests` and
`notifications` collections with MongoDB CHANGE STREAMS — so every writer (controllers, the
expiry cron, supersedes inside other transactions) is covered with no per-path hooks, and
events fire only after commit. Events name what changed (`{ scopes: [...] }`: `requests`,
`notifications`, `read`, `resync`) and carry no data; clients refetch the normal endpoints.
Change streams need a replica set (Atlas is one; the app's transactions need one anyway). If
they're unavailable the stream stays quiet and the badge's 90s poll still applies.

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
