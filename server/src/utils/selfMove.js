import userModel from "../models/userModel.js"

export const SELF_MOVE_MESSAGE = "You can't move your own employee record to another site. Ask an admin to do it."

/**
 * Is this the calling supervisor's OWN employee record? Their site access follows that
 * record's permanent site (utils/supervisorScope.js), so moving it themselves would let them
 * pick which site they control. One-day visits leave access alone and aren't refused.
 */
export async function isOwnEmployeeRecord(req, employee, session = null) {
  if (req.user?.role !== "supervisor") return false
  if (employee.user && String(employee.user) === String(req.user.id)) return true

  const me = await userModel.findById(req.user.id).select("employeeId").session(session).lean()
  return Boolean(me?.employeeId) && me.employeeId === employee.employeeId
}
