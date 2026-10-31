import { ShieldCheck } from "lucide-react"
import type { HelpTopic } from "../types"

export const manageUsers: HelpTopic = {
  id: "manage-users",
  title: "Manage users",
  icon: ShieldCheck,
  roles: ["superadmin"],
  summary:
    "Everyone who can log in: supervisors, driver supervisors, admins and superadmins. Here you add users, reset passwords and remove users.",
  whereToFind: "Sidebar → **Manage Users**",
  overviewImage: "manage-users/01-page.jpg",
  workflows: [
    {
      id: "roles",
      title: "Who can do what",
      steps: [
        { text: "**Supervisor**: marks attendance for their own site only." },
        { text: "**Driver Supervisor**: marks the **Drivers Attendance** sheet only." },
        { text: "**Admin**: manages sites, employees, attendance, leave and timesheets." },
        { text: "**Superadmin**: everything an admin does, plus **Manage Users**." },
      ],
    },
    {
      id: "add",
      title: "Add a user",
      steps: [
        { text: "Click **Add user**.", image: "manage-users/02-add-button.jpg" },
        { text: "Pick the **Role** first. The form changes for that role.", image: "manage-users/03-add-dialog.jpg" },
        { text: "For a supervisor, pick the **Linked employee**. Their site comes from that employee." },
        { text: "Type the **Full name** and **Email**." },
        { text: "Type a **Password** and type it again in **Confirm password**. The strength bar should be green." },
        { text: "Click the **Create** button." },
        { text: "Send the email and password to the person in a private message." },
      ],
    },
    {
      id: "edit",
      title: "Change email or reset a password",
      when: "Use this when a user forgets their password.",
      steps: [
        { text: "Find the user. Use **Search name or ID...** or **Filter by site**." },
        { text: "Click **Edit** on a supervisor row, or **Edit / Reset Password** on an admin row." },
        { text: "Change the **Email Address**, or type a **New Password** and **Confirm New Password**." },
        { text: "Click **Update User**. Send the new password to the person." },
      ],
    },
    {
      id: "promote-delete",
      title: "Promote or delete a user",
      steps: [
        { text: "To make an admin a superadmin, click **Promote** on their row and confirm." },
        {
          text: "To remove a user, click **Delete** and confirm. The person cannot log in any more. Their employee record is not deleted.",
          warning: "You cannot delete your own account.",
        },
      ],
    },
  ],
}
