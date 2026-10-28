// Timesheet approval — the DB side. Loads a month's records for a set of employees, works out
// each one's blockers, fingerprint and approval status, and auto-revokes an approval whose
// records changed since it was given. Everything that reads or gates on approval (the
// Timesheets list, the employee timesheet, approve, every export) goes through here, so the
// gate is always computed from the records as they are NOW.

import Attendance from "../models/attendanceModel.js";
import empModel from "../models/empModel.js";
import workModel from "../models/workModel.js";
import customHolidayModel from "../models/holidayModel.js";
import TimesheetApproval from "../models/timesheetApprovalModel.js";
import { eachUtcDay } from "./leaveBalance.js";
import { buildCountableDays } from "./unmarkedDays.js";
import { monthBounds, timesheetBlockers, timesheetFingerprint } from "./timesheetApproval.js";

/** "approved" | "revoked" | "pending" (never approved). */
export const statusOf = (approval) => approval?.status || "pending";

/**
 * The approval as it stands against `fingerprint`: an "approved" doc whose records no longer
 * hash the same is revoked here (reason records_changed, an auto_revoked history entry). The
 * update is guarded on the old status + fingerprint, so two readers revoke it once.
 */
export async function resolveApproval(approval, fingerprint) {
  if (!approval || approval.status !== "approved" || approval.fingerprint === fingerprint) {
    return approval;
  }
  const now = new Date();
  const updated = await TimesheetApproval.findOneAndUpdate(
    { _id: approval._id, status: "approved", fingerprint: approval.fingerprint },
    {
      $set: {
        status: "revoked",
        revokedBy: null,
        revokedByName: null,
        revokedAt: now,
        revokeReason: "records_changed",
      },
      $push: { history: { action: "auto_revoked", by: null, byName: null, at: now } },
    },
    { returnDocument: "after" }
  ).lean();
  return updated || (await TimesheetApproval.findById(approval._id).lean());
}

/**
 * One month's timesheets. `employeeFilter` narrows the employees (Mongo clauses, e.g. the
 * Timesheets list filters); `employeeIds` limits to those ids. Employees listed: active ones,
 * plus inactive ones with a record that month — never anyone added after the month.
 * Returns { employees: [{ employee, records, blockers, fingerprint, approval, status }] }.
 */
export async function loadMonthTimesheets(year, month, { employeeFilter = null, employeeIds = null } = {}) {
  const { from, to } = monthBounds(year, month);
  const endExclusive = new Date(to.getTime() + 86400000);

  const recordFilter = { date: { $gte: from, $lte: to } };
  if (employeeIds) recordFilter.employee = { $in: employeeIds };

  const [records, workConfig, customHolidays] = await Promise.all([
    Attendance.find(recordFilter).lean(),
    workModel.findOne({ type: "default" }).lean(),
    customHolidayModel.find({ date: { $gte: from, $lt: endExclusive } }).lean(),
  ]);

  const recordsByEmp = new Map();
  for (const record of records) {
    const key = String(record.employee);
    if (!recordsByEmp.has(key)) recordsByEmp.set(key, []);
    recordsByEmp.get(key).push(record);
  }

  const clauses = [
    { $or: [{ createdAt: { $lt: endExclusive } }, { createdAt: { $exists: false } }] },
    { $or: [{ isActive: { $ne: false } }, { _id: { $in: [...recordsByEmp.keys()] } }] },
  ];
  if (employeeIds) clauses.push({ _id: { $in: employeeIds } });
  if (employeeFilter) clauses.push(employeeFilter);

  const [employees, approvals] = await Promise.all([
    empModel
      .find(
        { $and: clauses },
        "_id name employeeId companyId jobTitle currentSite employmentType isActive createdAt"
      )
      .populate("currentSite", "siteName isDriverPool")
      .sort({ name: 1 })
      .lean(),
    TimesheetApproval.find({
      year,
      month,
      ...(employeeIds ? { employee: { $in: employeeIds } } : {}),
    }).lean(),
  ]);

  const countableDays = buildCountableDays(
    eachUtcDay(from, to),
    workConfig?.weeklyHolidays || [],
    customHolidays
  );
  const approvalByEmp = new Map(approvals.map((a) => [String(a.employee), a]));

  const rows = [];
  for (const employee of employees) {
    const empRecords = recordsByEmp.get(String(employee._id)) || [];
    const fingerprint = timesheetFingerprint(empRecords);
    const approval = await resolveApproval(approvalByEmp.get(String(employee._id)), fingerprint);
    rows.push({
      employee,
      records: empRecords,
      blockers: timesheetBlockers(employee, empRecords, countableDays),
      fingerprint,
      approval,
      status: statusOf(approval),
    });
  }
  return { employees: rows };
}

/**
 * The employees among `employeeIds` whose timesheet for the month is NOT approved (as they
 * stand now — a changed one is revoked on the way), as [{ _id, name, employeeId }]. Ids
 * with no employee at all are reported too.
 */
export async function findNotApproved(year, month, employeeIds) {
  const ids = [...new Set(employeeIds.map(String))];
  const { employees } = await loadMonthTimesheets(year, month, { employeeIds: ids });
  const seen = new Set(employees.map((row) => String(row.employee._id)));
  const notApproved = employees
    .filter((row) => row.status !== "approved")
    .map(({ employee }) => ({ _id: employee._id, name: employee.name, employeeId: employee.employeeId }));
  for (const id of ids) if (!seen.has(id)) notApproved.push({ _id: id, name: null, employeeId: null });
  return notApproved;
}

/** The approval fields a client shows (no fingerprint). */
export function approvalView(approval) {
  return {
    status: statusOf(approval),
    approvedByName: approval?.approvedByName ?? null,
    approvedAt: approval?.approvedAt ?? null,
    revokedByName: approval?.revokedByName ?? null,
    revokedAt: approval?.revokedAt ?? null,
    revokeReason: approval?.revokeReason ?? null,
    history: approval?.history ?? [],
  };
}

/** The 409 body every approval-gated export answers with. */
export function notApprovedBody(notApproved) {
  return {
    success: false,
    code: "TIMESHEET_NOT_APPROVED",
    message: `${notApproved.length} selected timesheet(s) are not approved for this month`,
    notApproved,
  };
}
