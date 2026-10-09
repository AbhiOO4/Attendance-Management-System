// How one Attendance record counts for PAYROLL — the single classification shared by the
// ERPNext Attendance CSV (erpnextExport.js) and the Payment Days report
// (buildAttendanceReport), so AMS Payment Days and the ERPNext salary slip can only differ
// because of the data (a failed import, a holiday-list mismatch), never a counting rule.
// The client mirrors this in client/src/lib/payrollDay.ts — keep the two in sync.
//
// Kinds:
//   holiday — a holiday, worked or not. Never deducted: a day off is paid, and holiday work
//             is paid as holiday hours (exported to ERPNext as overtime). Checked FIRST, so a
//             half day or a leave flag on a holiday lands in no day bucket.
//   annual  — paid (annual) leave → ERPNext "On Leave".
//   full    — fullday → "Present".
//   half    — halfday → "Half Day" + Leave Without Pay: deducts 0.5 of a day.
//   absent  — everything else → "Absent": deducts a whole day. `reason` is the leave flag
//             (emergency > sick > lop, the model's precedence) or "none" — a plain absence,
//             including a PENDING day (checked in, no check-out yet), which the export also
//             sends as Absent.
export function classifyPayrollDay(record) {
  if (record.isHoliday) return { kind: "holiday" };
  if (record.isPaidLeave) return { kind: "annual" };
  if (record.status === "fullday") return { kind: "full" };
  if (record.status === "halfday") return { kind: "half" };
  if (record.isEmergencyLeave) return { kind: "absent", reason: "emergency" };
  if (record.isSickLeave) return { kind: "absent", reason: "sick" };
  if (record.isLop) return { kind: "absent", reason: "lop" };
  return { kind: "absent", reason: "none" };
}

// Checked in with no check-out yet (0 hours until it is closed). Payroll counts it as an
// absence with no reason; reports flag it so it can be closed before the export.
export function hasOpenSession(record) {
  return (record.sessions || []).some(
    (session) => session && session.checkIn && !session.checkOut
  );
}
