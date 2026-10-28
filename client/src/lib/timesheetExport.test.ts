import { describe, expect, test } from "vitest"
import ExcelJS from "exceljs"

import { sessionJobLabels, sessionPlaceLabel } from "@/lib/jobSplit"
import { addTimesheetSheet, recordBreakCount } from "@/lib/timesheetExport"
import type { AttendanceRecord } from "@/pages/EditPastAttendance"

const DAY = (d: number) => new Date(2026, 9, d).toISOString()
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString()

const jobs = [
  { _id: "j1", name: "Job One", jobCode: "GR-30" },
  { _id: "j2", name: "Job Two", jobCode: null },
  { _id: "j3", name: "Job Three", jobCode: "GR-32" },
]

// Minimal records — only the fields the timesheet reads.
const record = (date: number, sessions: object[], extra: object = {}) =>
  ({
    attendanceId: `a${date}`,
    date: DAY(date),
    status: "fullday",
    totalWorkHours: 8,
    overtimeHours: 0,
    holidayHours: 0,
    isHoliday: false,
    breaksTaken: null,
    remark: "",
    sessions,
    ...extra,
  }) as unknown as AttendanceRecord

const normalSession = {
  siteName: "Workshop",
  jobCode: "W-1",
  checkIn: at(1, 8),
  checkOut: at(1, 17),
  workedHours: 9,
}

const driverSession = {
  siteName: "Drivers",
  jobCode: null,
  servedSite: { _id: "s1", siteName: "Site Alpha" },
  splitJobs: jobs,
  checkIn: at(2, 8),
  checkOut: at(2, 17),
  workedHours: 9,
}

describe("jobSplit timesheet labels", () => {
  test("a plain session keeps its own site and single job", () => {
    expect(sessionPlaceLabel(normalSession, "Workshop")).toBe("Workshop")
    expect(sessionJobLabels(normalSession, "W-1")).toEqual(["W-1"])
  })

  test("a driver split shows the served site and one label per job (code, else name)", () => {
    expect(sessionPlaceLabel(driverSession, "Drivers")).toBe("Site Alpha")
    expect(sessionJobLabels(driverSession, "-")).toEqual(["GR-30", "Job Two", "GR-32"])
  })

  test("a split on global jobs reads General; a legacy pool session keeps Drivers", () => {
    const general = { servedSite: null, splitJobs: [jobs[0]] }
    expect(sessionPlaceLabel(general, "Drivers")).toBe("General")
    expect(sessionPlaceLabel({ servedSite: null, splitJobs: [] }, "Drivers")).toBe("Drivers")
  })
})

describe("recordBreakCount", () => {
  test("auto break from exact raw hours, override clamped to 0–1", () => {
    expect(recordBreakCount(record(1, [normalSession]), 8)).toBe(1)
    expect(recordBreakCount(record(1, [{ ...normalSession, checkOut: at(1, 12), workedHours: 4 }]), 8)).toBe(0)
    expect(recordBreakCount(record(1, [normalSession], { breaksTaken: 5 }), 8)).toBe(1)
    expect(recordBreakCount(record(1, [normalSession], { breaksTaken: 0 }), 8)).toBe(0)
  })

  test("sessions that sum to exactly the threshold still break (no 2dp drift)", () => {
    // 06:00–08:20, 08:20–10:40, 10:40–14:00 = exactly 8h; stored per-session hours would sum 7.99.
    const s = (ci: [number, number], co: [number, number], worked: number) => ({
      checkIn: at(1, ci[0], ci[1]),
      checkOut: at(1, co[0], co[1]),
      workedHours: worked,
    })
    const r = record(1, [s([6, 0], [8, 20], 2.33), s([8, 20], [10, 40], 2.33), s([10, 40], [14, 0], 3.33)])
    expect(recordBreakCount(r, 8)).toBe(1)
  })
})

describe("addTimesheetSheet", () => {
  const build = (records: AttendanceRecord[]) => {
    const workbook = new ExcelJS.Workbook()
    addTimesheetSheet(workbook, null, {
      name: "Test",
      employeeId: "E1",
      jobTitle: "Driver",
      records,
      month: 10,
      year: 2026,
      breakMinHours: 8,
    })
    return workbook.getWorksheet("Attendance")!
  }
  const text = (ws: ExcelJS.Worksheet, row: number, col: number) => String(ws.getRow(row).getCell(col).value ?? "")

  test("a normal employee keeps one row per session (header: Break before Total)", () => {
    const ws = build([record(1, [normalSession])])
    expect(text(ws, 8, 7)).toBe("Break")
    expect(text(ws, 8, 8)).toMatch(/Total/)
    expect(text(ws, 9, 2)).toBe("Workshop")
    expect(text(ws, 9, 3)).toBe("W-1")
    expect(text(ws, 9, 7)).toBe("1")
    expect(text(ws, 9, 8)).toBe("8")
    // The next row is already day 2 (an empty-day row), not a continuation of day 1.
    expect(text(ws, 10, 1)).toMatch(/2$/)
  })

  test("a driver's 3-job split spans 3 rows with merged site/time/hours and day cells", () => {
    const ws = build([record(2, [driverSession])])
    // Day 1 has no record (row 9); day 2 occupies rows 10–12.
    expect(text(ws, 10, 2)).toBe("Site Alpha")
    expect([10, 11, 12].map((r) => text(ws, r, 3))).toEqual(["GR-30", "Job Two", "GR-32"])

    for (const col of [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      expect(ws.getRow(11).getCell(col).master.address).toBe(ws.getRow(10).getCell(col).address)
      expect(ws.getRow(12).getCell(col).master.address).toBe(ws.getRow(10).getCell(col).address)
    }
    // The Job column is NOT merged — each job has its own cell.
    expect(ws.getRow(11).getCell(3).master.address).toBe(ws.getRow(11).getCell(3).address)
    // Day 3 starts right after.
    expect(text(ws, 13, 1)).toMatch(/3$/)
    expect(text(ws, 10, 7)).toBe("1")
  })

  test("two sessions where one is a split merge per session and per day", () => {
    const second = { ...normalSession, siteName: "Workshop", checkIn: at(2, 18), checkOut: at(2, 20), workedHours: 2 }
    const ws = build([record(2, [driverSession, second])])
    // rows 10–12 the split, row 13 the plain session; day cells span 10–13.
    expect(ws.getRow(13).getCell(1).master.address).toBe(ws.getRow(10).getCell(1).address)
    expect(text(ws, 13, 2)).toBe("Workshop")
    expect(ws.getRow(13).getCell(2).master.address).toBe(ws.getRow(13).getCell(2).address)
  })
})
