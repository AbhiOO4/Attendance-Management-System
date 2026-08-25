/**
 * Unclosed-session audit — the "will the auto-checkout cron ever close this?"
 * predictor behind the check-out reminder push (cron/checkoutReminder.js).
 *
 * The auto-checkout cron (cron/autoCheckOut.js) is deterministic: for each open
 * session (checkIn set, no checkOut) it closes the session at that site's
 * per-category default check-out time — but only when a matching default is
 * configured and the close is valid. So a session is "forgotten" (worth a
 * reminder) exactly when the cron will NOT resolve it. We reproduce the cron's
 * decision here at a practical granularity:
 *
 *   Rule 1  Today's open DAY session, category has NO day default (or the
 *           check-in is later than the default so the cron skips it,
 *           autoCheckOut.js:71) → the cron never closes it. Flag it once the
 *           global fallback time (checkoutReminderTime) has passed — we don't
 *           know the intended shift end, so the fallback stands in for it.
 *   Rule 2  Today's open DAY session, day default exists and check-in <= default
 *           → the cron closes it at the default time. Flag ONLY if it's still
 *           open `grace` minutes after that time (cron missed/overlap-skipped it).
 *   Rule 3  Yesterday's record still has an open session → definitively overdue.
 *           A day session should have closed yesterday; a night session closes
 *           this morning at the night default (so respect that time + grace), or
 *           by local noon when no night default exists (the carryover boundary
 *           after which yesterday's record is no longer auto-touched).
 *
 * Today's open NIGHT sessions are never flagged: they legitimately run overnight
 * and close via tomorrow morning's night cron — they only become reminder-worthy
 * the next day, via Rule 3.
 *
 * "Will auto-close" is approximated as (default present AND, for day, check-in <=
 * default); the rare overlap/invalid-hours skips the cron performs are not
 * re-derived — worst case is one extra, dismissible reminder.
 */
import Attendance from '../models/attendanceModel.js';
import Site from '../models/siteModel.js';
import { getEmployeeIdsByCategory } from './collar.js';
import { checkoutFieldFor } from './rosterFields.js';
import {
  getCurrentLocalTime,
  getTodayLocal,
  getDateLocal,
  toLocalTimeString,
} from './timeLocal.js';

const DEFAULT_FALLBACK_TIME = '20:00';
const DEFAULT_GRACE_MINUTES = 15;
const NOON_MINUTES = 12 * 60;

function toMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== 'string' || !hhmm.includes(':')) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function midnightUTC(dateStr) {
  const d = new Date(dateStr);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Decide whether a single open session is "forgotten" right now — i.e. the
 * auto-checkout cron will not resolve it. Exported so the decision (the crux of
 * the feature) is unit-testable independently of the DB.
 * @param {'today'|'yesterday'} when - which record day the session sits on.
 * @param {boolean} isNight - session.isNightShift.
 * @param {Date}   checkIn - the session check-in instant.
 * @param {string} defaultTime - the site's day/night check-out default for this
 *                 category ("HH:mm" or "" when none).
 * @param {number} nowMin, fallbackMin, grace - current/config minute values.
 */
export function isSessionForgotten(when, isNight, checkIn, defaultTime, nowMin, fallbackMin, grace) {
  const defaultMin = toMinutes(defaultTime);

  if (when === 'today') {
    if (isNight) return false; // closes tomorrow morning — not overdue today.
    const checkInMin = toMinutes(toLocalTimeString(checkIn));
    const willAutoClose = defaultMin !== null && checkInMin !== null && checkInMin <= defaultMin;
    if (willAutoClose) {
      // Rule 2: cron should close at defaultMin; flag only past the grace window.
      return nowMin > defaultMin + grace;
    }
    // Rule 1: no reliable auto-close — fall back to the global reminder time.
    return fallbackMin !== null && nowMin >= fallbackMin;
  }

  // when === 'yesterday' (Rule 3)
  if (!isNight) return true; // yesterday's day cron window is fully past.
  // Night session on yesterday's record closes THIS morning.
  if (defaultMin !== null) return nowMin > defaultMin + grace;
  // No night default: overdue once past the local-noon carryover boundary.
  return nowMin >= NOON_MINUTES;
}

/**
 * Find open sessions the auto-checkout cron will not resolve, grouped by site.
 *
 * @param {Object} workConfig - the WorkSchedule doc (checkoutReminderTime /
 *                 checkoutReminderGraceMinutes). Missing values fall back to
 *                 sensible defaults.
 * @returns {Promise<{
 *   sites: Array<{ siteId: string, siteName: string,
 *                  employees: Array<{ employeeId: string, name: string, when: string, isNight: boolean }> }>,
 *   totalSites: number,
 *   totalEmployees: number,
 * }>}
 */
export async function findForgottenSessionsBySite(workConfig) {
  const fallbackMin = toMinutes(workConfig?.checkoutReminderTime) ?? toMinutes(DEFAULT_FALLBACK_TIME);
  const grace = Number.isFinite(workConfig?.checkoutReminderGraceMinutes)
    ? workConfig.checkoutReminderGraceMinutes
    : DEFAULT_GRACE_MINUTES;

  const nowMin = toMinutes(getCurrentLocalTime());
  const todayStr = getTodayLocal();
  const yesterdayStr = getDateLocal(-1);
  const todayDate = midnightUTC(todayStr);
  const yesterdayDate = midnightUTC(yesterdayStr);

  // Employee -> roster category (for picking the right check-out default field).
  const cats = await getEmployeeIdsByCategory();
  const catByEmp = new Map();
  for (const [category, ids] of Object.entries(cats)) {
    for (const id of ids) catByEmp.set(id.toString(), category);
  }

  // Records for today/yesterday that contain at least one open session.
  const records = await Attendance.find({
    date: { $in: [todayDate, yesterdayDate] },
    sessions: { $elemMatch: { checkIn: { $ne: null }, checkOut: null } },
  })
    .populate('employee', 'name employeeId')
    .lean();

  if (records.length === 0) {
    return { sites: [], totalSites: 0, totalEmployees: 0 };
  }

  // Resolve the sites referenced by those sessions (no isActive filter, so a
  // site being wound down still surfaces its forgotten sessions).
  const siteIds = new Set();
  for (const rec of records) {
    for (const s of rec.sessions || []) {
      if (s.checkIn && !s.checkOut && s.siteId) siteIds.add(s.siteId.toString());
    }
  }
  const siteDocs = await Site.find({ _id: { $in: [...siteIds] } })
    .select('siteName')
    .lean();
  const siteMap = new Map(siteDocs.map((s) => [s._id.toString(), s]));

  // Group forgotten sessions by site, deduping employees within a site.
  const bySite = new Map(); // siteId -> { siteId, siteName, employees: Map<empId, entry> }
  const globalEmployees = new Set();

  for (const rec of records) {
    const empId = rec.employee?._id?.toString();
    const when =
      new Date(rec.date).getTime() === todayDate.getTime() ? 'today' : 'yesterday';
    const category = empId ? catByEmp.get(empId) : undefined;

    for (const session of rec.sessions || []) {
      if (!session.checkIn || session.checkOut) continue;
      const sId = session.siteId?.toString();
      if (!sId) continue;

      const site = siteMap.get(sId);
      const isNight = session.isNightShift === true;
      const field = category ? checkoutFieldFor(category, isNight) : undefined;
      const defaultTime = (site && field && site[field]) || '';

      if (!isSessionForgotten(when, isNight, session.checkIn, defaultTime, nowMin, fallbackMin, grace)) {
        continue;
      }

      if (!bySite.has(sId)) {
        bySite.set(sId, {
          siteId: sId,
          siteName: site?.siteName || 'Unknown site',
          employees: new Map(),
        });
      }
      const group = bySite.get(sId);
      const key = empId || `${sId}:${session._id}`;
      if (!group.employees.has(key)) {
        group.employees.set(key, {
          employeeId: rec.employee?.employeeId || '',
          name: rec.employee?.name || 'Unknown',
          when,
          isNight,
        });
      }
      if (empId) globalEmployees.add(empId);
    }
  }

  const sites = [...bySite.values()].map((g) => ({
    siteId: g.siteId,
    siteName: g.siteName,
    employees: [...g.employees.values()],
  }));

  return {
    sites,
    totalSites: sites.length,
    totalEmployees: globalEmployees.size,
  };
}
