import type { HelpTopic } from "./types"
import { gettingStarted } from "./topics/gettingStarted"
import { dashboard } from "./topics/dashboard"
import { sites } from "./topics/sites"
import { siteRoster } from "./topics/siteRoster"
import { dailyAttendance } from "./topics/dailyAttendance"
import { driversAttendance } from "./topics/driversAttendance"
import { pastAttendance } from "./topics/pastAttendance"
import { backfillApprovals } from "./topics/backfillApprovals"
import { employees } from "./topics/employees"
import { employeeTimesheet } from "./topics/employeeTimesheet"
import { timesheets } from "./topics/timesheets"
import { leave } from "./topics/leave"
import { requests } from "./topics/requests"
import { supervisors } from "./topics/supervisors"
import { configure } from "./topics/configure"
import { reports } from "./topics/reports"
import { activityTypes } from "./topics/activityTypes"
import { manageUsers } from "./topics/manageUsers"
import { monthEnd } from "./topics/monthEnd"
import { glossary } from "./topics/glossary"

/** Chapters grouped for the Help home page, in reading order. */
export const HELP_GROUPS: { title: string; topics: HelpTopic[] }[] = [
  { title: "Start here", topics: [gettingStarted, dashboard, glossary] },
  { title: "Every day", topics: [dailyAttendance, driversAttendance, requests, siteRoster] },
  { title: "Fixing past days", topics: [pastAttendance, backfillApprovals] },
  { title: "People and leave", topics: [employees, employeeTimesheet, leave, supervisors] },
  { title: "Month end", topics: [monthEnd, timesheets, reports] },
  { title: "Sites and settings", topics: [sites, configure, activityTypes, manageUsers] },
]

export const HELP_TOPICS: HelpTopic[] = HELP_GROUPS.flatMap((g) => g.topics)

export function findTopic(id: string | undefined): HelpTopic | undefined {
  return HELP_TOPICS.find((t) => t.id === id)
}

export function canReadTopic(topic: HelpTopic, role: string | undefined): boolean {
  return !!role && (topic.roles as string[]).includes(role)
}
