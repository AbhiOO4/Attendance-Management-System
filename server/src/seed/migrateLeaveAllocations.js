/**
 * One-off (PRODUCTION): move annual leave from the old implicit yearly allowance
 * (Employee.annualLeaveEntitlement / WorkSchedule.annualLeaveDefaultDays, both removed)
 * to date-range LeaveAllocations.
 *
 * Only employees with at least one ACTIVE annual leave grant (a Leave with status
 * "active" and type "annual", or no type — legacy grants are annual) get an allocation:
 * 60 days for 1 Jan – 31 Dec 2026. Everyone else starts with none and is allocated on
 * the Leave page.
 *   - An employee who already has an allocation overlapping 2026 is skipped (re-runnable).
 *   - If any of their annual leave days fall after 31 Dec 2026, the allocation's end is
 *     widened to the last such day (reported).
 *   - Annual leave days before 2026 are reported as uncovered (left alone).
 *   - Employees whose 2026 annual leave already exceeds 60 days are reported.
 *
 * Dry run by default. Usage (from server/):
 *   node src/seed/migrateLeaveAllocations.js "<mongo url>"            # report only
 *   node src/seed/migrateLeaveAllocations.js "<mongo url>" --apply    # create allocations
 */

import mongoose from "mongoose";
import Attendance from "../models/attendanceModel.js";
import employeeModel from "../models/empModel.js";
import Leave from "../models/leaveModel.js";
import LeaveAllocation from "../models/leaveAllocationModel.js";
import { utcDayKey, findOverlappingAllocation } from "../utils/leaveBalance.js";

const ALLOCATION_DAYS = 60;
const FROM = new Date(Date.UTC(2026, 0, 1));
const TO = new Date(Date.UTC(2026, 11, 31));
const NOTE = "Migrated from yearly allowance";

export const migrateLeaveAllocations = async (dbUrl, { apply = false } = {}) => {
  if (!dbUrl) {
    console.log("connection failed: no db url given");
    process.exit(1);
  }

  await mongoose.connect(dbUrl);
  // Name the target (never the credentials) so a live run is obvious in the log.
  console.log(`connected to ${mongoose.connection.host}/${mongoose.connection.name}${apply ? "" : " (dry run)"}`);

  try {
    const employeeIds = await Leave.distinct("employee", {
      status: "active",
      type: { $in: ["annual", null] },
    });
    const employees = await employeeModel
      .find({ _id: { $in: employeeIds } }, "name employeeId isActive")
      .sort({ name: 1 })
      .lean();

    console.log(`\n${employees.length} employee(s) with an active annual leave grant:`);

    let created = 0;
    let skipped = 0;
    for (const e of employees) {
      const label = `${e.name} (${e.employeeId})${e.isActive === false ? " [inactive]" : ""}`;

      const existing = await findOverlappingAllocation(e._id, FROM, TO);
      if (existing) {
        skipped += 1;
        console.log(`  - ${label}: already has an allocation ${utcDayKey(existing.fromDate)} → ${utcDayKey(existing.toDate)}, skipped`);
        continue;
      }

      const paidDays = (
        await Attendance.find({ employee: e._id, isPaidLeave: true }, "date").sort({ date: 1 }).lean()
      ).map((d) => d.date);
      const before = paidDays.filter((d) => d < FROM);
      const after = paidDays.filter((d) => d > TO);
      const inYear = paidDays.length - before.length - after.length;
      const toDate = after.length ? after[after.length - 1] : TO;

      const notes = [`${inYear} day(s) used in 2026`];
      if (after.length) notes.push(`end widened to ${utcDayKey(toDate)} for ${after.length} later day(s)`);
      if (before.length) notes.push(`WARNING ${before.length} day(s) before 2026 stay uncovered (${before.map(utcDayKey).join(", ")})`);
      if (inYear + after.length > ALLOCATION_DAYS) notes.push(`WARNING already over ${ALLOCATION_DAYS} days`);
      console.log(`  - ${label}: ${ALLOCATION_DAYS} days ${utcDayKey(FROM)} → ${utcDayKey(toDate)}; ${notes.join("; ")}`);

      if (apply) {
        await LeaveAllocation.create({
          employee: e._id,
          fromDate: FROM,
          toDate,
          days: ALLOCATION_DAYS,
          note: NOTE,
        });
        created += 1;
      }
    }

    if (!apply) {
      console.log("\nDry run — nothing changed. Re-run with --apply to create the allocations.");
    } else {
      console.log(`\nCreated ${created} allocation(s); ${skipped} employee(s) already had one.`);
    }
    return { found: employees.length, created, skipped };
  } finally {
    await mongoose.disconnect();
  }
};

const [, , dbUrl, flag] = process.argv;
migrateLeaveAllocations(dbUrl, { apply: flag === "--apply" }).catch((error) => {
  console.error("migrateLeaveAllocations failed:", error);
  process.exit(1);
});
