/**
 * One-off: re-price the days hit by the session-rounding bug.
 *
 * Day totals used to be computed from the SUM OF ROUNDED session hours, so a multi-session
 * day could be stored 0.01h short or over — and a 3-session day adding up to exactly the
 * full-day hours (06:00–08:20, 08:20–10:40, 10:40–14:00 → 2.33 + 2.33 + 3.33 = 7.99) as a
 * HALF day. Every write path now uses sumRawHours (exact durations, rounded once).
 *
 * This script touches ONLY records the fix itself changes:
 *   - recompute the record twice with the CURRENT shared math — once from the old raw
 *     (Σ rounded workedHours), once from sumRawHours — using the record's own stored break
 *     override and holiday state;
 *   - if the two agree, the bug never touched it → left alone;
 *   - if the stored totals don't equal the OLD-raw result, the record differs for some other
 *     reason (a config change since, a legacy 2-break override, a hand edit) → REPORTED and
 *     left alone, so this script never smuggles in an unrelated recalculation;
 *   - otherwise the record is listed, and with --apply its day totals (status, net, OT,
 *     holiday hours) are rewritten via bulkWrite (timestamps off, never .save(): the save
 *     hook re-derives session raw times from THIS machine's APP_TIMEZONE_OFFSET).
 *
 * Dry run by default. Business days FROM and TO are "YYYY-MM-DD", both inclusive.
 * Usage (from server/):
 *   node src/seed/recalcRawRounding.js "<mongo url>" 2026-01-01 2026-10-20           # report
 *   node src/seed/recalcRawRounding.js "<mongo url>" 2026-01-01 2026-10-20 --apply   # write
 */

import mongoose from "mongoose";
import Attendance from "../models/attendanceModel.js";
import employeeModel from "../models/empModel.js";
import workModel from "../models/workModel.js";
import { computeAttendanceTotals, sumRawHours } from "../utils/attendanceMath.js";

const FIELDS = ["status", "totalWorkHours", "overtimeHours", "holidayHours"];

const parseBusinessDay = (value) => {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const day = new Date(`${text}T00:00:00.000Z`);
  return !isNaN(day) && day.toISOString().slice(0, 10) === text ? day : null;
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** The day-total fields as computeAttendanceTotals names them on the record. */
const totalsFor = (rawHours, record, workConfig) => {
  const t = computeAttendanceTotals(rawHours, workConfig, record.breaksTaken ?? null, {
    isHoliday: record.isHoliday,
    reason: record.holidayReason,
  });
  return {
    status: t.status,
    totalWorkHours: t.netWorkHours,
    overtimeHours: t.overtimeHours,
    holidayHours: t.holidayHours,
  };
};

const sameTotals = (a, b) => FIELDS.every((k) => (a[k] ?? 0) === (b[k] ?? 0));

/**
 * Pure classification of records (exported for tests). Returns
 * { fixes: [{ record, oldRaw, newRaw, before, after }], otherDrift: [{ record, stored, expected }] }.
 */
export function classifyRoundingFixes(records, workConfig) {
  const fixes = [];
  const otherDrift = [];
  for (const record of records) {
    const oldRaw = round2((record.sessions || []).reduce((sum, s) => sum + (s?.workedHours || 0), 0));
    const newRaw = sumRawHours(record.sessions);
    if (oldRaw === newRaw) continue;

    const before = totalsFor(oldRaw, record, workConfig);
    const after = totalsFor(newRaw, record, workConfig);
    if (sameTotals(before, after)) continue;

    const stored = Object.fromEntries(FIELDS.map((k) => [k, record[k] ?? 0]));
    if (!sameTotals(stored, before)) {
      otherDrift.push({ record, stored, expected: before });
      continue;
    }
    fixes.push({ record, oldRaw, newRaw, before, after });
  }
  return { fixes, otherDrift };
}

export const recalcRawRounding = async (dbUrl, fromDate, toDate, { apply = false } = {}) => {
  const fromDay = parseBusinessDay(fromDate);
  const toDay = parseBusinessDay(toDate);
  if (!dbUrl || !fromDay || !toDay || fromDay > toDay) {
    console.log('usage: node src/seed/recalcRawRounding.js "<mongo url>" FROM TO [--apply]  (YYYY-MM-DD, FROM <= TO)');
    process.exit(1);
  }

  await mongoose.connect(dbUrl);
  // Name the target (never the credentials) so a live run is obvious in the log.
  console.log(`connected to ${mongoose.connection.host}/${mongoose.connection.name}${apply ? "" : " (dry run)"}`);

  try {
    const workConfig = await workModel.findOne({ type: "default" }).lean();
    if (!workConfig) throw new Error("No default work config found.");

    const records = await Attendance.find({
      date: { $gte: fromDay, $lt: new Date(toDay.getTime() + 86400000) },
      "sessions.1": { $exists: true }, // one session's exact hours ARE its rounded hours
    })
      .select("employee date sessions.checkIn sessions.checkOut sessions.workedHours breaksTaken isHoliday holidayReason status totalWorkHours overtimeHours holidayHours")
      .lean();

    const { fixes, otherDrift } = classifyRoundingFixes(records, workConfig);

    const empIds = [...new Set([...fixes, ...otherDrift].map((x) => String(x.record.employee)))];
    const employees = await employeeModel.find({ _id: { $in: empIds } }, "name employeeId").lean();
    const who = new Map(employees.map((e) => [String(e._id), `${e.name} (${e.employeeId})`]));
    const day = (r) => new Date(r.date).toISOString().slice(0, 10);

    console.log(`\nScanned ${records.length} record(s) with 2+ sessions, ${fromDate} → ${toDate}.`);
    console.log(`\n${fixes.length} record(s) the rounding fix changes:`);
    for (const { record, oldRaw, newRaw, before, after } of fixes) {
      console.log(
        `  ${day(record)}  ${who.get(String(record.employee)) || record.employee}  raw ${oldRaw} → ${newRaw}  ` +
          FIELDS.filter((k) => before[k] !== after[k]).map((k) => `${k} ${before[k]} → ${after[k]}`).join(", ")
      );
    }
    if (otherDrift.length) {
      console.log(`\n${otherDrift.length} record(s) the fix would change but whose stored totals ALSO differ for another reason (left alone):`);
      for (const { record, stored, expected } of otherDrift) {
        console.log(`  ${day(record)}  ${who.get(String(record.employee)) || record.employee}  stored ${JSON.stringify(stored)}  expected-before-fix ${JSON.stringify(expected)}`);
      }
    }

    if (apply && fixes.length) {
      const ops = fixes.map(({ record, after }) => ({
        updateOne: { filter: { _id: record._id }, update: { $set: after } },
      }));
      const res = await Attendance.bulkWrite(ops, { ordered: false, timestamps: false });
      console.log(`\nApplied: ${res.modifiedCount} record(s) updated.`);
    } else if (fixes.length) {
      console.log("\nDry run — nothing written. Re-run with --apply to update these records.");
    }
  } finally {
    await mongoose.disconnect();
  }
};

// Run only as a script (tests import classifyRoundingFixes).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const [, , url, from, to, flag] = process.argv;
  recalcRawRounding(url, from, to, { apply: flag === "--apply" })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("recalcRawRounding failed:", error);
      process.exit(1);
    });
}
