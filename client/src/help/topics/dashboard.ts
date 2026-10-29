import { LayoutDashboard } from "lucide-react"
import type { HelpTopic } from "../types"

export const dashboard: HelpTopic = {
  id: "dashboard",
  title: "Dashboard",
  icon: LayoutDashboard,
  roles: ["superadmin", "admin"],
  summary:
    "The Dashboard is the first page after you log in. It shows how many people worked today, the hours worked, and which sites were busy.",
  whereToFind: "Sidebar → **Dashboard**",
  overviewImage: "dashboard/01-overview.jpg",
  workflows: [
    {
      id: "read",
      title: "Read the Dashboard",
      when: "Use this every morning to see the day at a glance.",
      steps: [
        {
          text: "The four boxes at the top show today's numbers.",
          image: "dashboard/02-cards.jpg",
        },
        { text: "**Present Employees**: people who checked in today, out of all active employees." },
        { text: "**Attendance Percentage**: the same number as a percent." },
        { text: "**Total Man Hours**: all hours worked today by everyone together." },
        { text: "**Active Sites Worked**: how many sites had people working today." },
        {
          text: "**Today's Site Activity** lists the sites. The site with the most hours is first.",
          image: "dashboard/03-site-activity.jpg",
        },
      ],
    },
    {
      id: "other-day",
      title: "See another day",
      when: "Use this to look at the numbers for a past day.",
      steps: [
        { text: "Click the date box at the top right.", image: "dashboard/04-date.jpg" },
        { text: "Pick the day you want. The numbers change to that day." },
      ],
    },
    {
      id: "sites-overview",
      title: "Open a site from the Dashboard",
      steps: [
        {
          text: "Scroll down to **Sites Overview**. Click **In Progress** for running sites, or **Completed** for finished sites.",
          image: "dashboard/05-sites-overview.jpg",
        },
        { text: "Each card shows the site's total **Hours**, **Man Days** and number of **Jobs**." },
        { text: "Click a card to open that site's page.", tip: "Click **Load More** at the bottom to see more sites." },
      ],
      seeAlso: [{ topic: "sites", workflow: "site-page", label: "The site page" }],
    },
  ],
}
