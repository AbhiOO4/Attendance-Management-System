/**
 * Activity types: ERPNext rate bands (costing + billing rate) allocated per employee on the
 * Activity Types page. The ERPNext timesheet export stamps the employee's type on their
 * time-logs. Every type has an automatic OVERTIME twin — never stored: its name is the type's
 * name + OVERTIME_SUFFIX and its rates are the type's × the overtime activity multiplier
 * (Configure → ERPNext Export). KEEP IN SYNC with server/src/utils/activityTypes.js.
 */
export type ActivityType = {
  _id: string
  name: string
  costingRate: number
  billingRate: number
  overtimeName: string
  overtimeCostingRate: number
  overtimeBillingRate: number
  allocatedCount: number
}

export const OVERTIME_SUFFIX = " - Overtime"
export const DEFAULT_OVERTIME_MULTIPLIER = 1.25
export const MIN_OVERTIME_MULTIPLIER = 1
export const MAX_OVERTIME_MULTIPLIER = 5
export const ACTIVITY_NAME_MAX = 120

export const overtimeNameFor = (name: string) => `${name}${OVERTIME_SUFFIX}`

export const hasOvertimeSuffix = (name: string) =>
  name.toLowerCase().endsWith(OVERTIME_SUFFIX.toLowerCase())

// Rates are currency (OMR has 3 decimals).
export const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000

export const formatRate = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })
