import { History } from "lucide-react"
import type { HelpTopic } from "../types"

export const pastAttendance: HelpTopic = {
  id: "past-attendance",
  title: "Fix past attendance",
  icon: History,
  roles: ["superadmin", "admin"],
  summary:
    "Use this page to look at any past day, fix wrong times, fill days that were never marked, close open shifts, and declare a holiday.",
  whereToFind: "Sidebar → **Past Attendance**",
  overviewImage: "past-attendance/01-page.jpg",
  workflows: [
    {
      id: "find",
      title: "Find a day",
      steps: [
        {
          text: "Click the date box and pick the day. Or click the arrows ‹ › to go one day back or forward.",
          image: "past-attendance/02-date.jpg",
        },
        { text: "To see one site only, pick it in **All Sites**. Pick **Drivers** to see drivers." },
        { text: "To find one person, type their name or ID in the search box." },
      ],
    },
    {
      id: "edit",
      title: "Change a record",
      when: "Use this when a past time, job or status is wrong.",
      steps: [
        { text: "Find the person's row. Click the pencil button at the end of the row.", image: "past-attendance/03-row.jpg" },
        {
          text: "The **Edit Attendance Record** window opens. Change the site, job, **Check In** or **Check Out**.",
          image: "past-attendance/04-edit-dialog.jpg",
        },
        {
          text: "If the check-out is after midnight, turn on the next-day switch next to the time.",
          tip: "The bottom of the window shows the new **Total Work Hours** and **Overtime** before you save.",
        },
        { text: "To add a second place of work, click **Add New Session**." },
        { text: "For an absent day, you can tick **Sick Leave** or **LOP (Loss of Pay)** here." },
        { text: "Click **Save Changes**." },
      ],
      seeAlso: [{ topic: "employee-timesheet", workflow: "edit-day", label: "Change a day from the timesheet" }],
    },
    {
      id: "missing",
      title: "Fill days that were never marked (Missing)",
      when: "Use this when people have no record for a day, for example the site forgot to save.",
      steps: [
        {
          text: "Pick the day. Click **Missing**. The number shows how many people have no record.",
          image: "past-attendance/05-missing-button.jpg",
        },
        {
          text: "The list shows everyone with no record that day. Use the filters to find a site.",
          image: "past-attendance/06-missing-list.jpg",
        },
        { text: "For one person: click **Backfill** on their row. Enter the site, job and times. Click **Create Record**." },
        {
          text: "For many people with the same times: tick them, then click **Backfill selected**.",
        },
        {
          text: "In **Bulk Backfill**, pick the site and job, type **Check In** and **Check Out**, and click the **Backfill** button.",
          image: "past-attendance/07-bulk-backfill.jpg",
        },
        { text: "The result shows who was **Created** and who was **Skipped** (for example, already had a record). Click **Done**." },
      ],
      seeAlso: [{ topic: "backfill-approvals", label: "Backfills sent by supervisors" }],
    },
    {
      id: "bulk-checkout",
      title: "Close many open shifts at once",
      when: "Use this when several people checked in but nobody entered a check-out.",
      steps: [
        { text: "Pick the day. Click **Bulk check-out**." },
        { text: "Click **Select all unclosed**, or tick the people yourself." },
        { text: "Click **Check out selected**." },
        { text: "Type the check-out time. Click the **Check out** button. Click **Done**." },
      ],
    },
    {
      id: "holiday",
      title: "Make a day a holiday",
      when: "Use this for a sudden day off for everyone, for example a holiday announced by the government.",
      steps: [
        { text: "Pick the day." },
        { text: "Turn on the **Holiday** switch.", image: "past-attendance/08-holiday.jpg" },
        {
          text: "The app asks **Declare holiday?**. Click **Confirm**.",
          tip: "On a holiday, nobody loses pay. People who worked get their hours as holiday hours.",
        },
        { text: "To undo, turn the switch off and click **Confirm**." },
      ],
      seeAlso: [{ topic: "configure", workflow: "holidays", label: "Plan holidays in advance" }],
    },
    {
      id: "activity",
      title: "See all changes on a site for a day",
      steps: [
        { text: "Pick one site in **All Sites**." },
        { text: "Click **Activity**. You see every save, move and change that day, with the time and the person who did it." },
      ],
    },
    {
      id: "locked",
      title: "Why can't I change this day?",
      steps: [
        {
          text: "A day with approved leave is locked. The pencil says **On approved leave — cancel the leave grant to edit**. Change it on the **Leave** page.",
        },
        {
          text: "Future days cannot be changed. The date box does not allow them.",
        },
      ],
    },
  ],
}
