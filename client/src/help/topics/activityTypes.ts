import { Tags } from "lucide-react"
import type { HelpTopic } from "../types"

export const activityTypes: HelpTopic = {
  id: "activity-types",
  title: "Activity types (rates)",
  icon: Tags,
  roles: ["superadmin", "admin"],
  summary:
    "An activity type is a rate group for ERPNext, for example Skilled Labour. Each person gets one type. ERPNext uses it to cost their hours. The app makes an overtime type for every type by itself.",
  whereToFind: "Sidebar → **Activity Types**",
  overviewImage: "activity-types/01-page.jpg",
  workflows: [
    {
      id: "create",
      title: "Make a new activity type",
      steps: [
        { text: "Click **New Activity Type**.", image: "activity-types/02-new-button.jpg" },
        { text: "Type the name exactly as in ERPNext.", image: "activity-types/03-dialog.jpg" },
        { text: "Type the **Costing** rate and the **Billing** rate per hour." },
        {
          text: "Click **Create**. The overtime type is made by itself, named like **Skilled Labour - Overtime**.",
          tip: "Overtime rates = normal rates × the **Overtime Activity Multiplier** on the **Configure** page.",
        },
      ],
    },
    {
      id: "rates",
      title: "Change rates or delete a type",
      steps: [
        { text: "Click the edit button on the type's row. Change the rates. Click **Save Rates**." },
        { text: "The name cannot be changed, because ERPNext uses it." },
        { text: "Click the delete button to remove a type. It works only when no person has this type." },
      ],
    },
    {
      id: "allocate",
      title: "Give people an activity type",
      steps: [
        { text: "Scroll to **Allocate to employees**.", image: "activity-types/04-allocate.jpg" },
        { text: "Use the search, site and type filters to find the people. **Unallocated** shows people with no type." },
        { text: "Tick the people, or click **Select all**." },
        { text: "Pick the type in **Choose activity type**. Click **Allocate to** (the number of people)." },
        { text: "To remove a type from people, tick them and click **Clear allocation**." },
        {
          text: "A change applies to the whole month in the next ERPNext file.",
          warning: "Change types at the start of a month, before the timesheets are sent.",
        },
      ],
    },
    {
      id: "erpnext",
      title: "Send the types to ERPNext",
      when: "Do this before you upload a timesheet that uses a new type.",
      steps: [
        { text: "Click **Export for ERPNext**." },
        { text: "Pick **New types (Insert New Records)** for types ERPNext does not have yet." },
        { text: "Pick **All types (Update Existing Records)** to update the rates of all types." },
        { text: "Upload the file in ERPNext → Data Import → Activity Type." },
      ],
    },
  ],
}
