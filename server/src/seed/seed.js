import dotenv from 'dotenv'
dotenv.config({quiet: true})

import mongoose from "mongoose";

const real_db_url = ""


const url = `${process.env.MONGO_URI}`



const connectDB = async (dbUrl = real_db_url) => {
    if (!dbUrl) {
        console.log('connection failed: no db url given')
        process.exit(1)
    }
    try{
        await mongoose.connect(dbUrl)
        // Name the target (never the credentials) so a live run is obvious in the log.
        console.log(`connected to db "${mongoose.connection.name}" on ${mongoose.connection.host}`)
    }catch(error){
        console.log('connection failed', error)
        process.exit(1) //status code 1: exit with failiure
    }
}

// Nothing connects on import any more. The one-off helpers below expect an open
// connection, so run `await connectDB(real_db_url)` before calling them; the
// recalculate* functions take the db url and connect themselves.

import employeeModel from "../models/empModel.js"
import userModel from "../models/userModel.js";
import workModel from "../models/workModel.js";
import siteModel from "../models/siteModel.js";
import jobTitleModel from "../models/jobTitleModel.js";
import Attendance from "../models/attendanceModel.js";
import { toLocalTimeString } from "../utils/timeLocal.js";
import { computeAttendanceTotals, MAX_BREAKS_PER_DAY } from "../utils/attendanceMath.js";
import customHolidayModel from "../models/holidayModel.js";


const seeWorkSchedule = async () => {
  try {
    const schedule = await workModel.create({
      type: "default",
      name: "Default Work Schedule",

      fullDayHours: 8,
      halfDayHours: 4,

      overtimeThreshold: 8,

      weeklyHolidays: ["friday"],
    })

    console.log("Doc created", schedule)
  } catch (error) {
    console.log(error)
  }
}

const employeeNames = [
  "Arjun Nair",
  "Rahul Menon",
  "Vivek Pillai",
  "Akash Kumar",
  "Sandeep Sharma",
  "Rohit Verma",
  "Karthik Iyer",
  "Pranav Rao",
  "Nikhil Joshi",
  "Aditya Kulkarni",
  "Rohan Desai",
  "Varun Gupta",
  "Abhishek Mishra",
  "Deepak Yadav",
  "Manoj Singh",
  "Rajesh Patel",
  "Harish Choudhary",
  "Ashwin Krishnan",
  "Gokul Subramanian",
  "Dinesh Reddy",
  "Amit Agarwal",
  "Pavan Shetty",
  "Naveen Bhat",
  "Sanjay Tiwari",
  "Vinod Saini",

  "Mohammed Aslam",
  "Abdul Rahman",
  "Imran Khan",
  "Nizamuddin Shaikh",
  "Ameen Ahmed",
  "Sameer Hussain",
  "Farhan Siddiqui",
  "Arif Ali",
  "Salman Qureshi",
  "Faizan Ansari",
  "Shakir Malik",
  "Bilal Sheikh",
  "Yasir Mirza",
  "Zubair Khan",
  "Irfan Pathan",
  "Junaid Hussain",
  "Tariq Ahmed",
  "Rafiq Memon",
  "Sohail Khan",
  "Danish Siddiqui",

  "Joseph Mathew",
  "Thomas Varghese",
  "George Kurian",
  "Mathew Chacko",
  "Antony Joseph",
  "Samuel Daniel",
  "Paul Francis",
  "Kevin D'Souza",
  "Adrian Fernandes",
  "Christopher Rodrigues",
  "Martin Pereira",
  "Allan Pinto",
  "Vincent D'Cruz",
  "Joel Abraham",
  "Peter Jacob",
  "Andrew Thomas",
  "Benoy Mathew",
  "Reji Varghese",
  "John Kuruvilla",
  "Philip George",

  "Gurpreet Singh",
  "Harpreet Singh",
  "Manpreet Singh",
  "Jaswinder Singh",
  "Amarjeet Singh",
  "Paramjit Singh",
  "Balwinder Singh",
  "Navdeep Singh",
  "Hardeep Singh",
  "Kuldeep Singh",

  "Priya Nair",
  "Anjali Menon",
  "Meera Pillai",
  "Kavya Iyer",
  "Pooja Sharma",
  "Neha Verma",
  "Sneha Joshi",
  "Aishwarya Rao",
  "Divya Reddy",
  "Lakshmi Krishnan",

  "Fatima Khan",
  "Ayesha Siddiqui",
  "Sana Hussain",
  "Zainab Sheikh",

  "Mary Joseph",
  "Elizabeth Mathew",
  "Grace Varghese",
  "Christina D'Souza",
  "Teresa Fernandes",

  "Simran Kaur",
  "Harleen Kaur",
  "Jasleen Kaur",
  "Navjot Kaur",
  "Amrit Kaur",
  "Gurleen Kaur"
];

const jobTitles = [
  "Welder",
  "Staff",
  "Mechanic",
  "Fitter",
  "Gas-cutter",
  "Grinder",
  "Mig-welder",
  "T-welder",
  "HSE",
];

const employees = [];

for (let i = 1; i <= 100; i++) {
  employees.push({
    name: employeeNames[i-1],
    employeeId: `EMP${String(i).padStart(4, "0")}`,
    jobTitle: jobTitles[(i - 1) % jobTitles.length],
    isActive: true,
  });
}

// console.log(JSON.stringify(employees, null, 2));

const jobtitles = [
  { title: "Welder" },
  { title: "Staff" },
  { title: "Mechanic" },
  { title: "Fitter" },
  { title: "Gas-cutter" },
  { title: "Grinder" },
  { title: "Mig-welder" },
  { title: "T-welder" },
  { title: "HSE" },
];

// await jobTitleModel.insertMany(jobtitles);
// await employeeModel.insertMany(employees);


async function createAdmin (name, email, password) {
    const admin = new userModel({name, email, password, role: 'admin'})
    await admin.save()
}

async function createSuperAdmin (name, email, password) {
  try {
    const existing = await userModel.findOne({ email });
    if (existing) {
      console.log(`Superadmin user with email ${email} already exists.`);
      return;
    }
    const superadmin = new userModel({name, email, password, role: 'superadmin'})
    await superadmin.save()
    console.log(`Superadmin user ${name} created successfully.`);
  } catch (error) {
    console.error("Error creating superadmin:", error);
  }
}

// await connectDB(real_db_url)
// seeWorkSchedule()
// createAdmin('Abhi', 'abhi@gmail.com', "admin@2026", )
// createSuperAdmin('Vishal', 'superadmin', "superadmin@2026")

// One-off backfill: set each employee's denormalized collarType from its job
// title's collarType. Run once after deploying the collar feature. First
// classify the relevant JobTitles as 'staff' (e.g. Staff, HSE) via the Configure
// page or a direct DB update, then run this. Titles default to 'skilled'.
const resyncEmployeeCollarType = async () => {
  try {
    const titles = await jobTitleModel.find().lean();
    // Map lowercased title -> collarType for O(1) lookup.
    const titleToCollar = new Map(
      titles.map((t) => [t.title.trim().toLowerCase(), t.collarType || "skilled"])
    );

    const employees = await employeeModel.find();
    console.log(`Found ${employees.length} employees to resync.`);

    let updated = 0;
    for (const emp of employees) {
      const collarType =
        titleToCollar.get((emp.jobTitle || "").trim().toLowerCase()) || "skilled";
      if (emp.collarType !== collarType) {
        emp.collarType = collarType;
        await emp.save();
        updated++;
      }
    }

    console.log(`Resynced collarType on ${updated} employee(s).`);
    process.exit(0);
  } catch (error) {
    console.error("Error resyncing employee collarType:", error);
    process.exit(1);
  }
};

// await connectDB(real_db_url)
// resyncEmployeeCollarType()

// ---------------------------------------------------------------------------
// Attendance recalculation
// ---------------------------------------------------------------------------
// Re-derives each record's day totals (status, net hours, overtime, holiday hours)
// from its stored sessions via computeAttendanceTotals. Run it after a change to the
// hours formula or the work schedule. Session times are never touched.
//
// Writes use bulkWrite, NOT record.save(). The pre("save") hook re-derives every
// session's rawCheckIn/rawCheckOut from its stored Dates using THIS process's
// APP_TIMEZONE_OFFSET. So saving live (Oman, -240) records from a machine whose .env
// says IST (-330) would shift every stored time. Only records whose totals actually
// change are written, with timestamps off, so an open Site Attendance page doesn't get
// a spurious RECORD_CHANGED on its next edit.

// Strict "YYYY-MM-DD" → that business day's UTC midnight (how Attendance.date is
// stored), or null. The round trip rejects impossible days like 2026-02-31.
const parseBusinessDay = (value) => {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const day = new Date(`${text}T00:00:00.000Z`);
  return !isNaN(day) && day.toISOString().slice(0, 10) === text ? day : null;
};

// Recalculates every Attendance record matching `filter` on the CURRENT connection.
// Returns { matched, updated }. Throws on failure; the callers own connect/exit.
const recalculateAttendanceRecords = async (filter = {}) => {
  const workConfig = await workModel.findOne({ type: "default" });
  if (!workConfig) {
    throw new Error("No default work config found.");
  }

  // Resolve holiday reasons the same way checkHolidayForDate does:
  // a CustomHoliday doc wins ("public"), else a weeklyHolidays weekday match
  // ("weekly"). Preload all custom holiday days for one lookup per record.
  const weeklyHolidays = workConfig.weeklyHolidays || [];
  const customHolidays = await customHolidayModel.find().select("date").lean();
  const customHolidayDays = new Set(
    customHolidays.map((h) => new Date(h.date).toISOString().slice(0, 10))
  );

  // Temporary workers get no holiday treatment — a holiday is a normal working
  // day for them (normal hours + OT, no holiday-hours credit). Preload their ids
  // so we can clear any holiday state left on their existing records.
  const tempIds = new Set(
    (await employeeModel.find({ employmentType: "temporary" }).select("_id").lean())
      .map((e) => String(e._id))
  );

  const resolveHolidayReason = (record) => {
    if (!record.isHoliday) return null;
    const day = new Date(record.date);
    if (customHolidayDays.has(day.toISOString().slice(0, 10))) return "public";
    const dayName = day
      .toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
      .toLowerCase();
    if (weeklyHolidays.includes(dayName)) return "weekly";
    // isHoliday=true with no matching source (e.g. a weekly holiday removed
    // from config after the fact): treat as a declared public holiday.
    return "public";
  };

  const records = await Attendance.find(filter)
    .select("employee date sessions.workedHours breaksTaken isHoliday holidayReason totalWorkHours status overtimeHours holidayHours")
    .lean();
  console.log(`Found ${records.length} attendance records to recalculate.`);

  const ops = [];
  for (const record of records) {
    // Calculate raw work hours from sessions
    const rawHours = (record.sessions || []).reduce((total, session) => total + (session.workedHours || 0), 0);

    const isTemp = tempIds.has(String(record.employee));
    const holidayReason = isTemp ? null : resolveHolidayReason(record);
    const isHoliday = isTemp ? false : Boolean(record.isHoliday);

    const { netWorkHours, status, overtimeHours, holidayHours } = computeAttendanceTotals(
      rawHours,
      workConfig,
      record.breaksTaken ?? null,
      { isHoliday, reason: holidayReason }
    );

    const next = {
      isHoliday,
      holidayReason,
      totalWorkHours: netWorkHours,
      status,
      overtimeHours,
      holidayHours,
    };
    // A legacy 2+ break override is already clamped in the math above; store the
    // clamped value too so the record agrees with its own totals.
    if (record.breaksTaken > MAX_BREAKS_PER_DAY) next.breaksTaken = MAX_BREAKS_PER_DAY;

    const changed = Object.keys(next).some((key) => (record[key] ?? null) !== next[key]);
    if (changed) {
      ops.push({ updateOne: { filter: { _id: record._id }, update: { $set: next } } });
    }
  }

  if (ops.length > 0) {
    await Attendance.bulkWrite(ops, { ordered: false, timestamps: false });
  }
  return { matched: records.length, updated: ops.length };
};

// Every record in the database at `dbUrl`.
const recalculateExistingAttendance = async (dbUrl) => {
  await connectDB(dbUrl);
  try {
    const { matched, updated } = await recalculateAttendanceRecords();
    console.log(`Recalculated ${matched} records; ${updated} changed and were saved.`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("Error recalculating existing attendance:", error);
    process.exit(1);
  }
};

/**
 * Recalculates the attendance records of business days `fromDate` to `toDate`,
 * BOTH INCLUSIVE, in the database at `dbUrl`. Dates are "YYYY-MM-DD" business days
 * (Attendance.date), so a night shift that ran past midnight is included with the
 * day it started, and APP_TIMEZONE_OFFSET plays no part in picking records.
 *
 */


const recalculateAttendanceInRange = async (dbUrl, fromDate, toDate) => {
  const fromDay = parseBusinessDay(fromDate);
  const toDay = parseBusinessDay(toDate);
  if (!fromDay || !toDay) {
    console.error(`from and to must be YYYY-MM-DD dates (got "${fromDate}", "${toDate}")`);
    process.exit(1);
  }
  if (fromDay.getTime() > toDay.getTime()) {
    console.error(`'from' (${fromDate}) must be on or before 'to' (${toDate})`);
    process.exit(1);
  }
  // Half-open upper bound (the day after `to`) so the whole of `to` is in.
  const dayAfterTo = new Date(toDay.getTime() + 24 * 60 * 60 * 1000);

  await connectDB(dbUrl);
  try {
    console.log(`Recalculating attendance from ${fromDate} to ${toDate} (inclusive).`);
    const { matched, updated } = await recalculateAttendanceRecords({
      date: { $gte: fromDay, $lt: dayAfterTo },
    });
    console.log(`Recalculated ${matched} records; ${updated} changed and were saved.`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("Error recalculating attendance in range:", error);
    process.exit(1);
  }
};

// NOTE: the cutoff-history audit/repair helpers that lived here were removed with the
// cutoff redesign — there is no business-day boundary hour to reconcile any more.


// recalculateExistingAttendance(real_db_url);

recalculateAttendanceInRange(real_db_url, "2026-09-01", "2026-09-30");
