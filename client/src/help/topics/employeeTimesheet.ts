import { CalendarRange } from "lucide-react"
import type { HelpTopic } from "../types"

export const employeeTimesheet: HelpTopic = {
  id: "employee-timesheet",
  title: "One employee's timesheet",
  icon: CalendarRange,
  roles: ["superadmin", "admin"],
  summary:
    "One person's month, day by day: where they worked, their hours, overtime, leave and absent days. Here you fix their days and approve their month.",
  whereToFind: "Sidebar → **Employees** (or **Timesheets**) → click the person's name",
  overviewImage: "employee-timesheet/01-page.jpg",
  workflows: [
    {
      id: "open",
      title: "Open a timesheet",
      steps: [
        { text: "Click **Employees** in the sidebar. Click the person's name." },
        {
          text: "Pick the month at the top. It shows the month you picked, day by day.",
          image: "employee-timesheet/02-month.jpg",
        },
        { text: "Pick **Oldest first** or **Latest first** to change the order of days." },
      ],
    },
    {
      id: "read",
      title: "Read the numbers at the top",
      steps: [
        { text: "The boxes at the top give the month's totals.", image: "employee-timesheet/03-tiles.jpg" },
        {
          text: "**Payment days**: the days the person is paid for. It is every day of the month, minus absent days, minus half a day for each half day.",
        },
        { text: "**Half days**: days with short hours. Each one takes away half a day." },
        { text: "**Days absent**: unpaid days. Point at it to see why (no reason, emergency leave, sick leave, LOP, or not marked)." },
        { text: "**Regular hrs** and **OT hrs**: normal hours and overtime hours." },
        { text: "**Annual** and **Emergency** chips show the leave balance." },
      ],
      seeAlso: [{ topic: "glossary", label: "What these words mean" }],
    },
    {
      id: "flags",
      title: "Problems shown in red",
      when: "These must be fixed before the month can be approved.",
      steps: [
        {
          text: "**No record — missing day**: nobody marked this day. Click **Backfill** on the row to fill it.",
          image: "employee-timesheet/04-missing-day.jpg",
        },
        { text: "**Open check-out**: the person checked in but has no check-out time. Click the pencil and add the time." },
        { text: "**No job**: hours with no job. Click the pencil and pick a job." },
      ],
    },
    {
      id: "backfill-day",
      title: "Fill a missing day",
      steps: [
        { text: "On the **No record** row, click **Backfill**." },
        {
          text: "The **Backfill Attendance Record** window opens. Click **Add New Session**.",
          image: "employee-timesheet/05-backfill-dialog.jpg",
        },
        { text: "Pick the site and the job. Type **Check In** and **Check Out**." },
        { text: "Click **Create Record**." },
        { text: "If the person was absent that day, click **Create Record** with no session. The day is saved as absent." },
      ],
    },
    {
      id: "edit-day",
      title: "Change a day",
      steps: [
        { text: "Click the pencil on the day's row." },
        { text: "In **Edit Attendance Record**, change the times, the site or the job." },
        { text: "For an absent day you can tick **Sick Leave** or **LOP (Loss of Pay)**." },
        { text: "Click **Save Changes**." },
      ],
    },
    {
      id: "approve",
      title: "Approve the month",
      when: "Use this after the month has ended and every day is correct.",
      steps: [
        {
          text: "Look at the **Timesheet** bar. It says **Pending**, **Approved** or **Revoked**.",
          image: "employee-timesheet/06-approval-bar.jpg",
        },
        {
          text: "Click **Approve**.",
          tip: "The button is grey until the month is over and all red problems are fixed.",
        },
        { text: "To undo an approval, click **Revoke**. Click **History** to see who approved or revoked it and when." },
        {
          text: "If someone changes a day after approval, the approval is removed by itself. The bar says the records changed. Check and approve again.",
        },
      ],
      seeAlso: [{ topic: "timesheets", workflow: "approve", label: "Approve many people at once" }],
    },
    {
      id: "export",
      title: "Download the timesheet",
      steps: [
        { text: "Click **Export**.", image: "employee-timesheet/07-export.jpg" },
        { text: "**Timesheet (.xlsx)**: an Excel file of the month. You can print it." },
        {
          text: "**Attendance (payroll)** and **Timesheet (job cost)**: files for ERPNext. They work only after the month is approved.",
        },
      ],
    },
    {
      id: "leave-history",
      title: "See the person's leave",
      steps: [
        { text: "Click the **Leave history** tab. It lists every annual and emergency leave given to the person." },
        { text: "To add or change leave, use the **Leave** page." },
      ],
      seeAlso: [{ topic: "leave", label: "Leave page" }],
    },
  ],
}
