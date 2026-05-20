// pages/MonthlyReport.tsx

import { useEffect, useMemo, useState } from "react"

import {
  CalendarDays,
  Search,
} from "lucide-react"

import { api } from "@/lib/api"

import { Card } from "@/components/ui/card"

import { Input } from "@/components/ui/input"

import { Button } from "@/components/ui/button"

import * as XLSX from "xlsx"

import { saveAs } from "file-saver"

import { Download } from "lucide-react"

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

interface ReportEmployee {
  employeeId: string
  name: string
  jobTitle: string

  presentDays: number
  absentDays: number
  halfDays: number

  attendancePercentage: number

  totalWorkHours: number
  totalOvertime: number

  payableDays: number

  totalSalary: number
}

interface MonthlyReportResponse {
  page: number
  totalPages: number
  totalEmployees: number
  data: ReportEmployee[]
}

function MonthlyReport() {
  const today = new Date()

  const [month, setMonth] = useState(
    String(today.getMonth() + 1)
  )

  const [year, setYear] = useState(
    String(today.getFullYear())
  )

  const [name, setName] = useState("")

  const [employeeId, setEmployeeId] =
    useState("")

  const [jobTitle, setJobTitle] =
    useState("")

  const [loading, setLoading] =
    useState(false)

  const [reports, setReports] = useState<
    ReportEmployee[]
  >([])

  const [page, setPage] = useState(1)

  const [totalPages, setTotalPages] =
    useState(1)

  async function fetchReports() {
    try {
      setLoading(true)

      const params: any = {
        month,
        year,
        page,
        limit: 10,
      }

      if (name.trim()) {
        params.name = name
      }

      if (employeeId.trim()) {
        params.employeeId = employeeId
      }

      if (jobTitle.trim()) {
        params.jobTitle = jobTitle
      }

      const res =
        await api.get<MonthlyReportResponse>(
          "/api/attendance/reports/monthly",
          {
            params,
          }
        )

      setReports(res.data.data)

      setTotalPages(res.data.totalPages)
    } catch (error) {
      console.log(error)

      setReports([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      fetchReports()
    }, 400)

    return () => clearTimeout(timeout)
  }, [
    month,
    year,
    name,
    employeeId,
    jobTitle,
    page,
  ])

  function exportToExcel() {

    if (reports.length === 0) return

    const formattedData = reports.map(
      (employee, index) => ({
        "Sl No": (page - 1) * 10 + index + 1,

        Name: employee.name,

        "Employee ID": employee.employeeId,

        "Job Title": employee.jobTitle,

        Present: employee.presentDays,

        Absent: employee.absentDays,

        HalfDays: employee.halfDays,

        "Attendance %":
          `${employee.attendancePercentage}%`,

        "OT Hours":
          employee.totalOvertime,

        "Payable Days":
          employee.payableDays,

        Salary: employee.totalSalary,
      })
    )

    const worksheet =
      XLSX.utils.json_to_sheet(
        formattedData
      )

    const workbook =
      XLSX.utils.book_new()

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Monthly Report"
    )

    const excelBuffer = XLSX.write(
      workbook,
      {
        bookType: "xlsx",
        type: "array",
      }
    )

    const fileData = new Blob(
      [excelBuffer],
      {
        type:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8",
      }
    )

    saveAs(
      fileData,
      `monthly-report-${month}-${year}.xlsx`
    )
  }

  const months = useMemo(
    () => [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ],
    []
  )

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      <div className="mx-auto max-w-7xl space-y-8">

        {/* Header */}

        {/* Header */}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

          <div className="flex items-center gap-3">
            <CalendarDays className="h-8 w-8" />

            <div>
              <h1 className="text-3xl font-bold sm:text-4xl">
                Monthly Report
              </h1>

              <p className="text-sm text-muted-foreground sm:text-base">
                Attendance and salary summary
              </p>
            </div>
          </div>

          <Button
            onClick={exportToExcel}
            disabled={reports.length === 0}
            className="w-full sm:w-auto"
          >
            <Download className="mr-2 h-4 w-4" />

            Export Excel
          </Button>
        </div>

        {/* Filters */}

        <Card className="rounded-3xl border bg-card p-6 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">

            {/* Month */}

            <Select
              value={month}
              onValueChange={(value) => {
                setPage(1)
                setMonth(value)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Month" />
              </SelectTrigger>

              <SelectContent>
                {months.map(
                  (monthName, index) => (
                    <SelectItem
                      key={monthName}
                      value={String(index + 1)}
                    >
                      {monthName}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>

            {/* Year */}

            <Input
              placeholder="Year"
              value={year}
              onChange={(e) => {
                setPage(1)
                setYear(e.target.value)
              }}
            />

            {/* Name */}

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

              <Input
                placeholder="Employee name"
                className="pl-10"
                value={name}
                onChange={(e) => {
                  setPage(1)
                  setName(e.target.value)
                }}
              />
            </div>

            {/* Employee ID */}

            <Input
              placeholder="Employee ID"
              value={employeeId}
              onChange={(e) => {
                setPage(1)
                setEmployeeId(
                  e.target.value
                )
              }}
            />

            {/* Job Title */}

            <Input
              placeholder="Job Title"
              value={jobTitle}
              onChange={(e) => {
                setPage(1)
                setJobTitle(e.target.value)
              }}
            />
          </div>
        </Card>

        {/* Report Table */}

        <Card className="rounded-3xl border bg-card p-6 shadow-sm">
          <div className="overflow-hidden rounded-2xl border">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-background">
                  <TableRow>
                    <TableHead>
                      Sl No
                    </TableHead>

                    <TableHead>
                      Employee
                    </TableHead>

                    <TableHead>
                      Employee ID
                    </TableHead>

                    <TableHead>
                      Job Title
                    </TableHead>

                    <TableHead>
                      P
                    </TableHead>

                    <TableHead>
                      A
                    </TableHead>

                    <TableHead>
                      H
                    </TableHead>

                    <TableHead>
                      %
                    </TableHead>

                    <TableHead>
                      OT
                    </TableHead>

                    <TableHead>
                      Payable
                    </TableHead>

                    <TableHead className="text-right">
                      Salary
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell
                        colSpan={11}
                        className="h-24 text-center"
                      >
                        Loading report...
                      </TableCell>
                    </TableRow>
                  ) : reports.length ===
                    0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={11}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No report data found
                      </TableCell>
                    </TableRow>
                  ) : (
                    reports.map(
                      (employee, index) => (
                        <TableRow
                          key={
                            employee.employeeId
                          }
                        >
                          <TableCell>
                            {(page - 1) * 10 +
                              index +
                              1}
                          </TableCell>

                          <TableCell className="font-medium whitespace-nowrap">
                            {employee.name}
                          </TableCell>

                          <TableCell>
                            {
                              employee.employeeId
                            }
                          </TableCell>

                          <TableCell className="capitalize">
                            {
                              employee.jobTitle
                            }
                          </TableCell>

                          <TableCell>
                            {
                              employee.presentDays
                            }
                          </TableCell>

                          <TableCell>
                            {
                              employee.absentDays
                            }
                          </TableCell>

                          <TableCell>
                            {
                              employee.halfDays
                            }
                          </TableCell>

                          <TableCell>
                            {
                              employee.attendancePercentage
                            }
                            %
                          </TableCell>

                          <TableCell>
                            {
                              employee.totalOvertime
                            }
                          </TableCell>

                          <TableCell>
                            {
                              employee.payableDays
                            }
                          </TableCell>

                          <TableCell className="text-right font-semibold whitespace-nowrap">
                            ₹
                            {employee.totalSalary.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      )
                    )
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Pagination */}

          <div className="mt-6 flex items-center justify-between">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() =>
                setPage((prev) =>
                  prev - 1
                )
              }
            >
              Previous
            </Button>

            <p className="text-sm text-muted-foreground">
              Page {page} of{" "}
              {totalPages}
            </p>

            <Button
              variant="outline"
              disabled={
                page === totalPages
              }
              onClick={() =>
                setPage((prev) =>
                  prev + 1
                )
              }
            >
              Next
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

export default MonthlyReport