/**
 * Conditional supervisor site reassignment.
 *
 * A supervisor is both a User (`assignedSite` = auth scope) and an Employee
 * (`currentSite` = where they are physically marked present). Changing their site
 * naively leaves today's attendance inconsistent, so the move is conditional on
 * whether the supervisor already has a SAVED attendance record for today:
 *
 *   - Saved today  → defer the whole move to tomorrow via the scheduled-assignment
 *     mechanism (empModel.scheduled* + applyScheduledAssignments cron). Today's
 *     committed record stands; the move (currentSite AND the linked user's
 *     assignedSite) lands at the local day rollover.
 *   - Not saved (draft) → move immediately. Then, if the TARGET site already has a
 *     saved record today, create the supervisor's own record + one session there,
 *     check-in initialised from the site's category-specific day default (so they
 *     appear on the already-frozen roster). If the target is still a draft, create
 *     nothing — they show up when the target's draft is next built.
 *
 * This function MUTATES the passed `employee` doc in place (the caller persists it
 * with employee.save) and performs its own Job / Attendance writes inside the
 * caller's transaction. It returns `{ deferred, assignedSite }`: `assignedSite` is
 * the value the caller should write onto the User now (null when deferred).
 */
import mongoose from "mongoose";
import Attendance from "../models/attendanceModel.js";
import siteModel from "../models/siteModel.js";
import jobModel from "../models/jobModel.js";
import { isAssignableSite } from "../utils/siteAssignable.js";
import {
  getTodayLocal,
  getDateLocal,
  combineFromOffset,
} from "../utils/timeLocal.js";

// The site's day check-in default field for the employee's roster category
// (skilled|staff) × (foreign|omani). Mirrors utils/collar.js bucketing.
function categoryDayCheckInField(employee) {
  const isStaff = employee.collarType === "staff";
  const isOmani = employee.nationality === "omani";
  if (isOmani) return isStaff ? "omaniStaffDefaultCheckIn" : "omaniDefaultCheckIn";
  return isStaff ? "staffDefaultCheckIn" : "defaultCheckIn";
}

function todayAtUtcMidnight() {
  const today = new Date(getTodayLocal());
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

export async function applySupervisorSiteChange({
  employee,
  newSiteId,
  actorId,
  dbSession,
}) {
  const targetSite = await siteModel.findById(newSiteId).session(dbSession);
  if (!isAssignableSite(targetSite)) {
    const err = new Error("Target site is not a valid assignment destination");
    err.status = 400;
    throw err;
  }

  const today = todayAtUtcMidnight();

  // Signal: the supervisor already has a committed record for today (their current
  // site was submitted). Drafts live in the browser, not the DB, so "no record" == draft.
  const sourceSaved = await Attendance.exists({
    employee: employee._id,
    date: today,
  }).session(dbSession);

  // ---------------- CASE 1: source saved → defer to tomorrow ----------------
  if (sourceSaved) {
    // Reset the job on a cross-site move; the cron pulls the old job on apply.
    employee.scheduledSiteId = newSiteId;
    employee.scheduledJobId = null;
    employee.scheduledEffectiveDate = combineFromOffset(getDateLocal(1), "00:00", false);
    return { deferred: true, assignedSite: null };
  }

  // ---------------- CASE 2: source draft → move now ----------------
  const oldJobId = employee.currentJob;
  if (oldJobId) {
    await jobModel.findByIdAndUpdate(
      oldJobId,
      { $pull: { employees: employee._id } },
      { session: dbSession }
    );
  }
  employee.currentSite = newSiteId;
  employee.currentJob = null; // job belongs to the old site; unassign on move

  // If the target's day is already saved, the supervisor is missing from a frozen
  // roster — create their record + one session at the category day default.
  const targetSaved = await Attendance.exists({
    date: today,
    "sessions.siteId": newSiteId,
  }).session(dbSession);

  if (targetSaved) {
    const field = categoryDayCheckInField(employee);
    const defaultTime = targetSite[field]; // "HH:mm" or ""
    const checkIn = combineFromOffset(getTodayLocal(), defaultTime, false); // null if no default

    const [created] = await Attendance.create(
      [
        {
          employee: employee._id,
          siteId: newSiteId,
          jobId: null,
          markedBy: actorId,
          date: today,
          status: "absent", // no check-out yet; shown as pending until closed
          sessions: [
            {
              siteId: newSiteId,
              jobId: null,
              checkIn, // Date; pre-save hook derives raw times + offsets
              checkOut: null,
              workedHours: 0,
              markedBy: actorId,
            },
          ],
        },
      ],
      { session: dbSession }
    );
    void created;
  }

  return { deferred: false, assignedSite: new mongoose.Types.ObjectId(newSiteId) };
}
