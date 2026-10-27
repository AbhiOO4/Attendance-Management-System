// A full month written through the real API — multi-site days, OT, worked weekly and public
// holidays, half/pending days, annual + emergency leave, sick, LOP, unmarked days, a temporary
// worker, a driver split, a jobless session, a job with no code and a deleted job — then read
// back through the Monthly Report, the Jobs report and BOTH ERPNext exports and reconciled.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startStack, seedBase, makeSite, makeJob, makeEmployee, makeSupervisor, api, ok } from "../helpers/integration.js";
import { parseCsv, checkRecords, checkAttendanceCsv, checkTimesheetCsv, INFO_KINDS } from "../../src/utils/exportReconcile.js";
import { getDriverPoolId } from "../../src/utils/driverPool.js";

let stack, M, admin, superadmin, workConfig;
let sites, jobs, E;
let report, jobReport, attendanceCsv, timesheetCsv, timesheetHeaders, attendanceHeaders;

const day = (d) => new Date(`2026-09-${d}T00:00:00.000Z`);
const backfill = (employee, d, sessions, extra = {}) =>
  api(stack.app, admin)
    .post("/api/attendance/backfill")
    .send({ employeeMongoId: employee._id, date: `2026-09-${d}`, sessions, ...extra })
    .then((r) => ok(r, `backfill ${employee.employeeId} 09-${d}`));
const at = (site, job, checkIn, checkOut) => ({ siteId: site._id, jobId: job?._id ?? null, checkIn, checkOut });
const rowOf = (id) => report.report.find((r) => r.employeeId === id);
const jobRow = (code) => jobReport.flatMap((s) => s.jobs).find((j) => j.jobCode === code);

before(async () => {
  stack = await startStack();
  ({ M, admin, superadmin, workConfig } = await seedBase());
  sites = {
    alpha: await makeSite(M, "Alpha"),
    bravo: await makeSite(M, "Bravo"),
    delta: await makeSite(M, "Delta (no jobs)"),
  };
  jobs = {
    a100: await makeJob(M, sites.alpha, "A-100"),
    a101: await makeJob(M, sites.alpha, "A-101"),
    b200: await makeJob(M, sites.bravo, "B-200"),
    bdel: await makeJob(M, sites.bravo, "B-DEL"),
    noCode: await makeJob(M, sites.bravo, null),
  };
  E = {
    P1: await makeEmployee(M, "P1", { currentSite: sites.alpha._id }),
    P2: await makeEmployee(M, "P2", { currentSite: sites.bravo._id }),
    P3: await makeEmployee(M, "P3", { currentSite: sites.alpha._id }),
    P4: await makeEmployee(M, "P4", { currentSite: sites.delta._id }),
    T1: await makeEmployee(M, "T1", { currentSite: sites.alpha._id, employmentType: "temporary" }),
    D1: await makeEmployee(M, "D1", { jobTitle: "Light Driver" }),
  };
  const poolId = await getDriverPoolId();

  // P1 — multi-site 8h day (3 sessions), an OT day, a pending day.
  await backfill(E.P1, "01", [at(sites.alpha, jobs.a100, "06:00", "08:20"), at(sites.bravo, jobs.b200, "08:20", "10:40"), at(sites.alpha, jobs.a100, "10:40", "14:00")]);
  await backfill(E.P1, "02", [at(sites.alpha, jobs.a100, "06:00", "17:00")]);
  await backfill(E.P1, "03", [{ siteId: sites.alpha._id, jobId: jobs.a100._id, checkIn: "07:00" }]);
  await backfill(E.P1, "24", [at(sites.alpha, jobs.a100, "06:00", "18:00")]);

  // P2 — OT, half day, a worked weekly holiday (Fri 11th), and a day later declared a public holiday (23rd).
  await backfill(E.P2, "07", [at(sites.bravo, jobs.b200, "06:00", "18:00")]);
  await backfill(E.P2, "08", [at(sites.bravo, jobs.b200, "07:00", "12:00")]);
  await backfill(E.P2, "11", [at(sites.alpha, jobs.a100, "07:00", "13:00")]);
  await backfill(E.P2, "23", [at(sites.bravo, jobs.b200, "07:00", "17:00")]);

  // T1 (temporary) works the same Friday and the same declared day — normal days with OT for them.
  await backfill(E.T1, "11", [at(sites.alpha, jobs.a100, "06:00", "17:00")]);
  await backfill(E.T1, "23", [at(sites.alpha, jobs.a100, "06:00", "17:00")]);

  // D1 — a driver split equally over two Alpha jobs.
  ok(
    await api(stack.app, admin).post("/api/attendance/backfill").send({
      employeeMongoId: E.D1._id,
      date: "2026-09-09",
      sessions: [{ siteId: poolId, splitJobIds: [jobs.a100._id, jobs.a101._id], checkIn: "06:00", checkOut: "17:00" }],
    }),
    "driver backfill"
  );

  // P4 — a jobless session, a job with no code, and a job deleted after it was worked.
  await backfill(E.P4, "10", [at(sites.delta, null, "07:00", "15:00")]);
  await backfill(E.P4, "12", [at(sites.bravo, jobs.noCode, "07:00", "16:00")]);
  await backfill(E.P4, "22", [at(sites.bravo, jobs.bdel, "07:00", "16:00")]);
  await M.Job.updateOne({ _id: jobs.bdel._id }, { $set: { isDeleted: true, isActive: false } });

  // P3 — annual leave (needs an allocation), emergency leave, sick, LOP.
  ok(await api(stack.app, admin).post("/api/attendance/leave/allocations").send({ employeeId: E.P3._id, from: "2026-01-01", to: "2026-12-31", days: 30 }), "allocation");
  ok(await api(stack.app, admin).post("/api/attendance/leave").send({ employeeId: E.P3._id, from: "2026-09-14", to: "2026-09-15", type: "annual" }), "annual leave");
  ok(await api(stack.app, admin).post("/api/attendance/leave").send({ employeeId: E.P3._id, from: "2026-09-16", to: "2026-09-16", type: "emergency" }), "emergency leave");
  await backfill(E.P3, "17", [], { isSickLeave: true });
  await backfill(E.P3, "21", [], { isLop: true });

  // Declare the 23rd a public holiday AFTER it was worked; declare + undeclare the 24th.
  ok(await api(stack.app, admin).patch("/api/attendance/update/set-holiday").send({ date: "2026-09-23", isHoliday: true }), "declare 23");
  ok(await api(stack.app, admin).patch("/api/attendance/update/set-holiday").send({ date: "2026-09-24", isHoliday: true }), "declare 24");
  ok(await api(stack.app, admin).patch("/api/attendance/update/set-holiday").send({ date: "2026-09-24", isHoliday: false }), "undeclare 24");

  // Read every view of the month through the API.
  const sa = api(stack.app, superadmin);
  report = ok(await sa.get("/api/attendance/reports/monthly/9/2026"), "monthly report").body;
  jobReport = ok(await sa.get("/api/attendance/reports/job-report?month=9&year=2026"), "job report").body.report;
  const att = ok(await sa.post("/api/attendance/reports/erpnext/9/2026").send({ type: "attendance" }), "attendance export");
  const ts = ok(await sa.post("/api/attendance/reports/erpnext/9/2026").send({ type: "timesheet" }), "timesheet export");
  attendanceCsv = parseCsv(att.text);
  timesheetCsv = parseCsv(ts.text);
  attendanceHeaders = att.headers;
  timesheetHeaders = ts.headers;
});
after(async () => stack?.stop());

describe("holiday toggle re-prices records exactly like the shared math", () => {
  test("a worked day declared a public holiday: OT → 0, net → holiday hours; temporaries untouched", async () => {
    const p2 = await M.Attendance.findOne({ employee: E.P2._id, date: day("23") }).lean();
    assert.deepEqual([p2.isHoliday, p2.holidayReason, p2.totalWorkHours, p2.overtimeHours, p2.holidayHours], [true, "public", 9, 0, 9]);
    const t1 = await M.Attendance.findOne({ employee: E.T1._id, date: day("23") }).lean();
    assert.deepEqual([t1.isHoliday, t1.overtimeHours, t1.holidayHours], [false, 2, 0]);
  });
  test("undeclaring restores the overtime", async () => {
    const p1 = await M.Attendance.findOne({ employee: E.P1._id, date: day("24") }).lean();
    assert.deepEqual([p1.isHoliday, p1.totalWorkHours, p1.overtimeHours, p1.holidayHours], [false, 11, 3, 0]);
  });
});

describe("the month reconciles across every view", () => {
  test("no inconsistencies between records, report, Attendance CSV, Jobs report and Timesheet CSV", async () => {
    const records = await M.Attendance.find({ date: { $gte: day("01"), $lte: day("30") } })
      .populate("employee", "employeeId employmentType")
      .lean();
    const diffs = [
      ...checkRecords(records, workConfig.toObject()),
      ...checkAttendanceCsv({ records, reportRows: report.report, csvRows: attendanceCsv, overtimeType: "Standard OT", unmarkedAsAbsent: report.unmarkedAsAbsent }),
      ...checkTimesheetCsv({
        jobReport,
        csvRows: timesheetCsv,
        skippedHours: Number(timesheetHeaders["x-erpnext-skipped-hours"]),
        overtimeActivityType: "Construction OT",
      }),
    ];
    assert.deepEqual(diffs.filter((d) => !INFO_KINDS.has(d.kind)), []);
    // The only "info": the jobless (Delta, 7h net) and no-code (8h net) days that can't bill.
    assert.deepEqual(diffs.filter((d) => INFO_KINDS.has(d.kind)), [{ kind: "timesheet-skipped-info", hours: 15 }]);
  });

  test("Payment Days by hand (30 working days; Fridays + the 23rd are holidays; all of September is past)", () => {
    // P1: 4 records (3 full incl. 3-session day, 1 pending) + 21 unmarked → absent 22.
    assert.deepEqual(
      (({ fullDays, halfDays, absentDays, pendingDays, unmarkedDays, paymentDays, overtimeHours, holidayHours }) =>
        ({ fullDays, halfDays, absentDays, pendingDays, unmarkedDays, paymentDays, overtimeHours, holidayHours }))(rowOf("P1")),
      { fullDays: 3, halfDays: 0, absentDays: 22, pendingDays: 1, unmarkedDays: 21, paymentDays: 8, overtimeHours: 5, holidayHours: 0 }
    );
    // P2: full (OT 3), half, worked Friday (6 holiday h), declared 23rd (9 holiday h).
    const p2 = rowOf("P2");
    assert.deepEqual([p2.fullDays, p2.halfDays, p2.overtimeHours, p2.holidayHours, p2.totalOvertimeHours], [1, 1, 3, 15, 18]);
    assert.equal(p2.paymentDays, 30 - p2.absentDays - 0.5);
    // P3: 2 annual (paid), emergency + sick + LOP + 20 unmarked absent.
    const p3 = rowOf("P3");
    assert.deepEqual(
      [p3.leaveDays, p3.emergencyLeaveDays, p3.sickLeaveDays, p3.lopDays, p3.unmarkedDays, p3.absentDays, p3.paymentDays],
      [2, 1, 1, 1, 20, 23, 7]
    );
    // T1 (temporary): holidays are working days — the Fridays and the 23rd count as unmarked.
    assert.equal(rowOf("T1").unmarkedDays, 28);
    assert.equal(rowOf("T1").overtimeHours, 4);
  });

  test("Attendance CSV rows say what payroll should see", () => {
    const rows = (id) => attendanceCsv.filter((r) => r.Employee === id).map((r) => [r["Attendance Date"], r.Status, r["Working Hours"], r["Actual Overtime Duration"]]);
    assert.deepEqual(rows("P1"), [
      ["2026-09-01", "Present", "7", ""],
      ["2026-09-02", "Present", "10", "2"],
      ["2026-09-03", "Absent", "0", ""],
      ["2026-09-24", "Present", "11", "3"],
    ]);
    assert.deepEqual(rows("P2"), [
      ["2026-09-07", "Present", "11", "3"],
      ["2026-09-08", "Half Day", "5", ""],
      ["2026-09-11", "Present", "6", "6"],
      ["2026-09-23", "Present", "9", "9"],
    ]);
    assert.deepEqual(
      attendanceCsv.filter((r) => r.Employee === "P3").map((r) => [r["Attendance Date"], r.Status, r["Leave Type"]]),
      [
        ["2026-09-14", "On Leave", "Annual Leave"],
        ["2026-09-15", "On Leave", "Annual Leave"],
        ["2026-09-16", "Absent", ""],
        ["2026-09-17", "Absent", ""],
        ["2026-09-21", "Absent", ""],
      ]
    );
    assert.equal(attendanceHeaders["x-erpnext-dropped-overtime-hours"], "0");
  });

  test("Jobs report: per-job regular/OT, the driver split, and the deleted job still listed", () => {
    // A-100: P1 01 (4.04+2.92 of 7 net … see below), P1 02 (8+2), P1 24 (8+3), P2 11 (6 holiday), T1 11 + 23 (8+2 each), D1 half of 10 (4+1).
    const a100 = jobRow("A-100");
    const a101 = jobRow("A-101");
    assert.equal(a101.regularHours, 4);
    assert.equal(a101.totalOTHours, 1);
    assert.equal(Math.round((a100.regularHours + a100.totalOTHours) * 100) / 100, 4.96 + 10 + 11 + 6 + 10 + 10 + 5);
    const del = jobRow("B-DEL");
    assert.ok(del, "deleted job with hours must stay in the report");
    assert.equal(del.isDeleted, true);
    assert.equal(del.regularHours, 8);
  });

  test("Timesheet: per-job hours match, deleted job is billed, skipped hours are reported", () => {
    const sum = (code, ot) =>
      Math.round(
        timesheetCsv
          .filter((r) => r["Job Order (Time Sheets)"] === code && (ot === undefined || /OT$|Overtime$/.test(r["Activity Type (Time Sheets)"]) === ot))
          .reduce((s, r) => s + Number(r["Hrs (Time Sheets)"]), 0) * 100
      ) / 100;
    assert.equal(sum("B-DEL"), 8);
    assert.equal(sum("A-101", false), 4);
    assert.equal(sum("A-101", true), 1);
    assert.equal(timesheetHeaders["x-erpnext-skipped-no-job"], "2");
    assert.equal(timesheetHeaders["x-erpnext-skipped-hours"], "15");
  });
});

describe("access", () => {
  test("payroll reports and the bulk export are superadmin-only", async () => {
    const sup = await makeSupervisor(M, sites.alpha, "SUP-A");
    assert.equal((await api(stack.app, sup).get("/api/attendance/reports/monthly/9/2026")).status, 403);
    assert.equal((await api(stack.app, admin).get("/api/attendance/reports/monthly/9/2026")).status, 403);
    assert.equal((await api(stack.app, admin).post("/api/attendance/reports/erpnext/9/2026").send({ type: "attendance" })).status, 403);
    assert.equal((await api(stack.app, admin).get("/api/attendance/reports/job-report")).status, 403);
  });
  test("an admin can export one employee; the export carries the same hours", async () => {
    const res = ok(await api(stack.app, admin).get(`/api/attendance/employee/${E.P2._id}/erpnext/9/2026?type=attendance`), "employee export");
    const mine = parseCsv(res.text);
    assert.deepEqual(mine, attendanceCsv.filter((r) => r.Employee === "P2"));
  });
  test("no cookie → 401", async () => {
    const { default: request } = await import("supertest");
    assert.equal((await request(stack.app).get("/api/attendance/reports/monthly/9/2026")).status, 401);
  });
});
