/**
 * Collar-type helpers.
 *
 * Workers are classified as 'skilled' (blue-collar field workers) or 'staff'
 * (white-collar office workers). The source of truth is the JobTitle's
 * collarType; each Employee carries a denormalized copy so the man-hours /
 * man-days aggregations can exclude staff with a cheap id-set check rather than
 * joining and string-matching job titles.
 */

import empModel from '../models/empModel.js';
import jobTitleModel from '../models/jobTitleModel.js';
import { escapeRegExp } from './escapeRegExp.js';

const VALID_COLLAR_TYPES = ['skilled', 'staff'];

/**
 * Resolve the collarType for a given job-title string by looking it up in the
 * controlled JobTitle list (case-insensitive, since Employee.jobTitle is stored
 * lowercased). Falls back to 'skilled' when the title is unknown or empty.
 */
export async function resolveCollarType(jobTitle) {
  if (!jobTitle || typeof jobTitle !== 'string') return 'skilled';

  const match = await jobTitleModel
    .findOne({ title: { $regex: `^${escapeRegExp(jobTitle.trim())}$`, $options: 'i' } })
    .lean();

  return VALID_COLLAR_TYPES.includes(match?.collarType) ? match.collarType : 'skilled';
}

/**
 * Return the _id list of all employees classified as staff (white-collar) — both
 * foreign and Omani staff, since collarType is nationality-independent. Used to
 * exclude staff from man-hours / man-days stats.
 */
export async function getStaffEmployeeIds() {
  return empModel.find({ collarType: 'staff' }).distinct('_id');
}

/**
 * Bucket every employee _id into one of the four roster categories,
 * (skilled|staff) × (foreign|omani). The crons scope each auto check-in/out mode to
 * exactly one category's ids so a category is only touched by its own default times.
 * Returns `{ foreignSkilled, foreignStaff, omaniSkilled, omaniStaff }` (arrays of _id).
 */
export async function getEmployeeIdsByCategory() {
  const emps = await empModel.find({}, '_id collarType nationality').lean();
  const cats = { foreignSkilled: [], foreignStaff: [], omaniSkilled: [], omaniStaff: [] };
  for (const e of emps) {
    const isStaff = e.collarType === 'staff';
    const isOmani = e.nationality === 'omani';
    const key = isOmani
      ? (isStaff ? 'omaniStaff' : 'omaniSkilled')
      : (isStaff ? 'foreignStaff' : 'foreignSkilled');
    cats[key].push(e._id);
  }
  return cats;
}
