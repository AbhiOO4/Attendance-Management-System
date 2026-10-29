import { FileCheck } from "lucide-react"
import type { HelpTopic } from "../types"

export const timesheets: HelpTopic = {
  id: "timesheets",
  title: "Timesheets (approve the month)",
  icon: FileCheck,
  roles: ["superadmin", "admin"],
  summary:
    "At the end of every month, each person's timesheet must be approved. Only approved timesheets can be sent to ERPNext. This page lets you approve and download many people at once.",
  whereToFind: "Sidebar → **Timesheets**",
  overviewImage: "timesheets/01-page.jpg",
  workflows: [
    {
      id: "approve",
      title: "Approve timesheets",
      when: "Use this at the start of a new month, for the month that just ended.",
      steps: [
        {
          text: "The page opens on last month. To change it, click the month at the top, or the arrows ‹ ›.",
          image: "timesheets/02-month.jpg",
        },
        {
          text: "Pick **Pending** in the status filter to see only people not approved yet.",
          image: "timesheets/03-filter-pending.jpg",
        },
        {
          text: "Tick the people to approve. Or click **Select all** to tick everyone in the list.",
          image: "timesheets/04-select.jpg",
        },
        { text: "Click **Approve** at the top right. The number shows how many people are ticked." },
        {
          text: "A message shows how many were approved and how many were skipped.",
          tip: "A person is skipped when their month still has a problem: a missing day, an open check-out, or hours with no job. Click their name, fix the day, and approve again.",
        },
      ],
      seeAlso: [{ topic: "employee-timesheet", workflow: "flags", label: "Fix a skipped person" }],
    },
    {
      id: "status",
      title: "What the status means",
      steps: [
        { text: "**Pending**: not approved yet." },
        { text: "**Approved**: checked and ready for ERPNext. It shows who approved it." },
        {
          text: "**Revoked**: the approval was removed, by a person or because a day was changed after approval. Check it and approve again.",
        },
      ],
    },
    {
      id: "export",
      title: "Download files",
      steps: [
        { text: "Tick the people. Click **Export**.", image: "timesheets/05-export.jpg" },
        { text: "**Timesheets (.xlsx)**: one Excel timesheet for each ticked person." },
        { text: "**Monthly summary (.xlsx)**: one Excel sheet with the month's totals for all ticked people." },
        {
          text: "**Attendance (payroll)** and **Timesheet (job cost)** under **ERPNext import (CSV)**: files to upload to ERPNext. Only approved people are included.",
          tip: "Click **Select all approved** to tick only approved people before you download the ERPNext files.",
        },
        {
          text: "If a yellow message appears after download, some hours could not go into the file (for example, a job with no job code). Read it and fix the setting.",
        },
      ],
      seeAlso: [{ topic: "month-end", label: "Month-end checklist" }],
    },
    {
      id: "filters",
      title: "Filters",
      steps: [
        { text: "Search by name, ID or job title." },
        { text: "**All Sites**: show one site. **All Types**: show permanent or temporary people." },
        { text: "Click **Clear** to remove the filters." },
      ],
    },
  ],
}
