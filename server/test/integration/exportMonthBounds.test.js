// REGRESSION: the ERPNext export and the employee timesheet used SERVER-LOCAL month bounds
// (new Date(y, m - 1, 1)), while Attendance.date is the business day at UTC midnight. On a
// host west of UTC that dropped the 1st and pulled in the next month's 1st. They now use
// Date.UTC like the monthly report; this runs them in a child process under such a TZ.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { startStack, seedBase, makeSite, makeJob, makeEmployee, api, ok } from "../helpers/integration.js";

const run = promisify(execFile);
let stack, employee;

before(async () => {
  stack = await startStack();
  const { M, admin } = await seedBase();
  const site = await makeSite(M, "Edge");
  const job = await makeJob(M, site, "EDGE-1");
  employee = await makeEmployee(M, "EDGE");
  for (const date of ["2026-08-31", "2026-09-01", "2026-09-30", "2026-10-01"]) {
    ok(
      await api(stack.app, admin)
        .post("/api/attendance/backfill")
        .send({ employeeMongoId: employee._id, date, sessions: [{ siteId: site._id, jobId: job._id, checkIn: "07:00", checkOut: "16:00" }] }),
      `backfill ${date}`
    );
  }
});
after(async () => stack?.stop());

for (const tz of ["America/New_York", "UTC", "Asia/Muscat", "Pacific/Kiritimati"]) {
  test(`September is exactly 1st–30th with the server in ${tz}`, async () => {
    const child = fileURLToPath(new URL("../helpers/exportChild.mjs", import.meta.url));
    const { stdout } = await run(process.execPath, ["--import", "./test/setup-env.js", child], {
      env: {
        ...process.env,
        TZ: tz,
        TEST_MONGO_URI: stack.uri,
        TEST_EMPLOYEE_ID: String(employee._id),
      },
    });
    const out = JSON.parse(stdout.trim().split("\n").pop());
    assert.deepEqual(out.export, ["2026-09-01", "2026-09-30"], `export under ${out.tz}`);
    assert.deepEqual(out.timesheet, ["2026-09-01", "2026-09-30"], `timesheet under ${out.tz}`);
  });
}
