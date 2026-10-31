import { Settings } from "lucide-react"
import type { HelpTopic } from "../types"

export const configure: HelpTopic = {
  id: "configure",
  title: "Configure (settings)",
  icon: Settings,
  roles: ["superadmin", "admin"],
  summary:
    "The rules the whole app uses: working hours, breaks, overtime, weekly off days, holidays, job titles and the ERPNext labels. Change these carefully. They affect everyone.",
  whereToFind: "Sidebar → **Configure**",
  overviewImage: "configure/01-page.jpg",
  workflows: [
    {
      id: "save",
      title: "How to change a setting",
      steps: [
        { text: "Click a section name to open it. For example **Working Hours & Breaks**.", image: "configure/02-section.jpg" },
        { text: "Change the value." },
        { text: "Click **Save Changes** in that section. Click **Discard** to forget your change." },
        {
          text: "A new setting is used for new and changed records. Old saved days keep their old hours.",
          warning: "Do not change working hours in the middle of a month unless you must. Ask your superadmin first.",
        },
      ],
    },
    {
      id: "hours",
      title: "Working Hours & Breaks",
      steps: [
        { text: "**Full Day Hours**: the hours needed for a full day. Less than this is a half day." },
        { text: "**Half Day Hours**: the hours needed for a half day. Less than this is absent." },
        { text: "**Overtime Threshold**: hours after this number are overtime." },
        { text: "**Break Duration (min)**: the length of the one daily break, in minutes. 0 means no break." },
        { text: "**Break After (hours)**: the break is taken off only when a person works this many hours or more." },
      ],
    },
    {
      id: "weekly-off",
      title: "Weekly Off Days",
      steps: [
        { text: "Tick the days that are off every week, for example **Friday**." },
        { text: "People who work on an off day get their hours as holiday hours." },
      ],
    },
    {
      id: "checkout-rules",
      title: "Check-out Rules",
      steps: [
        { text: "**Check-out Reminder Time**: when the app sends a reminder about people with no check-out." },
        {
          text: "**Check-out Remark Grace (min)**: if a check-out is later than the site's normal time by more than this, a remark is needed.",
        },
      ],
    },
    {
      id: "lop",
      title: "Loss of Pay",
      steps: [{ text: "**LOP Deduction Amount (OMR)**: the amount written in the remark of an LOP day, for example **Deduct 10 OMR**." }],
    },
    {
      id: "backfill-window",
      title: "Supervisor Backfill",
      steps: [
        { text: "**Backfill Window (days)**: how many past days a supervisor can fill and send to you. For example 3 means the last 3 days." },
      ],
      seeAlso: [{ topic: "backfill-approvals", label: "Approve supervisor backfills" }],
    },
    {
      id: "erpnext",
      title: "ERPNext Export",
      when: "These must match the names in ERPNext exactly. Ask your accounts team if you are not sure.",
      steps: [
        { text: "**ERPNext Company Name**: your company name as written in ERPNext." },
        { text: "**ERPNext Activity Type** and **ERPNext Overtime Activity Type**: used on timesheets for people with no activity type." },
        { text: "**ERPNext Overtime Type** and **ERPNext Paid Leave Type**: used in the attendance file." },
        {
          text: "**Consider Unmarked Attendance As**: what a day with no record means. **Absent** = not paid. **Present** = paid.",
        },
        { text: "**Overtime Activity Multiplier**: overtime rate = normal rate × this number. For example 1.25." },
      ],
      seeAlso: [{ topic: "activity-types", label: "Activity types" }],
    },
    {
      id: "job-titles",
      title: "Job Titles",
      steps: [
        { text: "Open **Job Titles**. Type the new title in the box **Enter job title**.", image: "configure/03-job-titles.jpg" },
        { text: "Pick **Skilled Labour** (works with tools) or **Staff** (office, engineer, foreman)." },
        { text: "Click **Add**." },
        { text: "To change a title's group, click **Skilled** or **Staff** on its row." },
        { text: "To remove a title, click the red **×** next to it and confirm." },
      ],
    },
    {
      id: "holidays",
      title: "Custom Holidays",
      when: "Use this to plan public holidays in advance.",
      steps: [
        { text: "Open **Custom Holidays**.", image: "configure/04-holidays.jpg" },
        { text: "Pick the **Date**. Type the **Reason**, for example National Day." },
        { text: "Click **Add Holiday**." },
        { text: "To remove a holiday, click **Delete** on its row and confirm." },
      ],
      seeAlso: [{ topic: "past-attendance", workflow: "holiday", label: "Declare a holiday for a past day" }],
    },
  ],
}
