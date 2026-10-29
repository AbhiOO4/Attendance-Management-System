import { CalendarDays } from "lucide-react"
import type { HelpTopic } from "../types"

export const leave: HelpTopic = {
  id: "leave",
  title: "Leave",
  icon: CalendarDays,
  roles: ["superadmin", "admin"],
  summary:
    "Give annual leave (paid) and emergency leave (unpaid). First give each person their yearly leave days (an allocation). Then add each leave they take (an application).",
  whereToFind: "Sidebar → **Leave**",
  overviewImage: "leave/01-applications.jpg",
  workflows: [
    {
      id: "allocate",
      title: "Give a person their yearly leave days",
      when: "Use this once a year for each person, or when a person joins. Annual leave cannot be given without it.",
      steps: [
        { text: "Click the **Leave allocations** tab.", image: "leave/02-allocations.jpg" },
        { text: "Click **New allocation**." },
        { text: "Pick the person in **Employee**.", image: "leave/03-allocation-dialog.jpg" },
        { text: "Pick **From** and **To**. For example 1 Jan 2026 to 31 Dec 2026." },
        { text: "Type the number of days in **Annual leave days**. For example 30." },
        { text: "Click **Allocate**." },
        {
          text: "The table shows **Allocated**, **Used** and **Remaining** days for each person.",
          warning: "Two allocations for the same person cannot cover the same dates.",
        },
      ],
    },
    {
      id: "apply",
      title: "Add a leave",
      when: "Use this when a person takes leave. Add it before or after the leave days.",
      steps: [
        { text: "Click the **Leave applications** tab. Click **New application**." },
        { text: "Pick the person in **Employee**.", image: "leave/04-application-dialog.jpg" },
        {
          text: "Pick the **Leave type**: **Annual leave (paid)** or **Emergency leave (unpaid)**.",
          tip: "Annual leave uses the person's leave days. Emergency leave has no limit, but the days are not paid.",
        },
        { text: "Pick the first day in **From** and the last day in **To**." },
        { text: "For annual leave, check the **Annual leave balance** box. It shows how many days are left." },
        { text: "Type a note if you want. Click **Submit**." },
        {
          text: "The leave days are now locked. The person is not on the attendance sheet on those days.",
        },
      ],
    },
    {
      id: "change",
      title: "Change, cancel or delete a leave",
      steps: [
        { text: "Find the leave in the **Leave applications** tab. Click the three dots (⋮) on the row.", image: "leave/05-row-menu.jpg" },
        { text: "Click **Edit** to change the dates or type. Click **Save changes**." },
        {
          text: "Click **Cancel leave** if the person came to work after all. The days open again for attendance.",
        },
        {
          text: "**Delete** works only for a cancelled leave. Use it to remove a leave added by mistake.",
        },
      ],
    },
    {
      id: "find",
      title: "Find leaves",
      steps: [
        { text: "Type a name or ID in the search box." },
        { text: "Use **All types** to show only annual or only emergency leave." },
        { text: "Use **All statuses** to show **Active** or **Cancelled** leaves." },
      ],
    },
  ],
}
