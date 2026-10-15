// Shared shapes and formatting for the Leave page (allocations + applications), the
// employee timesheet's balance chip and the leave history table.

// "annual" = PAID leave drawn from the employee's date-range allocations.
// "emergency" = EXCUSED but UNPAID leave (like sick leave) with no cap. Both are
// granted over a range and lock the marked days until edited/cancelled on the Leave page.
export type LeaveType = "annual" | "emergency"

export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  annual: "Annual",
  emergency: "Emergency",
}

export interface EmployeeRef {
  _id: string
  name: string
  employeeId: string
  companyId?: string | null
  jobTitle?: string
}

/** An annual leave allocation with its usage (server: utils/leaveBalance.js). */
export interface LeaveAllocationSummary {
  _id: string
  fromDate: string
  toDate: string
  days: number
  note?: string
  used: number
  remaining: number
}

/** GET /api/attendance/leave/balance/:employeeId */
export interface LeaveBalance {
  year: number
  // Every allocation, newest first.
  allocations: LeaveAllocationSummary[]
  // The allocation covering today, if any.
  current: LeaveAllocationSummary | null
  // Emergency (unpaid, excused) days taken in `year` — informational, no cap.
  emergencyUsed: number
}

/** A row of the allocations list (GET /api/attendance/leave/allocations). */
export interface LeaveAllocationRow extends LeaveAllocationSummary {
  employee: EmployeeRef
  createdBy?: { name?: string } | null
  updatedBy?: { name?: string } | null
}

/** A leave application (the Leave ledger). */
export interface LeaveApplication {
  _id: string
  type?: LeaveType
  fromDate: string
  toDate: string
  note?: string
  workingDays: number
  status: "active" | "cancelled"
  createdAt: string
  updatedAt?: string
  employee?: EmployeeRef | string
  grantedBy?: { name?: string } | null
  updatedBy?: { name?: string } | null
  cancelledBy?: { name?: string } | null
}

/** "12 Oct 2026" — dates are stored at UTC midnight, so format in UTC. */
export const fmtLeaveDay = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })

export const fmtLeaveRange = (from: string, to: string) =>
  from.slice(0, 10) === to.slice(0, 10) ? fmtLeaveDay(from) : `${fmtLeaveDay(from)} – ${fmtLeaveDay(to)}`

/** "YYYY-MM-DD" for a date input, from a stored UTC-midnight date. */
export const toDateInput = (d: string) => d.slice(0, 10)

export const dayCount = (n: number) => `${n} ${n === 1 ? "day" : "days"}`

/** The server's error message from an axios error, or a fallback. */
export const apiErrorMessage = (error: unknown, fallback: string) =>
  (error as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback
