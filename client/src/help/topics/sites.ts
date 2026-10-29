import { Building2 } from "lucide-react"
import type { HelpTopic } from "../types"

export const sites: HelpTopic = {
  id: "sites",
  title: "Sites and jobs",
  icon: Building2,
  roles: ["superadmin", "admin"],
  summary:
    "A site is a place where people work, for example a building project. Each site has jobs (work orders with a job code). Here you add sites and jobs, see a site's numbers, and close a site when the work is finished.",
  whereToFind: "Sidebar → **Site**",
  overviewImage: "sites/01-list.jpg",
  workflows: [
    {
      id: "add-site",
      title: "Add a new site",
      steps: [
        { text: "Click **Site** in the sidebar. Click **Add New Site**.", image: "sites/02-add-button.jpg" },
        { text: "Type the **Site Name** and the **Location Details**.", image: "sites/03-add-dialog.jpg" },
        { text: "Click **Create Site**." },
        { text: "Next, add the site's jobs and its people." },
      ],
      seeAlso: [
        { topic: "sites", workflow: "site-jobs", label: "Add jobs" },
        { topic: "site-roster", workflow: "add", label: "Add people" },
      ],
    },
    {
      id: "site-page",
      title: "The site page",
      steps: [
        { text: "Click a site card to open the site page.", image: "sites/04-site-page.jpg" },
        { text: "The top shows the number of **Employees**, **Active Jobs** and days the site has run." },
        { text: "The **Employees** box below is the site's roster." },
        { text: "Click **Edit Location** to change the address. Click **Save Changes**." },
      ],
      seeAlso: [{ topic: "site-roster", label: "Site workers (roster)" }],
    },
    {
      id: "manpower",
      title: "Today's headcount (Manpower)",
      when: "Use this to see how many people of each trade are at the site today, or to send a manpower report.",
      steps: [
        { text: "On the site page, click **Manpower**." },
        {
          text: "The window shows today's people by trade (job title) and by group, with present, absent, leave and not marked.",
          image: "sites/05-manpower.jpg",
        },
        { text: "Click **Export Excel** or **Export PDF** to download it. Click **Refresh** to load the latest numbers." },
      ],
    },
    {
      id: "site-jobs",
      title: "Add and manage a site's jobs",
      steps: [
        { text: "On the site page, click **Manage →** next to **Active Jobs**." },
        { text: "Click **Add Job**. Type the **Job Name** and the **Job Code**.", image: "sites/06-add-job.jpg" },
        {
          text: "Click **Create Job**.",
          tip: "The job code must be the same as the Job Order in ERPNext. Use letters, numbers and hyphens only, for example SVP-101.",
        },
        { text: "When a job is finished, click **Complete**. Click **Reopen** to start it again." },
        { text: "Click **Deactivate** to stop a job for a while. Click **Reactivate** to use it again." },
      ],
    },
    {
      id: "global-jobs",
      title: "Global jobs (for all sites)",
      when: "Use this for work that does not belong to one site, for example general expenses or drivers' office trips.",
      steps: [
        { text: "On the **Site** page, click **Global Jobs**." },
        { text: "Click **Add Global Job**. Type the **Job Name** and **Job Code**. Click **Create Job**.", image: "sites/07-global-jobs.jpg" },
        { text: "A global job can be picked on every site's attendance sheet." },
      ],
    },
    {
      id: "finish-site",
      title: "Finish, stop or delete a site",
      steps: [
        { text: "**Complete Site**: the work is finished. The site moves to the **Completed** list. Click **Reopen Site** to open it again." },
        { text: "**Deactivate Site**: stop the site for now. It is hidden from **Mark Attendance**. Click **Re-Activate Site** to use it again." },
        {
          text: "**Delete Site**: remove the site. Everyone on it loses their site, and its jobs are removed.",
          warning: "Read the warning in the window before you click **Confirm Delete**. You cannot delete the permanent site (Workshop).",
        },
      ],
    },
    {
      id: "find-site",
      title: "Find a site",
      steps: [
        { text: "Type in **Search by site name...**." },
        { text: "Click **Show active sites only** to hide stopped sites." },
      ],
    },
  ],
}
