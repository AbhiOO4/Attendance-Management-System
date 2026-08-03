/**
 * One-time migration: backfill the cutoff-redesign session fields
 * (rawCheckIn / rawCheckOut / checkInNextDay / checkOutNextDay) onto every existing
 * attendance record.
 *
 * The values are DERIVED from each session's already-stored checkIn/checkOut Dates and
 * its record's business day (Attendance.date). Those Dates already encode the correct
 * calendar day — the old cutoff placed them there at write time — so the offset can be
 * read straight back out with no cutoff lookup and no history. Payroll math is untouched,
 * so NO hours recalc is needed.
 *
 * Idempotent: only sessions whose derived fields differ from what's stored are rewritten,
 * and updatedAt is preserved. Safe to run repeatedly.
 *
 * Usage (from server/):
 *   node src/seed/backfillRawOffsets.js --dry     # report only, no writes
 *   node src/seed/backfillRawOffsets.js           # apply
 */

import dotenv from "dotenv";
dotenv.config({ quiet: true });

import mongoose from "mongoose";
import Attendance from "../models/attendanceModel.js";
import { deriveRawOffsetFields } from "../utils/timeLocal.js";

const DRY_RUN = process.argv.includes("--dry") || process.env.DRY_RUN === "true";

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("[backfill] MONGO_URI is not set — aborting.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log(
    `[backfill] connected. ${DRY_RUN ? "DRY RUN — no writes will be made." : "LIVE — records will be updated."}`
  );

  let scanned = 0;
  let changedDocs = 0;
  let changedSessions = 0;
  let failed = 0;

  const cursor = Attendance.find({}).cursor();

  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    scanned++;
    let docChanged = false;

    for (const s of doc.sessions || []) {
      if (!s) continue;
      const d = deriveRawOffsetFields(doc.date, s.checkIn, s.checkOut);
      if (
        s.rawCheckIn !== d.rawCheckIn ||
        s.rawCheckOut !== d.rawCheckOut ||
        !!s.checkInNextDay !== d.checkInNextDay ||
        !!s.checkOutNextDay !== d.checkOutNextDay
      ) {
        s.rawCheckIn = d.rawCheckIn;
        s.rawCheckOut = d.rawCheckOut;
        s.checkInNextDay = d.checkInNextDay;
        s.checkOutNextDay = d.checkOutNextDay;
        docChanged = true;
        changedSessions++;
      }
    }

    if (docChanged) {
      changedDocs++;
      if (!DRY_RUN) {
        try {
          // timestamps:false so a historical record's updatedAt isn't disturbed. The
          // pre-save hook re-derives the same values (idempotent).
          await doc.save({ timestamps: false });
        } catch (err) {
          failed++;
          console.warn(`[backfill] save failed for ${doc._id}: ${err.message}`);
        }
      }
    }

    if (scanned % 500 === 0) console.log(`[backfill]   scanned ${scanned}...`);
  }

  console.log(
    `[backfill] done. scanned=${scanned} changedDocs=${changedDocs} ` +
      `changedSessions=${changedSessions} failed=${failed}${DRY_RUN ? " (dry run — nothing written)" : ""}`
  );

  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("[backfill] fatal:", err);
  process.exit(1);
});
