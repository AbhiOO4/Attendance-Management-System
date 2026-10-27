// The client mirrors of the server's payroll math, run against the SAME golden fixtures as
// the server suite (server/test/fixtures/parity/*.json). A mirror that drifts from the
// server fails here; a fixture change must pass on both sides.
import { describe, expect, test } from "vitest"
import dayTotals from "../../../server/test/fixtures/parity/day-totals.json"
import rawHours from "../../../server/test/fixtures/parity/raw-hours.json"
import payrollDay from "../../../server/test/fixtures/parity/payroll-day.json"
import {
  computeAttendanceTotals,
  sumRawHours,
  resolveBreakMinHours,
  computeAutoBreaks,
  clampBreaks,
  MAX_BREAKS_PER_DAY,
  type DayMathConfig,
} from "@/lib/attendanceUtils"
import { classifyPayrollDay, paymentDaysOf } from "@/lib/payrollDay"
import { previewDay } from "@/lib/backfillRequests"

type TotalsCase = (typeof dayTotals.cases)[number] & {
  breaksTaken?: number
  isHoliday?: boolean
  config?: Partial<DayMathConfig>
}

describe("computeAttendanceTotals mirror — golden cases", () => {
  for (const c of dayTotals.cases as TotalsCase[]) {
    test(c.name, () => {
      const cfg = { ...dayTotals.defaultConfig, ...(c.config ?? {}) } as DayMathConfig
      expect(computeAttendanceTotals(c.rawHours, cfg, c.breaksTaken ?? null, !!c.isHoliday)).toEqual(c.expected)
    })
  }
})

describe("sumRawHours mirror — golden cases", () => {
  for (const c of rawHours.cases) {
    test(c.name, () => expect(sumRawHours(c.sessions)).toBe(c.expected))
  }
})

describe("classifyPayrollDay mirror — golden cases", () => {
  for (const c of payrollDay.cases) {
    test(c.name, () => expect(classifyPayrollDay(c.record)).toEqual(c.expected))
  }
})

describe("break helpers mirror the server", () => {
  test("resolveBreakMinHours falls back to fullDayHours, then 0 (like the server)", () => {
    expect(resolveBreakMinHours({ breakMinHours: 6, fullDayHours: 8 })).toBe(6)
    expect(resolveBreakMinHours({ breakMinHours: null, fullDayHours: 8 })).toBe(8)
    expect(resolveBreakMinHours(null)).toBe(0)
  })
  test("one break at most", () => {
    expect(MAX_BREAKS_PER_DAY).toBe(1)
    expect(computeAutoBreaks(30, 8)).toBe(1)
    expect(clampBreaks(2)).toBe(1)
    expect(clampBreaks(-1)).toBe(0)
    expect(clampBreaks(null)).toBe(null)
  })
})

describe("paymentDaysOf", () => {
  test("working − absent − ½ × half, floored at 0", () => {
    expect(paymentDaysOf(30, 4, 2)).toBe(25)
    expect(paymentDaysOf(30, 31, 0)).toBe(0)
  })
})

describe("previewDay (supervisor backfill-request preview)", () => {
  const cfg = { ...dayTotals.defaultConfig } as never
  const s = (checkIn: string, checkOut: string, checkInNextDay = false, checkOutNextDay = false) => ({
    jobId: null,
    checkIn,
    checkOut,
    checkInNextDay,
    checkOutNextDay,
  })

  test("3 back-to-back sessions of exactly 8h preview as a FULL day (rounding regression)", () => {
    const p = previewDay([s("06:00", "08:20"), s("08:20", "10:40"), s("10:40", "14:00")] as never, null, cfg)
    expect(p).toMatchObject({ rawHours: 8, breaks: 1, netHours: 7, status: "fullday", overtimeHours: 0 })
  })

  test("a holiday credits holiday hours and no OT", () => {
    const p = previewDay([s("06:00", "18:00")] as never, null, cfg, "weekly")
    expect(p).toMatchObject({ netHours: 11, overtimeHours: 0, holidayHours: 11 })
  })

  test("a night shift and a clamped legacy override", () => {
    const p = previewDay([s("19:00", "07:00", false, true)] as never, 2, cfg)
    expect(p).toMatchObject({ rawHours: 12, breaks: 1, netHours: 11, overtimeHours: 3, isNight: true })
  })
})
