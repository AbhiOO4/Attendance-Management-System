// Site manpower report — shared types, labels and the Excel / PDF exporters.
//
// The report itself is computed server-side (GET /api/site/:siteId/manpower, see
// server/src/utils/siteManpower.js): today's people on a site, bucketed by trade (job
// title) and roster category, each with an attendance status. The dialog
// (components/site/SiteManpowerReport.tsx) and both exports read the same payload.
//
// exceljs and jsPDF are heavy, so each exporter `import()`s its library at export time —
// this module stays cheap to import statically from the dialog.

import type { Workbook, Worksheet, Borders } from "exceljs"
import type { CellHookData } from "jspdf-autotable"
import { saveAs } from "file-saver"

import {
  CATEGORY_IS_FOREIGN,
  CATEGORY_LABELS,
  type RosterCategory,
} from "@/lib/rosterUtils"
import { formatLocalTime12h, toLocalTimeString } from "@/lib/dateUtils"

// --------------------------------------------------------------------------
// Payload types (mirror server/src/utils/siteManpower.js)
// --------------------------------------------------------------------------

export type ManpowerStatus = "present" | "absent" | "leave" | "emergency" | "sick" | "notMarked"

export interface ManpowerCounts {
  roster: number
  present: number
  absent: number
  leave: number // annual + emergency + sick leave
  notMarked: number
}

export interface ManpowerTrade extends ManpowerCounts {
  jobTitle: string
}

export interface ManpowerCategory extends ManpowerCounts {
  category: RosterCategory
}

export interface ManpowerEmployee {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
  category: RosterCategory
  status: ManpowerStatus
  jobName: string | null
  isVisitor: boolean
}

export interface ManpowerReport {
  site: { _id: string; siteName: string }
  date: string // YYYY-MM-DD business day
  generatedAt: string // ISO instant the snapshot was taken
  attendanceSaved: boolean
  totals: ManpowerCounts
  trades: ManpowerTrade[]
  categories: ManpowerCategory[]
  employees: ManpowerEmployee[]
}

// --------------------------------------------------------------------------
// Labels / helpers shared by the dialog and the exports
// --------------------------------------------------------------------------

export const STATUS_LABELS: Record<ManpowerStatus, string> = {
  present: "Present",
  absent: "Absent",
  leave: "Annual leave",
  emergency: "Emergency leave",
  sick: "Sick leave",
  notMarked: "Not marked",
}

// Job titles are stored lowercase ("pipe fitter") — show them as "Pipe Fitter".
export function tradeLabel(jobTitle: string): string {
  const t = (jobTitle || "").trim()
  return t ? t.replace(/\b\w/g, (c) => c.toUpperCase()) : "Unspecified"
}

// Plain-text category name for exports (the UI marks foreign categories with a plane icon
// instead, like the roster tabs).
export function categoryExportLabel(category: RosterCategory): string {
  return CATEGORY_IS_FOREIGN[category]
    ? `Foreign ${CATEGORY_LABELS[category]}`
    : CATEGORY_LABELS[category]
}

export function formatReportDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

export function formatGeneratedAt(iso: string): string {
  return formatLocalTime12h(iso)
}

export interface ManpowerColumn {
  key: keyof ManpowerCounts
  label: string
}

// Count columns to show. Present / Absent only mean something once today's attendance is
// saved (before that nobody has a session here), and Not marked only when anyone is.
export function manpowerColumns(report: ManpowerReport): ManpowerColumn[] {
  const cols: ManpowerColumn[] = [{ key: "roster", label: "On site" }]
  if (report.attendanceSaved) {
    cols.push({ key: "present", label: "Present" }, { key: "absent", label: "Absent" })
  }
  cols.push({ key: "leave", label: "On leave" })
  if (report.totals.notMarked > 0) cols.push({ key: "notMarked", label: "Not marked" })
  return cols
}

export const NOT_SAVED_NOTE =
  "Today's attendance hasn't been saved yet — present / absent fill in once it's saved."

// Employees grouped under their trade, in the trade table's order.
export function employeesByTrade(report: ManpowerReport): { trade: ManpowerTrade; employees: ManpowerEmployee[] }[] {
  return report.trades.map((trade) => ({
    trade,
    employees: report.employees.filter((e) => e.jobTitle === trade.jobTitle),
  }))
}

function fileBaseName(report: ManpowerReport): string {
  const site = (report.site.siteName || "Site").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")
  const time = toLocalTimeString(report.generatedAt).replace(":", "")
  return `Manpower_${site}_${report.date}${time ? `_${time}` : ""}`
}

const COMPANY_NAME = "NEW GULF DESSERT PROJECT LLC"
const REPORT_TITLE = "SITE MANPOWER REPORT"

// Company logo as a data URL, or null when it can't be loaded (the export then just
// renders without it).
async function fetchLogoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch("/ngdp logo.png")
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

// --------------------------------------------------------------------------
// Excel
// --------------------------------------------------------------------------

// Print-friendly grey palette, same as the monthly time card (lib/timesheetExport.ts).
const HEADER_GREY = "D9D9D9"
const ROW_GREY = "EFEFEF"
const TOTALS_GREY = "BFBFBF"

const THIN_BORDER: Partial<Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
}

function fill(argb: string) {
  return { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } }
}

// Company / title / meta block shared by both sheets. Returns the next free row number.
function writeTitleBlock(ws: Worksheet, report: ManpowerReport, width: number, logoId: number | null): number {
  ws.mergeCells(1, 1, 1, width)
  ws.getRow(1).height = 30
  const company = ws.getCell(1, 1)
  company.value = COMPANY_NAME
  company.font = { bold: true, size: 14 }
  company.alignment = { horizontal: "center", vertical: "middle" }

  ws.mergeCells(2, 1, 2, width)
  const title = ws.getCell(2, 1)
  title.value = REPORT_TITLE
  title.font = { bold: true, size: 12 }
  title.alignment = { horizontal: "center" }

  if (logoId !== null) {
    ws.addImage(logoId, { tl: { col: width - 0.6, row: 0 }, ext: { width: 48, height: 48 } })
  }

  const meta: [string, string][] = [
    ["Site", report.site.siteName],
    ["Date", formatReportDate(report.date)],
    ["As of", formatGeneratedAt(report.generatedAt)],
  ]
  let r = 4
  for (const [label, value] of meta) {
    ws.getCell(r, 1).value = label
    ws.getCell(r, 1).font = { bold: true }
    ws.mergeCells(r, 2, r, width)
    ws.getCell(r, 2).value = value
    r++
  }
  if (!report.attendanceSaved) {
    ws.mergeCells(r, 1, r, width)
    ws.getCell(r, 1).value = NOT_SAVED_NOTE
    ws.getCell(r, 1).font = { italic: true, color: { argb: "FF9A3412" } }
    r++
  }
  return r + 1
}

// A header row + body rows + optional bold totals row, all bordered. Returns the next free row.
function writeTable(
  ws: Worksheet,
  startRow: number,
  header: string[],
  body: (string | number)[][],
  totals?: (string | number)[]
): number {
  let r = startRow
  const headerRow = ws.getRow(r)
  header.forEach((h, i) => {
    const c = headerRow.getCell(i + 1)
    c.value = h
    c.font = { bold: true }
    c.fill = fill(HEADER_GREY)
    c.border = THIN_BORDER
    c.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle", wrapText: true }
  })
  r++
  for (const values of body) {
    const row = ws.getRow(r)
    values.forEach((v, i) => {
      const c = row.getCell(i + 1)
      c.value = v
      c.border = THIN_BORDER
      c.alignment = { horizontal: i === 0 ? "left" : "center" }
    })
    r++
  }
  if (totals) {
    const row = ws.getRow(r)
    totals.forEach((v, i) => {
      const c = row.getCell(i + 1)
      c.value = v
      c.font = { bold: true }
      c.fill = fill(TOTALS_GREY)
      c.border = THIN_BORDER
      c.alignment = { horizontal: i === 0 ? "left" : "center" }
    })
    r++
  }
  return r
}

function sectionHeading(ws: Worksheet, row: number, text: string) {
  const c = ws.getCell(row, 1)
  c.value = text
  c.font = { bold: true, size: 12 }
}

function addSummarySheet(wb: Workbook, report: ManpowerReport, logoId: number | null) {
  const cols = manpowerColumns(report)
  const width = cols.length + 1
  const ws = wb.addWorksheet("Summary", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  ws.getColumn(1).width = 30
  for (let i = 2; i <= width; i++) ws.getColumn(i).width = 13

  let r = writeTitleBlock(ws, report, width, logoId)
  const header = cols.map((c) => c.label)

  sectionHeading(ws, r++, "By trade")
  r = writeTable(
    ws,
    r,
    ["Trade", ...header],
    report.trades.map((t) => [tradeLabel(t.jobTitle), ...cols.map((c) => t[c.key])]),
    ["Total", ...cols.map((c) => report.totals[c.key])]
  )

  r++
  sectionHeading(ws, r++, "By category")
  writeTable(
    ws,
    r,
    ["Category", ...header],
    report.categories.map((c) => [categoryExportLabel(c.category), ...cols.map((col) => c[col.key])]),
    ["Total", ...cols.map((c) => report.totals[c.key])]
  )
}

const EMPLOYEE_HEADER = ["#", "Employee ID", "Name", "Category", "Job", "Status"]

function employeeCells(e: ManpowerEmployee, index: number): string[] {
  return [
    String(index + 1),
    e.employeeId,
    e.isVisitor ? `${e.name} (visiting)` : e.name,
    categoryExportLabel(e.category),
    e.jobName || "—",
    STATUS_LABELS[e.status],
  ]
}

function addEmployeesSheet(wb: Workbook, report: ManpowerReport, logoId: number | null) {
  const width = EMPLOYEE_HEADER.length
  const ws = wb.addWorksheet("Employees", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  ;[5, 14, 30, 22, 22, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w))

  let r = writeTitleBlock(ws, report, width, logoId)
  for (const { trade, employees } of employeesByTrade(report)) {
    ws.mergeCells(r, 1, r, width)
    const heading = ws.getCell(r, 1)
    heading.value = `${tradeLabel(trade.jobTitle)} (${trade.roster})`
    heading.font = { bold: true }
    heading.fill = fill(ROW_GREY)
    heading.border = THIN_BORDER
    r++
    r = writeTable(ws, r, EMPLOYEE_HEADER, employees.map(employeeCells))
    r++
  }
}

export async function exportManpowerExcel(report: ManpowerReport): Promise<void> {
  const { default: ExcelJS } = await import("exceljs")
  const wb = new ExcelJS.Workbook()
  wb.created = new Date()

  const logo = await fetchLogoDataUrl()
  const logoId = logo ? wb.addImage({ base64: logo.split(",")[1], extension: "png" }) : null

  addSummarySheet(wb, report, logoId)
  addEmployeesSheet(wb, report, logoId)

  const buffer = await wb.xlsx.writeBuffer()
  saveAs(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${fileBaseName(report)}.xlsx`
  )
}

// --------------------------------------------------------------------------
// PDF
// --------------------------------------------------------------------------

const PDF_HEADER_FILL: [number, number, number] = [217, 217, 217]
const PDF_GROUP_FILL: [number, number, number] = [239, 239, 239]
const PDF_TOTALS_FILL: [number, number, number] = [191, 191, 191]

// jsPDF's built-in fonts only cover a Latin subset — swap typographic dashes for hyphens.
const pdfSafe = (s: string) => s.replace(/[—–]/g, "-")

export async function exportManpowerPdf(report: ManpowerReport): Promise<void> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")])
  // compress: the embedded logo alone is ~1 MB as an uncompressed stream.
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 14
  const lastY = () => (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 0

  const logo = await fetchLogoDataUrl()
  if (logo) {
    try {
      const props = doc.getImageProperties(logo)
      const h = 16
      const w = (props.width / props.height) * h
      doc.addImage(logo, "PNG", pageWidth - margin - w, 10, w, h, undefined, "FAST")
    } catch {
      // Render without the logo.
    }
  }

  doc.setFont("helvetica", "bold")
  doc.setFontSize(14)
  doc.text(COMPANY_NAME, pageWidth / 2, 16, { align: "center" })
  doc.setFontSize(11)
  doc.text(REPORT_TITLE, pageWidth / 2, 23, { align: "center" })

  doc.setFontSize(10)
  let y = 34
  const meta: [string, string][] = [
    ["Site", report.site.siteName],
    ["Date", formatReportDate(report.date)],
    ["As of", formatGeneratedAt(report.generatedAt)],
  ]
  for (const [label, value] of meta) {
    doc.setFont("helvetica", "bold")
    doc.text(`${label}:`, margin, y)
    doc.setFont("helvetica", "normal")
    doc.text(value, margin + 16, y)
    y += 5.5
  }
  if (!report.attendanceSaved) {
    doc.setFont("helvetica", "italic")
    doc.setTextColor(154, 52, 18)
    doc.text(pdfSafe(NOT_SAVED_NOTE), margin, y)
    doc.setTextColor(0, 0, 0)
    y += 5.5
  }

  const cols = manpowerColumns(report)
  const countHead = cols.map((c) => c.label)
  const tableBase = {
    theme: "grid" as const,
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 1.8, textColor: 20 },
    headStyles: { fillColor: PDF_HEADER_FILL, textColor: 0, fontStyle: "bold" as const },
    footStyles: { fillColor: PDF_TOTALS_FILL, textColor: 0, fontStyle: "bold" as const },
  }
  // Centre the count columns in head, body and foot alike (columnStyles only reach the body).
  const centerCounts = (data: CellHookData) => {
    if (data.column.index > 0) data.cell.styles.halign = "center"
  }

  const heading = (text: string, at: number) => {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(11)
    doc.text(text, margin, at)
  }

  heading("By trade", y + 4)
  autoTable(doc, {
    ...tableBase,
    startY: y + 6,
    head: [["Trade", ...countHead]],
    body: report.trades.map((t) => [tradeLabel(t.jobTitle), ...cols.map((c) => String(t[c.key]))]),
    foot: [["Total", ...cols.map((c) => String(report.totals[c.key]))]],
    didParseCell: centerCounts,
  })

  heading("By category", lastY() + 9)
  autoTable(doc, {
    ...tableBase,
    startY: lastY() + 11,
    head: [["Category", ...countHead]],
    body: report.categories.map((c) => [categoryExportLabel(c.category), ...cols.map((col) => String(c[col.key]))]),
    foot: [["Total", ...cols.map((c) => String(report.totals[c.key]))]],
    didParseCell: centerCounts,
  })

  if (report.employees.length > 0) {
    doc.addPage()
    heading("Employees by trade", 18)
    autoTable(doc, {
      ...tableBase,
      startY: 21,
      head: [EMPLOYEE_HEADER],
      body: employeesByTrade(report).flatMap(({ trade, employees }) => [
        [
          {
            content: `${tradeLabel(trade.jobTitle)} (${trade.roster})`,
            colSpan: EMPLOYEE_HEADER.length,
            styles: { fillColor: PDF_GROUP_FILL, fontStyle: "bold" as const, halign: "left" as const },
          },
        ],
        ...employees.map((e, i) => employeeCells(e, i).map(pdfSafe)),
      ]),
      columnStyles: { 0: { halign: "center", cellWidth: 9 } },
    })
  }

  const pages = doc.getNumberOfPages()
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8)
  doc.setTextColor(120, 120, 120)
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.text(
      pdfSafe(`${report.site.siteName} - ${report.date} - Page ${p} of ${pages}`),
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 8,
      { align: "center" }
    )
  }

  doc.save(`${fileBaseName(report)}.pdf`)
}
