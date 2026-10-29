// ERPNext Data Import row-shapers.
//
// Turns a month of Attendance records into CSV files shaped for ERPNext's Data Import
// tool. Pure and API-free — the controller fetches + populates the records and streams
// the returned CSV. Two exports, one shared "hours + status only" philosophy (the app
// holds NO rates; ERPNext supplies them from its own masters):
//
//   1. Attendance  → drives Salary Slip payment-days (Payroll Based On = Attendance) and
//                    the Overtime Slip (OT duration; worked holidays carry holiday hours).
//   2. Timesheet   → drives per-job (Project) salary-cost roll-up. `Project` = jobCode
//                    ("Job Order"); Site is NOT a cost dimension here.
//
// Break handling: breaks are a single DAY-LEVEL deduction (see attendanceMath.js), so
// the timesheet's per-session Hours come from allocateDaySessionHours — Σ session hours ==
// record.totalWorkHours (the paid net), which keeps project cost reconciled to payroll.
// Payroll itself is break-agnostic: status comes from raw hours and OT is already net.

import { toLocalDateString, toLocalTimeString } from "./timeLocal.js";
import { allocateDaySessionHours, allocateProRata } from "./attendanceMath.js";
import { classifyPayrollDay } from "./payrollDay.js";
import { overtimeNameFor } from "./activityTypes.js";

// --------------------------------------------------------------------------
// Tunables. Defaults; the controller overrides company/activity from WorkSchedule
// config. Leave-type names must exist in ERPNext (they are masters) — change here if
// the client's ERPNext uses different labels.
// --------------------------------------------------------------------------
// NOTE: this is the ERPNext *Company* master name — it must match ERPNext EXACTLY
// (link field). It is intentionally different from the app's printed letterhead
// ("NEW GULF DESSERT PROJECT LLC"): the ERPNext company is "New Gulf Desert Projects
// LLC". Overridden by WorkSchedule.erpCompanyName; verify against your ERPNext before use.
export const DEFAULT_COMPANY = "New Gulf Desert Projects LLC";
export const DEFAULT_ACTIVITY_TYPE = "Construction";
// Fallback ERPNext Leave Type for PAID (annual) leave — the only leave that maps to
// "On Leave". Overridden by WorkSchedule.erpPaidLeaveType; must exist in ERPNext.
const DEFAULT_PAID_LEAVE_TYPE = "Annual Leave";
// ERPNext Leave Type stamped on "Half Day" rows so the missing half is counted as LWP
// (a custom script on the client's ERPNext overrides the default half-day handling).
// Must match the Leave Type master exactly.
const HALF_DAY_LEAVE_TYPE = "Leave Without Pay";

// --------------------------------------------------------------------------
// CSV primitives
// --------------------------------------------------------------------------
function csvCell(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header, rows) {
  return [header, ...rows].map((cells) => cells.map(csvCell).join(",")).join("\r\n");
}

// Round to 2dp for display (values are already rounded upstream; this guards sums).
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// "YYYY-MM-DD" business day. Attendance.date is stored at UTC midnight of the business
// day (setUTCHours(0,..)), so its UTC calendar parts ARE the business day — do not
// re-localize it (that would shift it by the app offset and land a day off).
function businessDayString(date) {
  return new Date(date).toISOString().slice(0, 10);
}

// A session's jobs, populated: `splitJobIds` when non-empty (a driver split), else
// [jobId]. Mirrors sessionJobIds in utils/jobSplit.js, kept inline so this file stays pure.
function sessionJobs(session) {
  const split = Array.isArray(session?.splitJobIds) ? session.splitJobIds.filter(Boolean) : [];
  if (split.length) return split;
  return session?.jobId ? [session.jobId] : [];
}

// "YYYY-MM-DD HH:mm:ss" of an absolute instant in the app's local timezone, to the second
// (rounded). Every Timesheet From Time: ERPNext computes To Time = From Time + Hrs to the
// second, so a start derived from a previous log's end must keep its seconds or it would
// begin up to 59s BEFORE that log ends and be rejected as an overlap. A punch-time start reads
// "HH:mm:00". The APP offset is whole minutes, so the UTC seconds are the local seconds.
function localDateTimeStringExact(instant) {
  const d = new Date(Math.round(new Date(instant).getTime() / 1000) * 1000);
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${toLocalDateString(d)} ${toLocalTimeString(d)}:${ss}`;
}

// A session that actually contributes worked time (a closed session with positive
// hours). Open sessions (check-in, no check-out) carry 0 hours and are excluded.
export const isWorkedSession = (s) => !!(s && s.checkIn && (Number(s.workedHours) || 0) > 0);

// --------------------------------------------------------------------------
// 1. Attendance (payroll payment-days)
// --------------------------------------------------------------------------
// One row per employee per day. Status drives payment-days; Working Hours = the day's
// NET total (record.totalWorkHours). Holiday-with-no-work days are skipped — ERPNext
// owns its own Holiday List, so emitting them as attendance would double-count.
// A WORKED holiday is emitted as "Present" with its holidayHours as the overtime
// duration: holiday hours are paid at the OT rate, and ERPNext's Overtime Slip only
// collects submitted, Present attendance with an Overtime Type (Half Day is ignored).
// Attendance is a submittable doctype, but Frappe Data Import can't set docstatus via a
// column, so no Docstatus is emitted — tick "Submit After Import" on the import screen so
// payroll sees it (draft attendance is ignored by payroll).
// Non-holiday records only (the caller handles holidays). The day's kind comes from
// classifyPayrollDay — the same classification the Payment Days report counts.
function erpAttendanceStatus(record, paidLeaveType) {
  // Only PAID (annual) leave is "On Leave" — with a paid leave type. Sick leave, emergency
  // leave and LOP are UNPAID absences in this app (sick/emergency are excused; LOP is an
  // unexcused absence), so all map to plain Absent with NO leave type, as does a pending
  // day (open check-in). A Half Day carries the LWP leave type so ERPNext deducts the
  // missing half as Leave Without Pay.
  switch (classifyPayrollDay(record).kind) {
    case "annual":
      return { status: "On Leave", leaveType: paidLeaveType };
    case "full":
      return { status: "Present", leaveType: "" };
    case "half":
      return { status: "Half Day", leaveType: HALF_DAY_LEAVE_TYPE };
    default:
      return { status: "Absent", leaveType: "" };
  }
}

export function buildAttendanceCsv(
  records,
  {
    companyName = DEFAULT_COMPANY,
    overtimeType = "",
    paidLeaveType = "",
    standardWorkingHours = 8,
  } = {}
) {
  const plt = (paidLeaveType && String(paidLeaveType).trim()) || DEFAULT_PAID_LEAVE_TYPE;
  // Standard Working Hours = WorkSchedule.fullDayHours — company-wide, same on every row.
  const stdHours = round2(standardWorkingHours);
  const header = [
    "ID",
    "Employee",
    "Attendance Date",
    "Status",
    "Working Hours",
    "Standard Working Hours",
    "Company",
    "Leave Type",
    "Overtime Type",
    "Actual Overtime Duration",
  ];

  const sorted = [...records].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );

  const rows = [];
  let skippedHolidays = 0;
  let otRows = 0;
  let holidayOtRows = 0;
  // Hours payroll would miss because no Overtime Type is configured: the report and the
  // timesheet still carry them, so the caller must warn rather than let them vanish.
  let droppedOtHours = 0;
  let droppedHolidayHours = 0;

  for (const record of sorted) {
    if (record.isHoliday) {
      // Worked holiday → Present + holidayHours as OT (overtimeHours is 0 on holidays
      // upstream, so the two never double-count). Always Present, even for a short
      // shift: a Half Day row is dropped by the Overtime Slip and would carry LWP.
      // Days off — and worked holidays when no Overtime Type is configured, which the
      // Overtime Slip would ignore anyway — are skipped: ERPNext's Holiday List owns them.
      const holidayHours = Number(record.holidayHours) || 0;
      if (holidayHours > 0 && overtimeType) {
        holidayOtRows++;
        rows.push([
          "",
          record.employee.employeeId,
          businessDayString(record.date),
          "Present",
          round2(record.totalWorkHours || 0),
          stdHours,
          companyName,
          "",
          overtimeType,
          round2(holidayHours),
        ]);
      } else {
        skippedHolidays++;
        droppedHolidayHours += holidayHours;
      }
      continue;
    }

    const { status, leaveType } = erpAttendanceStatus(record, plt);

    // Overtime is fed straight into payroll here via `actual_overtime_duration` — ERPNext
    // does NOT derive OT from Working Hours on a bulk import (that only happens through the
    // Shift Type + Employee Checkin flow). We only emit it when an Overtime Type is
    // configured, because ERPNext expects a valid `overtime_type` alongside a duration.
    // Unit: hours (matching Working Hours). If your instance's actual_overtime_duration is
    // a Duration (seconds) field, multiply by 3600 — verify on your ERPNext.
    const otHours = Number(record.overtimeHours) || 0;
    const hasOt = otHours > 0 && !!overtimeType;
    if (hasOt) otRows++;
    else droppedOtHours += otHours;

    rows.push([
      "", // ID blank → ERPNext naming series (HR-ATT-.YYYY.-) auto-generates
      record.employee.employeeId,
      businessDayString(record.date),
      status,
      round2(record.totalWorkHours || 0),
      stdHours,
      companyName,
      leaveType,
      hasOt ? overtimeType : "",
      hasOt ? round2(otHours) : "",
    ]);
  }

  return {
    csv: toCsv(header, rows),
    meta: {
      rows: rows.length,
      skippedHolidays,
      otRows,
      holidayOtRows,
      droppedOtHours: round2(droppedOtHours),
      droppedHolidayHours: round2(droppedHolidayHours),
    },
  };
}

// --------------------------------------------------------------------------
// 2. Timesheet (per-job / Project salary cost)
// --------------------------------------------------------------------------
// One Timesheet per (employee, JOB ORDER) for the month; one Time Log per WORKED session.
// Laid out the way ERPNext's Data Import reads a parent + child table as contiguous BLOCKS:
// the first row of each block carries the parent fields (Employee, Company, Job Order) and
// starts a new Timesheet; the rows below it leave those three BLANK and attach as its Time
// Logs. NGDP made the parent Job Order (parent_project) mandatory, so grouping by job (not
// just employee) is what gives each Timesheet an unambiguous parent Job Order. WARNING:
// repeating Employee/Company/Job Order on a continuation row makes Frappe start a brand-new
// one-line Timesheet — so parent fields ride ONLY the block's first row, and blocks must be
// contiguous (we sort employee → block → line before emitting).
//
// `To Time` is deliberately OMITTED. ERPNext recomputes a Time Log's hours from
// (to_time − from_time) whenever both are present, which would silently re-add the
// break time and overstate job cost. Supplying `From Time` + net `Hours` keeps the
// pro-rata NET authoritative; ERPNext derives To Time (crossing midnight for a night
// shift automatically).
//
// A worked session with no job can't bill to a Project: it is skipped and counted in
// meta.skippedNoJob (lines) and meta.skippedHours (net hours) so nothing vanishes silently —
// the controller sends both as headers and the client warns.
//
// Driver job splits (utils/jobSplit.js): a session whose hours are split across N jobs
// (`splitJobIds`) becomes N slices of equal net (and equal OT), laid ONE AFTER ANOTHER from
// the check-in (job A regular → A overtime → job B regular …). Each slice lands in its own
// job's Timesheet, and back-to-back slices never overlap there — ERPNext rejects an
// employee's overlapping time logs across Timesheets. A sliced job with no code is skipped
// and counted like a jobless session.
//
// Regular/OT split: when `overtimeActivityType` is set, a session is emitted as up to TWO
// time-logs — the regular hours under `activityType` and the overtime hours under
// `overtimeActivityType` — so ERPNext can cost OT at a premium (its own Activity Cost per
// employee). OT is a DAY-level figure (record.overtimeHours) that belongs to the OVERTIME
// WINDOW — the last OT hours of the worked day — so only the sessions worked in that window
// carry it (allocateDaySessionHours; the break comes out of the regular part). HOLIDAY hours (record.holidayHours) are paid at the
// OT rate too, so a worked holiday goes entirely under `overtimeActivityType` — matching the
// Attendance CSV, which sends them as overtime duration. The OT log is placed as the shift's TAIL
// (From = check-in + regular hours) so the two contiguous logs never overlap in ERPNext.
// With no OT type configured, a session stays a single net-hours line (unchanged).
//
// Per-employee activity types: when the record's employee has an allocated activity type
// (record.employee.activityType populated with `name`), its lines use THAT type for regular
// hours and its overtime twin (overtimeNameFor) for OT/holiday hours — the split is always on,
// since every type has a twin — so ERPNext costs them at that type's default rates. Unallocated
// employees fall back to `activityType` / `overtimeActivityType` above and are counted in
// meta.unallocated (distinct employees with at least one exported line).
export function buildTimesheetCsv(
  records,
  {
    companyName = DEFAULT_COMPANY,
    activityType = DEFAULT_ACTIVITY_TYPE,
    overtimeActivityType = "",
  } = {}
) {
  // Frappe auto-matches on each field's DISPLAY LABEL, and THIS instance customizes them:
  // the Timesheet child table is labelled "Time Sheets" (not "Time Logs"), the hours field
  // is "Hrs" (not "Hours"), and the Project field is renamed "Job Order" at BOTH levels.
  // Bare "Job Order" is the PARENT field parent_project (mandatory on the Timesheet itself);
  // "Job Order (Time Sheets)" is the per-line child field. Bare vs suffixed is how the
  // importer tells parent from child (same as ID/Employee/Company being bare). The line-
  // level Job Order is still emitted on every row — Data Import does NOT default the child
  // project from the parent, so per-job costing needs it explicitly.
  // Verify against the import screen's Download Template if the instance changes again.
  // No Docstatus column — Frappe Data Import can't set docstatus; tick "Submit After
  // Import" on the import screen instead.
  const header = [
    "ID",
    "Employee",
    "Company",
    "Job Order",
    "Activity Type (Time Sheets)",
    "From Time (Time Sheets)",
    "Hrs (Time Sheets)",
    "Job Order (Time Sheets)",
    "Is Billable (Time Sheets)",
  ];

  // The (regular, overtime) activity names for a record's employee; overtime "" = no split.
  const activityFor = (record) => {
    const allocated = record.employee?.activityType?.name;
    return allocated
      ? { regular: allocated, overtime: overtimeNameFor(allocated) }
      : { regular: activityType, overtime: overtimeActivityType };
  };

  let skippedNoJob = 0;
  // Net hours of the skipped lines — the cost that never reaches a Job Order.
  let skippedHours = 0;
  const unallocated = new Set();

  // ---- Pass 1: bucket time-log lines by (employee, job order) ----
  // The per-DAY math must run per record first: allocateDaySessionHours splits the day net
  // across the day's worked sessions (Σ === record.totalWorkHours) and puts the day's OT on
  // the sessions in the overtime window. A single day can span jobs (multi-site day), so each
  // resulting line is then routed to its OWN job's bucket.
  const byEmployee = new Map(); // employeeId -> Map<jobCode, Array<{ at, fromStr, hours }>>
  const addLine = (employeeId, jobCode, at, fromStr, hours) => {
    if (!byEmployee.has(employeeId)) byEmployee.set(employeeId, new Map());
    const jobs = byEmployee.get(employeeId);
    if (!jobs.has(jobCode)) jobs.set(jobCode, []);
    jobs.get(jobCode).push({ at, fromStr, hours });
  };

  // Where each employee's last emitted log ENDS. A session's Hrs are 2dp-rounded, so a
  // session can carry up to 18s more than its real length (2h55m → 2.92h = 2h55m12s); laid
  // from its check-in, its last log would then run into the next session when the two are
  // back to back (a site switch at 08:35), and ERPNext rejects the import for overlapping
  // time logs. So a log never starts before this cursor: the next session's first log moves
  // a few seconds later instead. Hours are untouched. Records go in time order for it.
  const logCursor = new Map(); // employeeId -> ms
  const ordered = [...records].sort(
    (a, b) =>
      String(a.employee?.employeeId).localeCompare(String(b.employee?.employeeId)) ||
      new Date(a.date) - new Date(b.date)
  );

  for (const record of ordered) {
    const worked = (record.sessions || []).filter(isWorkedSession);
    if (worked.length === 0) continue;

    const employeeId = record.employee.employeeId;
    const { regular: regularType, overtime: overtimeType } = activityFor(record);
    const splitOt = !!overtimeType;
    // Premium = hours paid at the OT rate: overtime on a normal day, the whole holiday credit
    // on a worked holiday (overtimeHours is 0 on holidays upstream, so the two never stack).
    const parts = allocateDaySessionHours(worked, {
      netHours: record.totalWorkHours || 0,
      overtimeHours: record.overtimeHours,
      holidayHours: record.holidayHours,
    });
    const nets = parts.map((p) => p.net);
    const ots = parts.map((p) => (splitOt ? p.premium : 0));

    // Lay the day's sessions in check-in order (nets/ots stay indexed like `worked`).
    const inOrder = worked
      .map((session, i) => ({ session, i }))
      .sort((a, b) => new Date(a.session.checkIn) - new Date(b.session.checkIn));

    inOrder.forEach(({ session, i }) => {
      const jobs = sessionJobs(session);
      if (!jobs.some((job) => job && job.jobCode)) {
        skippedNoJob++;
        skippedHours += nets[i];
        return;
      }
      if (!record.employee?.activityType?.name) unallocated.add(employeeId);

      // One job → one slice (the whole session). N jobs → N equal slices, back to back.
      const netParts = allocateProRata(jobs.map(() => 1), nets[i]);
      const otParts = allocateProRata(jobs.map(() => 1), ots[i]);
      let sliceStartMs = Math.max(new Date(session.checkIn).getTime(), logCursor.get(employeeId) ?? -Infinity);

      jobs.forEach((job, k) => {
        const startMs = sliceStartMs;
        // Exact to the second: the parts are 2dp, so part*3600 is a whole number of seconds
        // and each slice starts precisely where the previous one ends (From + Hrs).
        sliceStartMs += Math.round(netParts[k] * 3600) * 1000;
        const jobCode = job && job.jobCode;
        if (!jobCode) {
          skippedNoJob++;
          skippedHours += netParts[k];
          return;
        }

        // Exact to the second — a check-in is a whole minute, so this reads "HH:mm:00" unless
        // the cursor pushed the log a few seconds past a back-to-back session.
        const from = localDateTimeStringExact(new Date(startMs));
        const otH = otParts[k];
        const regH = round2(netParts[k] - otH);

        if (splitOt && otH > 0) {
          // Regular portion first, then OT as the tail so the two logs are contiguous
          // (To Time = From + Hours) and never overlap within the Timesheet.
          if (regH > 0) addLine(employeeId, jobCode, regularType, from, regH);
          const otFrom = localDateTimeStringExact(new Date(startMs + Math.round(regH * 3600) * 1000));
          addLine(employeeId, jobCode, overtimeType, otFrom, otH);
        } else {
          addLine(employeeId, jobCode, regularType, from, round2(netParts[k]));
        }
      });
      logCursor.set(employeeId, sliceStartMs);
    });
  }

  // ---- Pass 2: emit contiguous blocks (one per employee × job order) ----
  // Deterministic order: employees by id; blocks within an employee by earliest From Time
  // (tiebreak jobCode); lines within a block by From Time. Since From Time is
  // "YYYY-MM-DD HH:mm:ss", lexicographic === chronological, which also keeps each OT tail
  // right after its regular portion. The first row of a block carries the parent fields;
  // continuation rows leave Employee/Company/Job Order blank.
  const rows = [];
  const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  for (const employeeId of [...byEmployee.keys()].sort()) {
    const jobs = byEmployee.get(employeeId);
    const blocks = [...jobs.entries()].map(([jobCode, lines]) => {
      lines.sort((a, b) => byStr(a.fromStr, b.fromStr));
      return { jobCode, lines, earliest: lines[0].fromStr };
    });
    blocks.sort(
      (a, b) => byStr(a.earliest, b.earliest) || byStr(a.jobCode, b.jobCode)
    );

    for (const { jobCode, lines } of blocks) {
      let firstRowInBlock = true;
      for (const line of lines) {
        rows.push([
          "",
          firstRowInBlock ? employeeId : "",
          firstRowInBlock ? companyName : "",
          firstRowInBlock ? jobCode : "", // parent Job Order — block header only
          line.at,
          line.fromStr,
          line.hours,
          jobCode, // line-level Job Order (same job within the block)
          1, // Is Billable
        ]);
        firstRowInBlock = false;
      }
    }
  }

  return {
    csv: toCsv(header, rows),
    meta: { rows: rows.length, skippedNoJob, skippedHours: round2(skippedHours), unallocated: unallocated.size },
  };
}
