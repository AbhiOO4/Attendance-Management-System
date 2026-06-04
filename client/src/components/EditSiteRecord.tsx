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

  status: "fullday" | "halfday" | "absent"

  isHoliday?: boolean

  totalWorkHours: number

  overtimeHours: number

  sessions: AttendanceSession[]
}

interface EditSiteRecordProps {
  open: boolean
  onClose: () => void
  attendanceId: string | null
  site: Site
  onUpdated: (updatedRecord: AttendanceRecord) => void
}

// --------------------------------------------------
// COMPONENT
// --------------------------------------------------

function EditSiteRecord({ open, onClose, attendanceId, site, onUpdated }: EditSiteRecordProps) {
  const [overlapInfo, setOverlapInfo] =
    useState<any>(null)

  const [overlapSessionIds, setOverlapSessionIds] = useState<string[]>([])

  const [record, setRecord] =
    useState<AttendanceRecord | null>(null)

  const [sessions, setSessions] =
    useState<AttendanceSession[]>([])

  const [saving, setSaving] =
    useState(false)

  const [config, setConfig] =
    useState({
      fullDayHours: 8,
      halfDayHours: 4,
      overtimeThreshold: 8,
    })

const [deleteDialogOpen, setDeleteDialogOpen] =
  useState(false)

const [sessionToDelete, setSessionToDelete] =
  useState<number | null>(null)

  // --------------------------------------------------
  // INITIALIZE
  // --------------------------------------------------

  const fetchAttendanceRecord = async () => {
    try {
      if (!attendanceId) return

      const res = await api.get(`/api/attendance/${attendanceId}`)

      const attendance = res.data

      setRecord(attendance)

      setSessions(
        attendance.sessions || []
      )
    } catch (error) {
      console.log(error)

      toast.error(
        "Failed to load attendance record"
      )
    }
  }

  useEffect(() => {
    if (open && attendanceId) {
      fetchAttendanceRecord()
    }
  }, [open, attendanceId])

  useEffect(() => {
    fetchConfig()
  }, [])

  // --------------------------------------------------
  // FETCHERS
  // --------------------------------------------------


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


  // --------------------------------------------------
  // VALIDATIONS
  // --------------------------------------------------

  const hasInvalidSession = sessions.some((session) => {
      const onlyOneExists =
        (session.checkIn &&
          !session.checkOut) ||
        (!session.checkIn &&
          session.checkOut)

      return onlyOneExists
    })


  const hasOverlappingSessions = sessions.some((sessionA, indexA) => {
      if (
        !sessionA.checkIn ||
        !sessionA.checkOut
      )
        return false

      const startA = new Date(
        sessionA.checkIn
      ).getTime()

      const endA = new Date(
        sessionA.checkOut
      ).getTime()

      return sessions.some(
        (sessionB, indexB) => {
          if (indexA === indexB)
            return false

          if (
            !sessionB.checkIn ||
            !sessionB.checkOut
          )
            return false

          const startB = new Date(
            sessionB.checkIn
          ).getTime()

          const endB = new Date(
            sessionB.checkOut
          ).getTime()

          return (
            startA < endB &&
            endA > startB
          )
        }
      )
    })

  // --------------------------------------------------
  // HANDLERS
  // --------------------------------------------------

 const updateSessionField = (
  index: number,
  field: keyof AttendanceSession,
  value: string | null
) => {
  const updated = [...sessions]

  let finalValue: string | null =
    value

  // convert HH:mm -> full ISO datetime
  if (
    field === "checkIn" ||
    field === "checkOut"
  ) {
    finalValue = combineDateAndTime(value)
  }

  updated[index] = {
    ...updated[index],
    [field]: finalValue,
  }

  // recalculate hours
  if (
    field === "checkIn" ||
    field === "checkOut"
  ) {
    updated[index].workedHours =
      calculateWorkedHours(
        updated[index].checkIn,
        updated[index].checkOut
      )
  }

  // reset job when site changes
  if (field === "siteId") {
    updated[index].jobId = null
  }

   setOverlapInfo(null)
   setOverlapSessionIds([])

  setSessions(updated)
}

const addSession = async () => {
  try {
    if (!record) return

    const payload = {
      session: {
        siteId: site._id,
        jobId: record.jobId || null,
        checkIn: null,
        checkOut: null,
      }
    }

    const res = await api.post(
      `/api/attendance/${record.attendanceId}/sessions`,
      payload
    )

    setSessions((prev) => [
      ...prev,
      res.data.session,
    ])

    // toast.success("Session added")
  } catch (error) {
    console.log(error)

    toast.error(
      "Failed to create session"
    )
  }
}

  const removeSession = (
    index: number
  ) => {
    const updated = [...sessions]

    if (sessions.length == 1){
      return toast.error("Cannot delete!, Sessions can't be empty")
    }

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
    // CHECK-IN / CHECK-OUT VALIDATION
    // -------------------------

    const hasIncompleteSession =
      sessions.some((session) => {
        const hasCheckIn =
          !!session.checkIn

        const hasCheckOut =
          !!session.checkOut

        return (
          (hasCheckIn &&
            !hasCheckOut) ||
          (!hasCheckIn &&
            hasCheckOut)
        )
      })

    if (hasIncompleteSession) {
      toast.error(
        "Check-in and check-out must both be filled or both be empty"
      )

      return
    }


      setSaving(true)

      const payload = {
        sessions: sessions.map(
          (session) => ({
            _id: session._id,

            siteId: session.siteId,

            jobId:
              session.jobId || null,

            checkIn:
              session.checkIn || null,

            checkOut:
              session.checkOut || null,
          })
        ),
      }

      const res = await api.patch(
        `/api/attendance/update/${record.attendanceId}`,
        payload
      )

    const updatedRecord = {
      ...res.data.attendance,
      sessions: res.data.attendance.sessions.filter(
        (session: AttendanceSession) =>
          String(session.siteId) === String(site._id)
      ),
    }

    onUpdated(updatedRecord)

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

       setOverlapSessionIds([
         overlap.sessionA._id,
         overlap.sessionB._id,
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

  const combineDateAndTime = (time: string | null) => {
    if (!record?.date || !time)
      return null

    const [hours, minutes] =
      time.split(":")

    const date = new Date(record.date)

    date.setHours(Number(hours))
    date.setMinutes(Number(minutes))
    date.setSeconds(0)
    date.setMilliseconds(0)

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
            {sessions.map((session, index) => {
              const isEditable =
                String(session.siteId) === String(site._id)

              const hasOverlap =
                session._id &&
                overlapSessionIds.includes(
                  String(session._id)
                )

              return (
                <div
                  key={session._id || index}
                  className={`rounded-2xl p-6 shadow-sm space-y-6 transition-colors ${hasOverlap
                      ? "border-red-500 bg-red-50"
                      : isEditable
                        ? "border bg-background"
                        : "border bg-muted/20 opacity-50"
                    }`}
                >
                  {/* TOP */}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold">
                          Session {index + 1}
                        </h3>

                        {!isEditable && (
                          <Badge variant="secondary">
                            Read Only
                          </Badge>
                        )}
                      </div>

                      <p className="text-sm text-muted-foreground">
                        Site:{" "}
                        {session.siteName ||
                          "Unknown Site"}
                      </p>

                      {hasOverlap && (
                          <p className="text-sm text-red-600 font-medium mt-2">
                            This session overlaps
                            with another session.
                          </p>
                        )}
                    </div>

                    {isEditable && (
                      <Button
                        variant="destructive"
                        size="icon"
                        onClick={() => {
                          setSessionToDelete(
                            index
                          )

                          setDeleteDialogOpen(
                            true
                          )
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  {/* FORM */}
                  <div className="space-y-5">

                    {/* JOB */}
                    <div className="space-y-2">
                      <p className="text-sm font-medium">
                        Job
                      </p>

                      {isEditable ? (
                        <Select
                          value={
                            session.jobId ||
                            "not-assigned"
                          }
                          onValueChange={(
                            value
                          ) =>
                            updateSessionField(
                              index,
                              "jobId",
                              value ===
                                "not-assigned"
                                ? null
                                : value
                            )
                          }
                        >
                          <SelectTrigger className="w-full h-11">
                            <SelectValue placeholder="Select job" />
                          </SelectTrigger>

                          <SelectContent>
                            <SelectItem value="not-assigned">
                              Not Assigned
                            </SelectItem>

                            {site.jobs.map(
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
                      ) : (
                        <Input
                          readOnly
                          value={
                            session.jobName ||
                            "Not Assigned"
                          }
                        />
                      )}
                    </div>

                    {/* TIMES */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

                      {/* CHECK IN */}
                      <div className="space-y-2">
                        <p className="text-sm font-medium">
                          Check In
                        </p>

                        <Input
                          disabled={!isEditable}
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
                          disabled={!isEditable}
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
            })}
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

export default EditSiteRecord