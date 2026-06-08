
// pages/MonthlyReport.tsx

import { useEffect, useMemo, useState } from "react"

import {
  CalendarDays,
  Search,
  Download,
  RotateCcw,
} from "lucide-react"

import { api } from "@/lib/api"

import * as XLSX from "xlsx"

import { saveAs } from "file-saver"

import { Card } from "@/components/ui/card"

import { Input } from "@/components/ui/input"

import { Button } from "@/components/ui/button"

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
  employeeName: string
  employeeId: string
  jobTitle: string
  isActive?: boolean

  fullDays: number
  halfDays: number
  absentDays: number

  attendancePercentage: number

  overtimeHours: number

  payableDays: number

  normalPay: number
  overtimePay: number

  salary: number
}

interface MonthlyReportResponse {
  success: boolean
  month: number
  year: number
  report: ReportEmployee[]
}

function MonthlyReport() {
  const today = new Date()

  const [month, setMonth] = useState(
    String(today.getMonth() + 1)
  )

  const [year, setYear] = useState(
    String(today.getFullYear())
  )

  const [loading, setLoading] =
    useState(false)

  const [reports, setReports] = useState<
    ReportEmployee[]
  >([])

  const [name, setName] = useState("")

  const [employeeId, setEmployeeId] =
    useState("")

  const [jobTitle, setJobTitle] =
    useState("")

  async function fetchReports() {
    try {
      setLoading(true)

      const res =
        await api.get<MonthlyReportResponse>(
          `/api/attendance/reports/monthly/${month}/${year}`
        )

      setReports(res.data.report || [])
    } catch (error) {
      console.log(error)

      setReports([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchReports()
  }, [month, year])

  const filteredReports = useMemo(() => {
    const filtered = reports.filter((employee) => {
      const matchesName =
        employee.employeeName
          .toLowerCase()
          .includes(
            name.toLowerCase()
          )

      const matchesEmployeeId =
        employee.employeeId
          .toLowerCase()
          .includes(
            employeeId.toLowerCase()
          )

      const matchesJobTitle =
        employee.jobTitle
          .toLowerCase()
          .includes(
            jobTitle.toLowerCase()
          )

      return (
        matchesName &&
        matchesEmployeeId &&
        matchesJobTitle
      )
    })

    return [...filtered].sort((a, b) => {
      const aActive = a.isActive !== false;
      const bActive = b.isActive !== false;
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      return a.employeeName.localeCompare(b.employeeName);
    });
  }, [
    reports,
    name,
    employeeId,
    jobTitle,
  ])

  const totals = useMemo(() => {
    return filteredReports.reduce(
      (acc, employee) => {
        acc.fullDays +=
          employee.fullDays

        acc.halfDays +=
          employee.halfDays

        acc.absentDays +=
          employee.absentDays

        acc.overtimeHours +=
          employee.overtimeHours

        acc.payableDays +=
          employee.payableDays

        acc.normalPay +=
          employee.normalPay

        acc.overtimePay +=
          employee.overtimePay

        acc.salary +=
          employee.salary

        return acc
      },
      {
        fullDays: 0,
        halfDays: 0,
        absentDays: 0,

        overtimeHours: 0,

        payableDays: 0,

        normalPay: 0,
        overtimePay: 0,

        salary: 0,
      }
    )
  }, [filteredReports])

  function clearFilters() {
    setName("")
    setEmployeeId("")
    setJobTitle("")
  }

  function exportToExcel() {
    if (filteredReports.length === 0)
      return

    const formattedData =
      filteredReports.map(
        (employee, index) => ({
          "Sl No": index + 1,

          "Employee Name":
            employee.employeeName + (employee.isActive === false ? " (Inactive)" : ""),

          "Employee ID":
            employee.employeeId,

          "Job Title":
            employee.jobTitle,

          "Full Days":
            employee.fullDays,

          "Half Days":
            employee.halfDays,

          "Absent Days":
            employee.absentDays,

          "Attendance %":
            employee.attendancePercentage,

          "OT Hours":
            employee.overtimeHours,

          "Payable Days":
            employee.payableDays,

          "Normal Pay":
            employee.normalPay,

          "OT Pay":
            employee.overtimePay,

          Salary:
            employee.salary,
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

    const excelBuffer =
      XLSX.write(workbook, {
        bookType: "xlsx",
        type: "array",
      })

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

  const months = [
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
  ]

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      <div className="mx-auto max-w-7xl space-y-6">

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <CalendarDays className="h-8 w-8" />

            <div>
              <h1 className="text-3xl font-bold">
                Monthly Payroll Report
              </h1>

              <p className="text-muted-foreground">
                Attendance, OT and salary summary
              </p>
            </div>
          </div>

          <Button
            onClick={exportToExcel}
            disabled={
              filteredReports.length ===
              0
            }
          >
            <Download className="mr-2 h-4 w-4" />
            Export Spreadsheet
          </Button>
        </div>

        <Card className="p-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">

            <Select
              value={month}
              onValueChange={
                setMonth
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>

              <SelectContent>
                {months.map(
                  (
                    monthName,
                    index
                  ) => (
                    <SelectItem
                      key={
                        monthName
                      }
                      value={String(
                        index + 1
                      )}
                    >
                      {monthName}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>

            <Input
              placeholder="Year"
              value={year}
              onChange={(e) =>
                setYear(
                  e.target.value
                )
              }
            />

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

              <Input
                className="pl-10"
                placeholder="Employee Name"
                value={name}
                onChange={(e) =>
                  setName(
                    e.target.value
                  )
                }
              />
            </div>

            <Input
              placeholder="Employee ID"
              value={employeeId}
              onChange={(e) =>
                setEmployeeId(
                  e.target.value
                )
              }
            />

            <Input
              placeholder="Job Title"
              value={jobTitle}
              onChange={(e) =>
                setJobTitle(
                  e.target.value
                )
              }
            />
          </div>

          <div className="mt-4">
            <Button
              variant="outline"
              onClick={
                clearFilters
              }
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Clear Filters
            </Button>
          </div>
        </Card>

        <div className="grid gap-4 md:grid-cols-5">
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">
              Employees
            </p>

            <p className="text-2xl font-bold">
              {
                filteredReports.length
              }
            </p>
          </Card>

          <Card className="p-4">
            <p className="text-sm text-muted-foreground">
              OT Hours
            </p>

            <p className="text-2xl font-bold">
              {totals.overtimeHours.toFixed(
                2
              )}
            </p>
          </Card>

          <Card className="p-4">
            <p className="text-sm text-muted-foreground">
              Normal Pay
            </p>

            <p className="text-2xl font-bold">
              <span className="text-sm font-normal text-muted-foreground mr-1.5">OMR</span>
              {totals.normalPay.toLocaleString()}
            </p>
          </Card>

          <Card className="p-4">
            <p className="text-sm text-muted-foreground">
              OT Pay
            </p>

            <p className="text-2xl font-bold">
              <span className="text-sm font-normal text-muted-foreground mr-1.5">OMR</span>
              {totals.overtimePay.toLocaleString()}
            </p>
          </Card>

          <Card className="p-4">
            <p className="text-sm text-muted-foreground">
              Total Payroll
            </p>

            <p className="text-2xl font-bold">
              <span className="text-sm font-normal text-muted-foreground mr-1.5">OMR</span>
              {totals.salary.toLocaleString()}
            </p>
          </Card>
        </div>

        <Card className="p-6">
          <Table wrapperClassName="h-[650px] overflow-auto rounded-xl border">
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead>Sl</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Full</TableHead>
                  <TableHead>Half</TableHead>
                  <TableHead>Absent</TableHead>
                  <TableHead>%</TableHead>
                  <TableHead>OT</TableHead>
                  <TableHead>Payable</TableHead>
                  <TableHead>Normal Pay</TableHead>
                  <TableHead>OT Pay</TableHead>
                  <TableHead>Salary</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={13}
                      className="text-center h-24"
                    >
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : filteredReports.length ===
                  0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={13}
                      className="text-center h-24"
                    >
                      No data found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredReports.map(
                    (
                      employee,
                      index
                    ) => (
                      <TableRow
                        key={
                          employee.employeeId
                        }
                        className={employee.isActive === false ? "opacity-60 bg-muted/20 hover:bg-muted/30" : ""}
                      >
                        <TableCell>
                          {index + 1}
                        </TableCell>

                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className={employee.isActive === false ? "text-muted-foreground line-through decoration-1" : ""}>
                              {employee.employeeName}
                            </span>
                            {employee.isActive === false && (
                              <span className="text-[10px] text-destructive font-medium uppercase tracking-wide">
                                Inactive
                              </span>
                            )}
                          </div>
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
                            employee.fullDays
                          }
                        </TableCell>

                        <TableCell>
                          {
                            employee.halfDays
                          }
                        </TableCell>

                        <TableCell>
                          {
                            employee.absentDays
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
                            employee.overtimeHours
                          }
                        </TableCell>

                        <TableCell>
                          {
                            employee.payableDays
                          }
                        </TableCell>

                        <TableCell>
                          {employee.normalPay.toLocaleString()}
                        </TableCell>

                        <TableCell>
                          {employee.overtimePay.toLocaleString()}
                        </TableCell>

                        <TableCell className="font-semibold">
                          {employee.salary.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    )
                  )
                )}
              </TableBody>
            </Table>
        </Card>
      </div>
    </div>
  )
}

export default MonthlyReport

