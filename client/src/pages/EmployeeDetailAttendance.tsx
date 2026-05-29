
import { api } from "@/lib/api"

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

import { Input } from "@/components/ui/input"

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

    // TITLE
    worksheet.mergeCells(
      "A1:F1"
    )

    const titleCell =
      worksheet.getCell("A1")

    titleCell.value = `${employee?.name} Attendance Report`

    titleCell.font = {
      bold: true,
      size: 16,
    }

    titleCell.alignment = {
      horizontal: "center",
      vertical: "middle",
    }

    // EMPLOYEE INFO
    worksheet.addRow([])

    worksheet.addRow([
      "Employee ID",
      employee?.employeeId || "-",
    ])

    worksheet.addRow([
      "Job Title",
      employee?.jobTitle || "-",
    ])

    worksheet.addRow([
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
    // HEADER ROW 1
    // --------------------------

    const headerRow1 = [
      "S.No",
      "Date",
    ]

    for (
      let i = 0;
      i < maxSessions;
      i++
    ) {
      headerRow1.push(
        `Session ${i + 1}`,
        "",
        "",
        "",
        ""
      )
    }

    headerRow1.push(
      "Status",
      "Total Hours",
      "OT Hours"
    )

    const row1 =
      worksheet.addRow(headerRow1)

    // --------------------------
    // MERGE SESSION HEADERS
    // --------------------------

    let currentCol = 3

    for (
      let i = 0;
      i < maxSessions;
      i++
    ) {
      worksheet.mergeCells(
        7,
        currentCol,
        7,
        currentCol + 4
      )

      currentCol += 5
    }

    // --------------------------
    // HEADER ROW 2
    // --------------------------

    const headerRow2 = [
      "",
      "",
    ]

    for (
      let i = 0;
      i < maxSessions;
      i++
    ) {
      headerRow2.push(
        "Site Name",
        "Job Name",
        "Check In",
        "Check Out",
        "Worked Hours"
      )
    }

    headerRow2.push(
      "",
      "",
      ""
    )

    const row2 =
      worksheet.addRow(headerRow2)

    // --------------------------
    // STYLE HEADERS
    // --------------------------

    ;[row1, row2].forEach(
      (row) => {
        row.eachCell((cell) => {
          cell.font = {
            bold: true,
          }

          cell.alignment = {
            horizontal:
              "center",
            vertical:
              "middle",
            wrapText: true,
          }

          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: {
              argb: "D9EAF7",
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
      }
    )

    // --------------------------
    // DATA ROWS
    // --------------------------

    sortedAttendance.forEach(
      (record, index) => {
        const rowData = [
          index + 1,

          new Date(
            record.date
          ).toLocaleDateString(
            "en-IN",
            {
              day: "2-digit",
              month: "short",
              year: "numeric",
            }
          ),
        ]

        for (
          let i = 0;
          i < maxSessions;
          i++
        ) {
          const session =
            record.sessions[i]

          if (session) {
            rowData.push(
              session.siteName ||
                "-",

              session.jobName ||
                "-",

              session.checkIn
                ? new Date(
                    session.checkIn
                  ).toLocaleTimeString(
                    "en-IN",
                    {
                      hour:
                        "2-digit",
                      minute:
                        "2-digit",
                    }
                  )
                : "-",

              session.checkOut
                ? new Date(
                    session.checkOut
                  ).toLocaleTimeString(
                    "en-IN",
                    {
                      hour:
                        "2-digit",
                      minute:
                        "2-digit",
                    }
                  )
                : "-",

              session.workedHours ??
                "-"
            )
          } else {
            rowData.push(
              "-",
              "-",
              "-",
              "-",
              "-"
            )
          }
        }

        rowData.push(
          record.status,
          record.totalWorkHours,
          record.overtimeHours
        )

        const row =
          worksheet.addRow(rowData)

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
        })
      }
    )

    // --------------------------
    // COLUMN WIDTHS
    // --------------------------

    worksheet.columns.forEach(
      (column) => {
        column.width = 20
      }
    )

    // --------------------------
    // FREEZE HEADER
    // --------------------------

    worksheet.views = [
      {
        state: "frozen",
        ySplit: 8,
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

  const maxSessions = useMemo(() => {
    return Math.max(
      ...attendance.map(
        (record) =>
          record.sessions.length
      ),
      0
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
                    <TableHead>
                      S.No
                    </TableHead>

                    <TableHead>
                      Date
                    </TableHead>

                    {Array.from(
                      { length: maxSessions },
                      (_, index) => (
                        <TableHead
                          key={index}
                          className="min-w-[260px]"
                        >
                          Session {index + 1}
                        </TableHead>
                      )
                    )}

                    <TableHead>
                      Status
                    </TableHead>

                    <TableHead>
                      Total Hours
                    </TableHead>

                    <TableHead>
                      OT Hours
                    </TableHead>

                    <TableHead className="text-right">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell
                        colSpan={
                          maxSessions + 6
                        }
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
                        colSpan={
                          maxSessions + 6
                        }
                        className="h-40 text-center text-muted-foreground"
                      >
                        No attendance records found
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedAttendance.map(
                      (record, index) => (
                        <TableRow
                          key={record.attendanceId}
                        >
                          <TableCell>
                            {index + 1}
                          </TableCell>

                          <TableCell>
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

                          {/* SESSION COLUMNS */}
                          {Array.from(
                            {
                              length: maxSessions,
                            },
                            (_, sessionIndex) => {
                              const session =
                                record.sessions[
                                  sessionIndex
                                ]

                              return (
                                <TableCell
                                  key={sessionIndex}
                                >
                                  {session ? (
                                    <div className="space-y-1 rounded-md border p-3 text-sm">

                                      <p>
                                        <span className="font-medium">
                                          Site:
                                        </span>{" "}
                                        {
                                          session.siteName
                                        }
                                      </p>

                                      {session.jobName && (
                                        <p>
                                          <span className="font-medium">
                                            Job:
                                          </span>{" "}
                                          {
                                            session.jobName
                                          }
                                        </p>
                                      )}

                                      <p>
                                        <span className="font-medium">
                                          In:
                                        </span>{" "}
                                        {session.checkIn
                                          ? new Date(
                                              session.checkIn
                                            ).toLocaleTimeString(
                                              "en-IN",
                                              {
                                                hour:
                                                  "2-digit",
                                                minute:
                                                  "2-digit",
                                              }
                                            )
                                          : "-"}
                                      </p>

                                      <p>
                                        <span className="font-medium">
                                          Out:
                                        </span>{" "}
                                        {session.checkOut
                                          ? new Date(
                                              session.checkOut
                                            ).toLocaleTimeString(
                                              "en-IN",
                                              {
                                                hour:
                                                  "2-digit",
                                                minute:
                                                  "2-digit",
                                              }
                                            )
                                          : "-"}
                                      </p>

                                      <p>
                                        <span className="font-medium">
                                          Worked:
                                        </span>{" "}
                                        {
                                          session.workedHours
                                        } hrs
                                      </p>
                                    </div>
                                  ) : (
                                    <div className="text-muted-foreground text-sm">
                                      -
                                    </div>
                                  )}
                                </TableCell>
                              )
                            }
                          )}

                          {/* STATUS */}
                          <TableCell>
                            <div
                              className={`inline-flex rounded-full px-3 py-1 text-xs font-medium text-white ${
                                record.status ===
                                "fullday"
                                  ? "bg-green-600"
                                  : record.status ===
                                      "halfday"
                                    ? "bg-yellow-500"
                                    : "bg-red-600"
                              }`}
                            >
                              {record.status}
                            </div>
                          </TableCell>

                          {/* HOURS */}
                          <TableCell>
                            {
                              record.totalWorkHours
                            } hrs
                          </TableCell>

                          <TableCell>
                            {
                              record.overtimeHours
                            } hrs
                          </TableCell>

                          {/* ACTION */}
                          <TableCell className="text-right">
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
                        </TableRow>
                      )
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
        onUpdated={handleAttendanceUpdated}
      />
    </div>
  )
}

export default EmployeeAttendanceDetail

