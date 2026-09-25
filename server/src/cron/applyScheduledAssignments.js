import cron from 'node-cron';
import mongoose from 'mongoose';
import empModel from '../models/empModel.js';
import jobModel from '../models/jobModel.js';
import siteModel from '../models/siteModel.js';
import { isAssignableSite, findAssignableJob } from '../utils/siteAssignable.js';

/**
 * Promote deferred ("from tomorrow") assignments once their effective date arrives.
 *
 * SiteDetail-context adds and job changes stash their intent on the employee
 * (scheduledSiteId / scheduledJobId / scheduledEffectiveDate — tomorrow's local
 * midnight) instead of mutating currentSite/currentJob immediately. This job flips
 * them at the local day rollover so the employee appears on the destination site's
 * roster (or under the new job) starting that day.
 *
 * Semantics (see empModel.js): scheduledEffectiveDate != null means a change is
 * pending. scheduledSiteId set → add/move (apply site + job); null → job-only
 * change (apply job, keep the current site). Only currentSite/currentJob and the
 * job `employees[]` arrays change — no attendance is touched, so nothing to recompute.
 *
 * A removal or job-only change belongs to the site that scheduled it. If the employee
 * has permanently moved away from that site since (a same-day transfer, send, accepted
 * request or admin add), that change is DROPPED rather than applied to their new home —
 * otherwise "leaving tomorrow" at the old site would un-assign them from the new one, or
 * a job-only change would hand them another site's job. A scheduled MOVE is kept as is.
 *
 * Idempotent and runs every minute (like the other crons), so a missed midnight or a
 * server restart still applies due changes on the next tick.
 */

function clearSchedule(employee) {
  employee.scheduledRemoval = false;
  employee.scheduledSiteId = null;
  employee.scheduledJobId = null;
  employee.scheduledEffectiveDate = null;
  employee.scheduledBySiteId = null;
}

// True when the site that scheduled the change is no longer the employee's home.
// Legacy docs (no scheduledBySiteId) can't tell, so they apply as before.
function movedAwayFromScheduler(employee) {
  if (!employee.scheduledBySiteId) return false;
  return !employee.currentSite || employee.currentSite.toString() !== employee.scheduledBySiteId.toString();
}

async function dropSchedule(employee, session, reason) {
  clearSchedule(employee);
  await employee.save({ session });
  await session.commitTransaction();
  session.endSession();
  console.log(`[ScheduledAssignments] Dropped schedule for employee ${employee._id} — ${reason}`);
}

export async function runApplyScheduledAssignments() {
  try {
    const now = new Date();

    const due = await empModel
      .find({ scheduledEffectiveDate: { $ne: null, $lte: now } })
      .select('_id');

    if (due.length === 0) return;

    for (const { _id } of due) {
      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const employee = await empModel.findById(_id).session(session);

        // Re-check under the transaction — it may have been cancelled/applied since.
        if (!employee || !employee.scheduledEffectiveDate) {
          await session.abortTransaction();
          session.endSession();
          continue;
        }

        // Scheduled removal (Tomorrow-tab remove of an on-site employee) — checked
        // BEFORE the move/job-only logic because a removal carries scheduledSiteId:null,
        // which would otherwise read as a job-only change. Null the assignment now.
        if (employee.scheduledRemoval) {
          if (movedAwayFromScheduler(employee)) {
            await dropSchedule(employee, session, 'removal skipped, employee has moved to another site');
            continue;
          }

          if (employee.currentJob) {
            await jobModel.findByIdAndUpdate(
              employee.currentJob,
              { $pull: { employees: employee._id } },
              { session }
            );
          }

          // NOTE: a supervisor's User.assignedSite (auth scope) is decoupled and
          // admin-owned — a scheduled WORKER-record removal deliberately does not
          // touch it. Site deactivation/soft-delete is what clears auth scope.

          employee.currentSite = null;
          employee.currentJob = null;
          clearSchedule(employee);

          await employee.save({ session });

          await session.commitTransaction();
          session.endSession();

          console.log(`[ScheduledAssignments] Applied removal for employee ${employee._id}`);
          continue;
        }

        const isMove = !!employee.scheduledSiteId;

        // Guard: a scheduled add/move whose target site is gone is dropped, not applied.
        if (isMove) {
          const site = await siteModel.findById(employee.scheduledSiteId).session(session);
          if (!isAssignableSite(site)) {
            await dropSchedule(employee, session, 'target site unavailable');
            continue;
          }
        } else if (movedAwayFromScheduler(employee)) {
          // Job-only change scheduled by a site the employee has since left.
          await dropSchedule(employee, session, 'job change skipped, employee has moved to another site');
          continue;
        }

        // The job must be live at the site the employee will be on. For a move, a job that
        // went inactive meanwhile is dropped (they still move, with no job); for a job-only
        // change there is nothing else to apply, so the whole change is dropped.
        const targetSiteId = isMove ? employee.scheduledSiteId : employee.currentSite;
        let newJobId = employee.scheduledJobId || null;
        if (newJobId && !(await findAssignableJob(newJobId, targetSiteId, session))) {
          if (!isMove) {
            await dropSchedule(employee, session, 'scheduled job is not active at the current site');
            continue;
          }
          newJobId = null;
        }

        const oldJobId = employee.currentJob;

        // Pull from the old job's employees[] (unless it's the same job).
        if (oldJobId && (!newJobId || oldJobId.toString() !== newJobId.toString())) {
          await jobModel.findByIdAndUpdate(
            oldJobId,
            { $pull: { employees: employee._id } },
            { session }
          );
        }

        if (isMove) {
          employee.currentSite = employee.scheduledSiteId;
        }
        employee.currentJob = newJobId;

        if (newJobId) {
          await jobModel.findByIdAndUpdate(
            newJobId,
            { $addToSet: { employees: employee._id } },
            { session }
          );
        }

        // NOTE: a WORKER-record move never changes a supervisor's User.assignedSite
        // (auth scope) — the two are decoupled and assignedSite is admin-owned.

        clearSchedule(employee);

        await employee.save({ session });

        await session.commitTransaction();
        session.endSession();

        console.log(`[ScheduledAssignments] Applied schedule for employee ${employee._id}`);
      } catch (err) {
        await session.abortTransaction();
        session.endSession();
        console.error(`[ScheduledAssignments] Failed to apply schedule for ${_id}:`, err);
      }
    }
  } catch (error) {
    console.error('[ScheduledAssignments] Cron job error:', error);
  }
}

/**
 * Start the scheduled-assignment promotion cron. Runs every minute; promotes any
 * pending assignment whose effective date has arrived.
 */
export function startApplyScheduledAssignmentsCron() {
  cron.schedule('* * * * *', runApplyScheduledAssignments);
  console.log('[ScheduledAssignments] Cron job started (runs every minute)');
}
