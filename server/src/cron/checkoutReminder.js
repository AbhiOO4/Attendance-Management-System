/**
 * Check-out reminder cron. Every 10 minutes it asks openSessionAudit.js which
 * open sessions the auto-checkout cron will NOT resolve, then push-notifies:
 *   - each supervisor about their own site's forgotten sessions (deep-links to
 *     /attendance/<siteId>), and
 *   - each admin/superadmin a roundup digest (deep-links to /site).
 *
 * Delivery is capped per user per local day (MAX_PER_DAY) and spaced by
 * COOLDOWN_MS via the user's `checkoutReminder` throttle field, so a still-open
 * session nudges again later without spamming every run.
 */
import cron from 'node-cron';
import userModel from '../models/userModel.js';
import workModel from '../models/workModel.js';
import { getTodayLocal } from '../utils/timeLocal.js';
import { findForgottenSessionsBySite } from '../utils/openSessionAudit.js';
import { sendPushToUser, isPushConfigured } from '../utils/webPush.js';

const MAX_PER_DAY = 3;
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

/** Whether this user may be pinged now given the per-day cap and cooldown. */
function canSend(user, todayStr) {
  const rem = user.checkoutReminder || {};
  const freshDay = rem.date !== todayStr;
  const count = freshDay ? 0 : rem.count || 0;
  if (count >= MAX_PER_DAY) return false;
  if (!freshDay && rem.lastSentAt && Date.now() - new Date(rem.lastSentAt).getTime() < COOLDOWN_MS) {
    return false;
  }
  return true;
}

/** Advance a user's reminder throttle after a successful send. */
async function recordSend(user, todayStr) {
  const rem = user.checkoutReminder || {};
  const freshDay = rem.date !== todayStr;
  const count = (freshDay ? 0 : rem.count || 0) + 1;
  await userModel.updateOne(
    { _id: user._id },
    { $set: { checkoutReminder: { date: todayStr, count, lastSentAt: new Date() } } }
  );
}

export async function runCheckoutReminder() {
  try {
    if (!isPushConfigured()) return; // VAPID not set — nothing to deliver.

    const workConfig = await workModel.findOne();
    const { sites, totalSites, totalEmployees } = await findForgottenSessionsBySite(workConfig);
    if (totalSites === 0) return;

    const todayStr = getTodayLocal();
    const siteById = new Map(sites.map((s) => [s.siteId, s]));

    // --- Supervisors: one notification per assigned site with forgotten sessions.
    const supervisors = await userModel
      .find({
        role: 'supervisor',
        assignedSite: { $in: sites.map((s) => s.siteId) },
        'pushSubscriptions.0': { $exists: true },
      })
      .lean();

    for (const sup of supervisors) {
      const group = siteById.get(sup.assignedSite?.toString());
      if (!group || group.employees.length === 0) continue;
      if (!canSend(sup, todayStr)) continue;

      const n = group.employees.length;
      const delivered = await sendPushToUser(sup, {
        title: 'Unclosed attendance',
        body: `${n} employee${n === 1 ? '' : 's'} still need${n === 1 ? 's' : ''} a check-out at ${group.siteName}.`,
        url: `/attendance/${group.siteId}`,
        tag: 'checkout-reminder',
      });
      if (delivered > 0) await recordSend(sup, todayStr);
    }

    // --- Admin digest: roundup across every site with forgotten sessions.
    const admins = await userModel
      .find({
        role: { $in: ['admin', 'superadmin'] },
        'pushSubscriptions.0': { $exists: true },
      })
      .lean();

    for (const admin of admins) {
      if (!canSend(admin, todayStr)) continue;
      const delivered = await sendPushToUser(admin, {
        title: 'Check-outs pending',
        body: `${totalSites} site${totalSites === 1 ? '' : 's'} · ${totalEmployees} employee${totalEmployees === 1 ? '' : 's'} still need a check-out.`,
        url: '/site',
        tag: 'checkout-digest',
      });
      if (delivered > 0) await recordSend(admin, todayStr);
    }
  } catch (error) {
    console.error('[CheckoutReminder] Cron job error:', error);
  }
}

/** Start the check-out reminder cron (runs every 10 minutes). */
export function startCheckoutReminderCron() {
  cron.schedule('*/10 * * * *', runCheckoutReminder);
  console.log('[CheckoutReminder] Cron job started (runs every 10 minutes)');
}
