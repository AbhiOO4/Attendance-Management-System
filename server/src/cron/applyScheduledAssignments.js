import cron from 'node-cron';
import mongoose from 'mongoose';
import empModel from '../models/empModel.js';
import jobModel from '../models/jobModel.js';
import siteModel from '../models/siteModel.js';
import { isAssignableSite } from '../utils/siteAssignable.js';

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
 * Idempotent and runs every minute (like the other crons), so a missed midnight or a
 * server restart still applies due changes on the next tick.
 */
async function runApplyScheduledAssignments() {
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
          employee.scheduledRemoval = false;
          employee.scheduledSiteId = null;
          employee.scheduledJobId = null;
          employee.scheduledEffectiveDate = null;

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
            employee.scheduledSiteId = null;
            employee.scheduledJobId = null;
            employee.scheduledEffectiveDate = null;
            await employee.save({ session });
            await session.commitTransaction();
            session.endSession();
            console.log(
              `[ScheduledAssignments] Dropped schedule for employee ${employee._id} — target site unavailable`
            );
            continue;
          }
        }

        const oldJobId = employee.currentJob;
        const newJobId = employee.scheduledJobId || null;

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

        employee.scheduledSiteId = null;
        employee.scheduledJobId = null;
        employee.scheduledEffectiveDate = null;

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
