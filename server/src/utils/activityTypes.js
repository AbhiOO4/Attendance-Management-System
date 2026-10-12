/**
 * Activity types — ERPNext rate bands allocated per employee (models/activityTypeModel.js).
 *
 * Each type has an automatic OVERTIME twin that is derived, never stored: its name is the
 * type's name + OVERTIME_SUFFIX and its rates are the type's × the configured multiplier
 * (WorkSchedule.overtimeActivityMultiplier), so changing the multiplier re-rates every twin.
 * KEEP IN SYNC with client/src/lib/activityTypes.ts.
 */

export const OVERTIME_SUFFIX = " - Overtime"
export const DEFAULT_OVERTIME_MULTIPLIER = 1.25
export const MIN_OVERTIME_MULTIPLIER = 1
export const MAX_OVERTIME_MULTIPLIER = 5
export const ACTIVITY_NAME_MAX = 120

/** The ERPNext Activity Type name of a type's overtime twin. */
export const overtimeNameFor = (name) => `${name}${OVERTIME_SUFFIX}`

/** True when `name` ends with the overtime suffix (reserved for twins). */
export const hasOvertimeSuffix = (name) =>
  String(name).toLowerCase().endsWith(OVERTIME_SUFFIX.toLowerCase())

/** The configured multiplier, or the default when unset / out of range. */
export function resolveOvertimeMultiplier(workConfig) {
  const m = Number(workConfig?.overtimeActivityMultiplier)
  return Number.isFinite(m) && m >= MIN_OVERTIME_MULTIPLIER && m <= MAX_OVERTIME_MULTIPLIER
    ? m
    : DEFAULT_OVERTIME_MULTIPLIER
}

// Rates are currency (OMR has 3 decimals).
export const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000

/** `{ _id, name, costingRate, billingRate }` plus the derived overtime twin. */
export function withOvertime(type, multiplier) {
  return {
    _id: String(type._id),
    name: type.name,
    costingRate: type.costingRate,
    billingRate: type.billingRate,
    overtimeName: overtimeNameFor(type.name),
    overtimeCostingRate: round3(type.costingRate * multiplier),
    overtimeBillingRate: round3(type.billingRate * multiplier),
  }
}
