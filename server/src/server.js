// Boot: connect to MongoDB, seed the fixed sites, start the crons and change-stream
// watchers, then listen. The Express app itself (middleware + routes) lives in app.js.
import app from './app.js'

import connectDB from './config/db.js'
import Site from './models/siteModel.js'
import { startAutoCheckOutCron } from './cron/autoCheckOut.js'
import { startApplyScheduledAssignmentsCron } from './cron/applyScheduledAssignments.js'
import { startCheckoutReminderCron } from './cron/checkoutReminder.js'
import { startExpireTransferRequestsCron } from './cron/expireTransferRequests.js'
import { startRealtimeWatchers } from './utils/realtime.js'
import { ensureDriverPool } from './utils/driverPool.js'
// Transfer requests are no longer escalated: every admin sees every request in their
// Requests inbox (requestController.incomingFilterFor), so nothing can sit unseen.
// Night check-in is now pre-filled when a night shift is assigned (see
// assignNightShift), so the auto check-in cron is no longer scheduled.

const initializePermanentSite = async () => {
  try {
    const siteName = "Workshop Phase 7";
    const existing = await Site.findOne({ siteName: { $regex: new RegExp(`^${siteName}$`, 'i') } });
    if (!existing) {
      await Site.create({
        siteName,
        locationDetails: "Main Office & Workshop (Permanent Site)",
        isPermanent: true,
        isActive: true,
      });
      console.log(`Permanent site '${siteName}' created.`);
    } else if (!existing.isPermanent) {
      existing.isPermanent = true;
      await existing.save();
      console.log(`Site '${siteName}' updated to permanent.`);
    }
  } catch (error) {
    console.error("Failed to initialize permanent site:", error);
  }
};

connectDB().then(async () => {
    await initializePermanentSite();
    await ensureDriverPool();
    startAutoCheckOutCron();
    startApplyScheduledAssignmentsCron();
    startCheckoutReminderCron();
    startExpireTransferRequestsCron();
    startRealtimeWatchers();
    app.listen(process.env.PORT || 3000, () => {
        console.log(`Server is running on PORT : ${process.env.PORT} `)
    })
})
