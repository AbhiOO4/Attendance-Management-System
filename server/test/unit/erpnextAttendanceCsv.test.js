import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildAttendanceCsv, toCsv } from "../../src/utils/erpnextExport.js";
import { parseCsv } from "../../src/utils/exportReconcile.js";
import { record, session, employee } from "../helpers/records.js";

const E = employee("EMP-1");
const day = (d, opts) => record(d, { employee: E, ...opts });
const build = (records, opts = {}) => {
  const { csv, meta } = buildAttendanceCsv(records, { companyName: "ACME LLC", standardWorkingHours: 8, ...opts });
  return { rows: parseCsv(csv), meta, csv };
};

describe("ERPNext Attendance CSV — one row per non-holiday day", () => {
  const records = [
    day("2026-09-01", { sessions: [session("2026-09-01", "07:00", "16:00")] }), // full: 9 raw, 8 net
    day("2026-09-02", { sessions: [session("2026-09-02", "07:00", "12:00")] }), // half
    day("2026-09-03", { isPaidLeave: true }),
    day("2026-09-05", { isEmergencyLeave: true }),
    day("2026-09-06", { isSickLeave: true }),
    day("2026-09-07", { isLop: true }),
    day("2026-09-08", { sessions: [session("2026-09-08", "07:00", null)] }), // pending
    day("2026-09-09", {}), // plain absence
  ];
  const { rows } = build(records, { paidLeaveType: "Privilege Leave" });
  const byDate = Object.fromEntries(rows.map((r) => [r["Attendance Date"], r]));

  test("statuses and leave types follow classifyPayrollDay", () => {
    assert.deepEqual(
      rows.map((r) => [r["Attendance Date"], r.Status, r["Leave Type"]]),
      [
        ["2026-09-01", "Present", ""],
        ["2026-09-02", "Half Day", "Leave Without Pay"],
        ["2026-09-03", "On Leave", "Privilege Leave"],
        ["2026-09-05", "Absent", ""],
        ["2026-09-06", "Absent", ""],
        ["2026-09-07", "Absent", ""],
        ["2026-09-08", "Absent", ""],
        ["2026-09-09", "Absent", ""],
      ]
    );
  });

  test("Working Hours is the stored NET; Standard Working Hours is fullDayHours", () => {
    assert.equal(byDate["2026-09-01"]["Working Hours"], "8");
    assert.equal(byDate["2026-09-02"]["Working Hours"], "5");
    assert.ok(rows.every((r) => r["Standard Working Hours"] === "8" && r.Company === "ACME LLC"));
    assert.ok(rows.every((r) => r.Employee === "EMP-1" && r.ID === ""));
  });

  test("paid leave type falls back to Annual Leave", () => {
    const { rows: r2 } = build([records[2]]);
    assert.equal(r2[0]["Leave Type"], "Annual Leave");
  });

  test("rows are sorted by date whatever the input order", () => {
    const { rows: r3 } = build([...records].reverse());
    assert.deepEqual(r3.map((r) => r["Attendance Date"]), rows.map((r) => r["Attendance Date"]));
  });
});

describe("overtime and holidays", () => {
  const otDay = day("2026-09-10", { sessions: [session("2026-09-10", "06:00", "18:00")] }); // 12 raw → 11 net → 3 OT
  const workedHoliday = day("2026-09-11", { isHoliday: true, sessions: [session("2026-09-11", "07:00", "13:00")] }); // 6h
  const restDay = day("2026-09-12", { isHoliday: true });

  test("with an Overtime Type: OT duration on the day, worked holiday Present + holiday hours", () => {
    const { rows, meta } = build([otDay, workedHoliday, restDay], { overtimeType: "Standard OT" });
    assert.deepEqual(
      rows.map((r) => [r["Attendance Date"], r.Status, r["Working Hours"], r["Overtime Type"], r["Actual Overtime Duration"]]),
      [
        ["2026-09-10", "Present", "11", "Standard OT", "3"],
        ["2026-09-11", "Present", "6", "Standard OT", "6"],
      ]
    );
    assert.equal(meta.skippedHolidays, 1);
    assert.equal(meta.otRows, 1);
    assert.equal(meta.holidayOtRows, 1);
    assert.equal(meta.droppedOtHours, 0);
    assert.equal(meta.droppedHolidayHours, 0);
  });

  test("WITHOUT an Overtime Type the hours are dropped — and reported in meta", () => {
    const { rows, meta } = build([otDay, workedHoliday, restDay]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]["Overtime Type"], "");
    assert.equal(rows[0]["Actual Overtime Duration"], "");
    assert.equal(meta.droppedOtHours, 3);
    assert.equal(meta.droppedHolidayHours, 6);
    assert.equal(meta.skippedHolidays, 2);
  });

  test("a short worked holiday is still Present (never Half Day + LWP)", () => {
    const short = day("2026-09-13", { isHoliday: true, sessions: [session("2026-09-13", "07:00", "09:00")] });
    const { rows } = build([short], { overtimeType: "Standard OT" });
    assert.equal(rows[0].Status, "Present");
    assert.equal(rows[0]["Actual Overtime Duration"], "2");
  });
});

describe("CSV encoding", () => {
  test("cells with commas, quotes and newlines are quoted and round-trip", () => {
    const csv = toCsv(["a", "b"], [["x,y", 'say "hi"'], ["line\nbreak", null]]);
    assert.equal(csv, 'a,b\r\n"x,y","say ""hi"""\r\n"line\nbreak",');
    assert.deepEqual(parseCsv(csv), [
      { a: "x,y", b: 'say "hi"' },
      { a: "line\nbreak", b: "" },
    ]);
  });
  test("a company name with a comma survives", () => {
    const { rows } = build([day("2026-09-01", { sessions: [session("2026-09-01", "07:00", "16:00")] })], { companyName: "New Gulf, LLC" });
    assert.equal(rows[0].Company, "New Gulf, LLC");
  });
});
