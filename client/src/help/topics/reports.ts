import { BarChart3 } from "lucide-react"
import type { HelpTopic } from "../types"

export const reports: HelpTopic = {
  id: "reports",
  title: "Reports",
  icon: BarChart3,
  roles: ["superadmin", "admin"],
  summary:
    "Two reports. **Monthly Attendance** shows every person's payment days, absent days and overtime, to check against the ERPNext salary slip. **Job Report** shows the hours spent on each job.",
  whereToFind: "Sidebar → **Reports**",
  overviewImage: "reports/01-monthly.jpg",
  workflows: [
    {
      id: "monthly",
      title: "Monthly Attendance report",
      steps: [
        { text: "Click **Reports** in the sidebar. The **Monthly Attendance** tab opens." },
        {
          text: "Click **Month** and pick a month. Or click **Date range** and pick the first and last day.",
          image: "reports/02-period.jpg",
        },
        { text: "Use the employee filter to show **Permanent** or **Temporary** people, or search for a name." },
        { text: "**Payment Days**: days the person is paid for." },
        { text: "**Half**: half days. **Absent**: unpaid days. Point at the number to see why." },
        { text: "**OT**: overtime hours. **Holiday**: hours worked on holidays. **Total OT**: both together." },
        {
          text: "This page only shows the report. To download files, use the **Timesheets** page.",
        },
      ],
      seeAlso: [{ topic: "timesheets", workflow: "export", label: "Download files" }],
    },
    {
      id: "job-report",
      title: "Job Report",
      when: "Use this to see how many hours each job used.",
      steps: [
        { text: "Click the **Job Report** tab.", image: "reports/03-job-report.jpg" },
        { text: "Pick a month, or the whole time." },
        { text: "Each row shows **Regular Hours**, **Total OT Hours** and **Man Hours** for one job." },
        { text: "Turn on **Temporary workers only** to see only hired workers' hours." },
        { text: "Click **Export** to download it as Excel." },
      ],
    },
  ],
}
