import { useEffect, useMemo, useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

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

import { Button } from "@/components/ui/button"

import { Input } from "@/components/ui/input"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Badge } from "@/components/ui/badge"

import { Separator } from "@/components/ui/separator"

import {
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react"

import { api } from "@/lib/api"

import toast from "react-hot-toast"
import { isCrossMidnight, isValidNightShiftTime, isCheckInInToggleRange } from "@/lib/dateUtils"

// --------------------------------------------------
// TYPES
// --------------------------------------------------

interface Job {
  _id: string
  name: string
}

interface Site {
  _id: string
  siteName: string
  locationDetails: string
  isActive: boolean
  jobs: Job[]
}

interface AttendanceSession {
  _id?: string

  siteId: string

  siteName?: string

  jobId?: string | null

  jobName?: string

  checkIn?: string | null

  checkOut?: string | null

  workedHours: number

  isNightShift?: boolean

  markedBy?: string
}

export interface AttendanceRecord {
  attendanceId: string

  employee: string

  name: string

  employeeId: string

  jobTitle: string

  siteId?: string

  siteName?: string

  jobId?: string | null

  jobName?: string

  date: string

  status?: "fullday" | "halfday" | "absent"

  isHoliday?: boolean

  totalWorkHours: number

  overtimeHours: number

  sessions: AttendanceSession[]
}

interface EditRecordProps {
  open: boolean

  onClose: () => void

  record: AttendanceRecord | null

  onUpdated: (updatedRecord: AttendanceRecord) => void
}

// --------------------------------------------------
// COMPONENT
// --------------------------------------------------

function EditRecord({ open, onClose, record, onUpdated }: EditRecordProps) {
  const [overlapInfo, setOverlapInfo] =
    useState<any>(null)

  const [overlapIndexes, setOverlapIndexes] =
    useState<number[]>([])

  const [sites, setSites] = useState<Site[]>([])

  const [sessions, setSessions] =
    useState<AttendanceSession[]>([])

  const [saving, setSaving] =
    useState(false)

  const [config, setConfig] =
    useState({
      fullDayHours: 8,
      halfDayHours: 4,
      overtimeThreshold: 8,
      nightShiftCutoffHour: 7,
    })

const [deleteDialogOpen, setDeleteDialogOpen] =
  useState(false)

const [sessionToDelete, setSessionToDelete] =
  useState<number | null>(null)

  // --------------------------------------------------
  // INITIALIZE
  // --------------------------------------------------

  useEffect(() => {
    setOverlapInfo(null)
    setOverlapIndexes([])
    if (record) {
      setSessions(record.sessions)
    }
  }, [open, record])

  useEffect(() => {
    fetchSites()
    fetchConfig()
  }, [])

  // --------------------------------------------------
  // FETCHERS
  // --------------------------------------------------

  const fetchSites = async () => {
    try {
      const res = await api.get("/api/site")

      setSites(res.data || [])
    } catch (error) {
      console.log(error)
    }
  }

  const fetchConfig = async () => {
    try {
      const res = await api.get(
        "/api/config"
      )

      setConfig({
        fullDayHours:
          res.data.data.fullDayHours,
        halfDayHours:
          res.data.data.halfDayHours,
        overtimeThreshold:
          res.data.data
            .overtimeThreshold,
        nightShiftCutoffHour:
          res.data.data.nightShiftCutoffHour ?? 7,
      })
    } catch (error) {
      console.log(error)
    }
  }

  // --------------------------------------------------
  // HELPERS
  // --------------------------------------------------

  const calculateWorkedHours = (
    checkIn?: string | null,
    checkOut?: string | null
  ) => {
    if (!checkIn || !checkOut)
      return 0

    const start = new Date(checkIn)
    const end = new Date(checkOut)

    const hours =
      (end.getTime() -
        start.getTime()) /
      (1000 * 60 * 60)

    if (hours < 0) return 0

    return Number(hours.toFixed(2))
  }

  // --------------------------------------------------
  // DERIVED VALUES
  // --------------------------------------------------

  const totalWorkHours = useMemo(() => {
    return Number(
      sessions
        .reduce(
          (acc, curr) =>
            acc + curr.workedHours,
          0
        )
        .toFixed(2)
    )
  }, [sessions])

  const overtimeHours = useMemo(() => {
    if (
      totalWorkHours <=
      config.overtimeThreshold
    )
      return 0

    return Number(
      (
        totalWorkHours -
        config.overtimeThreshold
      ).toFixed(2)
    )
  }, [
    totalWorkHours,
    config.overtimeThreshold,
  ])

  const status = useMemo(() => {
    if (
      totalWorkHours >=
      config.fullDayHours
    ) {
      return "fullday"
    }

    if (
      totalWorkHours >=
      config.halfDayHours
    ) {
      return "halfday"
    }

    return "absent"
  }, [
    totalWorkHours,
    config.fullDayHours,
    config.halfDayHours,
  ])

  // --------------------------------------------------
  // HANDLERS
  // --------------------------------------------------

 const updateSessionField = (
  index: number,
  field: keyof AttendanceSession | "isNightShift",
  value: any
 ) => {
  const updated = [...sessions]

  if (field === "isNightShift") {
    return
  }

  if (field === "checkIn" || field === "checkOut") {
    const checkInVal = field === "checkIn" ? value : toTimeValue(updated[index].checkIn)
    const checkOutVal = field === "checkOut" ? value : toTimeValue(updated[index].checkOut)

    // 1. RULE: checkout time cannot be > cutoffHour if checkin was before cutoffHour
    if (checkInVal && checkOutVal) {
      const [inH] = checkInVal.split(":").map(Number)
      const [outH, outM] = checkOutVal.split(":").map(Number)
      if (inH >= 0 && inH < config.nightShiftCutoffHour && outH * 60 + outM > config.nightShiftCutoffHour * 60) {
        toast.error(`Check-out time must be before or equal to the cutoff hour (${config.nightShiftCutoffHour}:00 AM) if checked in before ${config.nightShiftCutoffHour}:00 AM.`)
        return
      }
    }

    // 2. Auto-detect night shift
    let nextIsNight = false
    if (checkInVal) {
      const inRange = isCheckInInToggleRange(checkInVal, config.nightShiftCutoffHour)
      if (inRange) {
        nextIsNight = true
      }
      if (checkOutVal && isCrossMidnight(checkInVal, checkOutVal, false)) {
        nextIsNight = true
      }
    }

    // 3. Night shift cutoff validation
    if (nextIsNight) {
      if (checkInVal && !isValidNightShiftTime(checkInVal, config.nightShiftCutoffHour)) {
        toast.error(`Check-in time must be before the cutoff hour (${config.nightShiftCutoffHour}:00 AM) for night shifts.`)
        return
      }
      if (checkOutVal) {
        const [outH, outM] = checkOutVal.split(":").map(Number)
        if (outH * 60 + outM > config.nightShiftCutoffHour * 60) {
          toast.error(`Check-out time must be before or equal to the cutoff hour (${config.nightShiftCutoffHour}:00 AM) for night shifts.`)
          return
        }
      }
    }

    updated[index].isNightShift = nextIsNight

    // Combine date and time
    updated[index].checkIn = checkInVal ? combineDateAndTime(checkInVal, undefined, nextIsNight) : null
    updated[index].checkOut = checkOutVal ? combineDateAndTime(checkOutVal, checkInVal, nextIsNight) : null
    updated[index].workedHours = calculateWorkedHours(
      updated[index].checkIn,
      updated[index].checkOut
    )
  } else {
    updated[index] = {
      ...updated[index],
      [field as any]: value,
    }

    if (field === "siteId") {
      updated[index].jobId = null
    }
  }

  setOverlapInfo(null)
  setOverlapIndexes([])
  setSessions(updated)
 }

  const addSession = () => {
    setSessions([
      ...sessions,
      {
        siteId: "",
        jobId: null,
        checkIn: null,
        checkOut: null,
        workedHours: 0,
      },
    ])
  }

  const removeSession = (
    index: number
  ) => {
    const updated = [...sessions]

    updated.splice(index, 1)

    setSessions(updated)
  }

  // --------------------------------------------------
  // SAVE
  // --------------------------------------------------

 const updateARecord = async () => {
  try {
    if (!record) return

    // -------------------------
    // SITE VALIDATION
    // -------------------------

    const hasMissingSite =
      sessions.some(
        (session) => !session.siteId
      )

    if (hasMissingSite) {
      toast.error(
        "Every session must have a site selected"
      )

      return
    }

    // -------------------------
    // CHECK-IN / CHECK-OUT VALIDATION
    // -------------------------

    const hasCheckoutWithoutCheckin =
      sessions.some((session) => {
        return !session.checkIn && !!session.checkOut
      })

    if (hasCheckoutWithoutCheckin) {
      toast.error("Check-out cannot exist without check-in")
      return
    }


    // Validate night shift times
    for (const session of sessions) {
      if (session.isNightShift) {
        const inTime = toTimeValue(session.checkIn)
        const outTime = toTimeValue(session.checkOut)
        if (inTime && !isValidNightShiftTime(inTime, config.nightShiftCutoffHour)) {
          toast.error(`Check-in time must be before the cutoff hour (${config.nightShiftCutoffHour}:00 AM) for night shifts.`)
          return
        }
        if (outTime) {
          const [outH, outM] = outTime.split(":").map(Number)
          if (outH * 60 + outM > config.nightShiftCutoffHour * 60) {
            toast.error(`Check-out time must be before or equal to the cutoff hour (${config.nightShiftCutoffHour}:00 AM) for night shifts.`)
            return
          }
        }
      }
    }

    // Sort sessions chronologically by checkIn datetime. Empty checkIns go last.
    const sortedSessions = [...sessions].sort((a, b) => {
      if (!a.checkIn && !b.checkIn) return 0
      if (!a.checkIn) return 1
      if (!b.checkIn) return -1
      return new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime()
    })

    setSessions(sortedSessions)

    setSaving(true)

    const payload = {
      sessions: sortedSessions.map(
        (session) => ({
          _id: session._id,
          siteId: session.siteId,
          jobId: session.jobId || null,
          checkIn: session.checkIn || null,
          checkOut: session.checkOut || null,
          isNightShift: session.isNightShift || false,
        })
      ),
    }

      const res = await api.patch(
        `/api/attendance/update/${record.attendanceId}`,
        payload
      )

      onUpdated(res.data.attendance)

      toast.success(
        "Attendance updated successfully"
      )

      onClose()
   } catch (error: any) {
     console.log(error)

     const overlap =
       error?.response?.data?.overlap

     if (overlap) {
       setOverlapInfo(overlap)

       setOverlapIndexes([
         overlap.firstIndex,
         overlap.secondIndex,
       ])

       toast.error(
         error.response.data.message
       )

       return
     }

     toast.error(
       error?.response?.data?.message ||
       "Failed to update attendance"
     )
   } finally {
     setSaving(false)
   }
 }

  // --------------------------------------------------
  // UTIL
  // --------------------------------------------------

const toTimeValue = (
  date?: string | null
) => {
  if (!date) return ""

  const d = new Date(date)

  if (isNaN(d.getTime()))
    return ""

  const hours = String(
    d.getHours()
  ).padStart(2, "0")

  const minutes = String(
    d.getMinutes()
  ).padStart(2, "0")

  return `${hours}:${minutes}`
}

  const combineDateAndTime = (
    time: string | null,
    referenceCheckIn?: string,
    isNightShift: boolean = false
  ) => {
    if (!record?.date || !time)
      return null

    const [hours, minutes] =
      time.split(":")

    const date = new Date(record.date)

    date.setHours(Number(hours))
    date.setMinutes(Number(minutes))
    date.setSeconds(0)
    date.setMilliseconds(0)

    if (isNightShift) {
      // Night shift: AM times before cutoff → next day
      if (Number(hours) < config.nightShiftCutoffHour) {
        date.setDate(date.getDate() + 1)
      }
    } else if (referenceCheckIn) {
      // Cross-midnight detection
      const [inH, inM] = referenceCheckIn.split(":").map(Number)
      const inMin = inH * 60 + inM
      const outMin = Number(hours) * 60 + Number(minutes)
      if (outMin < inMin) {
        date.setDate(date.getDate() + 1)
      }
    }

    return date.toString()
  }

  // --------------------------------------------------
  // RENDER
  // --------------------------------------------------

  return (
    <Dialog
      open={open}
      onOpenChange={onClose}
    >
      <DialogContent className="!w-[92vw] !max-w-[1000px] h-[92vh] overflow-hidden p-0 flex flex-col rounded-2xl">

        {/* HEADER */}
        <div className="border-b bg-background px-8 py-5">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">
              Edit Attendance Record
            </DialogTitle>
          </DialogHeader>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">

          {/* EMPLOYEE INFO */}
          <div className="rounded-2xl border bg-muted/20 p-6">
            <h2 className="text-2xl font-bold">
              {record?.name}
            </h2>

            <div className="mt-2 space-y-1">
              <p className="text-sm text-muted-foreground">
                Employee ID:{" "}
                <span className="font-medium text-foreground">
                  {record?.employeeId}
                </span>
              </p>

              <p className="text-sm text-muted-foreground">
                Job Title:{" "}
                <span className="font-medium text-foreground">
                  {record?.jobTitle}
                </span>
              </p>
            </div>
          </div>

          {/* SESSIONS */}
          <div className="space-y-5">
            {sessions.map(
              (session, index) => {
                const selectedSite =
                  sites.find(
                    (site) =>
                      site._id ===
                      session.siteId
                  )

                return (
                  <div
                    key={
                      session._id ||
                      index
                    }
                    className={`rounded-2xl p-6 shadow-sm space-y-6 transition-colors ${overlapIndexes.includes(index)
                        ? "border-red-500 bg-red-50 dark:bg-red-950/20"
                        : "border bg-background"
                      }`}
                  >
                    {/* TOP */}
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold">
                          Session{" "}
                          {index + 1}
                        </h3>

                        <p className="text-sm text-muted-foreground">
                          Edit session details
                        </p>

                        {overlapIndexes.includes(index) && (
                          <p className="text-sm text-red-600 font-medium mt-2">
                            This session overlaps with another
                            session.
                          </p>
                        )}
                      </div>

                      <Button
                        variant="destructive"
                        size="icon"
                        onClick={() => {
                          setSessionToDelete(index)
                          setDeleteDialogOpen(true)
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* FORM */}
                    <div className="space-y-5">

                      {/* TOP ROW */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

                        {/* SITE */}
                        <div className="space-y-2">
                          <p className="text-sm font-medium">
                            Site
                          </p>

                          <Select
                            value={session.siteId}
                            onValueChange={(value) =>
                              updateSessionField(
                                index,
                                "siteId",
                                value
                              )
                            }
                          >
                            <SelectTrigger className="w-full h-11">
                              <SelectValue placeholder="Select site" />
                            </SelectTrigger>

                            <SelectContent>
                              {sites.map((site) => (
                                <SelectItem
                                  key={site._id}
                                  value={site._id}
                                >
                                  {site.siteName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* JOB */}
                        <div className="space-y-2">
                          <p className="text-sm font-medium">
                            Job
                          </p>

                          <Select
                            value={session.jobId || ""}
                            onValueChange={(value) =>
                              updateSessionField(
                                index,
                                "jobId",
                                value
                              )
                            }
                          >
                            <SelectTrigger className="w-full h-11">
                              <SelectValue placeholder="Select job" />
                            </SelectTrigger>

                            <SelectContent>
                              {selectedSite?.jobs.map(
                                (job) => (
                                  <SelectItem
                                    key={job._id}
                                    value={job._id}
                                  >
                                    {job.name}
                                  </SelectItem>
                                )
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* BOTTOM ROW */}
                      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">

                        {/* CHECK IN */}
                        <div className="space-y-2">
                          <p className="text-sm font-medium">
                            Check In
                          </p>

                          <Input
                            className="w-full h-11"
                            type="time"
                            value={toTimeValue(
                              session.checkIn
                            )}
                            onChange={(e) =>
                              updateSessionField(
                                index,
                                "checkIn",
                                e.target.value
                              )
                            }
                          />
                        </div>

                        {/* CHECK OUT */}
                        <div className="space-y-2">
                          <p className="text-sm font-medium">
                            Check Out
                          </p>

                          <Input
                            className="w-full h-11"
                            type="time"
                            value={toTimeValue(
                              session.checkOut
                            )}
                            onChange={(e) =>
                              updateSessionField(
                                index,
                                "checkOut",
                                e.target.value
                              )
                            }
                          />
                        </div>
                        {/* SHIFT */}
                        <div className="space-y-2">
                          <p className="text-sm font-medium">
                            Shift
                          </p>

                          <div className="flex items-center gap-2 h-11">
                            {(session.isNightShift || (toTimeValue(session.checkIn) && toTimeValue(session.checkOut) && isCrossMidnight(toTimeValue(session.checkIn), toTimeValue(session.checkOut), session.isNightShift))) ? (
                              <span className="inline-flex items-center gap-1.5 text-indigo-600 font-medium text-sm">
                                🌙 Night
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-sm font-medium">☀️ Day</span>
                            )}
                          </div>
                        </div>

                        {/* WORKED HOURS */}
                        <div className="space-y-2">
                          <p className="text-sm font-medium">
                            Worked Hours
                          </p>

                          <Input
                            readOnly
                            className="h-11 font-medium"
                            value={`${session.workedHours} hrs`}
                          />
                        </div>

                      </div>
                    </div>
                  </div>
                )
              }
            )}
          </div>

          {/* ADD SESSION */}
          <Button
            variant="outline"
            onClick={addSession}
            className="w-full border-dashed h-11"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add New Session
          </Button>

          {overlapInfo && (
            <div className="rounded-xl border border-red-500 bg-red-50 p-4">
              <h4 className="font-semibold text-red-700">
                Session Overlap Detected
              </h4>

              <div className="mt-3 text-sm text-red-700 space-y-2">
                <div>
                  <strong>
                    Session{" "}
                    {overlapInfo.firstIndex + 1}
                  </strong>

                  <br />

                  Check In:{" "}
                  {overlapInfo.sessionA.checkIn
                    ? new Date(
                      overlapInfo.sessionA.checkIn
                    ).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                    : "-"}

                  <br />

                  Check Out:{" "}
                  {overlapInfo.sessionA.checkOut
                    ? new Date(
                      overlapInfo.sessionA.checkOut
                    ).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                    : "-"}
                </div>

                <div>
                  <strong>
                    Session{" "}
                    {overlapInfo.secondIndex + 1}
                  </strong>

                  <br />

                  Check In:{" "}
                  {overlapInfo.sessionB.checkIn
                    ? new Date(
                      overlapInfo.sessionB.checkIn
                    ).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                    : "-"}

                  <br />

                  Check Out:{" "}
                  {overlapInfo.sessionB.checkOut
                    ? new Date(
                      overlapInfo.sessionB.checkOut
                    ).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                    : "-"}
                </div>
              </div>
            </div>
          )}

          {/* SUMMARY */}
          <div className="rounded-2xl border bg-muted/20 p-6 space-y-4">

            <div>
              <p className="text-sm text-muted-foreground">
                Total Work Hours
              </p>

              <p className="text-3xl font-bold">
                {totalWorkHours} hrs
              </p>
            </div>

            <Separator />

            <div>
              <p className="text-sm text-muted-foreground">
                Overtime Hours
              </p>

              <p className="text-3xl font-bold">
                {overtimeHours} hrs
              </p>
            </div>

            <Separator />

            <div>
              <p className="text-sm text-muted-foreground">
                Attendance Status
              </p>

              <Badge className="mt-2 text-sm">
                {status}
              </Badge>
            </div>
          </div>

         
        </div>

        {/* FOOTER */}
        <div className="border-t bg-background px-8 py-5 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={onClose}
          >
            Cancel
          </Button>

          <Button
            onClick={updateARecord}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </DialogContent>
      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete Session?
            </AlertDialogTitle>

            <AlertDialogDescription>
              This session will be permanently removed from the attendance record.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>
              Cancel
            </AlertDialogCancel>

            <AlertDialogAction
              onClick={() => {
                if (
                  sessionToDelete !== null
                ) {
                  removeSession(
                    sessionToDelete
                  )
                }

                setDeleteDialogOpen(false)

                setSessionToDelete(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}

export default EditRecord