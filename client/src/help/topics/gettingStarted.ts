import { Rocket } from "lucide-react"
import type { HelpTopic } from "../types"

export const gettingStarted: HelpTopic = {
  id: "getting-started",
  title: "Getting started",
  icon: Rocket,
  roles: ["superadmin", "admin"],
  summary:
    "How to log in, how to move around the app, and the buttons you see on every page. Read this first.",
  workflows: [
    {
      id: "log-in",
      title: "Log in",
      when: "Use this when you open the app and it asks for your email and password.",
      steps: [
        { text: "Open the app on your phone or computer. Click **Sign In**.", image: "getting-started/01-landing.jpg" },
        { text: "Type your email in **Email Address**.", image: "getting-started/02-login.jpg" },
        {
          text: "Type your password in **Password**. Click the eye icon to see what you typed.",
          tip: "Your password is given to you by a superadmin. Do not share it with anyone.",
        },
        { text: "Click **Login**. The **Dashboard** opens." },
      ],
    },
    {
      id: "sidebar",
      title: "Move around the app (the sidebar)",
      when: "Use this to find any page. The list on the left side is called the sidebar.",
      steps: [
        {
          text: "Look at the sidebar on the left. Click a name to open that page.",
          image: "getting-started/03-sidebar.jpg",
        },
        {
          text: "A red number next to a name means something is waiting for you. For example, **Requests** with a **2** means two new requests.",
          image: "getting-started/04-badges.jpg",
        },
        {
          text: "To make the sidebar small, click the small panel button at the top of the sidebar. Click it again to make it big.",
          image: "getting-started/05-collapse.jpg",
          tip: "When the sidebar is small, only the icons show. Point at an icon to see its name.",
        },
        {
          text: "On a phone, the sidebar is hidden. Click the three lines (☰) at the top left to open it.",
          image: "getting-started/06-mobile-menu.jpg",
        },
      ],
      seeAlso: [{ topic: "glossary", label: "Words used in the app" }],
    },
    {
      id: "page-help",
      title: "Get help on any page",
      when: "Use this when you are on a page and you are not sure what to do.",
      steps: [
        {
          text: "Look for the round **?** button at the top of the page. Click it.",
          image: "getting-started/07-help-button.jpg",
        },
        { text: "The guide for that page opens in a window. Your work on the page stays as it is." },
        { text: "To see all guides, click **Help** in the sidebar." },
        {
          text: "In **Help**, type what you want to do in the search box. For example: **approve timesheet**.",
          image: "getting-started/08-help-search.jpg",
        },
      ],
    },
    {
      id: "install",
      title: "Put the app on your phone home screen",
      when: "Use this so the app opens like a normal phone app, with one tap.",
      steps: [
        { text: "Open the app address in your phone browser (Chrome on Android, Safari on iPhone)." },
        { text: "On the first page, click **Download App**. A window shows the steps for your phone." },
        { text: "Android: click the browser menu (⋮), then **Install app** or **Add to Home screen**." },
        { text: "iPhone: click the Share button (□↑), then **Add to Home Screen**, then **Add**." },
        { text: "Open the app from the new icon on your home screen." },
      ],
    },
    {
      id: "reminders",
      title: "Turn on check-out reminders",
      when: "Use this to get a phone message when someone has checked in but nobody checked them out.",
      steps: [
        {
          text: "At the bottom of the sidebar, click **Enable reminders**.",
          image: "getting-started/09-bottom-buttons.jpg",
        },
        { text: "Your phone or browser asks for permission. Click **Allow**." },
        { text: "The button now says **Reminders on**." },
      ],
      seeAlso: [{ topic: "configure", workflow: "checkout-rules", label: "Reminder time setting" }],
    },
    {
      id: "theme-logout",
      title: "Dark mode and log out",
      steps: [
        { text: "To change the colours, click **Dark Mode** at the bottom of the sidebar. Click **Light Mode** to change back." },
        { text: "To leave the app, click **Logout**." },
        { text: "A window asks **Are you sure you want to logout?**. Click **Yes, Logout**.", image: "getting-started/10-logout.jpg" },
      ],
    },
  ],
}
