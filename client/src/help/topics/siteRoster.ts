import { Users } from "lucide-react"
import type { HelpTopic } from "../types"

export const siteRoster: HelpTopic = {
  id: "site-roster",
  title: "Site workers (roster)",
  icon: Users,
  roles: ["superadmin", "admin"],
  summary:
    "The roster is the list of people who work at a site. People on the roster appear on that site's attendance sheet. Here you add people, send them to another site, remove them and give them a job.",
  whereToFind: "Sidebar → **Site** → click a site → **Employees** box",
  overviewImage: "site-roster/01-roster.jpg",
  workflows: [
    {
      id: "today-tomorrow",
      title: "Today and Tomorrow tabs",
      steps: [
        {
          text: "**Today** shows who is on the site today. Changes here start now.",
          image: "site-roster/02-tabs.jpg",
        },
        {
          text: "**Tomorrow** shows who will be on the site tomorrow. Use it to plan. Changes here start tomorrow morning.",
          tip: "Click the small **i** icon next to the tabs to read what the Tomorrow tab does.",
        },
      ],
    },
    {
      id: "add",
      title: "Add people to the site",
      when: "Use this for a new worker, or a worker with no site.",
      steps: [
        {
          text: "Click the three dots (⋮) at the right of the **Employees** box. The **Manage roster** menu opens. Click **Add employees**.",
          image: "site-roster/03-manage-menu.jpg",
        },
        {
          text: "Find the person. Use the search box or the site filter. Click **Add** on their row.",
          image: "site-roster/04-insta-add.jpg",
        },
        {
          text: "Pick a job in **Assign Job Role**, or **Don't assign job**.",
          image: "site-roster/05-confirm-add.jpg",
        },
        { text: "Type the **Check-in Time** for today." },
        {
          text: "Tick **Only for today** if the person comes for one day only. Leave it empty if they stay.",
        },
        { text: "Click **Confirm Add**. Or click **Schedule for Tomorrow** to add them from tomorrow." },
      ],
    },
    {
      id: "send",
      title: "Send a person to another site",
      when: "Use this before the person starts work today, or to plan tomorrow.",
      steps: [
        { text: "Find the person's row. Click **Send to site**.", image: "site-roster/06-send-button.jpg" },
        { text: "The **Send to another site** window opens. Click the new site. Pick a job if needed." },
        {
          text: "On the **Today** tab, pick **For today** (a one-day visit, back tomorrow) or **Permanent** (they move to the new site).",
          image: "site-roster/07-send-dialog.jpg",
        },
        { text: "On the **Tomorrow** tab, pick **Only tomorrow** or **Permanent from tomorrow**." },
        { text: "Click **Send**." },
        {
          text: "To undo it, click **Cancel visit** or **Cancel move** on the row.",
        },
      ],
      seeAlso: [{ topic: "daily-attendance", workflow: "transfer", label: "Move someone in the middle of the day" }],
    },
    {
      id: "remove",
      title: "Remove a person from the site",
      steps: [
        { text: "Find the person's row. Click **Remove**." },
        {
          text: "On the **Today** tab, the **Confirm Removal** window opens. Click **Remove Employee**. The person leaves the site now and has no site.",
          image: "site-roster/08-remove.jpg",
        },
        { text: "On the **Tomorrow** tab, the person gets the label **Leaving tomorrow**. Click **Undo** to keep them." },
      ],
    },
    {
      id: "jobs",
      title: "Give people a job",
      when: "Use this to set the normal job for several people at once.",
      steps: [
        { text: "Click the three dots (⋮) at the right of the **Employees** box, then **Assign jobs**. Tick boxes appear on the rows." },
        { text: "Tick the people." },
        {
          text: "Pick the job in **Assign to job...** at the top. Click **Assign**.",
          image: "site-roster/09-assign-jobs.jpg",
        },
        { text: "No job in the list? Click **Add job** to make a new one." },
        { text: "Click **Cancel** to leave without changes." },
      ],
      seeAlso: [{ topic: "sites", workflow: "site-jobs", label: "Manage a site's jobs" }],
    },
    {
      id: "hired",
      title: "Add a hired (temporary) worker",
      steps: [
        { text: "Click the three dots (⋮) at the right of the **Employees** box, then **Add hired worker**." },
        { text: "Pick the worker from the list of temporary workers, and a job if needed." },
        { text: "Click **Add Worker**." },
      ],
      seeAlso: [{ topic: "employees", workflow: "add", label: "Create a new employee" }],
    },
    {
      id: "labels",
      title: "Labels on a row",
      steps: [
        { text: "**Supervisor**: this person is the site's supervisor." },
        { text: "**Temporary**: a hired worker, not permanent staff." },
        { text: "**Visiting**: from another site, here for today only." },
        { text: "**Leaving tomorrow**: will leave the site tomorrow." },
        { text: "**New**: added to the site while the attendance page was open." },
      ],
    },
  ],
}
