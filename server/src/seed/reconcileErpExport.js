/**
 * READ-ONLY month reconciliation: stored records vs the shared math, the Monthly Report vs
 * the ERPNext Attendance CSV, and the Jobs report vs the ERPNext Timesheet CSV.
 *
 * Runs the REAL production code — the monthlyReport / jobReport / exportErpnext controllers
 * are called with in-memory req/res objects — then hands their outputs to
 * utils/exportReconcile.js. Nothing is written to the database.
 *
 * Usage (from server/):
 *   node src/seed/reconcileErpExport.js "<mongo url>" 2026-09
 *   node src/seed/reconcileErpExport.js "<mongo url>" 2026-09 --csv out.csv   # also dump diffs
 */

import fs from "node:fs";
import mongoose from "mongoose";
import Attendance from "../models/attendanceModel.js";
import customHolidayModel from "../models/holidayModel.js";
import workModel from "../models/workModel.js";
// Models the exports populate — registered here because a standalone run doesn't load the app.
import "../models/empModel.js";
import "../models/jobModel.js";
import "../models/siteModel.js";
import "../models/activityTypeModel.js";
import { monthlyReport, jobReport, exportErpnext } from "../controllers/attendanceController.js";
import {
  parseCsv,
  checkRecords,
  checkAttendanceCsv,
  checkTimesheetCsv,
  INFO_KINDS,
} from "../utils/exportReconcile.js";

/** Call an Express controller with an in-memory request; resolves { status, body, headers }. */
export function callController(handler, { params = {}, query = {}, body = {}, user = { role: "superadmin" } } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
      set(name, value) {
        headers[name.toLowerCase()] = value;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, body: payload, headers });
      },
      send(payload) {
        resolve({ status: this.statusCode, body: payload, headers });
      },
    };
    Promise.resolve(handler({ params, query, body, user }, res)).catch(reject);
  });
}

/**
 * Build every view of month `year`-`month` and reconcile them. Expects an open mongoose
 * connection. Returns { diffs, summary, config }.
 */
export async function reconcileMonth(year, month) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));

  const [workConfig, records, customHolidays] = await Promise.all([
    workModel.findOne({ type: "default" }).lean(),
    Attendance.find({ date: { $gte: from, $lt: to } })
      .populate("employee", "employeeId name employmentType")
      .lean(),
    customHolidayModel.find({ date: { $gte: from, $lt: to } }).lean(),
  ]);
  if (!workConfig) throw new Error("No default work config found.");

  const params = { month: String(month), year: String(year) };
  const [report, jobs, attendanceCsv, timesheetCsv] = await Promise.all([
    callController(monthlyReport, { params }),
    callController(jobReport, { query: params }),
    callController(exportErpnext, { params, body: { type: "attendance" } }),
    callController(exportErpnext, { params, body: { type: "timesheet" } }),
  ]);
  for (const [name, r] of [["monthlyReport", report], ["jobReport", jobs], ["attendance export", attendanceCsv], ["timesheet export", timesheetCsv]]) {
    if (r.status !== 200) throw new Error(`${name} failed (${r.status}): ${JSON.stringify(r.body).slice(0, 300)}`);
  }

  // The export drops records whose employee was hard-deleted; so does this check.
  const linked = records.filter((r) => r.employee && r.employee.employeeId);
  const diffs = [
    ...checkRecords(linked, workConfig),
    ...checkAttendanceCsv({
      records: linked,
      reportRows: report.body.report,
      csvRows: parseCsv(attendanceCsv.body),
      overtimeType: workConfig.erpOvertimeType || "",
      unmarkedAsAbsent: report.body.unmarkedAsAbsent !== false,
    }),
    ...checkTimesheetCsv({
      jobReport: jobs.body.report,
      csvRows: parseCsv(timesheetCsv.body),
      skippedHours: Number(timesheetCsv.headers["x-erpnext-skipped-hours"]) || 0,
      overtimeActivityType: workConfig.erpOvertimeActivityType || "",
    }),
  ];
  if (records.length !== linked.length)
    diffs.push({ kind: "records-of-deleted-employees", count: records.length - linked.length });

  const summary = {};
  for (const d of diffs) summary[d.kind] = (summary[d.kind] || 0) + 1;

  return {
    diffs,
    summary,
    records: records.length,
    config: {
      // AMS-side settings that must match ERPNext — compare by hand.
      fullDayHours: workConfig.fullDayHours,
      halfDayHours: workConfig.halfDayHours,
      overtimeThreshold: workConfig.overtimeThreshold,
      weeklyHolidays: workConfig.weeklyHolidays || [],
      publicHolidays: customHolidays.map((h) => new Date(h.date).toISOString().slice(0, 10)).sort(),
      countUnmarkedAsAbsent: workConfig.countUnmarkedAsAbsent !== false,
      erpOvertimeType: workConfig.erpOvertimeType || "(not set)",
      erpOvertimeActivityType: workConfig.erpOvertimeActivityType || "(not set)",
      erpPaidLeaveType: workConfig.erpPaidLeaveType || "(default: Annual Leave)",
    },
  };
}

const toCsvLine = (d) =>
  [d.kind, d.employeeId ?? d.jobCode ?? "", d.date ?? "", JSON.stringify(d).replace(/"/g, '""')]
    .map((c) => `"${c}"`)
    .join(",");

// Run only as a script (tests import reconcileMonth / callController).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const [, , url, ym, flag, csvPath] = process.argv;
  const m = /^(\d{4})-(\d{2})$/.exec(ym || "");
  if (!url || !m) {
    console.log('usage: node src/seed/reconcileErpExport.js "<mongo url>" YYYY-MM [--csv out.csv]');
    process.exit(1);
  }
  (async () => {
    await mongoose.connect(url);
    // Name the target (never the credentials) so the run is obvious in the log.
    console.log(`connected to ${mongoose.connection.host}/${mongoose.connection.name} (read-only)`);
    try {
      const { diffs, summary, records, config } = await reconcileMonth(Number(m[1]), Number(m[2]));
      console.log(`\n${ym}: ${records} attendance record(s).`);
      console.log("\nAMS settings to compare with ERPNext:", JSON.stringify(config, null, 2));
      const problems = diffs.filter((d) => !INFO_KINDS.has(d.kind));
      console.log(`\n${problems.length} inconsistency(ies); by kind:`, summary);
      for (const d of diffs.slice(0, 200)) console.log(" ", JSON.stringify(d));
      if (diffs.length > 200) console.log(`  … ${diffs.length - 200} more (use --csv)`);
      if (flag === "--csv" && csvPath) {
        fs.writeFileSync(csvPath, ["kind,subject,date,detail", ...diffs.map(toCsvLine)].join("\n"));
        console.log(`\nWrote ${diffs.length} row(s) to ${csvPath}`);
      }
    } finally {
      await mongoose.disconnect();
    }
  })().catch((error) => {
    console.error("reconcileErpExport failed:", error);
    process.exit(1);
  });
}
