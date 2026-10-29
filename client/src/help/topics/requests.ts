import { Inbox } from "lucide-react"
import type { HelpTopic } from "../types"

export const requests: HelpTopic = {
  id: "requests",
  title: "Requests and messages",
  icon: Inbox,
  roles: ["superadmin", "admin"],
  summary:
    "When a supervisor wants a worker from another site, they send a request. Admins can see and decide every request. This page also shows messages from the app, for example a backfill waiting for approval.",
  whereToFind: "Sidebar → **Requests** (the red number shows how many new items are waiting)",
  overviewImage: "requests/01-incoming.jpg",
  workflows: [
    {
      id: "decide",
      title: "Accept or reject a request",
      when: "Use this when **Requests** in the sidebar has a red number.",
      steps: [
        { text: "Click **Requests** in the sidebar. The **Incoming** tab opens." },
        {
          text: "Each card says who is asked for, from which site, to which site, and if it is **For today** or **Permanent**.",
          image: "requests/02-card.jpg",
        },
        { text: "To agree, click **Accept**. For a permanent move the button says **Confirm permanent move**." },
        {
          text: "If the worker already checked in at their old site today, the app asks **How should today be handled?**",
        },
        { text: "Pick **Didn't work here** if the whole day belongs to the new site." },
        { text: "Pick **Worked here until** and type the time if they worked part of the day at the old site." },
        {
          text: "To say no, click **Reject**. You can type a reason. The supervisor will see it. Click **Reject request**.",
        },
      ],
    },
    {
      id: "tabs",
      title: "The three tabs",
      steps: [
        { text: "**Incoming**: requests waiting for a decision." },
        { text: "**Sent**: requests you sent. Click **Cancel** to take one back before it is decided." },
        {
          text: "**Activity**: messages. For example, **Backfill to approve**. Click **Open backfill** to go to it.",
          image: "requests/03-activity.jpg",
        },
      ],
      seeAlso: [{ topic: "backfill-approvals", label: "Approve a supervisor backfill" }],
    },
  ],
}
