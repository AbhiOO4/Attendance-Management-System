
import { useWorkConfig } from "@/context/WorkConfigContext"
import { api } from "@/lib/api"
import { formatLocalTime12h } from "@/lib/dateUtils"

import ExcelJS from "exceljs"
import { saveAs } from "file-saver"

import {
  useEffect,
  useMemo,
  useState,
} from "react"

import {
  useNavigate,
  useParams,
} from "react-router-dom"

import toast from "react-hot-toast"

import EditRecord from "@/components/EditRecord"

import type {
  AttendanceRecord,
} from "@/pages/EditPastAttendance"

import {
  Card,
  CardContent,
} from "@/components/ui/card"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import {
  ArrowLeft,
  Loader2,
  Pencil,
  Download,
} from "lucide-react"

interface Employee {
  _id: string

  name: string

  employeeId: string

  jobTitle: string

  currentSite: string | null

  currentJob: string | null

  isActive: boolean
}

const round2 = (value: number) =>
  Math.round(value * 100) / 100

const getDisplayStatus = (record: AttendanceRecord) => {
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
  return record.status
}

function EmployeeAttendanceDetail() {
  const { id } = useParams()

  const navigate = useNavigate()

  const today = new Date()

  const currentMonth =
    today.getMonth() + 1

  const currentYear =
    today.getFullYear()

  const [employee, setEmployee] =
    useState<Employee | null>(null)

  const { config: workConfig } = useWorkConfig()
  const fullDayHours = workConfig?.fullDayHours ?? 8
  const breakDurationMinutes = workConfig?.breakDurationMinutes ?? 60



  const [attendance, setAttendance] =
    useState<AttendanceRecord[]>([])

  const [loading, setLoading] =
    useState(false)

  const [editingRecord, setEditingRecord] =
    useState<AttendanceRecord | null>(null)

  const [month, setMonth] =
    useState(String(currentMonth))

  const [year, setYear] =
    useState(String(currentYear))

  const [sortOrder, setSortOrder] =
    useState<"asc" | "desc">("asc")

  const fetchEmployee = async () => {
    try {
      const res = await api.get(
        `/api/employees/${id}`
      )

      setEmployee(res.data)
    } catch (error) {
      console.log(error)

      toast.error(
        "Failed to fetch employee"
      )
    }
  }

  const fetchAttendance = async () => {
    try {
      setLoading(true)

      const res = await api.get(
        `/api/attendance/employee/${id}`,
        {
          params: {
            month,
            year,
          },
        }
      )

      setAttendance(res.data.data || [])
    } catch (error: any) {
      console.log(error)

      toast.error(
        error?.response?.data
          ?.message ||
          "Failed to fetch attendance"
      )
    } finally {
      setLoading(false)
    }
  }

  const exportSpreadsheet = async () => {
    try {
      // Grey palette (print-friendly). Fridays get a darker shade to mark the
      // weekend; alternating rows keep the two-tone look, just in grey.
      const HEADER_GREY = "D9D9D9"
      const ROW_GREY = "EFEFEF"
      const FRIDAY_GREY = "C0C0C0"
      const TOTALS_GREY = "BFBFBF"

      const workbook = new ExcelJS.Workbook()

      const worksheet =
        workbook.addWorksheet(
          "Attendance",
          {
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
          }
        )

      // --------------------------
      // LOGO
      // --------------------------

      const logoResponse = await fetch("/ngdp logo.png")
      const logoBlob = await logoResponse.blob()
      const logoBase64 = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve((reader.result as string).split(",")[1])
        reader.readAsDataURL(logoBlob)
      })

      const logoId = workbook.addImage({
        base64: logoBase64,
        extension: "png",
      })

      worksheet.addImage(logoId, {
        tl: { col: 10.6, row: 0 },
        ext: { width: 64, height: 64 },
      })

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
        employee?.name || "-",
        "Employee ID:",
        employee?.employeeId || "-"
      )

      addInfoRow(
        "Job Title:",
        employee?.jobTitle || "-",
        "Month:",
        `${new Date(
          Number(year),
          Number(month) - 1
        ).toLocaleString(
          "en-IN",
          {
            month: "long",
          }
        )} ${year}`
      )

      worksheet.addRow([])

      // --------------------------
      // HEADERS
      // --------------------------

      const headerRow =
        worksheet.addRow([
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
          top: {
            style: "thin",
          },
          left: {
            style: "thin",
          },
          bottom: {
            style: "thin",
          },
          right: {
            style: "thin",
          },
        }
      })

      // --------------------------
      // DATA ROWS
      // --------------------------

      let currentRow = 8

      exportDays.forEach(
        ({ date, record }, index) => {
          const shortDate =
            date.toLocaleDateString("en-IN", { weekday: "short" }).slice(0, 3)
            + " " + date.getDate()

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

          const sessions =
            record.sessions.length > 0
              ? record.sessions
              : [null]

          const startRow =
            currentRow

          sessions.forEach(
            (
              session,
              sessionIndex
            ) => {
              const breakCount = record.breaksTaken !== null && record.breaksTaken !== undefined
                ? record.breaksTaken
                : Math.floor(record.sessions.reduce((acc, s) => acc + (s.workedHours || 0), 0) / fullDayHours)

              const row =
                worksheet.addRow([
                  sessionIndex === 0
                    ? shortDate
                    : "",

                  session?.siteName ||
                  "-",

                  session?.jobCode ||
                  "-",

                  session?.checkIn
                    ? formatLocalTime12h(session.checkIn)
                    : "-",

                  session?.checkOut
                    ? formatLocalTime12h(session.checkOut)
                    : "-",

                  session?.workedHours ??
                  "-",

                  sessionIndex === 0
                    ? breakCount
                    : "",

                  sessionIndex === 0
                    ? record.totalWorkHours
                    : "",

                  sessionIndex === 0
                    ? (typeof record.overtimeHours === "number" ? Math.round(record.overtimeHours * 100) / 100 : record.overtimeHours)
                    : "",

                  sessionIndex === 0
                    ? (record.isHoliday
                        ? Math.round((record.holidayHours || 0) * 100) / 100
                        : "-")
                    : "",

                  sessionIndex === 0
                    ? (getDisplayStatus(record) === "sick"
                        ? "Sick Leave"
                        : getDisplayStatus(record))
                    : "",

                  sessionIndex === 0
                    ? (record.isSickLeave ? "Yes" : "-")
                    : "",
                ])

              row.eachCell((cell) => {
                cell.font = {
                  size: 8,
                }

                cell.alignment = {
                  horizontal:
                    "center",
                  vertical:
                    "middle",
                  wrapText: true,
                }

                cell.border = {
                  top: {
                    style: "thin",
                  },
                  left: {
                    style: "thin",
                  },
                  bottom: {
                    style: "thin",
                  },
                  right: {
                    style: "thin",
                  },
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
            }
          )

          const endRow =
            currentRow - 1

          // --------------------------
          // MERGE COMMON CELLS
          // --------------------------

          if (
            sessions.length > 1
          ) {
            ;[
              1, // Date
              7, // Break
              8, // Total Hours
              9, // OT Hours
              10, // Holiday Hours
              11, // Status
              12, // Sick Leave
            ].forEach((col) => {
              worksheet.mergeCells(
                startRow,
                col,
                endRow,
                col
              )
            })
          }
        }
      )

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

      worksheet.mergeCells(
        totalsRow.number,
        1,
        totalsRow.number,
        7
      )

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
          top: {
            style: "thin",
          },
          left: {
            style: "thin",
          },
          bottom: {
            style: "thin",
          },
          right: {
            style: "thin",
          },
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
        const signatureRow =
          worksheet.addRow([
            `${label}: ______________________`,
            "",
            "",
            "Date: ____________________",
          ])

        signatureRow.height = 24

        worksheet.mergeCells(
          signatureRow.number,
          1,
          signatureRow.number,
          3
        )

        worksheet.mergeCells(
          signatureRow.number,
          4,
          signatureRow.number,
          6
        )

        ;[1, 4].forEach((col) => {
          const cell =
            signatureRow.getCell(col)

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
      worksheet.columns =
        worksheet.columns.map(
          (column, index) => ({
            ...column,
            width: colWidths[index] || 10,
          })
        )

      // --------------------------
      // DOWNLOAD
      // --------------------------

      const buffer =
        await workbook.xlsx.writeBuffer()

      saveAs(
        new Blob([buffer]),
        `${employee?.name}-${month}-${year}-attendance.xlsx`
      )

      toast.success(
        "Spreadsheet exported"
      )
    } catch (error) {
      console.log(error)

      toast.error(
        "Failed to export spreadsheet"
      )
    }
  }

  useEffect(() => {
    fetchEmployee()
  }, [id])

  useEffect(() => {
    fetchAttendance()
  }, [id, month, year])

  const sortedAttendance =
    useMemo(() => {
      return [...attendance].sort(
        (a, b) => {
          const first = new Date(
            a.date
          ).getTime()

          const second = new Date(
            b.date
          ).getTime()

          return sortOrder === "asc"
            ? first - second
            : second - first
        }
      )
    }, [attendance, sortOrder])

  // Every day of the selected month, with its record if one exists — days with no
  // record become a date-only row in the export.
  const exportDays = useMemo(() => {
    const monthIndex = Number(month) - 1
    const yearNumber = Number(year)

    const byDay = new Map<number, AttendanceRecord>()

    attendance.forEach((record) => {
      const d = new Date(record.date)

      if (
        d.getFullYear() === yearNumber &&
        d.getMonth() === monthIndex
      ) {
        byDay.set(d.getDate(), record)
      }
    })

    const daysInMonth = new Date(
      yearNumber,
      monthIndex + 1,
      0
    ).getDate()

    const days = Array.from(
      { length: daysInMonth },
      (_, i) => ({
        date: new Date(yearNumber, monthIndex, i + 1),
        record: byDay.get(i + 1) || null,
      })
    )

    return sortOrder === "asc" ? days : days.reverse()
  }, [attendance, month, year, sortOrder])

  const totals = useMemo(() => {
    return attendance.reduce(
      (acc, record) => {
        acc.totalHours += record.totalWorkHours || 0

        acc.otHours += record.overtimeHours || 0

        if (record.isHoliday) {
          acc.holidayHours += record.holidayHours || 0
        }

        // Half-days count as present; sick-leave days carry status "absent",
        // so they fall into the absent bucket alongside plain absences.
        if (record.status === "fullday" || record.status === "halfday") {
          acc.daysPresent += 1
        } else {
          acc.daysAbsent += 1
        }

        return acc
      },
      {
        totalHours: 0,
        otHours: 0,
        holidayHours: 0,
        daysPresent: 0,
        daysAbsent: 0,
      }
    )
  }, [attendance])

  const handleAttendanceUpdated = (updatedRecord: AttendanceRecord) => {
    setAttendance((prev) =>
      prev.map((record) =>
        record.attendanceId ===
        updatedRecord.attendanceId
          ? updatedRecord
          : record
      )
    )
  }

  return (
    <div className="min-h-screen bg-muted/30 px-3 py-6 sm:px-4">
      <div className="mx-auto max-w-none space-y-6">

        {/* BACK BUTTON */}
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            navigate(-1)
          }
          className="w-fit"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        {/* EMPLOYEE INFO */}
        <Card>
          <CardContent className="space-y-6 p-6">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">

              <div>
                <h1 className="text-3xl font-bold">
                  {employee?.name}
                </h1>

                <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                  <p>
                    Employee ID: {employee?.employeeId}
                  </p>

                  <p>
                    Job Title: {employee?.jobTitle}
                  </p>
                </div>
              </div>

              {/* FILTERS */}
              <div className="flex flex-wrap gap-3">

                {/* MONTH */}
                <Select
                  value={month}
                  onValueChange={setMonth}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Month" />
                  </SelectTrigger>

                  <SelectContent>
                    {Array.from(
                      { length: 12 },
                      (_, i) => (
                        <SelectItem
                          key={i + 1}
                          value={String(i + 1)}
                        >
                          {new Date(
                            0,
                            i
                          ).toLocaleString(
                            "en-IN",
                            {
                              month: "long",
                            }
                          )}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>

                {/* YEAR */}
                <Select
                  value={year}
                  onValueChange={setYear}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue placeholder="Year" />
                  </SelectTrigger>

                  <SelectContent>
                    {Array.from(
                      { length: 5 },
                      (_, i) => {
                        const yr =
                          currentYear - i

                        return (
                          <SelectItem
                            key={yr}
                            value={String(yr)}
                          >
                            {yr}
                          </SelectItem>
                        )
                      }
                    )}
                  </SelectContent>
                </Select>

                {/* SORT */}
                <Select
                  value={sortOrder}
                  onValueChange={(
                    value: "asc" | "desc"
                  ) =>
                    setSortOrder(value)
                  }
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value="asc">
                      Oldest First
                    </SelectItem>

                    <SelectItem value="desc">
                      Latest First
                    </SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  variant="outline"
                  onClick={exportSpreadsheet}
                  className="w-full sm:w-auto"
                >
                  <Download className="mr-2 h-4 w-4" />

                  Export Spreadsheet
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* SUMMARY */}
        {employee && (
          <Card>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">
                    Normal Hours
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {round2(totals.totalHours - totals.otHours)} hrs
                  </p>
                </div>

                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">
                    Total OT Hours
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {round2(totals.otHours + totals.holidayHours)} hrs
                  </p>
                </div>

                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">
                    Days Present
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {totals.daysPresent}
                  </p>
                </div>

                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">
                    Days Absent
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {totals.daysAbsent}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ATTENDANCE TABLE */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>S.No</TableHead>

                    <TableHead>Date</TableHead>

                    <TableHead>Site</TableHead>

                    <TableHead>Job No</TableHead>

                    <TableHead>Check In</TableHead>

                    <TableHead>Check Out</TableHead>

                    <TableHead>Worked</TableHead>

                    <TableHead>Status</TableHead>

                    <TableHead>Sick Leave</TableHead>

                    <TableHead>Total Hours</TableHead>

                    <TableHead>OT Hours</TableHead>

                    <TableHead>Holiday Hours</TableHead>

                    <TableHead>Breaks</TableHead>

                    <TableHead className="text-right">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell
                        colSpan={14}
                        className="h-40 text-center"
                      >
                        <div className="flex items-center justify-center">
                          <Loader2 className="h-6 w-6 animate-spin" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : sortedAttendance.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={14}
                        className="h-40 text-center text-muted-foreground"
                      >
                        No attendance records found
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedAttendance.map(
                      (record, index) => {
                        const sessions =
                          record.sessions.length > 0
                            ? record.sessions
                            : [null]

                        return sessions.map(
                          (session, sessionIndex) => (
                            <TableRow
                              key={`${record.attendanceId}-${sessionIndex}`}
                              className={`${index % 2 === 0
                                  ? "bg-white dark:bg-background"
                                  : "bg-slate-200 dark:bg-slate-900/40"
                                } `}
                            >
                              {/* COMMON CELLS */}
                              {sessionIndex === 0 && (
                                <>
                                  <TableCell
                                    rowSpan={
                                      sessions.length
                                    }
                                  >
                                    {index + 1}
                                  </TableCell>

                                  <TableCell
                                    rowSpan={
                                      sessions.length
                                    }
                                  >
                                    {(() => {
                                      const d = new Date(record.date)
                                      return (
                                        d.toLocaleDateString("en-IN", {
                                          weekday: "short",
                                        }).slice(0, 3) +
                                        " " +
                                        d.getDate()
                                      )
                                    })()}
                                  </TableCell>
                                </>
                              )}

                              {/* SESSION DATA */}
                              <TableCell>
                                {session?.siteName || "-"}
                              </TableCell>

                              <TableCell>
                                {session?.jobCode || "-"}
                              </TableCell>

                              <TableCell>
                                {session?.checkIn
                                  ? formatLocalTime12h(session.checkIn)
                                  : "-"}
                              </TableCell>

                              <TableCell>
                                {session?.checkOut
                                  ? formatLocalTime12h(session.checkOut)
                                  : "-"}
                              </TableCell>

                              <TableCell>
                                {session?.workedHours ??
                                  "-"}{" "}
                                hrs
                              </TableCell>

                              {/* COMMON CELLS */}
                              {sessionIndex === 0 && (
                                <>
                                  <TableCell
                                    rowSpan={
                                      sessions.length
                                    }
                                  >
                                    <Badge
                                      variant={
                                        getDisplayStatus(record) === "absent"
                                          ? "destructive"
                                          : "secondary"
                                      }
                                      className={
                                        getDisplayStatus(record) === "fullday"
                                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25 border-transparent"
                                          : getDisplayStatus(record) === "pending"
                                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25 border-transparent"
                                            : getDisplayStatus(record) === "sick"
                                              ? "bg-sky-500/15 text-sky-700 dark:text-sky-400 hover:bg-sky-500/25 border-transparent"
                                              : ""
                                      }
                                    >
                                      {getDisplayStatus(record) === "sick"
                                        ? "Sick Leave"
                                        : getDisplayStatus(record)}
                                    </Badge>
                                  </TableCell>

                                  <TableCell
                                    rowSpan={
                                      sessions.length
                                    }
                                  >
                                    {record.isSickLeave
                                      ? "Yes"
                                      : "-"}
                                  </TableCell>

                                  <TableCell
                                    rowSpan={
                                      sessions.length
                                    }
                                  >
                                    {
                                      record.totalWorkHours
                                    }{" "}
                                    hrs
                                  </TableCell>

                                  <TableCell
                                    rowSpan={
                                      sessions.length
                                    }
                                  >
                                    {
                                      typeof record.overtimeHours === "number"
                                        ? Math.round(record.overtimeHours * 100) / 100
                                        : record.overtimeHours
                                    }{" "}
                                    hrs
                                  </TableCell>

                                  <TableCell
                                    rowSpan={
                                      sessions.length
                                    }
                                  >
                                    {record.isHoliday
                                      ? `${Math.round((record.holidayHours || 0) * 100) / 100} hrs`
                                      : "-"}
                                  </TableCell>

                                  <TableCell
                                    rowSpan={
                                      sessions.length
                                    }
                                  >
                                    {(() => {
                                      const count = record.breaksTaken !== null && record.breaksTaken !== undefined
                                        ? record.breaksTaken
                                        : Math.floor(record.sessions.reduce((acc, s) => acc + (s.workedHours || 0), 0) / fullDayHours);
                                      const hrs = (count * breakDurationMinutes) / 60;
                                      return `${hrs} ${hrs === 1 ? "hr" : "hrs"}`;
                                    })()}

                                  </TableCell>


                                  <TableCell
                                    rowSpan={
                                      sessions.length
                                    }
                                    className="text-right"
                                  >
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      onClick={() =>
                                        setEditingRecord(
                                          record
                                        )
                                      }
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                  </TableCell>
                                </>
                              )}
                            </TableRow>
                          )
                        )
                      }
                    )
                  )}
                </TableBody>

                {!loading && sortedAttendance.length > 0 && (
                  <TableFooter>
                    <TableRow>
                      <TableCell
                        colSpan={9}
                        className="text-right"
                      >
                        Totals
                      </TableCell>

                      <TableCell>
                        {round2(totals.totalHours)} hrs
                      </TableCell>

                      <TableCell>
                        {round2(totals.otHours)} hrs
                      </TableCell>

                      <TableCell>
                        {round2(totals.holidayHours)} hrs
                      </TableCell>

                      <TableCell colSpan={2} />
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* EDIT MODAL */}
      <EditRecord
        open={!!editingRecord}
        onClose={() =>
          setEditingRecord(null)
        }
        record={editingRecord}
        onUpdated={(updatedRecord) =>
          handleAttendanceUpdated(updatedRecord as AttendanceRecord)
        }
      />
    </div>
  )
}

export default EmployeeAttendanceDetail

