// Shared roster-category helpers. The four categories are collarType × nationality.
// Foreign categories are shown with a ✈️ plane marker; Omani ones are labelled
// "Omani …". collarType/nationality default to skilled/foreign for older data.
// Kept in sync with the server's model comment (server/src/models/empModel.js).

export type CollarType = 'skilled' | 'staff'
export type Nationality = 'foreign' | 'omani'

export type RosterCategory =
  | 'foreignSkilled'
  | 'foreignStaff'
  | 'omaniSkilled'
  | 'omaniStaff'

export const categoryOf = (
  collarType?: CollarType | null,
  nationality?: Nationality | string | null
): RosterCategory => {
  const staff = collarType === 'staff'
  const omani = nationality === 'omani'
  return omani
    ? (staff ? 'omaniStaff' : 'omaniSkilled')
    : (staff ? 'foreignStaff' : 'foreignSkilled')
}

export const CATEGORY_LABELS: Record<RosterCategory, string> = {
  foreignSkilled: 'Skilled Labour',
  foreignStaff: 'Staff',
  omaniSkilled: 'Omani Labour',
  omaniStaff: 'Omani Staff',
}

export const CATEGORY_IS_FOREIGN: Record<RosterCategory, boolean> = {
  foreignSkilled: true,
  foreignStaff: true,
  omaniSkilled: false,
  omaniStaff: false,
}

// Fallback grace (minutes) a check-out may run past its category's default before a
// supervisor remark becomes mandatory on edit. The live value is configurable via the
// work schedule (WorkConfig.checkoutRemarkGraceMinutes); this is only used when that is
// absent (e.g. an older config). Enforced client-side in EditSiteRecord.
export const CHECKOUT_REMARK_GRACE_MINUTES = 15

// The four categories' day/night default check-out strings, as they live on a Site.
// Any object carrying these optional fields (e.g. the Site type) can be passed in.
export type CheckOutDefaults = {
  defaultCheckOut?: string
  nightDefaultCheckOut?: string
  staffDefaultCheckOut?: string
  staffNightDefaultCheckOut?: string
  omaniDefaultCheckOut?: string
  omaniNightDefaultCheckOut?: string
  omaniStaffDefaultCheckOut?: string
  omaniStaffNightDefaultCheckOut?: string
}

// category → [day field, night field]. Mirrors the server's checkoutFieldFor() in
// server/src/utils/rosterFields.js — keep in sync.
const CHECKOUT_DEFAULT_FIELDS: Record<
  RosterCategory,
  [keyof CheckOutDefaults, keyof CheckOutDefaults]
> = {
  foreignSkilled: ['defaultCheckOut', 'nightDefaultCheckOut'],
  foreignStaff: ['staffDefaultCheckOut', 'staffNightDefaultCheckOut'],
  omaniSkilled: ['omaniDefaultCheckOut', 'omaniNightDefaultCheckOut'],
  omaniStaff: ['omaniStaffDefaultCheckOut', 'omaniStaffNightDefaultCheckOut'],
}

// The default check-out "HH:mm" for a category + shift type, read off the site object.
// Returns "" when that category/shift has no configured default.
export const defaultCheckOutFor = (
  site: CheckOutDefaults | null | undefined,
  category: RosterCategory,
  isNight: boolean
): string => {
  const field = CHECKOUT_DEFAULT_FIELDS[category][isNight ? 1 : 0]
  return (site?.[field] || '').trim()
}
