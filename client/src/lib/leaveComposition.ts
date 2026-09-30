// The four kinds of leave in a "leave composition" — shown per employee on the
// Monthly Report and on the employee timesheet. The colors match the per-day Status
// badges on the timesheet (EmployeeDetailAttendance), so a kind reads the same
// everywhere. Annual leave is paid; the other three are unpaid.

export type LeaveKind = "annual" | "emergency" | "sick" | "lop"

export type LeaveCounts = Record<LeaveKind, number>

export const LEAVE_KINDS: {
  key: LeaveKind
  /** Full name, e.g. for an Excel column. */
  label: string
  /** Kind name without "Leave", for a legend. */
  name: string
  /** Compact name for a table header. */
  short: string
  /** Text color for a count. */
  text: string
  /** Background color for a legend dot. */
  dot: string
}[] = [
  {
    key: "annual",
    label: "Annual Leave",
    name: "Annual",
    short: "Annual",
    text: "text-violet-700 dark:text-violet-400",
    dot: "bg-violet-500",
  },
  {
    key: "emergency",
    label: "Emergency Leave",
    name: "Emergency",
    short: "Emerg.",
    text: "text-orange-700 dark:text-orange-400",
    dot: "bg-orange-500",
  },
  {
    key: "sick",
    label: "Sick Leave",
    name: "Sick",
    short: "Sick",
    text: "text-sky-700 dark:text-sky-400",
    dot: "bg-sky-500",
  },
  {
    key: "lop",
    label: "LOP",
    name: "LOP",
    short: "LOP",
    text: "text-rose-700 dark:text-rose-400",
    dot: "bg-rose-500",
  },
]

export const emptyLeaveCounts = (): LeaveCounts => ({
  annual: 0,
  emergency: 0,
  sick: 0,
  lop: 0,
})

/** The leave kind behind a timesheet Status (from getDisplayStatus), or null. */
export function leaveKindOf(displayStatus: string): LeaveKind | null {
  switch (displayStatus) {
    case "leave":
      return "annual"
    case "emergency":
      return "emergency"
    case "sick":
      return "sick"
    case "lop":
      return "lop"
    default:
      return null
  }
}
