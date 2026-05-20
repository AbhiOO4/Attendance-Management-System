import { api } from "@/lib/api"
import { useEffect, useState } from "react"
import toast from "react-hot-toast"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

import {
  Card,
  CardContent,
} from "@/components/ui/card"

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
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Save,
  X,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"


type Attendance = {
  attendanceId: string
  employee: string
  siteId: string,
  date: string
  name: string
  employeeId: string
  jobTitle: string
  status: "present" | "absent" | "halfday"
  overtimeHours: number | ""
}

type Site = {
  _id: string
  siteName: string
  locationDetails: string
  isActive: boolean
}

interface DailyResponse {
  totalPages: number
  totalRecords: number
  isHoliday: boolean
  data: Attendance[]
}

interface Filters {
  name: string
  employeeId: string
  jobTitle: string
  site: string
  page: number
  limit: number
}

function EditPastAttendance() {
  const today = new Date()

  const [date, setDate] = useState(
    today.toLocaleDateString("en-CA")
  )

  const todayDateString = new Date().toLocaleDateString("en-CA")

  const navigate = useNavigate()

  const [attendance, setAttendance] = useState<Attendance[]>([])

  const [sites, setSites] = useState<Site[]>([])

  const [loading, setLoading] = useState(false)

  const [saving, setSaving] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)

  const [isHoliday, setIsHoliday] = useState<boolean>(false)

  const [filters, setFilters] =
    useState<Filters>({
      name: "",
      employeeId: "",
      jobTitle: "",
      site: "all",
      page: 1,
      limit: 10,
    })

  const [totalPages, setTotalPages] = useState(1)

  const formattedDate = new Date(date).toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  const [openHolidayDialog, setOpenHolidayDialog] = useState(false)

  const [pendingHolidayValue, setPendingHolidayValue] = useState(false)

  const [holidayReason, setHolidayReason] = useState<string>("")

    const checkHolidayStatus = async () => {
    try {

      // ---------------- GET WORK SCHEDULE ----------------
      const configRes = await api.get("/api/config")

      const weeklyHolidays = configRes.data.data.weeklyHolidays || []


      // ---------------- WEEKLY HOLIDAY PRIORITY ----------------
      if (weeklyHolidays.includes(date)) {
        setHolidayReason("Weekly Holiday")
        return
      }

      // ---------------- CUSTOM HOLIDAY CHECK ----------------
      const holidayRes = await api.get(
        "/api/config/custom-holidays/check",
        {
          params: {
            date: date,
          },
        }
      )

      if (holidayRes.data.isHoliday) {
        setHolidayReason(holidayRes.data.reason)
      } else {
        setHolidayReason("")
      }

    } catch (error) {
      console.log(error)
    }
  }

  const handleHolidayToggle = (checked: boolean) => {
    setPendingHolidayValue(checked)

    setOpenHolidayDialog(true)
  }

  const confirmHolidayToggle = async () => {
    try {
      await api.patch(
        "/api/attendance/update/set-holiday",
        {
          date,
          isHoliday: pendingHolidayValue,
        }
      )

      setIsHoliday(pendingHolidayValue)

      toast.success(
        pendingHolidayValue
          ? "Holiday declared successfully"
          : "Holiday removed successfully"
      )

      setOpenHolidayDialog(false)
    } catch (error) {
      console.log(error)

      toast.error(
        "Failed to update holiday status"
      )
    }
  }

  const fetchSites = async () => {
    try {
      const res = await api.get(
        "/api/site"
      )

      setSites(res.data || [])
    } catch (error) {
      console.log(error)
    }
  }

  const fetchAttendance = async () => {
    try {
      setLoading(true)

      const res =
        await api.get<DailyResponse>(
          "/api/attendance/reports/daily",
          {
            params: {
              date,
              ...filters,
              site:
                filters.site ===
                "all"
                  ? ""
                  : filters.site,
            },
          }
        )

      setIsHoliday(res.data.isHoliday || false)

      setAttendance(res.data.data)

      setTotalPages(
        res.data.totalPages || 1
      )
    } catch (error: any) {
      toast.error(
        error?.response?.data
          ?.message ||
          "Failed to fetch attendance"
      )
    } finally {
      setLoading(false)
    }
  }


  useEffect(() => {
    fetchSites()
  }, [])

  useEffect(() => {
    checkHolidayStatus()
    fetchAttendance()
  }, [date, filters])

  const changeDate = ( direction: "prev" | "next" ) => {
    const current = new Date(date)

    if (direction === "prev") {
      current.setDate(
        current.getDate() - 1
      )
    } else {
      current.setDate(
        current.getDate() + 1
      )
    }

    const newDate =
      current.toLocaleDateString("en-CA")

    // prevent going beyond today
    if (newDate > todayDateString) {
      return
    }

    setDate(newDate)
  }

  const unlockAttendance = async (attendanceId: string) => {
    try {
      const selected = attendance.find(
        (item) =>
          item.attendanceId ===
          attendanceId
      )

      if (!selected) return

      await api.patch(
        "/api/attendance/unlock",
        {
          siteId: selected.siteId,

          date: new Date(
            selected.date
          ).toLocaleDateString(
            "en-CA"
          ),
        }
      )

      setEditingId(attendanceId)

      toast.success(
        "Attendance unlocked"
      )
    } catch (error: any) {
      toast.error(
        error?.response?.data
          ?.message ||
        "Failed to unlock attendance"
      )
    }
  }

  const updateField = (attendanceId: string, field: keyof Attendance, value: any) => {
    setAttendance((prev) =>
      prev.map((item) =>
        item.attendanceId ===
        attendanceId ? {
          ...item,
          [field]: value,
          } : item
      )
    )
  }

  const saveAttendance = async (attendanceId: string) => {
    try {
      setSaving(true)

      const selected =
        attendance.find(
          (item) =>
            item.attendanceId ===
            attendanceId
        )

      if (!selected) return

      await api.patch(`/api/attendance/update/${attendanceId}`,
        {
          status:
            selected.status,

          overtimeHours:
            Number(selected.overtimeHours) || 0,
        }
      )

      toast.success("Attendance updated")

      setEditingId(null)

      fetchAttendance()
    } catch (error: any) {
      toast.error(
        error?.response?.data
          ?.message ||
        "Failed to update attendance"
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
              <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("/attendance")}
                  className="w-fit"
              >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
              </Button>
        <Card>
          <CardContent className="space-y-6 p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h1 className="text-3xl font-bold">
                  Edit Attendance
                </h1>

                <p className="text-muted-foreground">
                  {formattedDate}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() =>changeDate("prev")
                  }
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                <Input
                  type="date"
                  value={date}
                  max={todayDateString}
                  onChange={(e) => { 
                    
                    const selectedDate = e.target.value

                    // prevent selecting future date
                    if (
                      selectedDate > todayDateString
                    ) {
                      toast.error(
                        "Future dates are not allowed"
                      )

                      setDate(todayDateString)

                      return
                    }

                    setDate(selectedDate)
                  }}
                  className="w-[180px]"
                />

                <Button
                  variant="outline"
                  size="icon"
                  onClick={() =>changeDate("next")}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
              <Input
                placeholder="Search name"
                value={filters.name}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    name: e.target.value,
                    page: 1,
                  })
                }
              />

              <Input
                placeholder="Employee ID"
                value={
                  filters.employeeId
                }
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    employeeId:
                      e.target.value,
                    page: 1,
                  })
                }
              />

              <Input
                placeholder="Job Title"
                value={
                  filters.jobTitle
                }
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    jobTitle:
                      e.target.value,
                    page: 1,
                  })
                }
              />

              <Select value={filters.site} onValueChange={(value) => setFilters({...filters, site: value, page: 1,})}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Site" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="all">
                    All Sites
                  </SelectItem>

                  {sites.map(
                    (site) => (
                      <SelectItem
                        key={
                          site._id
                        }
                        value={
                          site._id
                        }
                      >
                        {
                          site.siteName
                        }
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="holiday"
                  checked={isHoliday}
                  onCheckedChange={(checked) =>
                    handleHolidayToggle(checked === true)
                  }
                />

                <Label htmlFor="holiday">Holiday</Label>
              </div>

              {isHoliday && (
                <div className="pt-2">
                  <Badge
                    variant="secondary"
                    className="bg-yellow-100 text-yellow-800 border-yellow-300"
                  >
                    Holiday • {holidayReason}
                  </Badge>
                </div>
              )}
            </div>

             
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex min-h-[300px] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      Employee
                    </TableHead>

                    <TableHead>
                      Status
                    </TableHead>

                    <TableHead>
                      OT Hours
                    </TableHead>

                    <TableHead className="w-[180px]">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {attendance.length >
                  0 ? (
                    attendance.map(
                      (emp) => {
                        const isEditing =
                          editingId ===
                          emp.attendanceId

                        return (
                          <TableRow
                            key={
                              emp.attendanceId
                            }
                          >
                            <TableCell>
                              <div className="space-y-1">
                                <p className="font-medium">
                                  {
                                    emp.name
                                  }
                                </p>

                                <p className="text-sm text-muted-foreground">
                                  {
                                    emp.employeeId
                                  }{" "}
                                  •{" "}
                                  {
                                    emp.jobTitle
                                  }
                                </p>
                              </div>
                            </TableCell>

                            <TableCell>
                              {isEditing ? (
                                <Select
                                  value={
                                    emp.status
                                  }
                                  onValueChange={(
                                    value
                                  ) =>
                                    updateField(
                                      emp.attendanceId,
                                      "status",
                                      value
                                    )
                                  }
                                >
                                  <SelectTrigger className="w-[140px]">
                                    <SelectValue />
                                  </SelectTrigger>

                                  <SelectContent>
                                    <SelectItem value="present">
                                      Present
                                    </SelectItem>

                                    <SelectItem value="halfday">
                                      Half Day
                                    </SelectItem>

                                    <SelectItem value="absent">
                                      Absent
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className={
                                    emp.status ===
                                    "present"
                                      ? "border-green-500 bg-green-500/10 text-green-600"
                                      : emp.status ===
                                          "halfday"
                                        ? "border-yellow-500 bg-yellow-500/10 text-yellow-600"
                                        : "border-red-500 bg-red-500/10 text-red-600"
                                  }
                                >
                                  {emp.status}
                                </Badge>
                              )}
                            </TableCell>

                            <TableCell>
                              {isEditing ? (
                                <Input
                                  type="number"
                                  min={0}
                                  step={0.5}
                                  value={
                                    emp.overtimeHours
                                  }
                                  onChange={(
                                    e
                                  ) =>
                                    updateField(
                                      emp.attendanceId,
                                      "overtimeHours",
                                      e
                                        .target
                                        .value ===
                                      ""
                                        ? ""
                                        : Number(
                                            e
                                              .target
                                              .value
                                          )
                                    )
                                  }
                                  className="w-24"
                                />
                              ) : (
                                emp.overtimeHours
                              )}
                            </TableCell>

                            <TableCell>
                              <div className="flex items-center gap-2">
                                {isEditing ? (
                                  <>
                                    <Button
                                      size="sm"
                                      onClick={() =>
                                        saveAttendance(
                                          emp.attendanceId
                                        )
                                      }
                                      disabled={
                                        saving
                                      }
                                    >
                                      {saving ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Save className="h-4 w-4" />
                                      )}
                                    </Button>

                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        setEditingId(
                                          null
                                        )
                                      }
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      unlockAttendance(
                                        emp.attendanceId
                                      )
                                    }
                                  >
                                    <Pencil className="mr-2 h-4 w-4" />
                                    Edit
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      }
                    )
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-10 text-center text-muted-foreground"
                      >
                        No attendance records found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            disabled={
              filters.page === 1
            }
            onClick={() =>
              setFilters({
                ...filters,
                page:
                  filters.page - 1,
              })
            }
          >
            Previous
          </Button>

          <p className="text-sm text-muted-foreground">
            Page {filters.page} of{" "}
            {totalPages}
          </p>

          <Button
            variant="outline"
            disabled={
              filters.page ===
              totalPages
            }
            onClick={() =>
              setFilters({
                ...filters,
                page:
                  filters.page + 1,
              })
            }
          >
            Next
          </Button>
        </div>
        <AlertDialog
          open={openHolidayDialog}
          onOpenChange={setOpenHolidayDialog}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {pendingHolidayValue
                  ? "Declare holiday?"
                  : "Remove holiday?"}
              </AlertDialogTitle>

              <AlertDialogDescription>
                {pendingHolidayValue
                  ? "This day will be marked as a holiday for all employees. Are you sure you want to continue?"
                  : "This day will no longer be treated as a holiday. Are you sure you want to continue?"}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter>
              <AlertDialogCancel>
                Cancel
              </AlertDialogCancel>

              <AlertDialogAction
                onClick={confirmHolidayToggle}
              >
                Confirm
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}

export default EditPastAttendance