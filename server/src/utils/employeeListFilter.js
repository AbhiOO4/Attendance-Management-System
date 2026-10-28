// The Employees list's site + unified-search filters as Mongo clauses, shared by
// GET /api/employees (empController.getAllEmployees) and the Timesheets list
// (timesheetController) so the two search exactly alike. Compose them under $and.

import { escapeRegExp } from "./escapeRegExp.js";

/**
 * ?site=: "null" → employees with no site; an id → that site's employees AND today's "only
 * for today" visitors (their currentSite stays home but pendingTransferSiteId points here).
 * Returns null when there is nothing to filter.
 */
export function siteClause(site) {
  if (!site) return null;
  if (site === "null") return { currentSite: null };
  return { $or: [{ currentSite: site }, { pendingTransferSiteId: site }] };
}

/**
 * Unified search box: split into whitespace tokens; each token must match (substring,
 * case-insensitive) at least one of name / employeeId / jobTitle. So "john welder" matches
 * John whose job title is Welder.
 */
export function searchClauses(search) {
  if (!search || !search.trim()) return [];
  return search
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const rx = { $regex: escapeRegExp(tok), $options: "i" };
      return { $or: [{ name: rx }, { employeeId: rx }, { jobTitle: rx }] };
    });
}
