/**
 * Web-Push helper. Configures the web-push library with the VAPID keypair from
 * the environment and exposes a small `sendPushToUser` that fans a payload out
 * to every device a user has subscribed, pruning dead endpoints as it goes.
 *
 * Required env (generate with `npx web-push generate-vapid-keys`):
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT ("mailto:you@example.com").
 * If any is missing the module becomes a no-op (logged once), so the app still
 * boots in a dev environment without keys configured.
 *
 * NOTE: env is read LAZILY (on first use), not at import time. Under ESM, static
 * imports are hoisted above `dotenv.config()` in server.js, so reading env at
 * module top level would see undefined keys. Configuring on first call sidesteps
 * that — consistent with how the rest of the codebase reads env (e.g. timeLocal.js).
 */
import webpush from 'web-push';
import userModel from '../models/userModel.js';

let configured = null; // null = not yet attempted; true/false once resolved.

function ensureConfigured() {
  if (configured !== null) return configured;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@ngdp-ams.local';

  if (!publicKey || !privateKey) {
    console.warn(
      '[WebPush] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — push notifications are disabled.'
    );
    configured = false;
    return configured;
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  } catch (err) {
    console.error('[WebPush] Failed to configure VAPID details:', err.message);
    configured = false;
  }
  return configured;
}

/** Whether web-push is configured (VAPID keys present and valid). */
export function isPushConfigured() {
  return ensureConfigured();
}

/** The VAPID public key clients need to subscribe (safe to expose). */
export function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

/**
 * Send a notification payload to every subscription on a user document.
 * Prunes any subscription the push service reports as gone (404/410).
 *
 * @param {import('mongoose').Document} user - a User doc with `pushSubscriptions`.
 * @param {Object} payload - serialisable notification payload
 *        ({ title, body, url, ... }); delivered to the SW `push` handler.
 * @returns {Promise<number>} number of subscriptions successfully delivered to.
 */
export async function sendPushToUser(user, payload) {
  if (!ensureConfigured()) return 0;
  const subs = user?.pushSubscriptions || [];
  if (subs.length === 0) return 0;

  const body = JSON.stringify(payload);
  const deadEndpoints = [];
  let delivered = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          body
        );
        delivered++;
      } catch (err) {
        // 404 Not Found / 410 Gone => the subscription is permanently dead.
        if (err.statusCode === 404 || err.statusCode === 410) {
          deadEndpoints.push(sub.endpoint);
        } else {
          console.error(
            `[WebPush] send failed (status ${err.statusCode}) for ${user._id}:`,
            err.body || err.message
          );
        }
      }
    })
  );

  if (deadEndpoints.length > 0) {
    try {
      await userModel.updateOne(
        { _id: user._id },
        { $pull: { pushSubscriptions: { endpoint: { $in: deadEndpoints } } } }
      );
    } catch (err) {
      console.error('[WebPush] Failed to prune dead subscriptions:', err.message);
    }
  }

  return delivered;
}
