/**
 * Site manpower snapshot — who is on a site TODAY, broken down by trade (job title) and
 * roster category, with each person's attendance state. Powers the admin "Manpower"
 * report on the Site Detail page (GET /api/site/:siteId/manpower).
 *
 * People on the site today = the union of
 *   - the draft roster (computeExpectedDraftRoster — home members not away today, plus
 *     today's visitors, minus granted leave),
 *   - anyone whose record for today has a session at this site (post-save visitors / adds),
 *   - home members on granted (annual or emergency) leave today (so leave shows instead of
 *     vanishing).
 *
 * Status per person, from today's attendance record:
 *   leave / emergency / sick → isPaidLeave / isEmergencyLeave / isSickLeave
 *   present      → a session at this site with a check-in
 *   absent       → a session here but no check-in (includes LOP)
 *   notMarked    → no session here yet (everyone, before the site's first save)
 */
import empModel from "../models/empModel.js"
import attendanceModel from "../models/attendanceModel.js"
import AttendanceLock from "../models/lockModel.js"
import { computeExpectedDraftRoster } from "./draftRoster.js"
import { categoryForEmployee } from "./collar.js"
import { getTodayLocal } from "./timeLocal.js"

const CATEGORY_ORDER = ["foreignSkilled", "foreignStaff", "omaniSkilled", "omaniStaff"]

const emptyCounts = () => ({ roster: 0, present: 0, absent: 0, leave: 0, notMarked: 0 })

// status → the count bucket it adds to (annual, emergency and sick leave share "leave").
const BUCKET = {
  present: "present",
  absent: "absent",
  leave: "leave",
  emergency: "leave",
  sick: "leave",
  notMarked: "notMarked",
}

const nameOf = (v) => (v && typeof v === "object" ? v.name ?? null : null)

function statusFor(record, site) {
  if (!record) return "notMarked"
  if (record.isPaidLeave) return "leave"
  if (record.isEmergencyLeave) return "emergency"
  if (record.isSickLeave) return "sick"
  const here = (record.sessions || []).filter((s) => String(s.siteId) === site)
  if (!here.length) return "notMarked"
  return here.some((s) => s.checkIn || s.rawCheckIn) ? "present" : "absent"
}

export async function buildSiteManpower(siteId) {
  const site = String(siteId)
  const todayStr = getTodayLocal()
  const dayStart = new Date(todayStr)
  const dayEnd = new Date(todayStr)
  dayEnd.setUTCHours(23, 59, 59, 999)
  const today = { $gte: dayStart, $lte: dayEnd }

  const [lock, expected, homeMembers, sessionHolders] = await Promise.all([
    AttendanceLock.exists({ siteId, date: dayStart }),
    computeExpectedDraftRoster({ siteId, dateStr: todayStr }),
    empModel.find({ isActive: true, currentSite: siteId }, "_id").lean(),
    attendanceModel.find({ date: today, "sessions.siteId": siteId }, "employee").lean(),
  ])

  const onLeaveAtHome = await attendanceModel
    .find(
      {
        date: today,
        $or: [{ isPaidLeave: true }, { isEmergencyLeave: true }],
        employee: { $in: homeMembers.map((e) => e._id) },
      },
      "employee"
    )
    .lean()

  const ids = [
    ...new Set([
      ...expected.keys(),
      ...sessionHolders.map((a) => String(a.employee)),
      ...onLeaveAtHome.map((a) => String(a.employee)),
    ]),
  ]

  const [employees, records] = await Promise.all([
    empModel
      .find(
        { _id: { $in: ids } },
        "name employeeId jobTitle collarType nationality currentSite currentJob pendingTransferJobId"
      )
      .populate("currentJob", "name")
      .populate("pendingTransferJobId", "name")
      .lean(),
    attendanceModel
      .find({ employee: { $in: ids }, date: today }, "employee sessions isPaidLeave isEmergencyLeave isSickLeave")
      .populate("sessions.jobId", "name")
      .lean(),
  ])

  const recordByEmp = new Map(records.map((r) => [String(r.employee), r]))

  const rows = employees.map((emp) => {
    const record = recordByEmp.get(String(emp._id)) || null
    const isVisitor = String(emp.currentSite || "") !== site
    const sessionJob = (record?.sessions || []).find((s) => String(s.siteId) === site && s.jobId)?.jobId
    return {
      _id: String(emp._id),
      name: emp.name,
      employeeId: emp.employeeId,
      jobTitle: emp.jobTitle || "",
      category: categoryForEmployee(emp),
      status: statusFor(record, site),
      // The job they work HERE: today's session job, else a visitor's per-visit job, else
      // the home job (a visitor's currentJob belongs to their home site, so not theirs here).
      jobName: nameOf(sessionJob) ?? (isVisitor ? nameOf(emp.pendingTransferJobId) : nameOf(emp.currentJob)),
      isVisitor,
    }
  })

  rows.sort((a, b) => a.jobTitle.localeCompare(b.jobTitle) || a.name.localeCompare(b.name))

  const totals = emptyCounts()
  const tradeMap = new Map()
  const categoryMap = new Map(CATEGORY_ORDER.map((c) => [c, emptyCounts()]))

  for (const row of rows) {
    const bucket = BUCKET[row.status]
    if (!tradeMap.has(row.jobTitle)) tradeMap.set(row.jobTitle, emptyCounts())
    for (const counts of [totals, tradeMap.get(row.jobTitle), categoryMap.get(row.category)]) {
      counts.roster++
      counts[bucket]++
    }
  }

  const trades = [...tradeMap]
    .map(([jobTitle, counts]) => ({ jobTitle, ...counts }))
    .sort((a, b) => b.roster - a.roster || a.jobTitle.localeCompare(b.jobTitle))

  const categories = CATEGORY_ORDER.map((category) => ({ category, ...categoryMap.get(category) }))

  return {
    date: todayStr,
    generatedAt: new Date().toISOString(),
    attendanceSaved: !!lock,
    totals,
    trades,
    categories,
    employees: rows,
  }
}
