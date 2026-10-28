import * as XLSX from "xlsx"
import { saveAs } from "file-saver"
import { ABSENT_REASONS, ANNUAL_LEAVE, type AbsentCounts } from "@/lib/leaveComposition"

// One employee's row of the hours + payment-days report (server buildAttendanceReport) —
// GET /reports/monthly, /reports/range and the Timesheets page's
// POST /api/timesheets/export/summary.
export interface ReportEmployee {
  // Mongo id.
  _id: string
  employeeName: string
  employeeId: string
  jobTitle: string
  isActive?: boolean
  employmentType?: "permanent" | "temporary"
  // Payroll view, classified exactly like the ERPNext Attendance CSV: every calendar
  // day of the period is a working day; paymentDays = workingDays − absentDays − 0.5 ×
  // halfDays (the figure on the ERPNext salary slip).
  workingDays: number
  paymentDays: number
  fullDays: number
  halfDays: number
  // Every unpaid day, and its composition (the four add up to absentDays).
  absentDays: number
  noReasonAbsentDays: number
  emergencyLeaveDays: number
  sickLeaveDays: number
  lopDays: number
  // Subset of noReasonAbsentDays: checked in, no check-out yet.
  pendingDays: number
  // Annual (paid) leave — never part of absentDays.
  leaveDays: number
  // Days before today with no record at all. Part of noReasonAbsentDays when the
  // response's unmarkedAsAbsent is set (Configure → ERPNext), otherwise counted as paid.
  unmarkedDays: number
  // paymentDays ÷ workingDays.
  attendancePercentage: number
  overtimeHours: number
  holidayHours: number
  totalOvertimeHours: number
}

// A report row's absent-day composition, keyed like ABSENT_REASONS.
export const absentCountsOf = (e: ReportEmployee): AbsentCounts => ({
  none: e.noReasonAbsentDays || 0,
  emergency: e.emergencyLeaveDays || 0,
  sick: e.sickLeaveDays || 0,
  lop: e.lopDays || 0,
})

/**
 * Spreadsheet of a month's figures for `employees`. Named like the ERPNext files: one
 * employee by ID, several by count.
 */
export function exportMonthlySummary(
  employees: ReportEmployee[],
  { month, year, unmarkedAsAbsent }: { month: number; year: number; unmarkedAsAbsent: boolean }
) {
  if (employees.length === 0) return
  const formattedData = employees.map((employee, index) => {
    const absent = absentCountsOf(employee)
    return {
      "Sl No": index + 1,
      "Employee Name":
        employee.employeeName + (employee.isActive === false ? " (Inactive)" : ""),
      "Employee ID": employee.employeeId,
      "Job Title": employee.jobTitle,
      "Working Days": employee.workingDays,
      "Payment Days": employee.paymentDays,
      "Full Days": employee.fullDays,
      "Half Days": employee.halfDays,
      "Absent Days": employee.absentDays,
      // Absent composition: "Absent (no reason)", "Emergency Leave", "Sick Leave", "LOP".
      ...Object.fromEntries(ABSENT_REASONS.map((reason) => [reason.label, absent[reason.key]])),
      "Pending Check-outs (in no reason)": employee.pendingDays || 0,
      [ANNUAL_LEAVE.label]: employee.leaveDays || 0,
      [unmarkedAsAbsent ? "Unmarked Days (in absent)" : "Unmarked Days (paid)"]:
        employee.unmarkedDays || 0,
      "Attendance %": employee.attendancePercentage,
      "OT Hours": employee.overtimeHours,
      "Holiday Hours": employee.holidayHours,
      "Total OT Hours": employee.totalOvertimeHours,
    }
  })
  const worksheet = XLSX.utils.json_to_sheet(formattedData)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, "Monthly Report")
  const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" })
  const fileData = new Blob([excelBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8",
  })
  const who =
    employees.length === 1 ? `-${employees[0].employeeId}` : `-${employees.length}-employees`
  saveAs(fileData, `monthly-report-${month}-${year}${who}.xlsx`)
}
