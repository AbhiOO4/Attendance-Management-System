import mongoose from "mongoose";
import Attendance from "../models/attendanceModel.js";
import empModel from "../models/empModel.js";
import LeaveAllocation from "../models/leaveAllocationModel.js";
import {
  normalizeUtcDay,
  utcDayKey,
  eachUtcDay,
  endOfUtcDay,
  paidLeaveDayKeys,
  findOverlappingAllocation,
  matchEmployeeIds,
  MAX_LEAVE_RANGE_DAYS,
} from "../utils/leaveBalance.js";

// ===========================================================================
// ANNUAL LEAVE ALLOCATIONS — the Leave page's Allocations tab. One employee per
// allocation, a from–to range and the annual (paid) leave days it grants. Annual
// leave applications draw on the allocation covering each day
// (utils/leaveBalance.js). Rules:
//   - one employee's allocations never overlap;
//   - an allocation can't be cut below the annual leave already taken inside it,
//     and can't be shrunk/deleted out from under a taken leave day.
// ===========================================================================

const fmtDay = (d) => utcDayKey(d);

// Validate the editable fields → { fromDay, toDay, days, note } or { error }.
function parseAllocationBody(body) {
  const fromDay = normalizeUtcDay(body?.from);
  const toDay = normalizeUtcDay(body?.to);
  if (!body?.from || !body?.to || !fromDay || !toDay) return { error: "A valid from and to date are required" };
  if (fromDay.getTime() > toDay.getTime()) return { error: "'from' must be on or before 'to'" };
  const span = eachUtcDay(fromDay, toDay).length;
  if (span > MAX_LEAVE_RANGE_DAYS) return { error: `Range too large (max ${MAX_LEAVE_RANGE_DAYS} days)` };

  const days = Number(body?.days);
  if (!Number.isInteger(days) || days < 0) return { error: "Days must be a whole number of 0 or more" };
  if (days > span) return { error: `Days can't exceed the ${span} day(s) in the period` };

  const note = String(body?.note ?? "").trim().slice(0, 500);
  return { fromDay, toDay, days, note };
}

const overlapResponse = (res, other) =>
  res.status(409).json({
    success: false,
    code: "ALLOCATION_OVERLAP",
    message: `This employee already has an allocation for ${fmtDay(other.fromDate)} – ${fmtDay(other.toDate)}. Allocations can't overlap — edit that one instead.`,
  });

// Attach used/remaining to a page of allocations with ONE attendance read.
async function attachUsage(allocations) {
  if (allocations.length === 0) return [];
  const docs = await Attendance.find(
    {
      isPaidLeave: true,
      $or: allocations.map((a) => ({
        employee: a.employee?._id ?? a.employee,
        date: { $gte: a.fromDate, $lte: endOfUtcDay(a.toDate) },
      })),
    },
    "employee date"
  ).lean();
  return allocations.map((a) => {
    const empId = String(a.employee?._id ?? a.employee);
    const from = new Date(a.fromDate).getTime();
    const to = new Date(a.toDate).getTime();
    const used = docs.filter((d) => {
      const t = new Date(d.date).getTime();
      return String(d.employee) === empId && from <= t && t <= to;
    }).length;
    return { ...a, used, remaining: a.days - used };
  });
}

// GET /api/attendance/leave/allocations?employeeId=&search=&page=&limit=
export const listAllocations = async (req, res) => {
  try {
    const { employeeId, search } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const filter = {};
    if (employeeId) {
      if (!mongoose.Types.ObjectId.isValid(employeeId)) {
        return res.status(400).json({ success: false, message: "Invalid employee id" });
      }
      filter.employee = employeeId;
    } else {
      const ids = await matchEmployeeIds(search);
      if (ids) filter.employee = { $in: ids };
    }

    const [total, allocations] = await Promise.all([
      LeaveAllocation.countDocuments(filter),
      LeaveAllocation.find(filter)
        .sort({ fromDate: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("employee", "name employeeId companyId jobTitle")
        .populate("createdBy", "name")
        .populate("updatedBy", "name")
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        allocations: await attachUsage(allocations),
        total,
        page,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error("listAllocations error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch leave allocations" });
  }
};

// POST /api/attendance/leave/allocations  { employeeId, from, to, days, note }
export const createAllocation = async (req, res) => {
  try {
    const { employeeId } = req.body || {};
    if (!employeeId || !mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({ success: false, message: "A valid employee is required" });
    }
    const parsed = parseAllocationBody(req.body);
    if (parsed.error) {
      return res.status(400).json({ success: false, message: parsed.error });
    }
    const { fromDay, toDay, days, note } = parsed;

    const employee = await empModel.findById(employeeId).select("_id").lean();
    if (!employee) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    const other = await findOverlappingAllocation(employeeId, fromDay, toDay);
    if (other) return overlapResponse(res, other);

    // Annual leave already on the books inside this period (granted before it was
    // allocated) draws on the new allocation straight away.
    const used = (await paidLeaveDayKeys(employeeId, fromDay, toDay)).length;
    if (days < used) {
      return res.status(409).json({
        success: false,
        message: `${used} day(s) of annual leave are already taken in this period — allocate at least ${used}.`,
      });
    }

    const allocation = await LeaveAllocation.create({
      employee: employeeId,
      fromDate: fromDay,
      toDate: toDay,
      days,
      note,
      createdBy: req.user?.id || null,
    });

    return res.status(201).json({
      success: true,
      message: `Allocated ${days} day(s) of annual leave`,
      data: { ...allocation.toObject(), used, remaining: days - used },
    });
  } catch (error) {
    console.error("createAllocation error:", error);
    return res.status(500).json({ success: false, message: "Failed to create leave allocation" });
  }
};

// PATCH /api/attendance/leave/allocations/:id  { from, to, days, note }  (employee fixed)
export const updateAllocation = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid allocation id" });
    }
    const parsed = parseAllocationBody(req.body);
    if (parsed.error) {
      return res.status(400).json({ success: false, message: parsed.error });
    }
    const { fromDay, toDay, days, note } = parsed;

    const allocation = await LeaveAllocation.findById(id);
    if (!allocation) {
      return res.status(404).json({ success: false, message: "Allocation not found" });
    }
    const employeeId = allocation.employee;

    const other = await findOverlappingAllocation(employeeId, fromDay, toDay, { excludeId: allocation._id });
    if (other) return overlapResponse(res, other);

    // Annual leave taken inside the OLD range must stay covered: allocations never
    // overlap, so no other allocation can be holding those days.
    const takenBefore = await paidLeaveDayKeys(employeeId, allocation.fromDate, allocation.toDate);
    const from = fromDay.getTime();
    const to = toDay.getTime();
    const uncovered = takenBefore.filter((k) => {
      const t = new Date(`${k}T00:00:00.000Z`).getTime();
      return t < from || t > to;
    });
    if (uncovered.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Annual leave is already taken on ${uncovered.join(", ")} — keep those days inside the period, or edit that leave first.`,
        data: { uncoveredDays: uncovered },
      });
    }

    const used = (await paidLeaveDayKeys(employeeId, fromDay, toDay)).length;
    if (days < used) {
      return res.status(409).json({
        success: false,
        message: `${used} day(s) of annual leave are already taken in this period — allocate at least ${used}.`,
      });
    }

    allocation.fromDate = fromDay;
    allocation.toDate = toDay;
    allocation.days = days;
    allocation.note = note;
    allocation.updatedBy = req.user?.id || null;
    await allocation.save();

    return res.status(200).json({
      success: true,
      message: "Allocation updated",
      data: { ...allocation.toObject(), used, remaining: days - used },
    });
  } catch (error) {
    console.error("updateAllocation error:", error);
    return res.status(500).json({ success: false, message: "Failed to update leave allocation" });
  }
};

// DELETE /api/attendance/leave/allocations/:id — only while no annual leave is taken in it.
export const deleteAllocation = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid allocation id" });
    }
    const allocation = await LeaveAllocation.findById(id);
    if (!allocation) {
      return res.status(404).json({ success: false, message: "Allocation not found" });
    }

    const taken = await paidLeaveDayKeys(allocation.employee, allocation.fromDate, allocation.toDate);
    if (taken.length > 0) {
      return res.status(409).json({
        success: false,
        message: `${taken.length} day(s) of annual leave are taken against this allocation. Cancel those leaves first.`,
      });
    }

    await allocation.deleteOne();
    return res.status(200).json({ success: true, message: "Allocation deleted" });
  } catch (error) {
    console.error("deleteAllocation error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete leave allocation" });
  }
};
