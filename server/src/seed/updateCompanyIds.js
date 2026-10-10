/**
 * One-off: set Employee.companyId from a list of
 *   { "Sl No": "17", "Employee Name": "Ahsan Iqbal", "Employee ID": "103135615", "ID NO": "NGDP-105" }
 * matching each row to the employee whose employeeId equals "Employee ID" and writing
 * "ID NO" as its company ID.
 *
 * Rows are skipped (and reported) when a field is missing or malformed, when the same
 * ID NO / Employee ID appears twice in the input, when no employee matches, or when the
 * ID NO already belongs to a DIFFERENT employee in the db. Re-running is safe: an
 * employee already holding the same value is a no-op.
 *
 * Usage (from server/): edit the call at the bottom, then
 *   node src/seed/updateCompanyIds.js
 */

import { readFileSync } from "node:fs";
import mongoose from "mongoose";
import employeeModel from "../models/empModel.js";
import { COMPANY_ID_RE } from "../middlewares/validation.js";

const label = (row) =>
  `#${row["Sl No"] ?? "?"} ${row["Employee Name"] ?? ""} (Employee ID ${row["Employee ID"] ?? "-"}, ID NO ${row["ID NO"] ?? "-"})`;

const clean = (v) =>
  v === undefined || v === null ? "" : String(v).trim().toUpperCase();



export const updateCompanyIds = async (dbUrl, rows, { dryRun = false } = {}) => {
  if (!dbUrl) {
    console.log("connection failed: no db url given");
    process.exit(1);
  }
  if (!Array.isArray(rows)) {
    console.log("rows must be an array");
    process.exit(1);
  }

  await mongoose.connect(dbUrl);
  // Name the target (never the credentials) so a live run is obvious in the log.
  console.log(
    `connected to db "${mongoose.connection.name}" on ${mongoose.connection.host}` +
      (dryRun ? " — DRY RUN, no writes" : "")
  );

  try {
    const invalid = [];
    const duplicateInInput = [];
    const notFound = [];
    const conflicts = [];

    // ---- 1. normalize + validate the input itself ----
    const parsed = [];
    for (const row of rows) {
      const employeeId = clean(row["Employee ID"]);
      const companyId = clean(row["ID NO"]);
      if (!employeeId || !companyId || !COMPANY_ID_RE.test(companyId)) {
        invalid.push(row);
        continue;
      }
      parsed.push({ row, employeeId, companyId });
    }

    const countBy = (key) =>
      parsed.reduce((m, p) => m.set(p[key], (m.get(p[key]) || 0) + 1), new Map());
    const empIdCount = countBy("employeeId");
    const companyIdCount = countBy("companyId");

    const unique = parsed.filter((p) => {
      if (empIdCount.get(p.employeeId) > 1 || companyIdCount.get(p.companyId) > 1) {
        duplicateInInput.push(p.row);
        return false;
      }
      return true;
    });

    // ---- 2. match employees ----
    await employeeModel.init(); // make sure the partial unique index exists

    const employees = await employeeModel
      .find({ employeeId: { $in: unique.map((p) => p.employeeId) } }, "_id employeeId companyId name")
      .lean();
    const byEmpId = new Map(employees.map((e) => [e.employeeId, e]));

    // ---- 3. company IDs already held by someone else ----
    const holders = await employeeModel
      .find({ companyId: { $in: unique.map((p) => p.companyId) } }, "_id employeeId companyId name")
      .lean();
    const holderByCompanyId = new Map(holders.map((e) => [e.companyId, e]));

    const ops = [];
    let alreadySet = 0;
    for (const p of unique) {
      const emp = byEmpId.get(p.employeeId);
      if (!emp) {
        notFound.push(p.row);
        continue;
      }
      const holder = holderByCompanyId.get(p.companyId);
      if (holder && String(holder._id) !== String(emp._id)) {
        conflicts.push({ row: p.row, heldBy: `${holder.name} (${holder.employeeId})` });
        continue;
      }
      if (emp.companyId === p.companyId) {
        alreadySet++;
        continue;
      }
      ops.push({
        updateOne: { filter: { _id: emp._id }, update: { $set: { companyId: p.companyId } } },
      });
    }

    // ---- 4. write ----
    let modified = 0;
    if (!dryRun && ops.length) {
      const result = await employeeModel.bulkWrite(ops, { ordered: false });
      modified = result.modifiedCount;
    }

    // ---- 5. report ----
    console.log(`\nrows given:          ${rows.length}`);
    console.log(`to update:           ${ops.length}${dryRun ? " (dry run — not written)" : ""}`);
    if (!dryRun) console.log(`modified:            ${modified}`);
    console.log(`already set:         ${alreadySet}`);
    const list = (title, items, fmt = label) => {
      if (!items.length) return;
      console.log(`\n${title} (${items.length}):`);
      items.forEach((i) => console.log(`  - ${fmt(i)}`));
    };
    list("invalid / missing fields", invalid);
    list("duplicate Employee ID or ID NO in input", duplicateInInput);
    list("no employee with that Employee ID", notFound);
    list("ID NO already used by another employee", conflicts, (c) => `${label(c.row)} → held by ${c.heldBy}`);

    return { updated: dryRun ? 0 : modified, toUpdate: ops.length, alreadySet, invalid, duplicateInInput, notFound, conflicts };
  } finally {
    await mongoose.disconnect();
  }
};

// The rows live in company-ids.data.json next to this file (git-ignored — it holds real
// employee names and IDs, so it never goes into the repo). Same shape as documented above.
const data = JSON.parse(
  readFileSync(new URL("./company-ids.data.json", import.meta.url), "utf8")
)

const db_url = ""

await updateCompanyIds(db_url, data, { dryRun: true })
await updateCompanyIds(db_url, data)
