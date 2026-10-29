import { ClipboardCheck } from "lucide-react"
import type { HelpTopic } from "../types"

export const dailyAttendance: HelpTopic = {
  id: "daily-attendance",
  title: "Mark today's attendance",
  icon: ClipboardCheck,
  roles: ["superadmin", "admin"],
  summary:
    "Each site has one attendance sheet per day. In the morning you check who came and click **Save Attendance**. Later you add the check-out times. Supervisors do this every day for their own site. Admins can do it for any site.",
  whereToFind: "Sidebar → **Mark Attendance** → click a site",
  overviewImage: "daily-attendance/02-sheet.jpg",
  workflows: [
    {
      id: "open-sheet",
      title: "Open a site's sheet",
      steps: [
        { text: "Click **Mark Attendance** in the sidebar.", image: "daily-attendance/01-pick-site.jpg" },
        { text: "Click the site you want. Today's sheet for that site opens." },
        {
          text: "The top shows the site name, today's date, and how many people are present.",
          tip: "If today is a holiday, a coloured line at the top says **Today is a Holiday**.",
        },
      ],
    },
    {
      id: "mark",
      title: "Mark attendance in the morning and save",
      when: "Use this once a day, after the work day starts.",
      steps: [
        {
          text: "Every person on the site has one row. The **Check In** time is already filled with the site's normal start time.",
          image: "daily-attendance/03-rows.jpg",
        },
        { text: "If someone came at a different time, click the time and type the real time." },
        {
          text: "If someone did not come today, click **Absent** at the end of their row. Their time is cleared.",
          image: "daily-attendance/04-absent.jpg",
          tip: "Clicked **Absent** by mistake? Click **Undo** on the same row.",
        },
        {
          text: "Check the **Job** for each person. Click the job box to pick a different job.",
          image: "daily-attendance/05-job.jpg",
          warning: "When a site has jobs, every person who worked must have a job. You cannot save without it.",
        },
        {
          text: "Use the tabs (**Skilled Labour**, **Staff**, **Omani Labour**, **Omani Staff**) to see one group at a time. **All** shows everyone.",
        },
        {
          text: "When everything is correct, click **Save Attendance** at the top right.",
          image: "daily-attendance/06-save.jpg",
        },
        {
          text: "The button changes to **Attendance Submitted**. The sheet is now saved.",
          image: "daily-attendance/07-saved.jpg",
        },
      ],
      seeAlso: [{ topic: "daily-attendance", workflow: "check-out", label: "Add check-out times" }],
    },
    {
      id: "check-out",
      title: "Add check-out times",
      when: "Use this at the end of the day, or when someone leaves early.",
      steps: [
        {
          text: "On the saved sheet, find the person's row. Click the pencil button.",
          image: "daily-attendance/11-saved-row.jpg",
        },
        {
          text: "The row opens. Type the time in **Check Out**. Click the save button (💾). Click **✕** to cancel.",
          image: "daily-attendance/12-inline-edit.jpg",
        },
        {
          text: "The **Hours** column now shows the hours worked.",
          tip: "If nobody enters a check-out, the app fills the site's normal check-out time by itself. Change it if the person left at a different time.",
        },
      ],
    },
    {
      id: "edit-saved",
      title: "Change a finished row",
      when: "Use this when a row already has a check-out and a time or job is wrong.",
      steps: [
        { text: "Click the pencil on the row." },
        {
          text: "The **Edit Attendance** window opens. Change the times or the job.",
          image: "daily-attendance/12b-edit-dialog.jpg",
        },
        { text: "If the person worked at two places today, click **Add Session** and fill the second time." },
        { text: "Click **Save**." },
        {
          text: "If the check-out is much later than the site's normal time, the app asks for a remark. Type the reason and click **Save with remark**.",
        },
      ],
    },
    {
      id: "default-times",
      title: "Change the site's normal times",
      when: "Use this when the whole site starts or ends at a different time, for example during Ramadan.",
      steps: [
        {
          text: "The box under the site name shows the normal **Day** and **Night** times for **Skilled** and **Staff**. Click **Edit**.",
          image: "daily-attendance/08-default-times.jpg",
        },
        { text: "The **Default Shift Times** window opens. Change the times for each group." },
        { text: "Click **Save**." },
        {
          text: "If the sheet is already saved, the app asks **Update Today's Attendance Records?**. Click **Yes, Update Records** to change today's rows too, or **No, Just Save Defaults** to change only future days.",
        },
      ],
    },
    {
      id: "breaks",
      title: "Breaks",
      steps: [
        {
          text: "The **Breaks** column shows **Auto**. The app takes off one break when a person works long enough.",
          image: "daily-attendance/09-breaks.jpg",
        },
        { text: "If a person did not take a break, click **−** to make it **0**." },
        { text: "Click **+** to give back the break. Click **✕** to go back to **Auto**." },
      ],
      seeAlso: [{ topic: "configure", workflow: "hours", label: "Break length setting" }],
    },
    {
      id: "carryover",
      title: "Close yesterday's open shift",
      when: "Use this when someone checked in yesterday but nobody entered their check-out time.",
      steps: [
        {
          text: "The person's row shows a yellow **Carryover** label and a **Check out** button. You cannot fill today until yesterday is closed.",
          image: "daily-attendance/10-carryover.jpg",
          tip: "Before noon, a **Pending check-out** box at the top of the sheet also lists these people.",
        },
        { text: "Click **Check out** on their row." },
        {
          text: "The **Edit Attendance** window shows yesterday's shift. Type the time they really left in **Check Out**. Click **Save**.",
          image: "daily-attendance/10b-carryover-dialog.jpg",
        },
        { text: "Now today's row opens. Fill it as normal." },
      ],
    },
    {
      id: "sick-lop",
      title: "Mark sick leave or loss of pay",
      when: "Use this for a person who did not come today. First save the sheet with the person as absent.",
      steps: [
        { text: "On the saved sheet, find the absent person." },
        {
          text: "Click the three dots (⋮) at the end of the row. The **Actions** menu opens.",
          image: "daily-attendance/13-actions.jpg",
        },
        { text: "Click **Sick Leave** if the person is sick." },
        {
          text: "Or click **LOP (Loss of Pay)** if the person was absent without a good reason. The day is not paid.",
          warning: "These work only when the person has no check-in today.",
        },
        { text: "A tick (✓) shows next to the chosen item. Click it again to remove it." },
      ],
      seeAlso: [{ topic: "leave", label: "Annual and emergency leave" }],
    },
    {
      id: "transfer",
      title: "Move a person to another site during the day",
      when: "Use this when a person starts here and then goes to work at another site.",
      steps: [
        { text: "On the saved sheet, click the three dots (⋮) on the person's row. Click **Transfer**." },
        {
          text: "The row opens. Type the time they left this site in **Check Out**. Click the save button (💾).",
          image: "daily-attendance/14a-transfer-checkout.jpg",
        },
        {
          text: "The **Transfer Employee** window opens. Click the new site. Pick a job if needed.",
          image: "daily-attendance/14-transfer.jpg",
        },
        { text: "Pick **For today** (back tomorrow) or **Permanent** (stays at the new site)." },
        { text: "Click **Transfer**. Their hours are split: the first part here, the rest at the new site." },
      ],
      seeAlso: [{ topic: "site-roster", workflow: "send", label: "Send someone before they start" }],
    },
    {
      id: "history",
      title: "See who changed a row",
      steps: [
        { text: "Click the three dots (⋮) on the row, then **Record history**." },
        {
          text: "You see every change: who changed it, when, and what changed. A supervisor's remark is also shown here.",
          image: "daily-attendance/15-history.jpg",
        },
        { text: "To see all movements on the site today, click **Activity** at the top of the sheet." },
      ],
    },
    {
      id: "night-shift",
      title: "Night shift",
      when: "Use this for people who work at night and finish after midnight.",
      steps: [
        { text: "Click **Assign Night Shift** in the shift times box." },
        { text: "Tick the people who work tonight. Click the button to confirm." },
        {
          text: "Their rows use the **Night** times. A check-out after midnight is saved on the next day automatically.",
          tip: "You do not need to make a new row for the morning. One shift is one row, even when it crosses midnight.",
        },
      ],
    },
    {
      id: "messages",
      title: "Messages you may see when saving",
      steps: [
        {
          text: "**The roster changed since this page was opened**: someone added or moved people while you worked. New rows have a **New** label. Check them and click **Save Attendance** again.",
        },
        {
          text: "**Already submitted**: another person saved this sheet first. The page shows their saved sheet. Change single rows with the pencil.",
        },
        {
          text: "**Record changed**: someone else changed this row a moment ago. The page loads the new times. Make your change again.",
        },
        { text: "**On leave today**: these people have approved leave. They are not on the sheet and you cannot change their day." },
      ],
    },
  ],
}
