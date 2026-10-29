import { Users } from "lucide-react"
import type { HelpTopic } from "../types"

export const employees: HelpTopic = {
  id: "employees",
  title: "Employees",
  icon: Users,
  roles: ["superadmin", "admin"],
  summary:
    "The list of all workers and staff. Here you add a new employee, change their details, and remove people who left.",
  whereToFind: "Sidebar → **Employees**",
  overviewImage: "employees/01-list.jpg",
  workflows: [
    {
      id: "add",
      title: "Add a new employee",
      when: "Use this when a new person joins the company.",
      steps: [
        { text: "Click **Add Employee** at the top right.", image: "employees/02-add-button.jpg" },
        { text: "Type the full **Name**.", image: "employees/03-add-form.jpg" },
        { text: "Type the **Employee ID**. Every employee must have a different ID." },
        {
          text: "Type the **Company ID** if the person has one, for example NGDP-105. You can leave it empty.",
        },
        {
          text: "Pick the **Job Title**. The job title decides if the person is a labourer or staff.",
          tip: "Job title missing from the list? Add it on the **Configure** page first.",
        },
        { text: "Pick **Permanent** or **Temporary** in **Employment Type**." },
        { text: "Pick **Foreign** or **Omani** in **Nationality**." },
        { text: "Click **Add Employee**." },
        {
          text: "The new employee has no site yet. Add them to a site from the site's page.",
        },
      ],
      seeAlso: [
        { topic: "site-roster", workflow: "add", label: "Add the person to a site" },
        { topic: "configure", workflow: "job-titles", label: "Add a job title" },
      ],
    },
    {
      id: "find",
      title: "Find an employee",
      steps: [
        { text: "Type a name, ID or job title in the search box.", image: "employees/04-filters.jpg" },
        { text: "Use the filters to show one site, **Active** or **Deactivated** people, or **Permanent** or **Temporary** people." },
        { text: "Pick **Not assigned** in the site filter to see people with no site." },
        { text: "Click **Clear** to remove all filters." },
        { text: "Click a person's name to open their timesheet." },
      ],
      seeAlso: [{ topic: "employee-timesheet", label: "The employee timesheet" }],
    },
    {
      id: "edit",
      title: "Change an employee's details",
      steps: [
        { text: "Find the person. Click the three dots (⋮) at the end of the row.", image: "employees/05-row-menu.jpg" },
        { text: "Click **Edit**." },
        { text: "Change the details. Click **Save Changes**." },
      ],
    },
    {
      id: "remove",
      title: "Remove an employee who left",
      steps: [
        { text: "Click the three dots (⋮) on the row. Click **Delete**." },
        {
          text: "Click **Deactivate**. The person is hidden but their past attendance is kept. This is the normal choice.",
          image: "employees/06-delete-dialog.jpg",
        },
        {
          text: "**Permanently delete** removes the person forever. It only works for a person with no attendance at all, for example someone added by mistake.",
          warning: "Permanently delete cannot be undone.",
        },
        {
          text: "To bring back a deactivated person, pick **Deactivated** in the status filter and click **Restore**.",
        },
      ],
    },
  ],
}
