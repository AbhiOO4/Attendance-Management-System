import { Truck } from "lucide-react"
import type { HelpTopic } from "../types"

export const driversAttendance: HelpTopic = {
  id: "drivers-attendance",
  title: "Drivers attendance",
  icon: Truck,
  roles: ["superadmin", "admin"],
  summary:
    "Drivers do not belong to one site. They have their own sheet. For each driver you pick the site they served, and their hours are shared equally between that site's jobs.",
  whereToFind: "Sidebar → **Mark Attendance** → **Drivers Attendance** button",
  overviewImage: "drivers-attendance/02-sheet.jpg",
  workflows: [
    {
      id: "mark",
      title: "Mark drivers' attendance",
      when: "Use this once a day, like a site sheet.",
      steps: [
        { text: "Click **Mark Attendance** in the sidebar. Click **Drivers Attendance** at the top.", image: "drivers-attendance/01-button.jpg" },
        {
          text: "Each driver has one row. The site they served last time is already picked, with all its jobs ticked.",
        },
        {
          text: "To change the site, click the site box. Click **All sites** to pick another site. Tick the jobs the driver worked for, then click **Done**.",
          image: "drivers-attendance/03-site-picker.jpg",
          tip: "Pick **General** for work that is not for one site (for example office errands). It uses the global jobs.",
        },
        { text: "Type the **Check In** time. Click **Absent** for a driver who did not come." },
        { text: "Use the **Foreign** and **Omani** tabs to see one group at a time." },
        { text: "Click **Save Attendance**." },
      ],
    },
    {
      id: "split",
      title: "How driver hours are shared",
      steps: [
        { text: "If you tick 2 jobs and the driver worked 10 hours, each job gets 5 hours." },
        { text: "Sites with no open job are grey. You cannot pick them." },
        { text: "At least one job must stay ticked." },
      ],
    },
    {
      id: "remark",
      title: "Add a remark for a driver",
      steps: [
        { text: "After saving, click the three dots (⋮) on the driver's row." },
        { text: "Click **Remark**. Type the note, for example the trip. Click **Save**." },
      ],
    },
  ],
}
