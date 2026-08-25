/**
 * Web-Push subscription endpoints. Supervisors and admins subscribe their
 * installed PWA to receive check-out reminders (cron/checkoutReminder.js).
 * All routes sit below verifyToken, so req.user.id is the acting user.
 */
import userModel from '../models/userModel.js';
import { getVapidPublicKey as readVapidPublicKey, isPushConfigured } from '../utils/webPush.js';

/** GET /api/user/vapid-public-key — the public key clients need to subscribe. */
export async function getVapidPublicKey(req, res) {
  const publicKey = readVapidPublicKey();
  if (!publicKey) {
    return res.status(503).json({
      success: false,
      message: 'Push notifications are not configured on the server',
    });
  }
  return res.status(200).json({ success: true, data: { publicKey } });
}

/**
 * POST /api/user/push-subscription — store (or refresh) a subscription for the
 * current user, deduped by endpoint so re-subscribing the same device is a no-op.
 * Body: a PushSubscription JSON ({ endpoint, keys: { p256dh, auth } }).
 */
export async function savePushSubscription(req, res) {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({
        success: false,
        message: 'A valid push subscription (endpoint + keys) is required',
      });
    }

    const userAgent = req.get('user-agent') || '';

    // Drop any existing copy of this endpoint, then push the fresh one — an
    // atomic "upsert by endpoint" without risking duplicates.
    await userModel.updateOne(
      { _id: req.user.id },
      { $pull: { pushSubscriptions: { endpoint } } }
    );
    await userModel.updateOne(
      { _id: req.user.id },
      {
        $push: {
          pushSubscriptions: { endpoint, keys, userAgent, createdAt: new Date() },
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: 'Push subscription saved',
      data: { configured: isPushConfigured() },
    });
  } catch (error) {
    console.error('[Push] savePushSubscription error:', error);
    return res.status(500).json({ success: false, message: 'Failed to save push subscription' });
  }
}

/**
 * DELETE /api/user/push-subscription — remove a subscription for the current
 * user. Body: { endpoint }.
 */
export async function deletePushSubscription(req, res) {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) {
      return res.status(400).json({ success: false, message: 'endpoint is required' });
    }

    await userModel.updateOne(
      { _id: req.user.id },
      { $pull: { pushSubscriptions: { endpoint } } }
    );

    return res.status(200).json({ success: true, message: 'Push subscription removed' });
  } catch (error) {
    console.error('[Push] deletePushSubscription error:', error);
    return res.status(500).json({ success: false, message: 'Failed to remove push subscription' });
  }
}
