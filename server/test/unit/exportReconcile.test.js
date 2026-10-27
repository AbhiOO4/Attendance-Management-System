import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildAttendanceCsv, buildTimesheetCsv } from "../../src/utils/erpnextExport.js";
import { parseCsv, checkRecords, checkAttendanceCsv, checkTimesheetCsv, INFO_KINDS } from "../../src/utils/exportReconcile.js";
import { record, session, employee, job, WORK_CONFIG } from "../helpers/records.js";

const E = employee("EMP-R");
const A = job("JOB-A");
const B = job("JOB-B");
const day = (d, opts) => record(d, { employee: E, ...opts });

const records = [
  day("2026-09-01", { sessions: [session("2026-09-01", "06:00", "18:00", A)] }), // full + 3 OT
  day("2026-09-02", { sessions: [session("2026-09-02", "06:00", "08:20", A), session("2026-09-02", "08:20", "10:40", B), session("2026-09-02", "10:40", "14:00", A)] }),
  day("2026-09-03", { sessions: [session("2026-09-03", "07:00", "12:00", B)] }), // half
  day("2026-09-04", { isHoliday: true, sessions: [session("2026-09-04", "07:00", "13:00", A)] }), // worked holiday
  day("2026-09-05", { isSickLeave: true }),
  day("2026-09-06", { isPaidLeave: true }),
];
const reportRow = {
  employeeId: "EMP-R",
  fullDays: 2,
  halfDays: 1,
  leaveDays: 1,
  absentDays: 1 + 3, // sick + 3 unmarked
  noReasonAbsentDays: 3,
  unmarkedDays: 3,
  overtimeHours: 3,
  holidayHours: 6,
};
const jobReport = [
  {
    siteName: "Site 1",
    jobs: [
      // A: d1 11 (8 + 3 OT), d2 2.04 + 2.92 = 4.96, d4 6 holiday
      { jobCode: "JOB-A", regularHours: 8 + 4.96, totalOTHours: 3 + 6 },
      // B: d2 2.04 (… pro-rata), d3 5
      { jobCode: "JOB-B", regularHours: 2.04 + 5, totalOTHours: 0 },
    ],
  },
];

const att = (opts) => parseCsv(buildAttendanceCsv(records, { overtimeType: "OT", ...opts }).csv);
const ts = (recs = records) => buildTimesheetCsv(recs, { overtimeActivityType: "Construction OT" });

describe("a consistent month has no diffs", () => {
  test("records, attendance CSV, timesheet CSV and job report all agree", () => {
    const { csv, meta } = ts();
    const diffs = [
      ...checkRecords(records, WORK_CONFIG),
      ...checkAttendanceCsv({ records, reportRows: [reportRow], csvRows: att(), overtimeType: "OT" }),
      ...checkTimesheetCsv({ jobReport, csvRows: parseCsv(csv), skippedHours: meta.skippedHours, overtimeActivityType: "Construction OT" }),
    ].filter((d) => !INFO_KINDS.has(d.kind));
    assert.deepEqual(diffs, []);
  });
});

describe("each kind of inconsistency is caught", () => {
  test("stored totals that no longer match the shared math, with a reason", () => {
    const stale = { ...records[1], status: "halfday", totalWorkHours: 7.99 }; // old rounding rule
    const legacy = { ...records[0], breaksTaken: 2, totalWorkHours: 10, overtimeHours: 2 };
    const other = { ...records[2], totalWorkHours: 9 };
    const kinds = checkRecords([stale, legacy, other], WORK_CONFIG).map((d) => [d.kind, d.reason]);
    assert.deepEqual(kinds, [
      ["record-totals", "session-rounding"],
      ["record-totals", "legacy-break-count"],
      ["record-totals", "other"],
    ]);
  });

  test("record invariants", () => {
    const bad = [
      { ...records[0], isSickLeave: true },
      { ...records[0], isHoliday: true, overtimeHours: 3, holidayHours: 0 },
      { ...records[2], holidayHours: 2 },
      { ...records[3], employee: { ...E, employmentType: "temporary" } },
      { ...records[2], sessions: [{ ...records[2].sessions[0], workedHours: 4 }] },
      { ...records[4], isLop: true },
    ];
    const kinds = new Set(checkRecords(bad, WORK_CONFIG).map((d) => d.kind));
    for (const k of ["leave-with-sessions", "overtime-on-holiday", "holiday-hours-off-holiday", "temporary-on-holiday", "session-hours", "multiple-leave-flags"]) {
      assert.ok(kinds.has(k), `missing ${k}`);
    }
  });

  test("attendance CSV that disagrees with the records/report", () => {
    const rows = att().filter((r) => r["Attendance Date"] !== "2026-09-03"); // a half day went missing
    rows[0]["Actual Overtime Duration"] = "1";
    const kinds = checkAttendanceCsv({ records, reportRows: [{ ...reportRow, fullDays: 3 }], csvRows: rows, overtimeType: "OT" }).map((d) => d.kind);
    assert.ok(kinds.includes("attendance-status-count"));
    assert.ok(kinds.includes("attendance-working-hours"));
    assert.ok(kinds.includes("attendance-overtime"));
    assert.ok(kinds.includes("report-day-count"));
  });

  test("no Overtime Type: the dropped hours are reported once, not as mismatches", () => {
    const diffs = checkAttendanceCsv({ records, reportRows: [reportRow], csvRows: att({ overtimeType: "" }), overtimeType: "" });
    assert.deepEqual(diffs, [{ kind: "attendance-dropped-overtime", overtimeHours: 3, holidayHours: 6 }]);
  });

  test("timesheet vs job report: totals, OT split, unknown jobs, skipped hours", () => {
    const { csv } = ts();
    const rows = parseCsv(csv);
    const wrongReport = [{ siteName: "Site 1", jobs: [{ ...jobReport[0].jobs[0], regularHours: 1 }, jobReport[0].jobs[1], { unassigned: true, regularHours: 4, totalOTHours: 0 }] }];
    const kinds = checkTimesheetCsv({ jobReport: wrongReport, csvRows: [...rows, { ...rows[0], "Job Order (Time Sheets)": "GHOST" }], skippedHours: 0, overtimeActivityType: "Construction OT" }).map((d) => d.kind);
    assert.ok(kinds.includes("timesheet-job-total"));
    assert.ok(kinds.includes("timesheet-unknown-job"));
    assert.ok(kinds.includes("timesheet-skipped-hours"));

    const otOnly = [{ siteName: "Site 1", jobs: [{ ...jobReport[0].jobs[0], regularHours: 12.96 + 9 - 2, totalOTHours: 2 }, jobReport[0].jobs[1]] }];
    const otKinds = checkTimesheetCsv({ jobReport: otOnly, csvRows: rows, skippedHours: 0, overtimeActivityType: "Construction OT" }).map((d) => d.kind);
    assert.deepEqual(otKinds, ["timesheet-job-overtime"]);
  });
});

describe("parseCsv", () => {
  test("handles the exporter's BOM and CRLF", () => {
    assert.deepEqual(parseCsv("﻿a,b\r\n1,2\r\n"), [{ a: "1", b: "2" }]);
  });
});
