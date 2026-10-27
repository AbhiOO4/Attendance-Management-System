// Every write path must price a day EXACTLY like the shared math: computeAttendanceTotals over
// sumRawHours(sessions), with the record's break override and holiday state. Each test writes
// through the real HTTP endpoint; the last test re-checks every stored record with
// checkRecords (stored totals + invariants), so a path that drifts fails here.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startStack, seedBase, makeSite, makeJob, makeEmployee, makeSupervisor, api, ok } from "../helpers/integration.js";
import { checkRecords } from "../../src/utils/exportReconcile.js";
import { combineFromOffset, getTodayLocal } from "../../src/utils/timeLocal.js";

let stack, M, admin, workConfig, siteA, siteB, siteC, jobA, jobB, jobC, emps;
const iso = (date, hhmm, nextDay = false) => combineFromOffset(date, hhmm, nextDay).toISOString();
const recordOf = (employee, date) => M.Attendance.findOne({ employee: employee._id, date: new Date(`${date}T00:00:00.000Z`) }).lean();
const totals = (r) => ({ status: r.status, net: r.totalWorkHours, ot: r.overtimeHours, holiday: r.holidayHours, isHoliday: r.isHoliday });

before(async () => {
  stack = await startStack();
  ({ M, admin, workConfig } = await seedBase());
  siteA = await makeSite(M, "Alpha");
  siteB = await makeSite(M, "Bravo");
  siteC = await makeSite(M, "Charlie");
  jobA = await makeJob(M, siteA, "A-100");
  jobB = await makeJob(M, siteB, "B-200");
  jobC = await makeJob(M, siteC, "C-300");
  emps = {};
  for (const id of ["E1", "E2", "E3", "E5", "E7"]) emps[id] = await makeEmployee(M, id, { currentSite: siteA._id });
  emps.E4 = await makeEmployee(M, "E4", { currentSite: siteA._id, employmentType: "temporary" });
  emps.E6 = await makeEmployee(M, "E6", { currentSite: siteC._id, currentJob: jobC._id });
  await M.Job.updateOne({ _id: jobC._id }, { $push: { employees: emps.E6._id } });
});
after(async () => stack?.stop());

describe("write paths", () => {
  test("admin backfill: 3 back-to-back sessions of exactly 8h are a FULL day (rounding regression)", async () => {
    ok(
      await api(stack.app, admin).post("/api/attendance/backfill").send({
        employeeMongoId: emps.E1._id,
        date: "2026-09-01",
        sessions: [
          { siteId: siteA._id, jobId: jobA._id, checkIn: "06:00", checkOut: "08:20" },
          { siteId: siteB._id, jobId: jobB._id, checkIn: "08:20", checkOut: "10:40" },
          { siteId: siteA._id, jobId: jobA._id, checkIn: "10:40", checkOut: "14:00" },
        ],
      }),
      "backfill"
    );
    const r = await recordOf(emps.E1, "2026-09-01");
    assert.deepEqual(totals(r), { status: "fullday", net: 7, ot: 0, holiday: 0, isHoliday: false });
  });

  test("bulk backfill prices each employee like the shared math", async () => {
    ok(
      await api(stack.app, admin).post("/api/attendance/backfill/bulk").send({
        date: "2026-09-02",
        employeeIds: [emps.E2._id, emps.E3._id],
        siteId: siteA._id,
        jobId: jobA._id,
        checkIn: "06:00",
        checkOut: "17:30",
      }),
      "bulk backfill"
    );
    for (const e of [emps.E2, emps.E3]) {
      assert.deepEqual(totals(await recordOf(e, "2026-09-02")), { status: "fullday", net: 10.5, ot: 2.5, holiday: 0, isHoliday: false });
    }
  });

  test("on a weekly holiday (Friday): permanent → holiday hours, temporary → a normal day with OT", async () => {
    ok(
      await api(stack.app, admin).post("/api/attendance/backfill/bulk").send({
        date: "2026-09-04",
        employeeIds: [emps.E2._id, emps.E4._id],
        siteId: siteA._id,
        jobId: jobA._id,
        checkIn: "06:00",
        checkOut: "17:00",
      }),
      "bulk backfill holiday"
    );
    assert.deepEqual(totals(await recordOf(emps.E2, "2026-09-04")), { status: "fullday", net: 10, ot: 0, holiday: 10, isHoliday: true });
    assert.deepEqual(totals(await recordOf(emps.E4, "2026-09-04")), { status: "fullday", net: 10, ot: 2, holiday: 0, isHoliday: false });
  });

  test("admin edit re-prices the day from the new times", async () => {
    const r = await recordOf(emps.E1, "2026-09-01");
    const sessions = r.sessions.map((s) => ({
      _id: s._id,
      siteId: s.siteId,
      jobId: s.jobId,
      checkIn: new Date(s.checkIn).toISOString(),
      checkOut: new Date(s.checkOut).toISOString(),
    }));
    sessions[2].checkOut = iso("2026-09-01", "16:00"); // 8h → 10h raw
    ok(await api(stack.app, admin).patch(`/api/attendance/update/${r._id}`).send({ sessions, breaksTaken: null }), "edit");
    assert.deepEqual(totals(await recordOf(emps.E1, "2026-09-01")), { status: "fullday", net: 9, ot: 1, holiday: 0, isHoliday: false });
  });

  test("adding a session re-prices the day", async () => {
    ok(
      await api(stack.app, admin).post("/api/attendance/backfill").send({
        employeeMongoId: emps.E5._id,
        date: "2026-09-03",
        sessions: [{ siteId: siteA._id, jobId: jobA._id, checkIn: "06:00", checkOut: "09:55" }],
      }),
      "backfill"
    );
    const r = await recordOf(emps.E5, "2026-09-03");
    ok(
      await api(stack.app, admin).post(`/api/attendance/${r._id}/sessions`).send({
        session: { siteId: siteB._id, jobId: jobB._id, checkIn: iso("2026-09-03", "09:55"), checkOut: iso("2026-09-03", "11:00") },
      }),
      "add session"
    );
    assert.deepEqual(totals(await recordOf(emps.E5, "2026-09-03")), { status: "halfday", net: 5, ot: 0, holiday: 0, isHoliday: false });
  });

  test("bulk checkout closes an open session and re-prices the day", async () => {
    ok(
      await api(stack.app, admin).post("/api/attendance/backfill").send({
        employeeMongoId: emps.E7._id,
        date: "2026-09-07",
        sessions: [{ siteId: siteA._id, jobId: jobA._id, checkIn: "07:00" }],
      }),
      "backfill open"
    );
    const open = await recordOf(emps.E7, "2026-09-07");
    assert.equal(open.status, "absent");
    ok(await api(stack.app, admin).post("/api/attendance/bulk-checkout").send({ attendanceIds: [open._id], checkOut: "18:00" }), "bulk checkout");
    assert.deepEqual(totals(await recordOf(emps.E7, "2026-09-07")), { status: "fullday", net: 10, ot: 2, holiday: 0, isHoliday: false });
  });

  test("site submit (today, as the site's supervisor) prices like every other path", async () => {
    const supervisor = await makeSupervisor(M, siteC, "SUP-C");
    const today = getTodayLocal();
    const res = await api(stack.app, supervisor).post("/api/attendance/submit").send({
      siteId: siteC._id,
      date: today,
      attendance: [
        {
          employee: { _id: emps.E6._id },
          sessions: [
            { siteId: siteC._id, job: { _id: jobC._id }, jobId: jobC._id, checkIn: "06:00", checkOut: "08:20" },
            { siteId: siteC._id, job: { _id: jobC._id }, jobId: jobC._id, checkIn: "08:20", checkOut: "10:40" },
            { siteId: siteC._id, job: { _id: jobC._id }, jobId: jobC._id, checkIn: "10:40", checkOut: "14:00" },
          ],
        },
      ],
    });
    ok(res, "submit");
    const r = await recordOf(emps.E6, today);
    assert.deepEqual(totals(r), { status: "fullday", net: 7, ot: 0, holiday: 0, isHoliday: r.isHoliday });
  });

  test("EVERY stored record still equals the shared math and passes the invariants", async () => {
    const records = await M.Attendance.find({}).populate("employee", "employeeId employmentType").lean();
    assert.equal(records.length, 8, `expected the records written above, got ${records.length}`);
    assert.deepEqual(checkRecords(records, workConfig.toObject()), []);
  });
});
