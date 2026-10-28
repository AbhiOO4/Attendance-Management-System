// Timesheets page: one row per employee for a month with its approval status; approve /
// revoke (admin + superadmin, logged); the approval-gated summary export. The ERPNext CSVs
// are gated in attendanceController.exportErpnext. Rules: utils/timesheetApproval.js,
// status + auto-revoke: utils/timesheetMonth.js.

import mongoose from "mongoose";
import TimesheetApproval from "../models/timesheetApprovalModel.js";
import userModel from "../models/userModel.js";
import { siteClause, searchClauses } from "../utils/employeeListFilter.js";
import { isDriverTitle } from "../utils/driverPool.js";
import { isMonthClosed, monthBounds, blockerCount } from "../utils/timesheetApproval.js";
import { loadMonthTimesheets, approvalView } from "../utils/timesheetMonth.js";
import { buildAttendanceReport } from "./attendanceController.js";

const APPROVAL_FILTERS = ["all", "approved", "pending", "revoked"];

/** Month + year from query/body, or null when invalid. */
function parseMonth(source) {
  const month = Number(source?.month);
  const year = Number(source?.year);
  if (!Number.isInteger(month) || !Number.isInteger(year) || month < 1 || month > 12 || year < 2000) {
    return null;
  }
  return { month, year };
}

function parseIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  if (!ids.every((id) => mongoose.isValidObjectId(id))) return null;
  return [...new Set(ids.map(String))];
}

async function actorName(req) {
  const user = await userModel.findById(req.user.id).select("name").lean();
  return user?.name || null;
}

// GET /api/timesheets?month&year&search&site&employmentType&approval&page&limit
export const listTimesheets = async (req, res) => {
  try {
    const period = parseMonth(req.query);
    if (!period) {
      return res.status(400).json({ success: false, message: "Valid month and year are required" });
    }
    const { search, site, employmentType } = req.query;
    const approval = APPROVAL_FILTERS.includes(req.query.approval) ? req.query.approval : "all";

    const clauses = [...searchClauses(search)];
    const siteFilter = siteClause(site);
    if (siteFilter) clauses.push(siteFilter);
    if (employmentType === "temporary") clauses.push({ employmentType: "temporary" });
    // Anything not temporary is permanent (same rule as the reports).
    else if (employmentType === "permanent") clauses.push({ employmentType: { $ne: "temporary" } });

    const { employees } = await loadMonthTimesheets(period.year, period.month, {
      employeeFilter: clauses.length ? { $and: clauses } : null,
    });

    const counts = { approved: 0, pending: 0, revoked: 0 };
    for (const row of employees) counts[row.status] += 1;

    const filtered = approval === "all" ? employees : employees.filter((row) => row.status === approval);

    const total = filtered.length;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 0;
    const pageRows = limit ? filtered.slice((page - 1) * limit, page * limit) : filtered;

    const rows = pageRows.map(({ employee, blockers, approval: doc, status }) => ({
      _id: employee._id,
      name: employee.name,
      employeeId: employee.employeeId,
      companyId: employee.companyId ?? null,
      jobTitle: employee.jobTitle,
      employmentType: employee.employmentType === "temporary" ? "temporary" : "permanent",
      isActive: employee.isActive !== false,
      site: isDriverTitle(employee.jobTitle)
        ? "Drivers"
        : employee.currentSite?.siteName || null,
      status,
      approvedByName: doc?.approvedByName ?? null,
      approvedAt: doc?.approvedAt ?? null,
      revokedByName: doc?.revokedByName ?? null,
      revokedAt: doc?.revokedAt ?? null,
      revokeReason: doc?.revokeReason ?? null,
      blockers: {
        missing: blockers.missing.length,
        pending: blockers.pending.length,
        noJob: blockers.noJob.length,
      },
    }));

    return res.status(200).json({
      success: true,
      month: period.month,
      year: period.year,
      monthClosed: isMonthClosed(period.year, period.month),
      counts,
      total,
      currentPage: limit ? page : 1,
      totalPages: limit ? Math.max(Math.ceil(total / limit), 1) : 1,
      rows,
    });
  } catch (error) {
    console.error("listTimesheets error:", error);
    return res.status(500).json({ success: false, message: "Failed to load timesheets" });
  }
};

// POST /api/timesheets/approve { month, year, employeeIds }
// Approves each employee whose month is clean NOW; the rest come back in `skipped` with
// their blockers. Already-approved ones are left as they are (reported as approved).
export const approveTimesheets = async (req, res) => {
  try {
    const period = parseMonth(req.body);
    const ids = parseIds(req.body?.employeeIds);
    if (!period || !ids) {
      return res.status(400).json({ success: false, message: "month, year and employeeIds are required" });
    }
    if (!isMonthClosed(period.year, period.month)) {
      return res.status(400).json({
        success: false,
        code: "MONTH_OPEN",
        message: "A month can be approved only after it ends",
      });
    }

    const byName = await actorName(req);
    const { employees } = await loadMonthTimesheets(period.year, period.month, { employeeIds: ids });
    const approved = [];
    const skipped = [];
    const found = new Set();

    for (const row of employees) {
      const { employee, blockers, fingerprint, status } = row;
      found.add(String(employee._id));
      const who = { _id: employee._id, name: employee.name, employeeId: employee.employeeId };
      if (status === "approved") {
        approved.push(who);
        continue;
      }
      if (blockerCount(blockers) > 0) {
        skipped.push({ ...who, reason: "Has missing or incomplete days", blockers });
        continue;
      }
      const now = new Date();
      await TimesheetApproval.findOneAndUpdate(
        { employee: employee._id, year: period.year, month: period.month },
        {
          $set: {
            status: "approved",
            fingerprint,
            approvedBy: req.user.id,
            approvedByName: byName,
            approvedAt: now,
            revokedBy: null,
            revokedByName: null,
            revokedAt: null,
            revokeReason: null,
          },
          $push: { history: { action: "approved", by: req.user.id, byName, at: now } },
        },
        { upsert: true, returnDocument: "after" }
      );
      approved.push(who);
    }
    for (const id of ids) {
      if (!found.has(id)) skipped.push({ _id: id, name: null, employeeId: null, reason: "Not on this month's timesheets" });
    }

    return res.status(200).json({
      success: true,
      message: `Approved ${approved.length}, skipped ${skipped.length}`,
      approved,
      skipped,
    });
  } catch (error) {
    console.error("approveTimesheets error:", error);
    return res.status(500).json({ success: false, message: "Failed to approve timesheets" });
  }
};

// POST /api/timesheets/revoke { month, year, employeeId }
export const revokeTimesheet = async (req, res) => {
  try {
    const period = parseMonth(req.body);
    const employeeId = req.body?.employeeId;
    if (!period || !mongoose.isValidObjectId(employeeId)) {
      return res.status(400).json({ success: false, message: "month, year and employeeId are required" });
    }
    const byName = await actorName(req);
    const now = new Date();
    const doc = await TimesheetApproval.findOneAndUpdate(
      { employee: employeeId, year: period.year, month: period.month, status: "approved" },
      {
        $set: {
          status: "revoked",
          revokedBy: req.user.id,
          revokedByName: byName,
          revokedAt: now,
          revokeReason: "manual",
        },
        $push: { history: { action: "revoked", by: req.user.id, byName, at: now } },
      },
      { returnDocument: "after" }
    ).lean();
    if (!doc) {
      return res.status(409).json({ success: false, message: "This timesheet is not approved" });
    }
    return res.status(200).json({ success: true, message: "Approval revoked", approval: approvalView(doc) });
  } catch (error) {
    console.error("revokeTimesheet error:", error);
    return res.status(500).json({ success: false, message: "Failed to revoke approval" });
  }
};

// POST /api/timesheets/export/summary { month, year, employeeIds }
// The monthly report rows (payment days, absences, OT…) for the picked employees — the data
// behind the summary spreadsheet. NOT approval-gated: a pending month is printed to check it
// before approving; only the ERPNext CSVs need an approved timesheet.
export const exportSummary = async (req, res) => {
  try {
    const period = parseMonth(req.body);
    const ids = parseIds(req.body?.employeeIds);
    if (!period || !ids) {
      return res.status(400).json({ success: false, message: "month, year and employeeIds are required" });
    }

    const { from, to } = monthBounds(period.year, period.month);
    const built = await buildAttendanceReport(from, to);
    if (!built) {
      return res.status(404).json({ success: false, message: "Work schedule configuration not found" });
    }
    const wanted = new Set(ids);
    return res.status(200).json({
      success: true,
      month: period.month,
      year: period.year,
      report: built.report.filter((row) => wanted.has(String(row._id))),
      unmarkedAsAbsent: built.unmarkedAsAbsent,
    });
  } catch (error) {
    console.error("exportSummary error:", error);
    return res.status(500).json({ success: false, message: "Failed to export summary" });
  }
};
