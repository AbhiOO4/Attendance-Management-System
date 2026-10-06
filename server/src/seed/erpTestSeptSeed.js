/**
 * ERPNext export test fixture — September 2026 on the GR-30 Test Site (DEV DB ONLY).
 *
 * Creates GR30EMP03 / GR30EMP04 with one attendance record per day of September,
 * sessions on Job GR-30-001 / GR-30-002, covering every display status and the
 * hours-math edge cases. Totals are written from a HAND-COMPUTED table (not
 * computeAttendanceTotals) so the seed.js recalc is a genuine cross-check.
 *
 * Also: wipes GR30EMP01/02's attendance (+ their leaves and audit rows), declares
 * 2026-09-16 a public holiday the way markHoliday does, and locks every Sept day of
 * the site. Re-runnable.
 *
 * Usage (from server/):
 *   node src/seed/erpTestSeptSeed.js --dry   # print only
 *   node src/seed/erpTestSeptSeed.js         # apply
 * Optional: EXPECTED_OUT=<path> writes the expected table as JSON.
 */

import dotenv from "dotenv";
dotenv.config({ quiet: true });

import fs from "fs";
import mongoose from "mongoose";
import Attendance from "../models/attendanceModel.js";
import employeeModel from "../models/empModel.js";
import jobModel from "../models/jobModel.js";
import Leave from "../models/leaveModel.js";
import AttendanceAudit from "../models/attendanceAuditModel.js";
import AttendanceLock from "../models/lockModel.js";
import customHolidayModel from "../models/holidayModel.js";
import { combineFromOffset, hoursFromOffset, getAppOffsetMinutes } from "../utils/timeLocal.js";

const DRY = process.argv.includes("--dry");
const DEV_HOST_MARK = "5bdvuas";

const O = (id) => new mongoose.Types.ObjectId(id);
const SITE = O("6ab0badccbf6a0a5b50707eb");
const J1 = O("6ab0badccbf6a0a5b50707ec"); // Job GR-30-001
const J2 = O("6ab0badccbf6a0a5b50707ed"); // Job GR-30-002
const MARKED_BY = O("6a2166d4bd8b34596e36add5"); // Abhi (superadmin)
const OLD_EMPLOYEE_IDS = ["GR30EMP01", "GR30EMP02"];
const PUBLIC_HOLIDAY = "2026-09-16";
const LOP_REMARK = "Deduct 3.5 OMR";

// s(in, out, job, inNext, outNext) — out null = open (pending) session.
const s = (rawIn, rawOut, job, inNext = false, outNext = false) => ({ rawIn, rawOut, job, inNext, outNext });
// e(net, ot, hol, status) — expected day totals (hand-computed).
const e = (net, ot, hol, status) => ({ net, ot, hol, status });
const ZERO = e(0, 0, 0, "absent");

// day → { sessions, exp, breaks?, leave?, cleared?, remark? }
// leave: annual | emergency (Leave doc, no sessions) | sick | lop (one cleared session)
const EMP_A = {
  employeeId: "GR30EMP03",
  name: "GR-30 ERP Test A",
  currentJob: J1,
  days: {
    1: { sessions: [s("07:00", "16:00", J1)], exp: e(8, 0, 0, "fullday") },
    2: { sessions: [s("07:00", "19:00", J1)], exp: e(11, 3, 0, "fullday") },
    3: { sessions: [s("07:00", "11:00", J1), s("11:00", "17:30", J2)], exp: e(9.5, 1.5, 0, "fullday") },
    4: { sessions: "holiday-empty", exp: ZERO },
    5: { sessions: [s("07:00", "15:00", J1)], exp: e(7, 0, 0, "fullday") },
    6: { sessions: [s("07:00", "12:00", J2)], exp: e(5, 0, 0, "halfday") },
    7: { sessions: [s("07:00", "13:00", J2)], exp: e(5, 0, 0, "halfday") },
    8: { sessions: [s("07:00", "10:00", J1)], exp: e(3, 0, 0, "absent") },
    9: { sessions: "cleared", exp: ZERO },
    10: { sessions: "cleared", leave: "sick", exp: ZERO },
    11: { sessions: [s("07:00", "16:00", J2)], exp: e(8, 0, 8, "fullday") },
    12: { sessions: "cleared", leave: "lop", exp: ZERO },
    13: { sessions: [s("07:00", "17:00", J1)], breaks: 0, exp: e(10, 2, 0, "fullday") },
    14: { sessions: [s("07:00", "12:00", J1)], breaks: 1, exp: e(4, 0, 0, "halfday") },
    15: { sessions: [s("19:00", "04:00", J1, false, true)], exp: e(8, 0, 0, "fullday") },
    16: { sessions: "holiday-empty", exp: ZERO },
    17: { sessions: [s("19:00", "01:00", J1, false, true), s("01:00", "07:00", J2, true, true)], exp: e(11, 3, 0, "fullday") },
    18: { sessions: [s("12:00", "22:00", J1)], exp: e(9, 0, 9, "fullday") },
    19: { sessions: [s("01:00", "06:00", J2, true, true)], exp: e(5, 0, 0, "halfday") },
    20: { sessions: [s("08:00", "08:00", J2, false, true)], exp: e(23, 15, 0, "fullday") },
    21: { sessions: "none", leave: "annual", exp: ZERO },
    22: { sessions: "none", leave: "annual", exp: ZERO },
    23: { sessions: "none", leave: "emergency", exp: ZERO },
    24: { sessions: [s("07:00", "16:00", J2)], remark: "Left 30 min early for a medical check-up (approved)", exp: e(8, 0, 0, "fullday") },
    25: { sessions: "holiday-empty", exp: ZERO },
    26: { sessions: [s("06:00", "10:00", J1), s("10:30", "14:30", J2), s("15:00", "18:00", J1)], exp: e(10, 2, 0, "fullday") },
    27: { sessions: [s("07:00", "16:00", J1)], exp: e(8, 0, 0, "fullday") },
    28: { sessions: [s("18:00", "06:00", J2, false, true)], exp: e(11, 3, 0, "fullday") },
    29: { sessions: [s("07:00", "12:30", J1)], exp: e(5.5, 0, 0, "halfday") },
    30: { sessions: [s("07:00", null, J2)], exp: ZERO },
  },
  leaves: [
    { type: "annual", from: 21, to: 22, note: "ERP test — annual leave" },
    { type: "emergency", from: 23, to: 23, note: "ERP test — emergency leave" },
  ],
};

const EMP_B = {
  employeeId: "GR30EMP04",
  name: "GR-30 ERP Test B",
  currentJob: J2,
  days: {
    1: { sessions: [s("07:00", "16:00", J2)], exp: e(8, 0, 0, "fullday") },
    2: { sessions: "none", leave: "annual", exp: ZERO },
    3: { sessions: "none", leave: "annual", exp: ZERO },
    4: { sessions: [s("07:00", "12:00", J2)], exp: e(5, 0, 5, "halfday") },
    5: { sessions: [s("07:00", "13:00", J2), s("13:00", "19:00", J1)], exp: e(11, 3, 0, "fullday") },
    6: { sessions: "cleared", leave: "sick", exp: ZERO },
    7: { sessions: "cleared", leave: "lop", exp: ZERO },
    8: { sessions: "cleared", exp: ZERO },
    9: { sessions: [s("13:00", "17:00", J1)], exp: e(4, 0, 0, "halfday") },
    10: { sessions: [s("07:00", "10:30", J1)], exp: e(3.5, 0, 0, "absent") },
    11: { sessions: "holiday-empty", exp: ZERO },
    12: { sessions: [s("20:00", "05:00", J1, false, true)], exp: e(8, 0, 0, "fullday") },
    13: { sessions: [s("08:00", "17:00", J2)], breaks: 0, exp: e(9, 1, 0, "fullday") },
    14: { sessions: "none", leave: "emergency", exp: ZERO },
    15: { sessions: "none", leave: "emergency", exp: ZERO },
    16: { sessions: [s("07:00", "17:00", J1)], exp: e(9, 0, 9, "fullday") },
    17: { sessions: [s("07:00", "16:00", J2)], exp: e(8, 0, 0, "fullday") },
    18: { sessions: [s("19:00", "07:00", J2, false, true)], exp: e(11, 0, 11, "fullday") },
    19: { sessions: [s("10:00", "19:00", J1)], exp: e(8, 0, 0, "fullday") },
    20: { sessions: [s("07:00", "16:00", J1)], remark: "Shifted to scaffolding work after lunch", exp: e(8, 0, 0, "fullday") },
    21: { sessions: [s("07:00", null, J2)], exp: ZERO },
    22: { sessions: [s("07:00", "15:30", J2)], exp: e(7.5, 0, 0, "fullday") },
    23: { sessions: [s("07:00", "11:30", J1)], breaks: 1, exp: e(3.5, 0, 0, "halfday") },
    24: { sessions: [s("06:00", "18:00", J1)], exp: e(11, 3, 0, "fullday") },
    25: { sessions: "holiday-empty", exp: ZERO },
    26: { sessions: [s("07:00", "16:00", J2)], exp: e(8, 0, 0, "fullday") },
    27: { sessions: [s("07:00", "16:00", J1)], exp: e(8, 0, 0, "fullday") },
    28: { sessions: [s("07:00", "21:00", J2)], exp: e(13, 5, 0, "fullday") },
    29: { sessions: [s("07:00", "16:00", J2)], exp: e(8, 0, 0, "fullday") },
    30: { sessions: [s("07:00", "11:00", J1), s("11:00", "16:00", J2)], exp: e(8, 0, 0, "fullday") },
  },
  leaves: [
    { type: "annual", from: 2, to: 3, note: "ERP test — annual leave" },
    { type: "emergency", from: 14, to: 15, note: "ERP test — emergency leave" },
  ],
};

const dayKey = (d) => `2026-09-${String(d).padStart(2, "0")}`;
const dayDate = (d) => new Date(`${dayKey(d)}T00:00:00.000Z`);
const holidayReasonFor = (d) => {
  if (dayKey(d) === PUBLIC_HOLIDAY) return "public";
  return dayDate(d).getUTCDay() === 5 ? "weekly" : null; // Friday
};

function buildRecord(emp, empDoc, d, spec) {
  const key = dayKey(d);
  const holidayReason = holidayReasonFor(d);
  const baseSession = { siteId: SITE, jobId: emp.currentJob, markedBy: MARKED_BY };

  let sessions = [];
  if (spec.sessions === "cleared") {
    sessions = [{ ...baseSession, manuallyCleared: true }];
  } else if (spec.sessions === "holiday-empty") {
    sessions = [{ ...baseSession, manuallyCleared: false }];
  } else if (Array.isArray(spec.sessions)) {
    sessions = spec.sessions.map((x) => ({
      siteId: SITE,
      jobId: x.job,
      markedBy: MARKED_BY,
      checkIn: combineFromOffset(key, x.rawIn, x.inNext),
      checkOut: x.rawOut ? combineFromOffset(key, x.rawOut, x.outNext) : null,
      workedHours: x.rawOut ? hoursFromOffset(x.rawIn, x.rawOut, x.inNext, x.outNext) : 0,
      isNightShift: x.inNext || x.outNext,
      manuallyCleared: false,
    }));
  }

  const nextDay = sessions.some((x) => x.isNightShift);
  return {
    employee: empDoc._id,
    siteId: SITE,
    jobId: sessions[0]?.jobId ?? emp.currentJob,
    markedBy: MARKED_BY,
    date: dayDate(d),
    status: spec.exp.status,
    isHoliday: Boolean(holidayReason),
    holidayReason,
    holidayHours: spec.exp.hol,
    isPaidLeave: spec.leave === "annual",
    isEmergencyLeave: spec.leave === "emergency",
    isSickLeave: spec.leave === "sick",
    isLop: spec.leave === "lop",
    totalWorkHours: spec.exp.net,
    overtimeHours: spec.exp.ot,
    shiftType: nextDay ? "night" : "day",
    crossedMidnight: nextDay,
    sessions,
    breaksTaken: spec.breaks ?? null,
    remark: spec.leave === "lop" ? LOP_REMARK : spec.remark || "",
  };
}

async function run() {
  if (getAppOffsetMinutes() !== -330) {
    console.error(`APP_TIMEZONE_OFFSET is ${getAppOffsetMinutes()}, expected -330 (dev). Aborting.`);
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  const host = mongoose.connection.host || "";
  console.log(`connected to db "${mongoose.connection.name}" on ${host}${DRY ? " — DRY RUN" : ""}`);
  if (!host.includes(DEV_HOST_MARK)) {
    console.error("Not the dev cluster — aborting.");
    await mongoose.disconnect();
    process.exit(1);
  }

  // 1. Wipe the old test workers' attendance (+ leaves and audit rows that point at it).
  const oldEmps = await employeeModel.find({ employeeId: { $in: OLD_EMPLOYEE_IDS } }).select("_id employeeId").lean();
  const oldIds = oldEmps.map((x) => x._id);
  const oldCounts = {
    attendance: await Attendance.countDocuments({ employee: { $in: oldIds } }),
    leaves: await Leave.countDocuments({ employee: { $in: oldIds } }),
    audits: await AttendanceAudit.countDocuments({ employee: { $in: oldIds } }),
  };
  console.log(`old workers ${oldEmps.map((x) => x.employeeId).join(", ")}: will delete`, oldCounts);
  if (!DRY) {
    await Attendance.deleteMany({ employee: { $in: oldIds } });
    await Leave.deleteMany({ employee: { $in: oldIds } });
    await AttendanceAudit.deleteMany({ employee: { $in: oldIds } });
  }

  // 2. Public holiday, declared exactly like markHoliday (CustomHoliday + day-wide update).
  const phDay = new Date(`${PUBLIC_HOLIDAY}T00:00:00.000Z`);
  const phEnd = new Date(`${PUBLIC_HOLIDAY}T23:59:59.999Z`);
  const phExists = await customHolidayModel.findOne({ date: { $gte: phDay, $lte: phEnd } });
  const tempIds = await employeeModel.find({ employmentType: "temporary" }).distinct("_id");
  const phMatch = { date: { $gte: phDay, $lte: phEnd }, employee: { $nin: tempIds } };
  console.log(`public holiday ${PUBLIC_HOLIDAY}: ${phExists ? "exists" : "will create"}; records on that day to mark: ${await Attendance.countDocuments(phMatch)}`);
  if (!DRY) {
    if (!phExists) await customHolidayModel.create({ date: phDay, reason: "Manual Holiday" });
    await Attendance.updateMany(
      phMatch,
      [{ $set: { isHoliday: true, holidayReason: "public", holidayHours: { $ifNull: ["$totalWorkHours", 0] }, overtimeHours: 0 } }],
      { updatePipeline: true }
    );
  }

  const septFrom = dayDate(1);
  const octFirst = new Date("2026-10-01T00:00:00.000Z");
  const expected = {};
  let inserted = 0;
  let leaveDocs = 0;

  for (const emp of [EMP_A, EMP_B]) {
    // 3. Upsert the employee + job membership.
    let empDoc = await employeeModel.findOne({ employeeId: emp.employeeId });
    if (!DRY) {
      const fields = {
        name: emp.name,
        jobTitle: "mason",
        employmentType: "permanent",
        collarType: "skilled",
        nationality: "foreign",
        currentSite: SITE,
        currentJob: emp.currentJob,
        isActive: true,
      };
      if (empDoc) {
        Object.assign(empDoc, fields);
        await empDoc.save();
      } else {
        empDoc = await employeeModel.create({ employeeId: emp.employeeId, ...fields });
      }
      // Membership lives on exactly the employee's current job.
      await jobModel.updateMany({ _id: { $in: [J1, J2] } }, { $pull: { employees: empDoc._id } });
      await jobModel.updateOne({ _id: emp.currentJob }, { $addToSet: { employees: empDoc._id } });

      // 4. Re-runnable: clear this fixture's own September data first.
      await Attendance.deleteMany({ employee: empDoc._id, date: { $gte: septFrom, $lt: octFirst } });
      await Leave.deleteMany({ employee: empDoc._id, fromDate: { $gte: septFrom, $lt: octFirst } });
    }
    console.log(`${emp.employeeId} ${empDoc ? "exists/updated" : "will be created"}`);

    // 5. Records.
    expected[emp.employeeId] = {};
    for (let d = 1; d <= 30; d++) {
      const spec = emp.days[d];
      if (!spec) throw new Error(`${emp.employeeId} missing day ${d}`);
      const doc = buildRecord(emp, empDoc || { _id: new mongoose.Types.ObjectId() }, d, spec);
      expected[emp.employeeId][dayKey(d)] = {
        status: doc.status,
        totalWorkHours: doc.totalWorkHours,
        overtimeHours: doc.overtimeHours,
        holidayHours: doc.holidayHours,
        isHoliday: doc.isHoliday,
        holidayReason: doc.holidayReason,
        isPaidLeave: doc.isPaidLeave,
        isEmergencyLeave: doc.isEmergencyLeave,
        isSickLeave: doc.isSickLeave,
        isLop: doc.isLop,
        breaksTaken: doc.breaksTaken,
        sessions: Array.isArray(spec.sessions)
          ? spec.sessions.map((x) => ({
              jobId: String(x.job),
              rawCheckIn: x.rawIn,
              rawCheckOut: x.rawOut,
              checkInNextDay: x.inNext,
              checkOutNextDay: x.rawOut ? x.outNext : false,
            }))
          : [],
      };
      if (!DRY) {
        await new Attendance(doc).save();
        inserted++;
      }
    }

    // 6. Leave ledger docs, shaped like grantLeave.
    for (const lv of emp.leaves) {
      const days = [];
      for (let d = lv.from; d <= lv.to; d++) days.push({ date: dayDate(d), created: true });
      if (!DRY) {
        await Leave.create({
          employee: empDoc._id,
          type: lv.type,
          grantedBy: MARKED_BY,
          fromDate: dayDate(lv.from),
          toDate: dayDate(lv.to),
          note: lv.note,
          workingDays: days.length,
          days,
          status: "active",
        });
        leaveDocs++;
      }
    }
  }

  // 8. Lock every September day of the site (as if each sheet was submitted).
  let locks = 0;
  for (let d = 1; d <= 30; d++) {
    const exists = await AttendanceLock.exists({ siteId: SITE, date: dayDate(d) });
    if (exists) continue;
    if (!DRY) {
      await AttendanceLock.create({
        siteId: SITE,
        date: dayDate(d),
        isLocked: true,
        lockedBy: MARKED_BY,
        lockedAt: new Date(`${dayKey(d)}T13:30:00.000Z`), // 19:00 IST
      });
    }
    locks++;
  }

  console.log(`records inserted: ${inserted}, leave docs: ${leaveDocs}, locks ${DRY ? "to create" : "created"}: ${locks}`);

  if (process.env.EXPECTED_OUT) {
    fs.writeFileSync(process.env.EXPECTED_OUT, JSON.stringify(expected, null, 2));
    console.log(`expected table written to ${process.env.EXPECTED_OUT}`);
  }

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("seed failed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
