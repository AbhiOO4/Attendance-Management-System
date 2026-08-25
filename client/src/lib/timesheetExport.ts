// Shared monthly time-card (timesheet) spreadsheet builder.
//
// This is the single source of truth for the "Monthly Time Card" .xlsx layout,
// used by BOTH the single-employee export (EmployeeDetailAttendance.tsx) and the
// bulk export on the Employees page. Keeping the ExcelJS layout here means the two
// exports can never drift — a bulk sheet is byte-identical to the individual one.
//
// This module is deliberately API-free: it only touches ExcelJS / file-saver. The
// caller is responsible for fetching each employee's attendance records and passing
// them in. exceljs is heavy, so page-level callers should `import()` this module
// lazily (at export time) to keep it out of their route chunk.

import ExcelJS from "exceljs"
import { saveAs } from "file-saver"

import { computeAutoBreaks } from "@/lib/attendanceUtils"
import { formatLocalTime12h } from "@/lib/dateUtils"

import type { AttendanceRecord } from "@/pages/EditPastAttendance"

// --------------------------------------------------------------------------
// Palette (print-friendly grey). Fridays get a darker shade to mark the
// weekend; alternating rows keep the two-tone look, just in grey.
// --------------------------------------------------------------------------
const HEADER_GREY = "D9D9D9"
const ROW_GREY = "EFEFEF"
const FRIDAY_GREY = "C0C0C0"
const TOTALS_GREY = "BFBFBF"

export interface TimesheetEmployeeMeta {
  name?: string | null
  employeeId?: string | null
  jobTitle?: string | null
}

interface WorkConfigLike {
  fullDayHours?: number | null
  breakDurationMinutes?: number | null
}

// --------------------------------------------------------------------------
// Pure helpers (lifted from EmployeeDetailAttendance.tsx so both exports and the
// on-screen table can share them).
// --------------------------------------------------------------------------

export const round2 = (value: number) => Math.round(value * 100) / 100

export const getDisplayStatus = (record: AttendanceRecord): string => {
  if (record.isSickLeave) {
    return "sick"
  }
  if (record.status === "absent" && record.sessions && record.sessions.length > 0) {
    const hasCheckInNoCheckOut = record.sessions.some(
      (session) => session && session.checkIn && !session.checkOut
    )
    if (hasCheckInNoCheckOut) {
      return "pending"
    }
  }
  // A holiday (weekly like Friday, or public) with no work is not an absence —
  // show it as "holiday" rather than a red "absent". Days actually worked on a
  // holiday keep their fullday/halfday status.
  if (record.isHoliday && record.status === "absent") {
    return "holiday"
  }
  return record.status
}

export interface ExportDay {
  date: Date
  record: AttendanceRecord | null
}

// Every calendar day of the selected month, with its record if one exists — days
// with no record become a date-only row in the export.
export function buildExportDays(
  records: AttendanceRecord[],
  month: number,
  year: number,
  sortOrder: "asc" | "desc" = "asc"
): ExportDay[] {
  const monthIndex = month - 1

  const byDay = new Map<number, AttendanceRecord>()

  records.forEach((record) => {
    const d = new Date(record.date)
    if (d.getFullYear() === year && d.getMonth() === monthIndex) {
      byDay.set(d.getDate(), record)
    }
  })

  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()

  const days = Array.from({ length: daysInMonth }, (_, i) => ({
    date: new Date(year, monthIndex, i + 1),
    record: byDay.get(i + 1) || null,
  }))

  return sortOrder === "asc" ? days : days.reverse()
}

export interface TimesheetTotals {
  totalHours: number
  otHours: number
  holidayHours: number
  daysPresent: number
  daysAbsent: number
}

export function computeTimesheetTotals(records: AttendanceRecord[]): TimesheetTotals {
  return records.reduce(
    (acc, record) => {
      acc.totalHours += record.totalWorkHours || 0
      acc.otHours += record.overtimeHours || 0

      // Holidays (a weekly holiday like Friday, or a public holiday) are not
      // working days, so they count toward NEITHER present nor absent — only their
      // holiday hours are tracked.
      if (record.isHoliday) {
        acc.holidayHours += record.holidayHours || 0
      } else if (record.status === "fullday" || record.status === "halfday") {
        acc.daysPresent += 1
      } else {
        acc.daysAbsent += 1
      }

      return acc
    },
    { totalHours: 0, otHours: 0, holidayHours: 0, daysPresent: 0, daysAbsent: 0 }
  )
}

// Worksheet names: Excel caps at 31 chars, disallows \ / ? * [ ] : and blanks, and
// requires uniqueness within a workbook. Sanitize + de-dupe (case-insensitively).
export function sanitizeSheetName(name: string, usedNames: Set<string>): string {
  let base = (name || "Sheet").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31)
  if (!base) base = "Sheet"

  let candidate = base
  let counter = 2
  while (usedNames.has(candidate.toLowerCase())) {
    const suffix = ` (${counter})`
    candidate = base.slice(0, 31 - suffix.length) + suffix
    counter++
  }

  usedNames.add(candidate.toLowerCase())
  return candidate
}

// Fetch the company logo and register it on the workbook ONCE. Returns the image
// id (reusable across worksheets), or null if the logo can't be loaded — in which
// case sheets are simply rendered without it rather than failing the whole export.
export async function registerLogo(
  workbook: ExcelJS.Workbook
): Promise<number | null> {
  try {
    const logoResponse = await fetch("/ngdp logo.png")
    const logoBlob = await logoResponse.blob()
    const logoBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () =>
        resolve((reader.result as string).split(",")[1])
      reader.onerror = reject
      reader.readAsDataURL(logoBlob)
    })

    return workbook.addImage({
      base64: logoBase64,
      extension: "png",
    })
  } catch {
    return null
  }
}

export interface TimesheetSheetInput extends TimesheetEmployeeMeta {
  records: AttendanceRecord[]
  month: number
  year: number
  fullDayHours: number
  sortOrder?: "asc" | "desc"
  /** Pre-sanitized worksheet tab name. Defaults to "Attendance". */
  sheetName?: string
}

// Build one worksheet (the full "Monthly Time Card" layout) for a single employee
// and append it to `workbook`. `logoId` is the id returned by registerLogo (or null).
export function addTimesheetSheet(
  workbook: ExcelJS.Workbook,
  logoId: number | null,
  input: TimesheetSheetInput
): void {
  const { month, year, fullDayHours } = input
  const sortOrder = input.sortOrder ?? "asc"

  const exportDays = buildExportDays(input.records, month, year, sortOrder)
  const totals = computeTimesheetTotals(input.records)

  const worksheet = workbook.addWorksheet(input.sheetName || "Attendance", {
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalCentered: true,
      margins: {
        left: 0.3,
        right: 0.3,
        top: 0.4,
        bottom: 0.4,
        header: 0.2,
        footer: 0.2,
      },
    },
  })

  // --------------------------
  // LOGO
  // --------------------------

  if (logoId !== null) {
    worksheet.addImage(logoId, {
      tl: { col: 10.6, row: 0 },
      ext: { width: 64, height: 64 },
    })
  }

  // --------------------------
  // COMPANY NAME
  // --------------------------

  worksheet.mergeCells("A1:L1")
  worksheet.getRow(1).height = 30

  const companyCell = worksheet.getCell("A1")
  companyCell.value = "NEW GULF DESSERT PROJECT LLC"
  companyCell.font = { bold: true, size: 14 }
  companyCell.alignment = {
    horizontal: "center",
    vertical: "middle",
  }

  // --------------------------
  // SUBTITLE
  // --------------------------

  worksheet.mergeCells("A2:L2")
  worksheet.getRow(2).height = 22

  const subtitleCell = worksheet.getCell("A2")
  subtitleCell.value = "Monthly Time Card"
  subtitleCell.font = { bold: true, size: 12 }
  subtitleCell.alignment = {
    horizontal: "center",
    vertical: "middle",
  }

  // --------------------------
  // EMPLOYEE INFO
  // --------------------------

  worksheet.addRow([])

  const addInfoRow = (
    leftLabel: string,
    leftValue: string,
    rightLabel: string,
    rightValue: string
  ) => {
    const row = worksheet.addRow([
      leftLabel,
      "",
      leftValue,
      "",
      "",
      "",
      rightLabel,
      "",
      rightValue,
    ])

    row.height = 18

    const r = row.number
    worksheet.mergeCells(r, 1, r, 2) // label
    worksheet.mergeCells(r, 3, r, 6) // value
    worksheet.mergeCells(r, 7, r, 8) // label
    worksheet.mergeCells(r, 9, r, 12) // value

    ;[1, 7].forEach((col) => {
      row.getCell(col).font = { bold: true, size: 10 }
    })
    ;[3, 9].forEach((col) => {
      row.getCell(col).font = { size: 10 }
    })
    ;[1, 3, 7, 9].forEach((col) => {
      row.getCell(col).alignment = {
        horizontal: "left",
        vertical: "middle",
      }
    })
  }

  addInfoRow(
    "Name:",
    input.name || "-",
    "Employee ID:",
    input.employeeId || "-"
  )

  addInfoRow(
    "Job Title:",
    input.jobTitle || "-",
    "Month:",
    `${new Date(year, month - 1).toLocaleString("en-IN", {
      month: "long",
    })} ${year}`
  )

  worksheet.addRow([])

  // --------------------------
  // HEADERS
  // --------------------------

  const headerRow = worksheet.addRow([
    "Date",
    "Site\nName",
    "Job\nNo",
    "Check\nIn",
    "Check\nOut",
    "Worked\nHours",
    "Break",
    "Total\nHours",
    "OT\nHours",
    "Holiday\nHours",
    "Status",
    "Sick\nLeave",
  ])

  headerRow.eachCell((cell) => {
    cell.font = {
      bold: true,
      size: 8,
    }

    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    }

    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: HEADER_GREY,
      },
    }

    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    }
  })

  // --------------------------
  // DATA ROWS
  // --------------------------

  // Row layout above is deterministic: 1 company, 2 subtitle, 3 blank, 4-5 info,
  // 6 blank, 7 header — so data begins at row 8 for every sheet.
  let currentRow = 8

  exportDays.forEach(({ date, record }, index) => {
    const shortDate =
      date.toLocaleDateString("en-IN", { weekday: "short" }).slice(0, 3) +
      " " +
      date.getDate()

    // Fridays get a darker fill so they stand out on B&W printouts.
    const isFriday = date.getDay() === 5

    if (!record) {
      const emptyRow = worksheet.addRow([
        shortDate,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ])

      for (let col = 1; col <= 12; col++) {
        const cell = emptyRow.getCell(col)

        cell.font = { size: 8 }

        cell.alignment = {
          horizontal: "center",
          vertical: "middle",
          wrapText: true,
        }

        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        }

        if (isFriday) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: FRIDAY_GREY },
          }
        } else if (index % 2 !== 0) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: ROW_GREY },
          }
        }
      }

      currentRow++

      return
    }

    const sessions = record.sessions.length > 0 ? record.sessions : [null]

    const startRow = currentRow

    sessions.forEach((session, sessionIndex) => {
      const breakCount =
        record.breaksTaken !== null && record.breaksTaken !== undefined
          ? record.breaksTaken
          : computeAutoBreaks(
              record.sessions.reduce(
                (acc, s) => acc + (s.workedHours || 0),
                0
              ),
              fullDayHours
            )

      const row = worksheet.addRow([
        sessionIndex === 0 ? shortDate : "",

        session?.siteName || "-",

        session?.jobCode || "-",

        session?.checkIn ? formatLocalTime12h(session.checkIn) : "-",

        session?.checkOut ? formatLocalTime12h(session.checkOut) : "-",

        session?.workedHours ?? "-",

        sessionIndex === 0 ? breakCount : "",

        sessionIndex === 0 ? record.totalWorkHours : "",

        sessionIndex === 0
          ? typeof record.overtimeHours === "number"
            ? Math.round(record.overtimeHours * 100) / 100
            : record.overtimeHours
          : "",

        sessionIndex === 0
          ? record.isHoliday
            ? Math.round((record.holidayHours || 0) * 100) / 100
            : "-"
          : "",

        sessionIndex === 0
          ? getDisplayStatus(record) === "sick"
            ? "Sick Leave"
            : getDisplayStatus(record)
          : "",

        sessionIndex === 0 ? (record.isSickLeave ? "Yes" : "-") : "",
      ])

      row.eachCell((cell) => {
        cell.font = {
          size: 8,
        }

        cell.alignment = {
          horizontal: "center",
          vertical: "middle",
          wrapText: true,
        }

        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        }

        if (isFriday) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: {
              argb: FRIDAY_GREY,
            },
          }
        } else if (index % 2 !== 0) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: {
              argb: ROW_GREY,
            },
          }
        }
      })

      currentRow++
    })

    const endRow = currentRow - 1

    // --------------------------
    // MERGE COMMON CELLS
    // --------------------------

    if (sessions.length > 1) {
      ;[
        1, // Date
        7, // Break
        8, // Total Hours
        9, // OT Hours
        10, // Holiday Hours
        11, // Status
        12, // Sick Leave
      ].forEach((col) => {
        worksheet.mergeCells(startRow, col, endRow, col)
      })
    }
  })

  // --------------------------
  // TOTALS
  // --------------------------

  const totalsRow = worksheet.addRow([
    "TOTALS",
    "",
    "",
    "",
    "",
    "",
    "",
    round2(totals.totalHours),
    round2(totals.otHours),
    round2(totals.holidayHours),
    "",
    "",
  ])

  worksheet.mergeCells(totalsRow.number, 1, totalsRow.number, 7)

  totalsRow.eachCell((cell) => {
    cell.font = {
      bold: true,
      size: 8,
    }

    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
    }

    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: TOTALS_GREY,
      },
    }

    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    }
  })

  // --------------------------
  // HOURS SUMMARY
  // --------------------------

  worksheet.addRow([])

  const summaryRows: [string, number][] = [
    ["Total Normal Hours", round2(totals.totalHours - totals.otHours)],
    [
      "Total OT Hours (OT + Holiday)",
      round2(totals.otHours + totals.holidayHours),
    ],
    ["Grand Total", round2(totals.totalHours + totals.holidayHours)],
  ]

  summaryRows.forEach(([label, value]) => {
    const row = worksheet.addRow([
      label,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      `${value} hrs`,
      "",
      "",
    ])

    row.height = 18

    worksheet.mergeCells(row.number, 1, row.number, 9) // label
    worksheet.mergeCells(row.number, 10, row.number, 12) // value

    const labelCell = row.getCell(1)
    labelCell.font = { bold: true, size: 9 }
    labelCell.alignment = { horizontal: "right", vertical: "middle" }

    const valueCell = row.getCell(10)
    valueCell.font = { bold: true, size: 9 }
    valueCell.alignment = { horizontal: "center", vertical: "middle" }

    ;[1, 10].forEach((col) => {
      const cell = row.getCell(col)

      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: ROW_GREY },
      }

      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      }
    })
  })

  // --------------------------
  // SIGNATURES
  // --------------------------

  worksheet.addRow([])

  const signatureLabels = [
    "Employee Signature",
    "Supervisor Signature",
    "Manager Signature",
  ]

  signatureLabels.forEach((label) => {
    const signatureRow = worksheet.addRow([
      `${label}: ______________________`,
      "",
      "",
      "Date: ____________________",
    ])

    signatureRow.height = 24

    worksheet.mergeCells(signatureRow.number, 1, signatureRow.number, 3)

    worksheet.mergeCells(signatureRow.number, 4, signatureRow.number, 6)

    ;[1, 4].forEach((col) => {
      const cell = signatureRow.getCell(col)

      cell.font = {
        size: 8,
      }

      cell.alignment = {
        horizontal: "left",
        vertical: "middle",
      }
    })

    worksheet.addRow([])
  })

  // --------------------------
  // COLUMN WIDTHS
  // --------------------------

  //          Date Site Job ChkIn ChkOut Worked Break Total OT Holiday Status Sick
  const colWidths = [8, 12, 7, 9, 9, 8, 6, 7, 6, 8, 9, 7]
  worksheet.columns = worksheet.columns.map((column, index) => ({
    ...column,
    width: colWidths[index] || 10,
  }))
}

// --------------------------------------------------------------------------
// Public entry points
// --------------------------------------------------------------------------

// Single-employee export — one workbook, one sheet. Downloads
// `<name>-<month>-<year>-attendance.xlsx` (unchanged from the detail page).
export async function exportSingleTimesheet(opts: {
  employee: TimesheetEmployeeMeta | null
  records: AttendanceRecord[]
  month: number | string
  year: number | string
  workConfig: WorkConfigLike | null
  sortOrder?: "asc" | "desc"
}): Promise<void> {
  const month = Number(opts.month)
  const year = Number(opts.year)
  const fullDayHours = opts.workConfig?.fullDayHours ?? 8

  const workbook = new ExcelJS.Workbook()
  const logoId = await registerLogo(workbook)

  addTimesheetSheet(workbook, logoId, {
    name: opts.employee?.name,
    employeeId: opts.employee?.employeeId,
    jobTitle: opts.employee?.jobTitle,
    records: opts.records,
    month,
    year,
    fullDayHours,
    sortOrder: opts.sortOrder ?? "asc",
    sheetName: "Attendance",
  })

  const buffer = await workbook.xlsx.writeBuffer()

  saveAs(
    new Blob([buffer]),
    `${opts.employee?.name || "employee"}-${month}-${year}-attendance.xlsx`
  )
}

export interface BulkTimesheetEmployee extends TimesheetEmployeeMeta {
  records: AttendanceRecord[]
}

// Bulk export — one workbook with one worksheet per employee. The logo is
// registered once and reused across every sheet.
export async function exportBulkTimesheets(opts: {
  employees: BulkTimesheetEmployee[]
  month: number | string
  year: number | string
  workConfig: WorkConfigLike | null
  sortOrder?: "asc" | "desc"
  filename?: string
}): Promise<void> {
  const month = Number(opts.month)
  const year = Number(opts.year)
  const fullDayHours = opts.workConfig?.fullDayHours ?? 8

  const workbook = new ExcelJS.Workbook()
  const logoId = await registerLogo(workbook)

  const usedNames = new Set<string>()

  opts.employees.forEach((emp) => {
    const sheetName = sanitizeSheetName(
      emp.name || emp.employeeId || "Employee",
      usedNames
    )

    addTimesheetSheet(workbook, logoId, {
      name: emp.name,
      employeeId: emp.employeeId,
      jobTitle: emp.jobTitle,
      records: emp.records,
      month,
      year,
      fullDayHours,
      sortOrder: opts.sortOrder ?? "asc",
      sheetName,
    })
  })

  const buffer = await workbook.xlsx.writeBuffer()

  const monthName = new Date(year, month - 1).toLocaleString("en-IN", {
    month: "long",
  })

  saveAs(
    new Blob([buffer]),
    opts.filename || `timesheets-${monthName}-${year}.xlsx`
  )
}
