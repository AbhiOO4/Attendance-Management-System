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
  X,
} from "lucide-react"

import { api } from "@/lib/api"

import toast from "react-hot-toast"
import { isCrossMidnight, validateSessionTimes, combineDateAndTime, toLocalTimeString as toTimeValue, formatLocalTime12h } from "@/lib/dateUtils"

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

  const [sessionErrors, setSessionErrors] = useState<Record<number, string>>({})

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

  const [initialSessions, setInitialSessions] = useState<AttendanceSession[]>([])
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)

  const isSameDateStr = (d1?: string | null, d2?: string | null) => {
    if (!d1 && !d2) return true
    if (!d1 || !d2) return false
    const t1 = new Date(d1).getTime()
    const t2 = new Date(d2).getTime()
    return t1 === t2
  }

  const areSessionsEqual = (s1: AttendanceSession[], s2: AttendanceSession[]) => {
    if (s1.length !== s2.length) return false
    for (let i = 0; i < s1.length; i++) {
      const a = s1[i]
      const b = s2[i]
      if (a.siteId !== b.siteId) return false
      if ((a.jobId || null) !== (b.jobId || null)) return false
      if (!isSameDateStr(a.checkIn, b.checkIn)) return false
      if (!isSameDateStr(a.checkOut, b.checkOut)) return false
    }
    return true
  }

  const isDirty = !areSessionsEqual(sessions, initialSessions)

  const handleCloseAttempt = () => {
    if (isDirty) {
      setShowDiscardConfirm(true)
    } else {
      onClose()
    }
  }

  const handleConfirmDiscard = () => {
    setShowDiscardConfirm(false)
    onClose()
  }

  const handleCancelDiscard = () => {
    setShowDiscardConfirm(false)
  }

  // --------------------------------------------------
  // INITIALIZE
  // --------------------------------------------------

  useEffect(() => {
    setOverlapInfo(null)
    setOverlapIndexes([])
    if (open && record) {
      const cloned = JSON.parse(JSON.stringify(record.sessions || []))
      setSessions(cloned)
      setInitialSessions(JSON.parse(JSON.stringify(record.sessions || [])))
    } else {
      setSessions([])
      setInitialSessions([])
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

    // Auto-detect and preserve night shift based on original session state, preventing keystroke pollution
    const originalSession = record?.sessions?.find((s: any) => s._id === updated[index]._id)
    const originalIsNight = originalSession?.isNightShift || false
    let nextIsNight = false
    if (checkInVal) {
      const [inH] = checkInVal.split(":").map(Number)
      const isDayOnlyCheckIn = inH >= config.nightShiftCutoffHour && inH < 12 // 7 AM to 12 PM
      if (originalIsNight) {
        nextIsNight = !isDayOnlyCheckIn
      } else {
        const inRange = inH >= 0 && inH < config.nightShiftCutoffHour
        const crossesMidnight = checkOutVal ? isCrossMidnight(checkInVal, checkOutVal, false) : false
        nextIsNight = inRange || crossesMidnight
      }
    } else {
      nextIsNight = originalIsNight
    }

    updated[index].isNightShift = nextIsNight

    // Combine date and time
    updated[index].checkIn = checkInVal ? combineDateAndTime(record?.date || "", checkInVal, undefined, nextIsNight, config.nightShiftCutoffHour) : null
    updated[index].checkOut = checkOutVal ? combineDateAndTime(record?.date || "", checkOutVal, checkInVal, nextIsNight, config.nightShiftCutoffHour) : null
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

  setSessionErrors((prev) => {
    const next = { ...prev }
    delete next[index]
    return next
  })

  setOverlapInfo(null)
  setOverlapIndexes([])
  setSessions(updated)
 }

  const addSession = () => {
    // Prevent adding if there is any incomplete session in the list
    const hasIncomplete = sessions.some((s) => !s.siteId || !s.checkIn || !s.checkOut)
    if (hasIncomplete) {
      toast.error("Please complete the existing sessions before adding a new one.")
      return
    }
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
    // SESSION COMPLETION VALIDATION
    // -------------------------
    const sessionsBySite: Record<string, typeof sessions> = {}
    sessions.forEach((s) => {
      if (s.siteId) {
        if (!sessionsBySite[s.siteId]) {
          sessionsBySite[s.siteId] = []
        }
        sessionsBySite[s.siteId].push(s)
      }
    })

    let validationErrorMsg = ""
    Object.keys(sessionsBySite).forEach((siteId) => {
      const siteGroup = sessionsBySite[siteId]
      
      const sorted = [...siteGroup].sort((a, b) => {
        if (!a.checkIn && !b.checkIn) return 0
        if (!a.checkIn) return 1
        if (!b.checkIn) return -1
        return new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime()
      })

      for (let i = 0; i < sorted.length; i++) {
        const s = sorted[i]
        const isLast = i === sorted.length - 1
        const isEmpty = !s.checkIn && !s.checkOut
        const isHalfFilled = s.checkIn && !s.checkOut

        if (!isLast) {
          if (isEmpty || isHalfFilled) {
            validationErrorMsg = "All previous sessions at the same site must be fully completed (both check-in and check-out filled)."
            break
          }
        } else {
          if (sorted.length > 1 && isEmpty) {
            validationErrorMsg = "Empty sessions are not allowed when multiple sessions exist for the same site."
            break
          }
        }
      }
    })

    if (validationErrorMsg) {
      toast.error(validationErrorMsg)
      return
    }

    // Validate times using helper
    let hasError = false
    const errors: Record<number, string> = {}
    sessions.forEach((session, index) => {
      const inTime = toTimeValue(session.checkIn)
      const outTime = toTimeValue(session.checkOut)
      const err = validateSessionTimes(inTime, outTime, session.isNightShift, config.nightShiftCutoffHour)
      if (err) {
        errors[index] = err
        hasError = true
      }
    })

    if (hasError) {
      setSessionErrors(errors)
      return
    }
    setSessionErrors({})

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



  // --------------------------------------------------
  // RENDER
  // --------------------------------------------------

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          handleCloseAttempt()
        }
      }}
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
                    className={`rounded-2xl p-6 shadow-sm space-y-6 transition-colors ${
                      (overlapIndexes.includes(index) || !!sessionErrors[index])
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

                      {sessionErrors[index] && (
                        <div className="text-red-500 text-sm font-medium mt-2">
                          {sessionErrors[index]}
                        </div>
                      )}
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
            <div className="rounded-xl border border-red-500 bg-red-50 p-4 dark:bg-red-950/20 dark:border-red-800/30">
              <h4 className="font-semibold text-red-700 dark:text-red-200">
                Session Overlap Detected
              </h4>

              <div className="mt-3 text-sm text-red-700 dark:text-red-300 space-y-2">
                <div>
                  <strong>
                    Session{" "}
                    {overlapInfo.firstIndex + 1}
                  </strong>

                  <br />

                  Check In:{" "}
                  {overlapInfo.sessionA.checkIn
                    ? formatLocalTime12h(overlapInfo.sessionA.checkIn)
                    : "-"}

                  <br />

                  Check Out:{" "}
                  {overlapInfo.sessionA.checkOut
                    ? formatLocalTime12h(overlapInfo.sessionA.checkOut)
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
                    ? formatLocalTime12h(overlapInfo.sessionB.checkIn)
                    : "-"}

                  <br />

                  Check Out:{" "}
                  {overlapInfo.sessionB.checkOut
                    ? formatLocalTime12h(overlapInfo.sessionB.checkOut)
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
            onClick={handleCloseAttempt}
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
      <AlertDialog
        open={showDiscardConfirm}
        onOpenChange={setShowDiscardConfirm}
      >
        <AlertDialogContent>
          <button
            onClick={handleCancelDiscard}
            className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Unsaved Changes
            </AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Are you sure you want to discard them?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={handleConfirmDiscard}
            >
              Discard Changes
            </Button>
            <Button
              onClick={async () => {
                setShowDiscardConfirm(false)
                await updateARecord()
              }}
            >
              Save Changes
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}

export default EditRecord