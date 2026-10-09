// Labels and colors for the payroll day buckets shown on the Monthly Report and the
// employee timesheet: annual leave (PAID, never an absence) and the composition of
// ABSENT days (all unpaid — what ERPNext receives as "Absent"). The colors match the
// per-day Status badges on the timesheet (EmployeeDetailAttendance), so a kind reads
// the same everywhere. Which bucket a record lands in: lib/payrollDay.ts.

import type { AbsentReason } from "@/lib/payrollDay"

interface DayKindStyle {
  /** Full name, e.g. for an Excel column. */
  label: string
  /** Short name for a legend or breakdown list. */
  name: string
  /** Compact name for a table header. */
  short: string
  /** Text color for a count. */
  text: string
  /** Background color for a legend dot. */
  dot: string
}

/** Annual leave — paid, kept apart from the absent days. */
export const ANNUAL_LEAVE: DayKindStyle = {
  label: "Annual Leave",
  name: "Annual",
  short: "Annual",
  text: "text-violet-700 dark:text-violet-400",
  dot: "bg-violet-500",
}

export type AbsentCounts = Record<AbsentReason, number>

/** The reasons an absent day was recorded with, in display order. */
export const ABSENT_REASONS: ({ key: AbsentReason } & DayKindStyle)[] = [
  {
    key: "none",
    label: "Absent (no reason)",
    name: "No reason",
    short: "None",
    text: "text-destructive",
    dot: "bg-destructive",
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

export const emptyAbsentCounts = (): AbsentCounts => ({
  none: 0,
  emergency: 0,
  sick: 0,
  lop: 0,
})
