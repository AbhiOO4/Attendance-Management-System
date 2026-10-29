import { ListChecks } from "lucide-react"
import type { HelpTopic } from "../types"

export const monthEnd: HelpTopic = {
  id: "month-end",
  title: "Month-end checklist",
  icon: ListChecks,
  roles: ["superadmin", "admin"],
  summary:
    "Do these steps in order in the first days of every month, for the month that just ended. When you finish, the attendance is correct and ready for payroll in ERPNext.",
  workflows: [
    {
      id: "checklist",
      title: "Close the month, step by step",
      steps: [
        {
          text: "Approve all supervisor backfills. Open **Past Attendance** → **Backfill approvals** and clear the **Awaiting approval** tab.",
        },
        {
          text: "Close all open shifts. In **Past Attendance**, go to each day with open shifts and use **Bulk check-out**.",
        },
        {
          text: "Fill the missing days. In **Past Attendance**, click **Missing** for each day and use **Backfill**, or mark the person absent.",
        },
        {
          text: "Check leave. On the **Leave** page, make sure every annual and emergency leave of the month is added.",
        },
        {
          text: "Open **Timesheets**. It shows last month. Pick **Pending** in the status filter.",
        },
        {
          text: "Click **Select all**, then **Approve**. Read the message: some people may be skipped.",
        },
        {
          text: "For each skipped person, click their name. Fix the red rows (missing day, open check-out, no job). Click **Approve**.",
        },
        {
          text: "Repeat until the **Pending** list is empty.",
        },
        {
          text: "Superadmin: open **Reports** and compare **Payment Days** with the ERPNext salary slips.",
        },
        {
          text: "Back on **Timesheets**, click **Select all approved**. Click **Export** → **Attendance (payroll)**. Then **Export** → **Timesheet (job cost)**.",
        },
        {
          text: "Upload both files in ERPNext with Data Import.",
          warning: "If you change a day after this, its timesheet is revoked. Approve it again and send a new file.",
        },
      ],
      seeAlso: [
        { topic: "backfill-approvals", label: "Backfill approvals" },
        { topic: "past-attendance", workflow: "missing", label: "Missing days" },
        { topic: "timesheets", workflow: "approve", label: "Approve timesheets" },
      ],
    },
  ],
}
