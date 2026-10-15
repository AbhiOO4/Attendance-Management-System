import Attendance from "../models/attendanceModel.js";
import LeaveAllocation from "../models/leaveAllocationModel.js";
import Employee from "../models/empModel.js";
import { escapeRegExp } from "./escapeRegExp.js";

// ---------------------------------------------------------------------------
// Annual leave BALANCE, from date-range allocations (models/leaveAllocationModel.js).
//
// An employee's annual allowance is the sum of their allocations; each allocation
// covers its own from–to range and the annual-leave days INSIDE that range draw on
// it. Days used are never stored — they are counted from Attendance.isPaidLeave,
// so the balance can't drift from the attendance flags. One employee's allocations
// never overlap, so a leave day belongs to at most one allocation.
//
// Every helper takes an optional mongoose `session`; inside a transaction its reads
// run strictly one at a time (parallel operations on a transaction session are
// unsupported by the driver — see grantLeave).
// ---------------------------------------------------------------------------

// Normalize any date-ish value to UTC midnight (how Attendance.date is stored).
export function normalizeUtcDay(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// "YYYY-MM-DD" key from a date's UTC parts (stable calendar-day identity).
export function utcDayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

// Inclusive list of UTC-midnight days from `from` to `to`.
export function eachUtcDay(from, to) {
  const days = [];
  const cur = normalizeUtcDay(from);
  const end = normalizeUtcDay(to);
  if (!cur || !end) return days;
  while (cur.getTime() <= end.getTime()) {
    days.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

export const endOfUtcDay = (date) => new Date(new Date(date).setUTCHours(23, 59, 59, 999));

const withSession = (query, session) => (session ? query.session(session) : query);

// Whether a UTC-midnight day falls inside an allocation's inclusive range.
const covers = (allocation, date) => {
  const t = new Date(date).getTime();
  return new Date(allocation.fromDate).getTime() <= t && t <= new Date(allocation.toDate).getTime();
};

// Keys of the employee's annual (paid) leave days in [from, to], minus `ignoreDates`
// (a Set of day keys — the days of a leave being edited, which the edit gives back).
export async function paidLeaveDayKeys(employeeId, from, to, { session = null, ignoreDates = null } = {}) {
  const docs = await withSession(
    Attendance.find(
      { employee: employeeId, isPaidLeave: true, date: { $gte: normalizeUtcDay(from), $lte: endOfUtcDay(to) } },
      "date"
    ).lean(),
    session
  );
  const keys = docs.map((d) => utcDayKey(d.date));
  return ignoreDates ? keys.filter((k) => !ignoreDates.has(k)) : keys;
}

// The employee's allocations overlapping [from, to] (all of them when no range),
// oldest first.
export async function loadAllocations(employeeId, { from = null, to = null, session = null } = {}) {
  const filter = { employee: employeeId };
  if (from && to) {
    filter.fromDate = { $lte: endOfUtcDay(to) };
    filter.toDate = { $gte: normalizeUtcDay(from) };
  }
  return withSession(LeaveAllocation.find(filter).sort({ fromDate: 1 }).lean(), session);
}

// Another allocation of the same employee whose range overlaps [from, to], if any.
export async function findOverlappingAllocation(employeeId, from, to, { excludeId = null, session = null } = {}) {
  const filter = {
    employee: employeeId,
    fromDate: { $lte: endOfUtcDay(to) },
    toDate: { $gte: normalizeUtcDay(from) },
  };
  if (excludeId) filter._id = { $ne: excludeId };
  return withSession(LeaveAllocation.findOne(filter).lean(), session);
}

// Attach used/remaining to allocations, from ONE paid-leave query over their span.
async function withUsage(employeeId, allocations, { session = null, ignoreDates = null } = {}) {
  if (allocations.length === 0) return [];
  const minFrom = allocations.reduce((m, a) => (a.fromDate < m ? a.fromDate : m), allocations[0].fromDate);
  const maxTo = allocations.reduce((m, a) => (a.toDate > m ? a.toDate : m), allocations[0].toDate);
  const keys = await paidLeaveDayKeys(employeeId, minFrom, maxTo, { session, ignoreDates });
  const dates = keys.map((k) => new Date(`${k}T00:00:00.000Z`));
  return allocations.map((a) => {
    const used = dates.filter((d) => covers(a, d)).length;
    return { ...a, used, remaining: a.days - used };
  });
}

// Every allocation of an employee with used/remaining, newest first, plus the one
// covering `todayKey` ("YYYY-MM-DD") as `current`.
export async function allocationSummaries(employeeId, { todayKey = null, session = null, ignoreDates = null } = {}) {
  const allocations = await loadAllocations(employeeId, { session });
  const summaries = (await withUsage(employeeId, allocations, { session, ignoreDates })).reverse();
  const today = todayKey ? new Date(`${todayKey}T00:00:00.000Z`) : null;
  const current = today ? summaries.find((a) => covers(a, today)) || null : null;
  return { allocations: summaries, current };
}

// Validate annual-leave days about to be marked (`toMark`: [{ date }]) against the
// allocations covering them. A day no allocation covers is refused outright; per
// allocation, the new days must fit in what's left of it.
//   → { ok, unallocatedDays: [keys], violations: [{ allocationId, fromDate, toDate,
//       allocated, used, remaining, requested }], allocations: [...touched, with usage] }
export async function checkAnnualAgainstAllocations({ employeeId, toMark, session = null, ignoreDates = null }) {
  if (!toMark || toMark.length === 0) {
    return { ok: true, unallocatedDays: [], violations: [], allocations: [] };
  }
  const dates = toMark.map((d) => normalizeUtcDay(d.date));
  const first = dates.reduce((m, d) => (d < m ? d : m), dates[0]);
  const last = dates.reduce((m, d) => (d > m ? d : m), dates[0]);

  const allocations = await withUsage(
    employeeId,
    await loadAllocations(employeeId, { from: first, to: last, session }),
    { session, ignoreDates }
  );

  const requestedById = new Map();
  const unallocatedDays = [];
  for (const date of dates) {
    const allocation = allocations.find((a) => covers(a, date));
    if (!allocation) {
      unallocatedDays.push(utcDayKey(date));
      continue;
    }
    const id = String(allocation._id);
    requestedById.set(id, (requestedById.get(id) || 0) + 1);
  }

  const touched = allocations
    .filter((a) => requestedById.has(String(a._id)))
    .map((a) => ({ ...a, requested: requestedById.get(String(a._id)) }));

  const violations = touched
    .filter((a) => a.requested > a.remaining)
    .map((a) => ({
      allocationId: a._id,
      fromDate: a.fromDate,
      toDate: a.toDate,
      allocated: a.days,
      used: a.used,
      remaining: a.remaining,
      requested: a.requested,
    }));

  return {
    ok: unallocatedDays.length === 0 && violations.length === 0,
    unallocatedDays,
    violations,
    allocations: touched,
  };
}

// Maximum span a single leave grant or allocation may cover — a guard against a
// runaway range.
export const MAX_LEAVE_RANGE_DAYS = 400;

// Ids of employees matching a free-text search (every whitespace token must match
// name / employeeId / companyId / jobTitle) — the Leave page's list filters.
// Returns null for an empty search (no filter).
export async function matchEmployeeIds(search) {
  if (!search || !String(search).trim()) return null;
  const clauses = String(search)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const rx = { $regex: escapeRegExp(tok), $options: "i" };
      return { $or: [{ name: rx }, { employeeId: rx }, { companyId: rx }, { jobTitle: rx }] };
    });
  const docs = await Employee.find({ $and: clauses }, "_id").lean();
  return docs.map((d) => d._id);
}
