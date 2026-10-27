// Cross-checks one month of payroll/job data across everything that reports it:
//
//   stored records ── recompute ──▶ do the stored day totals still equal the shared math?
//   Monthly Report  ◀── vs ──▶ ERPNext Attendance CSV   (per employee: day kinds, hours, OT)
//   Jobs report     ◀── vs ──▶ ERPNext Timesheet CSV    (per job: regular + OT hours)
//
// Pure: the caller (seed/reconcileErpExport.js, the integration tests) runs the REAL report
// and export code and hands the outputs in. Every diff is a plain object with a `kind`, so a
// caller can print, count or assert on them. Hours compare to the cent with a rounding
// allowance of 0.01h per CSV line involved (each line is rounded to 2dp on its own).

import { computeAttendanceTotals, sumRawHours } from "./attendanceMath.js";
import { classifyPayrollDay } from "./payrollDay.js";
import { OVERTIME_SUFFIX } from "./activityTypes.js";

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const dayKey = (date) => new Date(date).toISOString().slice(0, 10);

// --------------------------------------------------------------------------
// CSV
// --------------------------------------------------------------------------
/** Parse the exporter's CSV (RFC 4180 quoting, optional BOM) into header-keyed objects. */
export function parseCsv(text) {
  const src = String(text || "").replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header = [], ...body] = rows;
  return body
    .filter((r) => r.some((v) => v !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// --------------------------------------------------------------------------
// (a) + (b): each stored record against the shared math and the model invariants
// --------------------------------------------------------------------------
const TOTAL_FIELDS = [
  ["status", "status"],
  ["totalWorkHours", "netWorkHours"],
  ["overtimeHours", "overtimeHours"],
  ["holidayHours", "holidayHours"],
];

/**
 * Stored day totals vs a fresh computeAttendanceTotals(sumRawHours(sessions)) with the
 * record's own break override and holiday state, plus the record-level invariants.
 * `reason` on a drift says why when it can tell: a legacy 2+ break override (the cap was
 * rolled out without a recalc), the old session-rounding sum, or "other" (typically a
 * config change since the record was priced).
 */
export function checkRecords(records, workConfig) {
  const diffs = [];
  for (const record of records) {
    const ref = {
      recordId: String(record._id),
      employeeId: record.employee?.employeeId ?? String(record.employee),
      date: dayKey(record.date),
    };
    const sessions = record.sessions || [];
    const filled = sessions.some((s) => s && (s.checkIn || s.checkOut));

    const expected = computeAttendanceTotals(sumRawHours(sessions), workConfig, record.breaksTaken ?? null, {
      isHoliday: record.isHoliday,
      reason: record.holidayReason,
    });
    const mismatched = TOTAL_FIELDS.filter(([stored, computed]) => (record[stored] ?? 0) !== expected[computed]);
    if (mismatched.length) {
      const oldRaw = round2(sessions.reduce((sum, s) => sum + (s?.workedHours || 0), 0));
      const old = computeAttendanceTotals(oldRaw, workConfig, record.breaksTaken ?? null, {
        isHoliday: record.isHoliday,
        reason: record.holidayReason,
      });
      const matchesOld = TOTAL_FIELDS.every(([stored, computed]) => (record[stored] ?? 0) === old[computed]);
      const reason = record.breaksTaken > 1 ? "legacy-break-count" : matchesOld ? "session-rounding" : "other";
      diffs.push({
        kind: "record-totals",
        ...ref,
        reason,
        fields: Object.fromEntries(
          mismatched.map(([stored, computed]) => [stored, { stored: record[stored] ?? 0, expected: expected[computed] }])
        ),
      });
    }

    const leaveFlags = ["isPaidLeave", "isEmergencyLeave", "isSickLeave", "isLop"].filter((f) => record[f]);
    if (leaveFlags.length && filled) diffs.push({ kind: "leave-with-sessions", ...ref, flags: leaveFlags });
    if (leaveFlags.length > 1) diffs.push({ kind: "multiple-leave-flags", ...ref, flags: leaveFlags });
    if (record.isHoliday && (record.overtimeHours || 0) > 0)
      diffs.push({ kind: "overtime-on-holiday", ...ref, overtimeHours: record.overtimeHours });
    if (!record.isHoliday && (record.holidayHours || 0) > 0)
      diffs.push({ kind: "holiday-hours-off-holiday", ...ref, holidayHours: record.holidayHours });
    if (record.isHoliday && record.employee?.employmentType === "temporary")
      diffs.push({ kind: "temporary-on-holiday", ...ref });

    sessions.forEach((s, index) => {
      if (!s) return;
      if (s.checkOut && !s.checkIn) {
        diffs.push({ kind: "checkout-without-checkin", ...ref, session: index });
        return;
      }
      if (s.checkIn && s.checkOut) {
        const exact = round2((new Date(s.checkOut) - new Date(s.checkIn)) / 3600000);
        if (Math.abs(exact - (s.workedHours || 0)) > 0.011)
          diffs.push({ kind: "session-hours", ...ref, session: index, stored: s.workedHours || 0, expected: exact });
      } else if ((s.workedHours || 0) > 0) {
        diffs.push({ kind: "open-session-with-hours", ...ref, session: index, stored: s.workedHours });
      }
    });
  }
  return diffs;
}

// --------------------------------------------------------------------------
// (c) Monthly Report vs ERPNext Attendance CSV
// --------------------------------------------------------------------------
/**
 * Per employee in the CSV: the day kinds, Σ Working Hours and Σ overtime duration must
 * agree with the report row (and the records behind both). `overtimeType` is what the
 * export was configured with — without it OT and worked-holiday hours are not exported
 * (reported once as `attendance-dropped-overtime`, never as a per-employee mismatch).
 */
export function checkAttendanceCsv({ records, reportRows, csvRows, overtimeType = "", unmarkedAsAbsent = true }) {
  const diffs = [];
  const csvByEmp = new Map();
  for (const row of csvRows) {
    const list = csvByEmp.get(row.Employee) || [];
    list.push(row);
    csvByEmp.set(row.Employee, list);
  }
  const recordsByEmp = new Map();
  for (const r of records) {
    const id = r.employee?.employeeId;
    if (!id) continue;
    const list = recordsByEmp.get(id) || [];
    list.push(r);
    recordsByEmp.set(id, list);
  }
  const reportByEmp = new Map(reportRows.map((r) => [r.employeeId, r]));

  let droppedOt = 0;
  let droppedHoliday = 0;

  for (const [employeeId, recs] of recordsByEmp) {
    const rows = csvByEmp.get(employeeId) || [];
    const rep = reportByEmp.get(employeeId);
    const count = (status) => rows.filter((r) => r.Status === status).length;

    // Expected from the records, by the shared classifier.
    let full = 0, half = 0, annual = 0, absent = 0, workedHolidayRows = 0;
    let workingHours = 0, otHours = 0;
    for (const r of recs) {
      const kind = classifyPayrollDay(r).kind;
      if (kind === "holiday") {
        if ((r.holidayHours || 0) > 0 && overtimeType) {
          workedHolidayRows++;
          workingHours += r.totalWorkHours || 0;
          otHours += r.holidayHours || 0;
        } else droppedHoliday += r.holidayHours || 0;
        continue;
      }
      if (kind === "full") full++;
      else if (kind === "half") half++;
      else if (kind === "annual") annual++;
      else absent++;
      workingHours += r.totalWorkHours || 0;
      if (overtimeType) otHours += r.overtimeHours || 0;
      else droppedOt += r.overtimeHours || 0;
    }

    const got = {
      Present: count("Present"),
      "Half Day": count("Half Day"),
      "On Leave": count("On Leave"),
      Absent: count("Absent"),
    };
    const want = { Present: full + workedHolidayRows, "Half Day": half, "On Leave": annual, Absent: absent };
    for (const status of Object.keys(want)) {
      if (got[status] !== want[status])
        diffs.push({ kind: "attendance-status-count", employeeId, status, csv: got[status], records: want[status] });
    }

    const csvWorking = round2(rows.reduce((s, r) => s + (Number(r["Working Hours"]) || 0), 0));
    const csvOt = round2(rows.reduce((s, r) => s + (Number(r["Actual Overtime Duration"]) || 0), 0));
    const tol = 0.01 * rows.length + 0.005;
    if (Math.abs(csvWorking - round2(workingHours)) > tol)
      diffs.push({ kind: "attendance-working-hours", employeeId, csv: csvWorking, records: round2(workingHours) });
    if (Math.abs(csvOt - round2(otHours)) > tol)
      diffs.push({ kind: "attendance-overtime", employeeId, csv: csvOt, records: round2(otHours) });

    // The report row counts the same records with the same classifier. Its absentDays also
    // holds the unmarked days (no record → not in the CSV) when unmarkedAsAbsent is on.
    if (rep) {
      const reportAbsentFromRecords = rep.absentDays - (unmarkedAsAbsent ? rep.unmarkedDays || 0 : 0);
      const repChecks = [
        ["fullDays", rep.fullDays, full],
        ["halfDays", rep.halfDays, half],
        ["leaveDays", rep.leaveDays, annual],
        ["absentDays (recorded)", reportAbsentFromRecords, absent],
      ];
      for (const [field, reported, value] of repChecks) {
        if (reported !== value) diffs.push({ kind: "report-day-count", employeeId, field, report: reported, records: value });
      }
      const repOt = round2((rep.overtimeHours || 0) + (rep.holidayHours || 0));
      const recOt = round2(recs.reduce((s, r) => s + (r.isHoliday ? r.holidayHours || 0 : r.overtimeHours || 0), 0));
      if (Math.abs(repOt - recOt) > 0.011)
        diffs.push({ kind: "report-overtime", employeeId, report: repOt, records: recOt });
    } else if (recs.length) {
      diffs.push({ kind: "report-missing-employee", employeeId });
    }
  }

  for (const employeeId of csvByEmp.keys()) {
    if (!recordsByEmp.has(employeeId)) diffs.push({ kind: "attendance-csv-unknown-employee", employeeId });
  }
  if (droppedOt > 0 || droppedHoliday > 0)
    diffs.push({ kind: "attendance-dropped-overtime", overtimeHours: round2(droppedOt), holidayHours: round2(droppedHoliday) });
  return diffs;
}

// --------------------------------------------------------------------------
// (d) Jobs report vs ERPNext Timesheet CSV
// --------------------------------------------------------------------------
/**
 * Per job code: Σ timesheet Hrs (regular lines + overtime lines) vs the Jobs report's
 * regular + total OT, and the overtime part on its own when the timesheet split it
 * (an "… - Overtime" line, or the configured fallback OT activity). Jobs the report lists
 * without a code, and its "Unassigned" rows, must add up to the timesheet's skipped hours.
 */
export function checkTimesheetCsv({ jobReport, csvRows, skippedHours = 0, overtimeActivityType = "" }) {
  const diffs = [];
  const isOtLine = (activity) =>
    !!activity && (activity.endsWith(OVERTIME_SUFFIX) || (overtimeActivityType && activity === overtimeActivityType));

  const sheet = new Map(); // jobCode -> { regular, ot, lines }
  for (const row of csvRows) {
    const code = row["Job Order (Time Sheets)"];
    const hrs = Number(row["Hrs (Time Sheets)"]) || 0;
    const entry = sheet.get(code) || { regular: 0, ot: 0, lines: 0 };
    if (isOtLine(row["Activity Type (Time Sheets)"])) entry.ot += hrs;
    else entry.regular += hrs;
    entry.lines++;
    sheet.set(code, entry);
  }

  let reportSkipped = 0;
  const reportCodes = new Set();
  for (const site of jobReport || []) {
    for (const job of site.jobs || []) {
      const total = (job.regularHours || 0) + (job.totalOTHours || 0);
      if (job.unassigned || !job.jobCode) {
        reportSkipped += total;
        continue;
      }
      reportCodes.add(job.jobCode);
      const t = sheet.get(job.jobCode) || { regular: 0, ot: 0, lines: 0 };
      const tol = 0.01 * Math.max(t.lines, 1) + 0.01;
      const sheetTotal = round2(t.regular + t.ot);
      if (Math.abs(sheetTotal - round2(total)) > tol) {
        diffs.push({
          kind: "timesheet-job-total",
          jobCode: job.jobCode,
          timesheet: sheetTotal,
          jobReport: round2(total),
          site: site.siteName,
        });
      } else if (t.ot > 0 && Math.abs(round2(t.ot) - round2(job.totalOTHours || 0)) > tol) {
        // Totals agree but the OT split doesn't: only when every OT hour was split out.
        diffs.push({
          kind: "timesheet-job-overtime",
          jobCode: job.jobCode,
          timesheet: round2(t.ot),
          jobReport: round2(job.totalOTHours || 0),
          site: site.siteName,
        });
      }
    }
  }
  for (const [code, t] of sheet) {
    if (!reportCodes.has(code)) diffs.push({ kind: "timesheet-unknown-job", jobCode: code, timesheet: round2(t.regular + t.ot) });
  }
  if (Math.abs(round2(reportSkipped) - round2(skippedHours)) > 0.05)
    diffs.push({ kind: "timesheet-skipped-hours", timesheet: round2(skippedHours), jobReport: round2(reportSkipped) });
  if (skippedHours > 0) diffs.push({ kind: "timesheet-skipped-info", hours: round2(skippedHours) });
  return diffs;
}

/** Diff kinds that are information, not inconsistencies (the export already warns). */
export const INFO_KINDS = new Set(["attendance-dropped-overtime", "timesheet-skipped-info"]);
