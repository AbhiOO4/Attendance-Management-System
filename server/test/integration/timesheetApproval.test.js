// Monthly timesheet approval through the real app: blockers stop an approval, the approver is
// logged, only approved timesheets export to ERPNext (the summary is ungated), a change to an approved
// month — through ANY write path — revokes it, and supervisors only read.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startStack, seedBase, makeSite, makeJob, makeEmployee, makeSupervisor, api, ok } from "../helpers/integration.js";

let stack, M, admin, superadmin, sup;
let E;

const backfill = (employee, date, sessions) =>
  api(stack.app, admin)
    .post("/api/attendance/backfill")
    .send({ employeeMongoId: employee._id, date, sessions })
    .then((r) => ok(r, `backfill ${employee.employeeId} ${date}`));

const timesheetOf = async (employee, user = admin) =>
  ok(await api(stack.app, user).get(`/api/attendance/employee/${employee._id}?month=9&year=2026`), "timesheet").body;

const approve = (ids, user = admin, period = { month: 9, year: 2026 }) =>
  api(stack.app, user).post("/api/timesheets/approve").send({ ...period, employeeIds: ids.map((e) => String(e._id)) });

before(async () => {
  stack = await startStack();
  ({ M, admin, superadmin } = await seedBase());
  const alpha = await makeSite(M, "Alpha");
  const noJobs = await makeSite(M, "No jobs");
  const a100 = await makeJob(M, alpha, "A-100");
  sup = await makeSupervisor(M, alpha, "SUP-1");
  // Added late in September, so only the last few days count (Sep 28–30 are Mon–Wed).
  const late = { currentSite: alpha._id, createdAt: new Date("2026-09-28T00:00:00Z") };
  E = {
    missing: await makeEmployee(M, "MISS", late),
    open: await makeEmployee(M, "OPEN", { ...late, createdAt: new Date("2026-09-30T00:00:00Z") }),
    noJob: await makeEmployee(M, "NOJOB", { ...late, createdAt: new Date("2026-09-30T00:00:00Z") }),
    clean: await makeEmployee(M, "CLEAN", { ...late, createdAt: new Date("2026-09-30T00:00:00Z") }),
  };
  await backfill(E.missing, "2026-09-28", [{ siteId: alpha._id, jobId: a100._id, checkIn: "07:00", checkOut: "15:00" }]);
  await backfill(E.missing, "2026-09-29", [{ siteId: alpha._id, jobId: a100._id, checkIn: "07:00", checkOut: "15:00" }]);
  await backfill(E.open, "2026-09-30", [{ siteId: alpha._id, jobId: a100._id, checkIn: "07:00" }]);
  await backfill(E.noJob, "2026-09-30", [{ siteId: noJobs._id, jobId: null, checkIn: "07:00", checkOut: "15:00" }]);
  await backfill(E.clean, "2026-09-30", [{ siteId: alpha._id, jobId: a100._id, checkIn: "07:00", checkOut: "15:00" }]);
});
after(async () => stack?.stop());

describe("approving", () => {
  test("a month that hasn't ended can't be approved", async () => {
    const res = await approve([E.clean], admin, { month: 12, year: 2099 });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "MONTH_OPEN");
  });

  test("blocked timesheets are skipped with their blockers; a clean one is approved and the approver logged", async () => {
    const res = ok(await approve([E.missing, E.open, E.noJob, E.clean]), "approve");
    assert.deepEqual(res.body.approved.map((e) => e.employeeId), ["CLEAN"]);
    const skipped = Object.fromEntries(res.body.skipped.map((s) => [s.employeeId, s.blockers]));
    assert.deepEqual(skipped.MISS, { missing: ["2026-09-30"], pending: [], noJob: [] });
    assert.deepEqual(skipped.OPEN, { missing: [], pending: ["2026-09-30"], noJob: [] });
    assert.deepEqual(skipped.NOJOB, { missing: [], pending: [], noJob: ["2026-09-30"] });

    const sheet = await timesheetOf(E.clean);
    assert.equal(sheet.approval.status, "approved");
    assert.equal(sheet.approval.approvedByName, "Admin");
    assert.deepEqual(sheet.approval.history.map((h) => [h.action, h.byName]), [["approved", "Admin"]]);
    assert.equal(sheet.monthClosed, true);
  });

  test("the employee timesheet lists the missing dates to backfill", async () => {
    const sheet = await timesheetOf(E.missing);
    assert.deepEqual(sheet.payroll.unmarkedDates, ["2026-09-30"]);
    assert.deepEqual(sheet.blockers.missing, ["2026-09-30"]);
    assert.equal(sheet.approval.status, "pending");
  });

  test("backfilling the missing day unblocks it", async () => {
    const alpha = await M.Site.findOne({ siteName: "Alpha" });
    const a100 = await M.Job.findOne({ jobCode: "A-100" });
    await backfill(E.missing, "2026-09-30", [{ siteId: alpha._id, jobId: a100._id, checkIn: "07:00", checkOut: "15:00" }]);
    const res = ok(await approve([E.missing]), "approve after backfill");
    assert.deepEqual(res.body.approved.map((e) => e.employeeId), ["MISS"]);
  });
});

describe("the Timesheets list", () => {
  test("rows carry status, approver and blocker counts; filters by approval and search", async () => {
    const body = ok(await api(stack.app, sup).get("/api/timesheets?month=9&year=2026"), "list").body;
    const row = (id) => body.rows.find((r) => r.employeeId === id);
    assert.equal(row("CLEAN").status, "approved");
    assert.equal(row("CLEAN").approvedByName, "Admin");
    assert.deepEqual(row("OPEN").blockers, { missing: 0, pending: 1, noJob: 0 });
    assert.equal(body.counts.approved, 2);

    const approved = ok(await api(stack.app, admin).get("/api/timesheets?month=9&year=2026&approval=approved"), "approved").body;
    assert.deepEqual(approved.rows.map((r) => r.employeeId).sort(), ["CLEAN", "MISS"]);
    const search = ok(await api(stack.app, admin).get("/api/timesheets?month=9&year=2026&search=nojob"), "search").body;
    assert.deepEqual(search.rows.map((r) => r.employeeId), ["NOJOB"]);
  });
});

describe("exports are approval-gated", () => {
  test("ERPNext: 409 naming the unapproved, 200 for approved", async () => {
    const refused = await api(stack.app, admin)
      .post("/api/attendance/reports/erpnext/9/2026")
      .send({ type: "attendance", employeeIds: [String(E.clean._id), String(E.open._id)] });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, "TIMESHEET_NOT_APPROVED");
    assert.deepEqual(refused.body.notApproved.map((e) => e.employeeId), ["OPEN"]);

    const one = await api(stack.app, admin).get(`/api/attendance/employee/${E.open._id}/erpnext/9/2026?type=attendance`);
    assert.equal(one.status, 409);

    ok(
      await api(stack.app, admin)
        .post("/api/attendance/reports/erpnext/9/2026")
        .send({ type: "timesheet", employeeIds: [String(E.clean._id)] }),
      "approved export"
    );
  });

  test("summary: not approval-gated (a pending month is printed to check it)", async () => {
    const res = ok(
      await api(stack.app, admin)
        .post("/api/timesheets/export/summary")
        .send({ month: 9, year: 2026, employeeIds: [String(E.clean._id), String(E.noJob._id)] }),
      "summary"
    );
    assert.deepEqual(res.body.report.map((r) => r.employeeId).sort(), ["CLEAN", "NOJOB"]);
  });
});

describe("changes after approval", () => {
  test("any write to the month's records auto-revokes it (logged) and the export is refused again", async () => {
    // A direct write, as a cron or script would make — no controller hook involved.
    const rec = await M.Attendance.findOne({ employee: E.clean._id });
    await M.Attendance.updateOne(
      { _id: rec._id },
      { $set: { "sessions.0.checkOut": new Date(rec.sessions[0].checkOut.getTime() + 30 * 60000) } }
    );
    const sheet = await timesheetOf(E.clean);
    assert.equal(sheet.approval.status, "revoked");
    assert.equal(sheet.approval.revokeReason, "records_changed");
    assert.deepEqual(sheet.approval.history.map((h) => h.action), ["approved", "auto_revoked"]);

    const refused = await api(stack.app, admin)
      .post("/api/attendance/reports/erpnext/9/2026")
      .send({ type: "attendance", employeeIds: [String(E.clean._id)] });
    assert.equal(refused.status, 409);
  });

  test("a remark does not revoke", async () => {
    ok(await approve([E.clean]), "re-approve");
    const rec = await M.Attendance.findOne({ employee: E.clean._id });
    await M.Attendance.updateOne({ _id: rec._id }, { $set: { remark: "checked" } });
    assert.equal((await timesheetOf(E.clean)).approval.status, "approved");
  });

  test("manual revoke is logged with who did it", async () => {
    ok(await api(stack.app, superadmin).post("/api/timesheets/revoke").send({ month: 9, year: 2026, employeeId: String(E.clean._id) }), "revoke");
    const { approval } = await timesheetOf(E.clean);
    assert.equal(approval.status, "revoked");
    assert.equal(approval.revokeReason, "manual");
    assert.equal(approval.revokedByName, "Super");
    assert.deepEqual(approval.history.map((h) => h.action), ["approved", "auto_revoked", "approved", "revoked"]);
  });
});

describe("access", () => {
  test("supervisors read the list but can't approve, revoke or export", async () => {
    const s = api(stack.app, sup);
    assert.equal((await s.get("/api/timesheets?month=9&year=2026")).status, 200);
    assert.equal((await approve([E.clean], sup)).status, 403);
    assert.equal((await s.post("/api/timesheets/revoke").send({ month: 9, year: 2026, employeeId: String(E.clean._id) })).status, 403);
    assert.equal((await s.post("/api/timesheets/export/summary").send({ month: 9, year: 2026, employeeIds: [String(E.clean._id)] })).status, 403);
    assert.equal(
      (await s.post("/api/attendance/reports/erpnext/9/2026").send({ type: "attendance", employeeIds: [String(E.clean._id)] })).status,
      403
    );
  });
});
