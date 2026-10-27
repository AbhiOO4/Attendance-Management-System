// Child process for exportMonthBounds.test.js: runs the real exportErpnext controller under
// whatever process TZ the parent gave it, against the parent's test database, and prints the
// exported Attendance Dates as JSON.
import mongoose from "mongoose";
import "../../src/models/activityTypeModel.js";
import { exportErpnext, getEmployeeAttendanceByMonth } from "../../src/controllers/attendanceController.js";
import { callController } from "../../src/seed/reconcileErpExport.js";
import { parseCsv } from "../../src/utils/exportReconcile.js";

await mongoose.connect(process.env.TEST_MONGO_URI);
try {
  const params = { month: "9", year: "2026" };
  const exported = await callController(exportErpnext, { params, body: { type: "attendance" } });
  const timesheet = await callController(getEmployeeAttendanceByMonth, {
    params: { employeeId: process.env.TEST_EMPLOYEE_ID },
    query: { month: "9", year: "2026" },
  });
  console.log(
    JSON.stringify({
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      export: parseCsv(exported.body).map((r) => r["Attendance Date"]),
      timesheet: timesheet.body.data.map((r) => new Date(r.date).toISOString().slice(0, 10)),
    })
  );
} finally {
  await mongoose.disconnect();
}
