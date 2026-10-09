import userModel from "../models/userModel.js";

/**
 * Keep a supervisor's site access (User.assignedSite, the auth scope checked by
 * requireSiteAccess) on their linked employee's PERMANENT site.
 *
 * Call this after any write that permanently re-homes an employee — a permanent
 * send/pull/transfer, an applied "permanent from tomorrow" schedule, a roster removal,
 * a release — once `employee.currentSite` holds the new value (null for a removal,
 * which clears access). Temporary placements (only-for-today / only-tomorrow visits,
 * the pendingTransfer* stash) leave currentSite alone and must NOT call this, so a
 * visit never moves a supervisor's access.
 *
 * The account is found by the employee's `user` link or, for older docs without it,
 * by the shared employeeId. A no-op for employees with no supervisor account.
 */
export async function syncSupervisorScope(employee, session = null) {
  if (!employee) return;
  const or = [];
  if (employee.user) or.push({ _id: employee.user });
  if (employee.employeeId) or.push({ employeeId: employee.employeeId });
  if (or.length === 0) return;

  await userModel.updateMany(
    { role: "supervisor", $or: or },
    { $set: { assignedSite: employee.currentSite || null } },
    { session }
  );
}
