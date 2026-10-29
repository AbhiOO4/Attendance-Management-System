import { UserPlus } from "lucide-react"
import type { HelpTopic } from "../types"

export const supervisors: HelpTopic = {
  id: "supervisors",
  title: "Add a supervisor",
  icon: UserPlus,
  roles: ["superadmin", "admin"],
  summary:
    "A supervisor marks attendance for their own site from their phone. You make a supervisor from an existing employee. The supervisor's site is always the site where that employee works.",
  whereToFind: "Sidebar → **Add Supervisors**",
  overviewImage: "supervisors/01-page.jpg",
  workflows: [
    {
      id: "create",
      title: "Make an employee a supervisor",
      when: "Use this for a foreman or engineer who will mark attendance for a site.",
      steps: [
        {
          text: "First make sure the employee is on the right site. The supervisor will see that site only.",
        },
        { text: "Click **Add Supervisors** in the sidebar. The **Add supervisor** tab opens." },
        { text: "Find the employee. Use **Search name**, **Employee ID** or **Job title**." },
        { text: "Click the **+** button on their row.", image: "supervisors/02-plus.jpg" },
        { text: "Type the supervisor's **Email**.", image: "supervisors/03-create.jpg" },
        { text: "Click **Generate** to make a **Temporary password**. Or type one yourself." },
        { text: "Click **Create account**." },
        {
          text: "The **Account created** screen shows the email and password. Click **Copy both** and send them to the supervisor. Click **Done**.",
          warning: "This is the only time the password is shown. Copy it before you click Done.",
        },
      ],
      seeAlso: [{ topic: "manage-users", workflow: "edit", label: "Reset a password (superadmin)" }],
    },
    {
      id: "current",
      title: "See current supervisors",
      steps: [
        { text: "Click the **Current** tab. It lists every supervisor and their **Current site**." },
        { text: "A superadmin can remove a supervisor with **Remove**. Admins cannot." },
      ],
    },
    {
      id: "change-site",
      title: "Give a supervisor a different site",
      steps: [
        { text: "Move the supervisor's employee to the new site permanently (from the site roster, **Send to site** → **Permanent**)." },
        { text: "The supervisor's site changes to the new site by itself." },
      ],
      seeAlso: [{ topic: "site-roster", workflow: "send", label: "Send to site" }],
    },
  ],
}
