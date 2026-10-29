import { FileClock } from "lucide-react"
import type { HelpTopic } from "../types"

export const backfillApprovals: HelpTopic = {
  id: "backfill-approvals",
  title: "Approve supervisor backfills",
  icon: FileClock,
  roles: ["superadmin", "admin"],
  summary:
    "When a supervisor forgot to mark a day, they can fill it and send it to you. Nothing is saved until an admin approves it. You can check it, change it, approve it, or send it back.",
  whereToFind: "Sidebar → **Past Attendance** → **Backfill approvals** (the red number shows how many are waiting)",
  overviewImage: "backfill-approvals/01-list.jpg",
  workflows: [
    {
      id: "approve",
      title: "Check and approve a backfill",
      when: "Use this when **Past Attendance** in the sidebar has a red number.",
      steps: [
        { text: "Click **Past Attendance** in the sidebar. Click **Backfill approvals**." },
        { text: "The **Awaiting approval** tab lists backfills waiting for you. Click one to open it." },
        {
          text: "Check each person: the times, the job and the hours.",
          image: "backfill-approvals/02-detail.jpg",
          tip: "**Not on your site now** means the person has since moved to another site. Check that they really worked here that day.",
        },
        { text: "To change a row, click the three dots (⋮) on it, then **Edit sessions**. Fix the times or job and click **Save row**." },
        { text: "To take a person out of the backfill, click the three dots (⋮), then **Remove**." },
        {
          text: "When all rows are correct, click **Approve**. The app asks **Approve this backfill?**. Click **Approve** again.",
          image: "backfill-approvals/03-approve.jpg",
        },
        {
          text: "The records are created. Each row shows **Added** or **Skipped** (for example, someone already has a record that day).",
        },
      ],
    },
    {
      id: "send-back",
      title: "Send a backfill back to the supervisor",
      when: "Use this when something is wrong and the supervisor should fix it.",
      steps: [
        { text: "Open the backfill. Click **Send back**." },
        {
          text: "In **Say what needs fixing**, type what is wrong. For example: Ravi left at 3 PM, not 5 PM.",
        },
        { text: "Click **Send back**. The supervisor gets a message and can fix it and send it again." },
      ],
    },
    {
      id: "tabs",
      title: "The tabs",
      steps: [
        { text: "**Awaiting approval**: waiting for you." },
        { text: "**Approved**: already approved. Open one to see what was added." },
        { text: "**Sent back**: sent back to the supervisor, waiting for their fix." },
        { text: "**Drafts**: the supervisor started but has not sent yet. You can only look." },
        { text: "Use **All sites**, **From date** and **To date** to filter the list." },
      ],
    },
  ],
}
