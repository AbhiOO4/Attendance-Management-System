/**
 * Shared roster-category field metadata.
 *
 * The 16 per-category default time fields on a Site map one-to-one to a
 * (roster category × day|night × check-in|check-out) triple. This table is the
 * single source of truth for that mapping; the default propagator
 * (propagateDefaults.js), the auto-checkout cron (autoCheckOut.js) and the
 * unclosed-session audit (openSessionAudit.js) all key off it so a category is
 * only ever touched by its own default times — no cross-nationality leak between
 * the two same-collar categories, and no fallback to another category's field.
 *
 * The four categories match getEmployeeIdsByCategory() (utils/collar.js):
 *   foreignSkilled | foreignStaff | omaniSkilled | omaniStaff.
 *
 * Adding or renaming a category is a single edit here.
 */
export const FIELD_META = {
  // Foreign skilled (blue-collar field workers)
  defaultCheckIn:                 { category: 'foreignSkilled', night: false, checkIn: true },
  defaultCheckOut:                { category: 'foreignSkilled', night: false, checkIn: false },
  nightDefaultCheckIn:            { category: 'foreignSkilled', night: true,  checkIn: true },
  nightDefaultCheckOut:           { category: 'foreignSkilled', night: true,  checkIn: false },
  // Foreign staff (white-collar)
  staffDefaultCheckIn:            { category: 'foreignStaff', night: false, checkIn: true },
  staffDefaultCheckOut:           { category: 'foreignStaff', night: false, checkIn: false },
  staffNightDefaultCheckIn:       { category: 'foreignStaff', night: true,  checkIn: true },
  staffNightDefaultCheckOut:      { category: 'foreignStaff', night: true,  checkIn: false },
  // Omani skilled
  omaniDefaultCheckIn:            { category: 'omaniSkilled', night: false, checkIn: true },
  omaniDefaultCheckOut:           { category: 'omaniSkilled', night: false, checkIn: false },
  omaniNightDefaultCheckIn:       { category: 'omaniSkilled', night: true,  checkIn: true },
  omaniNightDefaultCheckOut:      { category: 'omaniSkilled', night: true,  checkIn: false },
  // Omani staff
  omaniStaffDefaultCheckIn:       { category: 'omaniStaff', night: false, checkIn: true },
  omaniStaffDefaultCheckOut:      { category: 'omaniStaff', night: false, checkIn: false },
  omaniStaffNightDefaultCheckIn:  { category: 'omaniStaff', night: true,  checkIn: true },
  omaniStaffNightDefaultCheckOut: { category: 'omaniStaff', night: true,  checkIn: false },
};

// Reverse lookup: `${category}|${night}` -> the Site check-out field for that
// category and shift type. Built once from FIELD_META so it can never drift.
const CHECKOUT_FIELD_BY_CATEGORY = Object.entries(FIELD_META).reduce(
  (acc, [field, meta]) => {
    if (!meta.checkIn) acc[`${meta.category}|${meta.night}`] = field;
    return acc;
  },
  {}
);

/**
 * The Site check-out default field that governs a given category + shift type.
 * @param {string} category - one of the four roster categories.
 * @param {boolean} isNight - true for the night check-out field, false for day.
 * @returns {string|undefined} the Site field name (e.g. "omaniStaffDefaultCheckOut").
 */
export function checkoutFieldFor(category, isNight) {
  return CHECKOUT_FIELD_BY_CATEGORY[`${category}|${!!isNight}`];
}
