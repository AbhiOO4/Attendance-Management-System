// The single-employee backfill honours explicit day offsets (the modal's next-day pills): a
// true 24h shift (08:00→08:00, check-out next day) and a standalone after-midnight session
// (01:00→06:00, starting next day) — neither can be inferred from the times alone.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startStack, seedBase, makeSite, makeJob, makeEmployee, api, ok } from "../helpers/integration.js";

let stack, admin, site, job, employee;

before(async () => {
  stack = await startStack();
  let M;
  ({ M, admin } = await seedBase());
  site = await makeSite(M, "Offsets");
  job = await makeJob(M, site, "OFF-1");
  employee = await makeEmployee(M, "OFFSET");
});
after(async () => stack?.stop());

const backfill = (date, session) =>
  api(stack.app, admin)
    .post("/api/attendance/backfill")
    .send({ employeeMongoId: employee._id, date, sessions: [{ siteId: site._id, jobId: job._id, ...session }] });

const storedSession = async (date) => {
  const Attendance = (await import("../../src/models/attendanceModel.js")).default;
  const doc = await Attendance.findOne({ employee: employee._id, date: new Date(`${date}T00:00:00Z`) }).lean();
  return doc.sessions[0];
};

test("08:00→08:00 with check-out next day is a 24h shift", async () => {
  ok(await backfill("2026-09-07", { checkIn: "08:00", checkOut: "08:00", checkInNextDay: false, checkOutNextDay: true }), "24h");
  const s = await storedSession("2026-09-07");
  assert.equal(s.checkOutNextDay, true);
  assert.equal(s.checkInNextDay, false);
  assert.equal((new Date(s.checkOut) - new Date(s.checkIn)) / 3600000, 24);
});

test("01:00→06:00 starting next day lands after midnight", async () => {
  ok(await backfill("2026-09-14", { checkIn: "01:00", checkOut: "06:00", checkInNextDay: true, checkOutNextDay: true }), "after midnight");
  const s = await storedSession("2026-09-14");
  assert.equal(s.checkInNextDay, true);
  assert.equal(s.checkOutNextDay, true);
  assert.equal(s.rawCheckIn, "01:00");
});

test("without flags the times are derived as before", async () => {
  ok(await backfill("2026-09-21", { checkIn: "19:00", checkOut: "03:00" }), "derived");
  const s = await storedSession("2026-09-21");
  assert.equal(s.checkInNextDay, false);
  assert.equal(s.checkOutNextDay, true);
});
