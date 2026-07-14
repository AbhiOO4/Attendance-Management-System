
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

  monthlySalary: number

  currentSite: string | null

  currentJob: string | null

  isActive: boolean
}

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
      const workbook = new ExcelJS.Workbook()

      const worksheet =
        workbook.addWorksheet(
          "Attendance"
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
        tl: { col: 7, row: 0 },
        ext: { width: 80, height: 80 },
      })

      // --------------------------
      // COMPANY NAME
      // --------------------------

      worksheet.mergeCells("A1:G1")
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

      worksheet.mergeCells("A2:G2")
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

      worksheet.addRow([
        "Name",
        employee?.name || "-",
        "",
        "",
        "Employee ID",
        employee?.employeeId || "-",
      ])

      worksheet.addRow([
        "Job Title",
        employee?.jobTitle || "-",
        "",
        "",
        "Month",
        `${new Date(
          Number(year),
          Number(month) - 1
        ).toLocaleString(
          "en-IN",
          {
            month: "long",
          }
        )} ${year}`,
      ])

      worksheet.addRow([])

      // --------------------------
      // HEADERS
      // --------------------------

      const headerRow =
        worksheet.addRow([
          "Date",
          "Site\nName",
          "Check\nIn",
          "Check\nOut",
          "Worked\nHours",
          "Break",
          "Total\nHours",
          "OT\nHours",
          "Status",
        ])

      headerRow.eachCell((cell) => {
        cell.font = {
          bold: true,
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
            argb: "D9F7E0",
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

      sortedAttendance.forEach(
        (record, index) => {
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

              const d = new Date(record.date)
              const shortDate = d.toLocaleDateString("en-IN", { weekday: "short" }).slice(0, 3)
                + " " + d.getDate()

              const row =
                worksheet.addRow([
                  sessionIndex === 0
                    ? shortDate
                    : "",

                  session?.siteName ||
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
                    ? (getDisplayStatus(record) === "sick"
                        ? "Sick Leave"
                        : getDisplayStatus(record))
                    : "",
                ])

              row.eachCell((cell) => {
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

                if (index % 2 !== 0) {
                  cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: {
                      argb: "D6F7DC",
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
              6, // Break
              7, // Total Hours
              8, // OT Hours
              9, // Status
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
      // COLUMN WIDTHS
      // --------------------------

      //          Date  Site  ChkIn ChkOut Worked Break Total  OT   Status
      const colWidths = [10, 16, 11, 11, 12, 8, 10, 9, 12]
      worksheet.columns =
        worksheet.columns.map(
          (column, index) => ({
            ...column,
            width: colWidths[index] || 10,
          })
        )

      // --------------------------
      // FREEZE HEADER
      // --------------------------

      worksheet.views = [
        {
          state: "frozen",
          ySplit: 7,
        },
      ]

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
    <div className="min-h-screen bg-muted/30 p-6">
      <div className="mx-auto max-w-7xl space-y-6">

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

                    <TableHead>Total Hours</TableHead>

                    <TableHead>OT Hours</TableHead>

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
                        colSpan={9}
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
                        colSpan={9}
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
                                    {new Date(
                                      record.date
                                    ).toLocaleDateString(
                                      "en-IN",
                                      {
                                        day: "2-digit",
                                        month: "short",
                                        year: "numeric",
                                      }
                                    )}
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

