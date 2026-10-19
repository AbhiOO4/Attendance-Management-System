import Attendance from "../models/attendanceModel.js";
import Employee from "../models/empModel.js";
import Job from "../models/jobModel.js";
import { isGlobalJobId } from "./globalJobs.js";

// --- CURRENT-JOB SYNC ---
// Keep Employee.currentJob (the roster/"assigned job", scoped to currentSite) in step
// with the LATEST session's job. Job flows one way otherwise: currentJob seeds a new
// session's jobId, but a supervisor changing a session's job never flowed back. This
// syncs the reverse — but ONLY for the employee's most-recent record at their current
// site, so editing history (a past record) never rewrites the present roster. Setting
// the latest session's job to none mirrors currentJob to null. Maintains each job's
// employees[] like updateEmployeeJob (siteController). Pass the caller's mongoose
// session when it runs in a transaction; otherwise it runs un-sessioned.
export async function syncCurrentJobFromLatestSession({ empId, siteId, recordDate, doc, session = null }) {
  if (!empId || !siteId || !recordDate || !doc) return;

  // Past edit? A newer record exists for this employee → leave currentJob alone.
  const laterExists = await Attendance.exists({
    employee: empId,
    date: { $gt: recordDate },
  }).session(session || null);
  if (laterExists) return;

  const employee = await Employee.findById(empId).session(session || null);
  // currentJob belongs to currentSite — only a session at that site may move it.
  if (!employee || !employee.currentSite || employee.currentSite.toString() !== siteId.toString()) {
    return;
  }

  // The latest session at this site (by check-in); its job is the target (null allowed).
  const siteSessions = (doc.sessions || []).filter(
    (s) => s.siteId && s.siteId.toString() === siteId.toString()
  );
  if (siteSessions.length === 0) return;

  const latest = [...siteSessions].sort(
    (a, b) => new Date(a.checkIn || 0).getTime() - new Date(b.checkIn || 0).getTime()
  ).at(-1);

  const targetJob = latest?.jobId || null;
  const currentJob = employee.currentJob || null;

  // A global job is a session-only job (utils/globalJobs.js): logging hours against it never
  // moves the roster job, so tomorrow's draft still defaults to the home job.
  if (targetJob && (await isGlobalJobId(targetJob, session))) return;

  if ((currentJob ? currentJob.toString() : null) === (targetJob ? targetJob.toString() : null)) {
    return; // no change → skip (avoids needless job employees[] churn)
  }

  if (currentJob) {
    await Job.findByIdAndUpdate(
      currentJob,
      { $pull: { employees: employee._id } },
      { session: session || undefined }
    );
  }

  employee.currentJob = targetJob;
  await employee.save({ session: session || undefined });

  if (targetJob) {
    await Job.findByIdAndUpdate(
      targetJob,
      { $addToSet: { employees: employee._id } },
      { session: session || undefined }
    );
  }
}
