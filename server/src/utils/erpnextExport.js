// ERPNext Data Import row-shapers.
//
// Turns a month of Attendance records into CSV files shaped for ERPNext's Data Import
// tool. Pure and API-free — the controller fetches + populates the records and streams
// the returned CSV. Two exports, one shared "hours + status only" philosophy (the app
// holds NO rates; ERPNext supplies them from its own masters):
//
//   1. Attendance  → drives Salary Slip payment-days (Payroll Based On = Attendance).
//   2. Timesheet   → drives per-job (Project) salary-cost roll-up. `Project` = jobCode
//                    ("Job Order"); Site is NOT a cost dimension here.
//
// Break handling: breaks are a single DAY-LEVEL deduction (see attendanceMath.js), so
// the timesheet's per-session Hours are the day net split PRO-RATA across sessions by
// allocateSessionNetHours — Σ session hours == record.totalWorkHours (the paid net),
// which keeps project cost reconciled to payroll. Payroll itself is break-agnostic:
// status comes from raw hours and OT is already net.

import { toLocalDateString, toLocalTimeString } from "./timeLocal.js";
import { allocateSessionNetHours, allocateProRata } from "./attendanceMath.js";

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

function toCsv(header, rows) {
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

// "YYYY-MM-DD HH:mm:ss" of an absolute instant in the app's local timezone. Used for a
// Timesheet From Time — the real punch wall-clock time.
function localDateTimeString(instant) {
  return `${toLocalDateString(instant)} ${toLocalTimeString(instant)}:00`;
}

// A session that actually contributes worked time (a closed session with positive
// hours). Open sessions (check-in, no check-out) carry 0 hours and are excluded.
const isWorkedSession = (s) => !!(s && s.checkIn && (Number(s.workedHours) || 0) > 0);

// --------------------------------------------------------------------------
// 1. Attendance (payroll payment-days)
// --------------------------------------------------------------------------
// One row per employee per day. Status drives payment-days; Working Hours = the day's
// NET total (record.totalWorkHours). Holiday-with-no-work days are skipped — ERPNext
// owns its own Holiday List, so emitting them as attendance would double-count.
// Attendance is a submittable doctype, but Frappe Data Import can't set docstatus via a
// column, so no Docstatus is emitted — tick "Submit After Import" on the import screen so
// payroll sees it (draft attendance is ignored by payroll).
function erpAttendanceStatus(record, paidLeaveType) {
  // Only PAID (annual) leave is "On Leave" — with a paid leave type. Sick leave, emergency
  // leave and LOP are UNPAID absences in this app (sick/emergency are excused but still
  // lower attendance %; LOP is an unexcused absence), so all map to plain Absent with NO
  // leave type, mirroring monthlyReport. A Half Day carries the LWP leave type so ERPNext
  // deducts the missing half as Leave Without Pay.
  if (record.isPaidLeave) return { status: "On Leave", leaveType: paidLeaveType };
  if (record.status === "fullday") return { status: "Present", leaveType: "" };
  if (record.status === "halfday") return { status: "Half Day", leaveType: HALF_DAY_LEAVE_TYPE };
  return { status: "Absent", leaveType: "" };
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

  for (const record of sorted) {
    // Skip ALL holidays (worked or not) — ERPNext's own Holiday List owns holiday pay,
    // and the app never counts a holiday as a payable day (see monthlyReport). Any hours
    // worked on a holiday still reach ERPNext via the Timesheet + the OT/holiday summary.
    if (record.isHoliday) {
      skippedHolidays++;
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
    meta: { rows: rows.length, skippedHolidays, otRows },
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
// meta.skippedNoJob so nothing vanishes silently.
//
// Regular/OT split: when `overtimeActivityType` is set, a session is emitted as up to TWO
// time-logs — the regular hours under `activityType` and the overtime hours under
// `overtimeActivityType` — so ERPNext can cost OT at a premium (its own Activity Cost per
// employee). OT is a DAY-level figure (record.overtimeHours), so it is spread across the
// day's sessions pro-rata by net hours. The OT log is placed as the shift's TAIL
// (From = check-in + regular hours) so the two contiguous logs never overlap in ERPNext.
// With no OT type configured, a session stays a single net-hours line (unchanged).
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

  const splitOt = !!overtimeActivityType;

  let skippedNoJob = 0;

  // ---- Pass 1: bucket time-log lines by (employee, job order) ----
  // The per-DAY math must run per record first: allocateSessionNetHours splits the day net
  // across the day's worked sessions (Σ === record.totalWorkHours) and OT is a day-level
  // figure spread across them. A single day can span jobs (multi-site day), so each
  // resulting line is then routed to its OWN job's bucket.
  const byEmployee = new Map(); // employeeId -> Map<jobCode, Array<{ at, fromStr, hours }>>
  const addLine = (employeeId, jobCode, at, fromStr, hours) => {
    if (!byEmployee.has(employeeId)) byEmployee.set(employeeId, new Map());
    const jobs = byEmployee.get(employeeId);
    if (!jobs.has(jobCode)) jobs.set(jobCode, []);
    jobs.get(jobCode).push({ at, fromStr, hours });
  };

  for (const record of records) {
    const worked = (record.sessions || []).filter(isWorkedSession);
    if (worked.length === 0) continue;

    const employeeId = record.employee.employeeId;
    const nets = allocateSessionNetHours(worked, record.totalWorkHours || 0);
    const ots = splitOt
      ? allocateProRata(nets, record.overtimeHours || 0)
      : nets.map(() => 0);

    worked.forEach((session, i) => {
      const jobCode = session.jobId && session.jobId.jobCode;
      if (!jobCode) {
        skippedNoJob++;
        return;
      }

      const from = localDateTimeString(session.checkIn);
      const otH = ots[i];
      const regH = round2(nets[i] - otH);

      if (splitOt && otH > 0) {
        // Regular portion first, then OT as the tail so the two logs are contiguous
        // (To Time = From + Hours) and never overlap within the Timesheet.
        if (regH > 0) addLine(employeeId, jobCode, activityType, from, regH);
        const otFrom = localDateTimeString(
          new Date(new Date(session.checkIn).getTime() + regH * 3600 * 1000)
        );
        addLine(employeeId, jobCode, overtimeActivityType, otFrom, otH);
      } else {
        addLine(employeeId, jobCode, activityType, from, round2(nets[i]));
      }
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

  return { csv: toCsv(header, rows), meta: { rows: rows.length, skippedNoJob } };
}

// --------------------------------------------------------------------------
// 3. OT & holiday hours summary (optional, informational)
// --------------------------------------------------------------------------
// Not a direct ERPNext doctype import — a per-employee monthly total of overtime and
// holiday hours, for the client to turn into Additional Salary lines in ERPNext (which
// is where the OT rate lives; the app has none). OT is already 0 on holidays upstream,
// so the two buckets never double-count.
export function buildOtSummaryCsv(records, { monthLabel = "" } = {}) {
  const header = [
    "Employee",
    "Employee Name",
    "Month",
    "Overtime Hours",
    "Holiday Hours",
  ];

  const byEmployee = new Map();
  for (const record of records) {
    const key = record.employee.employeeId;
    if (!byEmployee.has(key)) {
      byEmployee.set(key, {
        employeeId: key,
        name: record.employee.name || "",
        ot: 0,
        holiday: 0,
      });
    }
    const agg = byEmployee.get(key);
    agg.ot += Number(record.overtimeHours) || 0;
    agg.holiday += Number(record.holidayHours) || 0;
  }

  const rows = [...byEmployee.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => [e.employeeId, e.name, monthLabel, round2(e.ot), round2(e.holiday)]);

  return { csv: toCsv(header, rows), meta: { rows: rows.length } };
}
