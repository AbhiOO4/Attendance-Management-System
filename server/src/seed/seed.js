import dotenv from 'dotenv'
dotenv.config({quiet: true})

import mongoose from "mongoose";

const real_db_url = ""


const url = `${process.env.MONGO_URI}`



const connectDB = async () => {
    try{
        await mongoose.connect(real_db_url)
        console.log('connected to db')
    }catch(error){
        console.log('connection failed', error)
        process.exit(1) //status code 1: exit with failiure
    }
}

connectDB()

import employeeModel from "../models/empModel.js"
import userModel from "../models/userModel.js";
import workModel from "../models/workModel.js";
import siteModel from "../models/siteModel.js";
import jobTitleModel from "../models/jobTitleModel.js";
import Attendance from "../models/attendanceModel.js";
import {
  getCurrentCutoff,
  normalizeBusinessDate,
  resolveCutoffForDate,
  validateSessionTimes,
} from "../utils/cutoff.js";
import { toLocalTimeString } from "../utils/timeLocal.js";


const seeWorkSchedule = async () => {
  try {
    const schedule = await workModel.create({
      type: "default",
      name: "Default Work Schedule",

      fullDayHours: 8,
      halfDayHours: 4,

      overtimeThreshold: 8,
      overtimeRatePerHour: 0,

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
    monthlySalary: 20000,
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

// resyncEmployeeCollarType()

const recalculateExistingAttendance = async () => {
  try {
    const workConfig = await workModel.findOne({ type: "default" });
    if (!workConfig) {
      console.log("No default work config found.");
      return;
    }
    const { fullDayHours, overtimeThreshold } = workConfig;
    const breakDurationHours = (workConfig.breakDurationMinutes || 0) / 60;

    const records = await Attendance.find();
    console.log(`Found ${records.length} attendance records to recalculate.`);

    let updatedCount = 0;
    for (const record of records) {
      // Calculate raw work hours from sessions
      const rawHours = record.sessions.reduce((total, session) => total + (session.workedHours || 0), 0);

      const autoBreaks = fullDayHours > 0 ? Math.floor(rawHours / fullDayHours) : 0;
      const breaksApplied = (record.breaksTaken !== null && record.breaksTaken !== undefined)
        ? record.breaksTaken
        : autoBreaks;

      const netWorkHours = Math.max(rawHours - (breaksApplied * breakDurationHours), 0);
      const overtimeHours = netWorkHours > overtimeThreshold ? Number((netWorkHours - overtimeThreshold).toFixed(2)) : 0;

      record.totalWorkHours = Number(netWorkHours.toFixed(2));
      record.overtimeHours = overtimeHours;
      record.breaksTaken = record.breaksTaken ?? null;

      await record.save();
      updatedCount++;
    }

    console.log(`Successfully recalculated and saved ${updatedCount} records.`);
    process.exit(0);
  } catch (error) {
    console.error("Error recalculating existing attendance:", error);
    process.exit(1);
  }
};

// ---------------------------------------------------------------------------
// CUTOFF HISTORY (retroactive repair)
// ---------------------------------------------------------------------------
//
// The night-shift cutoff is baked into every stored checkIn/checkOut Date, so a record must
// be read with the cutoff that was in force on ITS OWN business day. That mapping lives in
// WorkSchedule.cutoffHistory, and the API deliberately refuses to backdate entries.
//
// If the cutoff was changed BEFORE effective-dating existed, the boot migration
// (ensureCutoffHistory) can only assume the current value always applied — which leaves the
// older records mis-interpreted and uneditable. These two functions are the escape hatch:
//
//   1. auditCutoffHistory()  — find records the CURRENT history mis-interprets, and the last
//                              business day affected. That day tells you when the cutoff
//                              actually changed.
//   2. setCutoffHistory([...]) — write the corrected history. Backdating is allowed here.
//
// Example: the cutoff used to be 7 and was changed to 4 on 2026-07-04.
//
//   setCutoffHistory([
//     { cutoffHour: 7, effectiveFrom: "1970-01-01" },   // everything before the change
//     { cutoffHour: 4, effectiveFrom: "2026-07-04" },   // the day the new cutoff took effect
//   ]);
//
// Re-run auditCutoffHistory() afterwards; it should report 0 problems.

const auditCutoffHistory = async () => {
  try {
    const workConfig = await workModel.findOne({ type: "default" });
    if (!workConfig) {
      console.log("No default work config found.");
      return process.exit(1);
    }

    console.log("Current cutoffHistory:");
    for (const e of workConfig.cutoffHistory || []) {
      console.log(`   ${e.cutoffHour}:00 from ${new Date(e.effectiveFrom).toISOString().slice(0, 10)}`);
    }

    // toLocalTimeString is not null-safe, and an open session has no check-out.
    const hhmm = (d) => (d ? toLocalTimeString(d) : null);

    const records = await Attendance.find({ "sessions.0": { $exists: true } })
      .select("date sessions")
      .lean();

    const problems = [];
    for (const record of records) {
      const cutoffHour = resolveCutoffForDate(workConfig, record.date);
      for (const session of record.sessions) {
        const inStr = hhmm(session.checkIn);
        const outStr = hhmm(session.checkOut);
        const error = validateSessionTimes(inStr, outStr, session.isNightShift, cutoffHour);
        if (error) {
          problems.push({
            date: new Date(record.date).toISOString().slice(0, 10),
            checkIn: inStr,
            checkOut: outStr,
            resolvedCutoff: cutoffHour,
            error,
          });
        }
      }
    }

    console.log(`\nScanned ${records.length} records. Sessions the current history mis-interprets: ${problems.length}`);
    console.log(`(Note: admin-backfilled records are deliberately cutoff-free and may appear here without being history bugs.)`);
    for (const p of problems) {
      console.log(`   ${p.date}  ${p.checkIn}→${p.checkOut ?? "—"}  (resolved cutoff ${p.resolvedCutoff}:00)  ${p.error}`);
    }

    if (problems.length > 0) {
      const lastBad = problems
        .map((p) => p.date)
        .sort()
        .pop();
      console.log(
        `\nLast affected business day: ${lastBad}. The old cutoff was still in force then, so the` +
        `\nnew cutoff's effectiveFrom must be AFTER ${lastBad}. Fix with setCutoffHistory([...]).`
      );
    }

    process.exit(0);
  } catch (error) {
    console.error("Error auditing cutoff history:", error);
    process.exit(1);
  }
};

// auditCutoffHistory();

const setCutoffHistory = async (entries) => {
  try {
    if (!Array.isArray(entries) || entries.length === 0) {
      console.log("Pass a non-empty array of { cutoffHour, effectiveFrom }.");
      return process.exit(1);
    }

    const normalized = entries.map(({ cutoffHour, effectiveFrom }) => {
      if (typeof cutoffHour !== "number" || cutoffHour < 0 || cutoffHour > 12) {
        throw new Error(`cutoffHour must be a number 0-12, got: ${cutoffHour}`);
      }
      const date = normalizeBusinessDate(effectiveFrom);
      if (!date) throw new Error(`Invalid effectiveFrom: ${effectiveFrom}`);
      return { cutoffHour, effectiveFrom: date };
    });

    normalized.sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());

    const workConfig = await workModel.findOne({ type: "default" });
    if (!workConfig) {
      console.log("No default work config found.");
      return process.exit(1);
    }

    workConfig.cutoffHistory = normalized;
    // Keep the denormalized field mirroring whichever entry is active right now.
    workConfig.nightShiftCutoffHour = getCurrentCutoff(workConfig);
    await workConfig.save();

    console.log("cutoffHistory set to:");
    for (const e of normalized) {
      console.log(`   ${e.cutoffHour}:00 from ${e.effectiveFrom.toISOString().slice(0, 10)}`);
    }
    console.log(`Active cutoff is now ${workConfig.nightShiftCutoffHour}:00.`);
    console.log("Re-run auditCutoffHistory() to confirm 0 problems.");

    process.exit(0);
  } catch (error) {
    console.error("Error setting cutoff history:", error);
    process.exit(1);
  }
};

// setCutoffHistory([
//   { cutoffHour: 7, effectiveFrom: "1970-01-01" },
//   { cutoffHour: 4, effectiveFrom: "2026-07-15" },
// ]);

// ---------------------------------------------------------------------------
// PER-SITE CUTOFF HISTORY (retroactive repair)
// ---------------------------------------------------------------------------
//
// Cutoffs are per-site now: each Site doc carries its own cutoffHistory, derived from its
// default shift times (utils/siteCutoff.js) and seeded from the global history by the boot
// migration (ensureSiteCutoffHistories). These are the per-site equivalents of the two
// global helpers above — same audit/fix workflow, scoped to one site's records.

const auditSiteCutoffHistories = async () => {
  try {
    const workConfig = await workModel.findOne({ type: "default" });
    const sites = await siteModel.find({}).select("siteName nightShiftCutoffHour cutoffHistory");
    const siteById = new Map(sites.map((s) => [s._id.toString(), s]));

    for (const site of sites) {
      console.log(`Site "${site.siteName}" cutoffHistory:`);
      for (const e of site.cutoffHistory || []) {
        console.log(`   ${e.cutoffHour}:00 from ${new Date(e.effectiveFrom).toISOString().slice(0, 10)}`);
      }
    }

    const hhmm = (d) => (d ? toLocalTimeString(d) : null);

    const records = await Attendance.find({ "sessions.0": { $exists: true } })
      .select("date sessions")
      .lean();

    // Each session is interpreted with ITS OWN site's cutoff for the record's business day;
    // sessions whose site is gone fall back to the global history.
    const problemsBySite = new Map();
    for (const record of records) {
      for (const session of record.sessions) {
        const site = session.siteId ? siteById.get(session.siteId.toString()) : null;
        const cutoffHour = resolveCutoffForDate(site || workConfig, record.date);
        const inStr = hhmm(session.checkIn);
        const outStr = hhmm(session.checkOut);
        const error = validateSessionTimes(inStr, outStr, session.isNightShift, cutoffHour);
        if (error) {
          const key = site ? site.siteName : "(unknown site)";
          if (!problemsBySite.has(key)) problemsBySite.set(key, []);
          problemsBySite.get(key).push({
            date: new Date(record.date).toISOString().slice(0, 10),
            checkIn: inStr,
            checkOut: outStr,
            resolvedCutoff: cutoffHour,
            error,
          });
        }
      }
    }

    const total = [...problemsBySite.values()].reduce((n, list) => n + list.length, 0);
    console.log(`\nScanned ${records.length} records. Sessions the current histories mis-interpret: ${total}`);
    console.log(`(Note: admin-backfilled records are deliberately cutoff-free and may appear here without being history bugs.)`);
    for (const [siteName, problems] of problemsBySite) {
      const lastBad = problems.map((p) => p.date).sort().pop();
      console.log(`\n  Site "${siteName}" — ${problems.length} problem(s), last affected day ${lastBad}:`);
      for (const p of problems) {
        console.log(`     ${p.date}  ${p.checkIn}→${p.checkOut ?? "—"}  (resolved cutoff ${p.resolvedCutoff}:00)  ${p.error}`);
      }
      console.log(`     Fix with setSiteCutoffHistory("${siteName}", [...]) — the changed cutoff's effectiveFrom must be AFTER ${lastBad}.`);
    }

    process.exit(0);
  } catch (error) {
    console.error("Error auditing site cutoff histories:", error);
    process.exit(1);
  }
};

// auditSiteCutoffHistories();

const setSiteCutoffHistory = async (siteName, entries) => {
  try {
    if (!Array.isArray(entries) || entries.length === 0) {
      console.log("Pass a site name and a non-empty array of { cutoffHour, effectiveFrom }.");
      return process.exit(1);
    }

    const normalized = entries.map(({ cutoffHour, effectiveFrom }) => {
      if (typeof cutoffHour !== "number" || cutoffHour < 0 || cutoffHour > 12) {
        throw new Error(`cutoffHour must be a number 0-12, got: ${cutoffHour}`);
      }
      const date = normalizeBusinessDate(effectiveFrom);
      if (!date) throw new Error(`Invalid effectiveFrom: ${effectiveFrom}`);
      return { cutoffHour, effectiveFrom: date };
    });

    normalized.sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());

    const site = await siteModel.findOne({ siteName });
    if (!site) {
      console.log(`No site named "${siteName}" found.`);
      return process.exit(1);
    }

    site.cutoffHistory = normalized;
    // Keep the denormalized field mirroring whichever entry is active right now.
    site.nightShiftCutoffHour = getCurrentCutoff(site);
    await site.save();

    console.log(`Site "${siteName}" cutoffHistory set to:`);
    for (const e of normalized) {
      console.log(`   ${e.cutoffHour}:00 from ${e.effectiveFrom.toISOString().slice(0, 10)}`);
    }
    console.log(`Active cutoff is now ${site.nightShiftCutoffHour}:00.`);
    console.log("NOTE: the next site-defaults edit re-derives the cutoff and schedules it for tomorrow.");
    console.log("Re-run auditSiteCutoffHistories() to confirm 0 problems.");

    process.exit(0);
  } catch (error) {
    console.error("Error setting site cutoff history:", error);
    process.exit(1);
  }
};

// setSiteCutoffHistory("Workshop Phase 7", [
//   { cutoffHour: 7, effectiveFrom: "1970-01-01" },
// ]);

// recalculateExistingAttendance();


