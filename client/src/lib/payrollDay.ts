// How one attendance record counts for PAYROLL — mirrors classifyPayrollDay in
// server/src/utils/payrollDay.js, which is also what the ERPNext Attendance CSV uses.
// Keep the two in sync, or the timesheet's Payment Days stops matching the report and
// the salary slip.
//
//   holiday — never deducted (a paid day off, or holiday work paid as holiday hours).
//             Checked first: a half day or leave flag on a holiday is in no day bucket.
//   annual  — paid (annual) leave.
//   full    — a full day.
//   half    — a half day: deducts 0.5 of a day.
//   absent  — deducts a whole day; `reason` is the leave flag or "none" (a plain absence,
//             including a pending day — checked in, no check-out yet).

export type AbsentReason = "none" | "emergency" | "sick" | "lop"

export type PayrollDay =
  | { kind: "holiday" | "annual" | "full" | "half" }
  | { kind: "absent"; reason: AbsentReason }

interface PayrollRecord {
  status: string
  isHoliday?: boolean
  isPaidLeave?: boolean
  isEmergencyLeave?: boolean
  isSickLeave?: boolean
  isLop?: boolean
}

export function classifyPayrollDay(record: PayrollRecord): PayrollDay {
  if (record.isHoliday) return { kind: "holiday" }
  if (record.isPaidLeave) return { kind: "annual" }
  if (record.status === "fullday") return { kind: "full" }
  if (record.status === "halfday") return { kind: "half" }
  if (record.isEmergencyLeave) return { kind: "absent", reason: "emergency" }
  if (record.isSickLeave) return { kind: "absent", reason: "sick" }
  if (record.isLop) return { kind: "absent", reason: "lop" }
  return { kind: "absent", reason: "none" }
}

/** Payment Days = working days − absent days − half of the half days (floored at 0). */
export function paymentDaysOf(
  workingDays: number,
  absentDays: number,
  halfDays: number
): number {
  return Math.max(workingDays - absentDays - 0.5 * halfDays, 0)
}
