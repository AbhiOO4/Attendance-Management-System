/**
 * One-off: move drivers who were placed on a site before the "drivers live only on Drivers
 * Attendance" rule onto the Drivers sheet.
 *
 * Lists every ACTIVE employee whose job title contains "driver" and who still has a site
 * placement — currentSite / currentJob, a one-day visit stash (pendingTransfer*) or a scheduled
 * change (scheduled*). With --apply it clears all of those (and pulls them out of every Job's
 * member list) through the same helper the employee edit uses (releaseSitePlacement), then
 * re-syncs a linked supervisor account's site access. Attendance history is never touched.
 *
 * Dry run by default. Usage (from server/):
 *   node src/seed/moveDriversToPool.js "<mongo url>"            # list only
 *   node src/seed/moveDriversToPool.js "<mongo url>" --apply    # move them
 */

import mongoose from "mongoose";
import employeeModel from "../models/empModel.js";
import siteModel from "../models/siteModel.js";
import { hasSitePlacement, releaseSitePlacement } from "../utils/driverPool.js";
import { syncSupervisorScope } from "../utils/supervisorScope.js";

export const moveDriversToPool = async (dbUrl, { apply = false } = {}) => {
  if (!dbUrl) {
    console.log("connection failed: no db url given");
    process.exit(1);
  }

  await mongoose.connect(dbUrl);
  // Name the target (never the credentials) so a live run is obvious in the log.
  console.log(`connected to ${mongoose.connection.host}/${mongoose.connection.name}${apply ? "" : " (dry run)"}`);

  try {
    const drivers = await employeeModel.find({ isActive: true, jobTitle: { $regex: "driver", $options: "i" } });
    const placed = drivers.filter(hasSitePlacement);

    const siteIds = [
      ...new Set(placed.flatMap((e) => [e.currentSite, e.pendingTransferSiteId, e.scheduledSiteId]).filter(Boolean).map(String)),
    ];
    const sites = await siteModel.find({ _id: { $in: siteIds } }, "siteName").lean();
    const nameOf = (id) => (id ? sites.find((s) => String(s._id) === String(id))?.siteName ?? String(id) : null);

    console.log(`\n${drivers.length} active driver(s); ${placed.length} still placed on a site:`);
    for (const e of placed) {
      const parts = [
        e.currentSite && `site ${nameOf(e.currentSite)}`,
        e.currentJob && "has a job",
        e.pendingTransferSiteId && `visiting ${nameOf(e.pendingTransferSiteId)}`,
        e.scheduledEffectiveDate && `scheduled change${e.scheduledSiteId ? ` to ${nameOf(e.scheduledSiteId)}` : ""}`,
      ].filter(Boolean);
      console.log(`  - ${e.name} (${e.employeeId}, ${e.jobTitle}): ${parts.join(", ")}`);
    }

    if (!apply) {
      console.log("\nDry run — nothing changed. Re-run with --apply to move them to Drivers Attendance.");
      return { found: placed.length, moved: 0 };
    }

    let moved = 0;
    for (const e of placed) {
      await releaseSitePlacement(e);
      await e.save();
      await syncSupervisorScope(e);
      moved++;
    }
    console.log(`\nMoved ${moved} driver(s) to Drivers Attendance.`);
    return { found: placed.length, moved };
  } finally {
    await mongoose.disconnect();
  }
};

const [dbUrl, flag] = process.argv.slice(2);
await moveDriversToPool(dbUrl, { apply: flag === "--apply" });
