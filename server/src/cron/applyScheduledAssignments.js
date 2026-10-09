import cron from 'node-cron';
import mongoose from 'mongoose';
import empModel from '../models/empModel.js';
import jobModel from '../models/jobModel.js';
import siteModel from '../models/siteModel.js';
import { isAssignableSite, findAssignableJob } from '../utils/siteAssignable.js';
import { applyHandover } from '../utils/handover.js';
import { touchSiteRosters } from '../utils/draftRoster.js';
import { syncSupervisorScope } from '../utils/supervisorScope.js';
import { recordSiteActivity, SYSTEM_ACTOR } from '../utils/siteActivity.js';

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
 * A scheduled VISIT (scheduledVisit, "Send to site → Only tomorrow") does not move the
 * home: at the rollover it becomes that day's pendingTransfer* visit stash — exactly what a
 * same-day "For today" send writes — so the destination's draft shows them as a visitor,
 * the home draft leaves them out, and the next day they're back on the home roster.
 *
 * Moves, visits, removals and every dropped change are written to the activity feed of
 * each site involved (as "System"), so a supervisor can see what happened at midnight.
 *
 * Idempotent and runs every minute (like the other crons), so a missed midnight or a
 * server restart still applies due changes on the next tick.
 */

function clearSchedule(employee) {
  employee.scheduledRemoval = false;
  employee.scheduledVisit = false;
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
  // The sites the dropped change concerned, captured before clearSchedule wipes them.
  const event = {
    type: 'scheduled_dropped',
    reason,
    fromSiteId: employee.currentSite || employee.scheduledBySiteId || null,
    toSiteId: employee.scheduledSiteId || null,
  };
  clearSchedule(employee);
  await employee.save({ session });
  await session.commitTransaction();
  session.endSession();
  console.log(`[ScheduledAssignments] Dropped schedule for employee ${employee._id} — ${reason}`);
  return event;
}

async function siteNameOf(id) {
  if (!id) return null;
  const site = await siteModel.findById(id).select('siteName').lean();
  return site?.siteName || null;
}

// Best-effort, after commit: one System line in the feed of every site the change touched.
async function logScheduleEvent(employee, event) {
  try {
    const from = await siteNameOf(event.fromSiteId);
    const to = await siteNameOf(event.toSiteId);
    const name = employee.name;
    let summary;
    if (event.type === 'scheduled_dropped') {
      summary = `Scheduled change for ${name} was not applied — ${event.reason}`;
    } else if (event.kind === 'visit') {
      summary = `${name} is visiting ${to || 'another site'} today (scheduled from ${from || 'their site'})`;
    } else if (event.kind === 'move') {
      summary = `${name} moved from ${from || 'no site'} to ${to || 'another site'} (scheduled)`;
    } else {
      summary = `${name} was removed from ${from || 'the site'} (scheduled)`;
    }
    const twoSites = !!(event.fromSiteId && event.toSiteId);
    await recordSiteActivity({
      type: event.type,
      actor: SYSTEM_ACTOR,
      employee: employee._id,
      employeeName: name,
      fromSiteId: twoSites ? event.fromSiteId : null,
      toSiteId: twoSites ? event.toSiteId : null,
      siteId: twoSites ? null : event.fromSiteId || event.toSiteId,
      summary,
    });
  } catch (err) {
    console.error('[ScheduledAssignments] activity log failed:', err.message);
  }
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
            const ev = await dropSchedule(employee, session, 'removal skipped, employee has moved to another site');
            await logScheduleEvent(employee, ev);
            continue;
          }
          const removedFrom = employee.currentSite;

          if (employee.currentJob) {
            await jobModel.findByIdAndUpdate(
              employee.currentJob,
              { $pull: { employees: employee._id } },
              { session }
            );
          }

          employee.currentSite = null;
          employee.currentJob = null;
          clearSchedule(employee);

          await employee.save({ session });
          // A permanent removal clears a linked supervisor's site access too.
          await syncSupervisorScope(employee, session);

          await session.commitTransaction();
          session.endSession();

          console.log(`[ScheduledAssignments] Applied removal for employee ${employee._id}`);
          await logScheduleEvent(employee, { type: 'scheduled_applied', kind: 'removal', fromSiteId: removedFrom });
          continue;
        }

        // Scheduled one-day visit: becomes today's pendingTransfer* stash; home untouched.
        if (employee.scheduledVisit && employee.scheduledSiteId) {
          const homeId = employee.currentSite;
          const targetId = employee.scheduledSiteId;
          const site = await siteModel.findById(targetId).session(session);
          if (!isAssignableSite(site)) {
            const ev = await dropSchedule(employee, session, 'the site they were to visit is no longer active');
            await logScheduleEvent(employee, ev);
            continue;
          }
          if (homeId && homeId.toString() === targetId.toString()) {
            const ev = await dropSchedule(employee, session, 'they are already on that site');
            await logScheduleEvent(employee, ev);
            continue;
          }
          const jobId =
            employee.scheduledJobId && (await findAssignableJob(employee.scheduledJobId, targetId, session))
              ? employee.scheduledJobId
              : null;

          // Clear first — applyHandover saves the employee once, with the stash written.
          clearSchedule(employee);
          await applyHandover({ employee, toSiteId: targetId, toJobId: jobId, mode: 'today', session });
          // Both rosters change for the new day: conflict with any submit in flight.
          await touchSiteRosters([homeId, targetId], session);

          await session.commitTransaction();
          session.endSession();

          console.log(`[ScheduledAssignments] Applied visit for employee ${employee._id}`);
          await logScheduleEvent(employee, { type: 'scheduled_applied', kind: 'visit', fromSiteId: homeId, toSiteId: targetId });
          continue;
        }

        const isMove = !!employee.scheduledSiteId;

        // Guard: a scheduled add/move whose target site is gone is dropped, not applied.
        if (isMove) {
          const site = await siteModel.findById(employee.scheduledSiteId).session(session);
          if (!isAssignableSite(site)) {
            const ev = await dropSchedule(employee, session, 'the destination site is no longer active');
            await logScheduleEvent(employee, ev);
            continue;
          }
        } else if (movedAwayFromScheduler(employee)) {
          // Job-only change scheduled by a site the employee has since left.
          const ev = await dropSchedule(employee, session, 'job change skipped, employee has moved to another site');
          await logScheduleEvent(employee, ev);
          continue;
        }

        // The job must be live at the site the employee will be on. For a move, a job that
        // went inactive meanwhile is dropped (they still move, with no job); for a job-only
        // change there is nothing else to apply, so the whole change is dropped.
        const targetSiteId = isMove ? employee.scheduledSiteId : employee.currentSite;
        let newJobId = employee.scheduledJobId || null;
        if (newJobId && !(await findAssignableJob(newJobId, targetSiteId, session))) {
          if (!isMove) {
            const ev = await dropSchedule(employee, session, 'the scheduled job is no longer active');
            await logScheduleEvent(employee, ev);
            continue;
          }
          newJobId = null;
        }

        const oldJobId = employee.currentJob;
        const oldSiteId = employee.currentSite;
        const newSiteId = employee.scheduledSiteId;

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

        clearSchedule(employee);

        await employee.save({ session });
        // A permanent site move carries a linked supervisor's site access with it.
        if (isMove) {
          await syncSupervisorScope(employee, session);
        }

        await session.commitTransaction();
        session.endSession();

        console.log(`[ScheduledAssignments] Applied schedule for employee ${employee._id}`);
        // A job-only change isn't logged — Tomorrow-tab bulk job edits would flood the feed.
        if (isMove) {
          await logScheduleEvent(employee, { type: 'scheduled_applied', kind: 'move', fromSiteId: oldSiteId, toSiteId: newSiteId });
        }
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
