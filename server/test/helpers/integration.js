// Integration harness: a throwaway single-node MongoDB REPLICA SET (the app's transactions need
// one) + the real Express app (src/app.js) driven over HTTP with supertest, authenticated by a
// signed JWT cookie per role — exactly what verifyToken reads.
//
// The mongod binary: MONGOMS_SYSTEM_BINARY when set, else a local MongoDB install if one is
// found (nothing is downloaded), else mongodb-memory-server downloads its default build.
import fs from "node:fs";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";

const LOCAL_MONGOD = [
  "C:/Program Files/MongoDB/Server/8.2/bin/mongod.exe",
  "C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe",
  "C:/Program Files/MongoDB/Server/7.0/bin/mongod.exe",
  "/usr/bin/mongod",
  "/usr/local/bin/mongod",
  "/opt/homebrew/bin/mongod",
];

/** Start the DB, connect mongoose, load the app and create every collection + index. */
export async function startStack() {
  const systemBinary = process.env.MONGOMS_SYSTEM_BINARY || LOCAL_MONGOD.find((p) => fs.existsSync(p));
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    ...(systemBinary ? { binary: { systemBinary } } : {}),
  });
  const stop = async () => {
    await mongoose.disconnect().catch(() => {});
    await replSet.stop().catch(() => {});
  };

  const uri = replSet.getUri("ams_test");
  try {
    await mongoose.connect(uri);
    const { default: app } = await import("../../src/app.js");
    // Collections must exist before a transaction writes to them. Indexes are built the way
    // the running app builds them (Model.init); a failing one is logged, not fatal — same as
    // production (TransferRequest's two `employee_1` definitions clash there too).
    for (const model of Object.values(mongoose.models)) {
      await model.createCollection().catch(() => {});
      await model.init().catch((error) => console.warn(`[test] index build for ${model.modelName}: ${error.message}`));
    }
    const { ensureDriverPool } = await import("../../src/utils/driverPool.js");
    await ensureDriverPool();
    return { app, stop, uri };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** Auth cookie for a user document (any role). */
export const cookieFor = (user) =>
  `token=${jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET)}`;

/** supertest bound to the app + a user: api(app, user).get(url) … */
export function api(app, user) {
  const cookie = cookieFor(user);
  const wrap = (method) => (url) => request(app)[method](url).set("Cookie", cookie);
  return { get: wrap("get"), post: wrap("post"), patch: wrap("patch"), put: wrap("put"), delete: wrap("delete") };
}

// --------------------------------------------------------------------------
// Seed factories (direct model writes — the thing under test is what the APP does with them)
// --------------------------------------------------------------------------
let seq = 0;
const next = () => ++seq;

export async function models() {
  const [work, site, job, emp, user, attendance, holiday] = await Promise.all([
    import("../../src/models/workModel.js"),
    import("../../src/models/siteModel.js"),
    import("../../src/models/jobModel.js"),
    import("../../src/models/empModel.js"),
    import("../../src/models/userModel.js"),
    import("../../src/models/attendanceModel.js"),
    import("../../src/models/holidayModel.js"),
  ]);
  return {
    WorkSchedule: work.default,
    Site: site.default,
    Job: job.default,
    Employee: emp.default,
    User: user.default,
    Attendance: attendance.default,
    CustomHoliday: holiday.default,
  };
}

export async function seedBase(overrides = {}) {
  const M = await models();
  const workConfig = await M.WorkSchedule.create({
    type: "default",
    name: "Default",
    fullDayHours: 8,
    halfDayHours: 4,
    overtimeThreshold: 8,
    weeklyHolidays: ["friday"],
    breakDurationMinutes: 60,
    erpCompanyName: "Test Co",
    erpOvertimeType: "Standard OT",
    erpOvertimeActivityType: "Construction OT",
    countUnmarkedAsAbsent: true,
    ...overrides,
  });
  const superadmin = await M.User.create({ name: "Super", email: `super${next()}@t.test`, password: "pw-123456", role: "superadmin" });
  const admin = await M.User.create({ name: "Admin", email: `admin${next()}@t.test`, password: "pw-123456", role: "admin" });
  return { M, workConfig, superadmin, admin };
}

export async function makeSite(M, name = `Site ${next()}`) {
  return M.Site.create({ siteName: name, isActive: true });
}

export async function makeJob(M, site, jobCode, extra = {}) {
  return M.Job.create({ name: `Job ${jobCode ?? next()}`, site: site?._id ?? null, ...(jobCode ? { jobCode } : {}), ...extra });
}

export async function makeEmployee(M, employeeId, extra = {}) {
  const { createdAt = new Date("2026-01-01T00:00:00Z"), ...fields } = extra;
  const emp = await M.Employee.create({ name: `Worker ${employeeId}`, employeeId, jobTitle: "Mason", ...fields });
  // Unmarked days count from createdAt — backdate it (timestamps would stamp "now").
  await M.Employee.collection.updateOne({ _id: emp._id }, { $set: { createdAt } });
  emp.createdAt = createdAt;
  return emp;
}

export async function makeSupervisor(M, site, employeeId) {
  return M.User.create({
    name: `Sup ${employeeId}`,
    email: `sup${next()}@t.test`,
    password: "pw-123456",
    role: "supervisor",
    assignedSite: site._id,
    employeeId,
  });
}

/** Expect a 2xx; on failure show the body (supertest's own message hides it). */
export function ok(res, label = "") {
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${label} → HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 600)}`);
  }
  return res;
}
