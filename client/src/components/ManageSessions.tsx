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

  siteId: string

  siteName: string

  jobId?: string | null

  jobName?: string

  date: string

  status: "fullday" | "halfday" | "absent"

  isHoliday: boolean

  totalWorkHours: number

  overtimeHours: number

  sessions: AttendanceSession[]
}

interface Props {
  open: boolean

  onClose: () => void

  record: AttendanceRecord | null

  site: Site,

  onUpdated: (updatedRecord: AttendanceRecord) => void
}

function ManageSessions({open, onClose, record,site, onUpdated}: Props) {
    const [sessions, setSessions] = useState<AttendanceSession[]>([])

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
    
    useEffect(() => {
        if (record) {
            setSessions(record.sessions)
        }
    }, [record])

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

    const combineDateAndTime = (time: string) => {
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


    const status = useMemo(() => {
        if (totalWorkHours >= config.fullDayHours) {
            return "fullday"
        }

        if (totalWorkHours >= config.halfDayHours) {
            return "halfday"
        }

        return "absent"
    }, [totalWorkHours, config.fullDayHours, config.halfDayHours])

    const updateSessionField = (index: number, field: keyof AttendanceSession, value: string) => {
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

        setSessions(updated)
    }

    const addSession = () => {
        setSessions([
            ...sessions,
            {
                siteId: site._id,
                jobId: null,
                checkIn: null,
                checkOut: null,
                workedHours: 0,
            },
        ])
    }

    const removeSession = (index: number) => {
        const updated = [...sessions]

        updated.splice(index, 1)

        setSessions(updated)
    }

    const toTimeValue = (date?: string | null) => {
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

    const updateARecord = async () => {
        try {
            if (!record) return

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

            onUpdated(res.data.attendance)

            toast.success(
                "Attendance updated successfully"
            )

            onClose()
        } catch (error) {
            console.log(error)

            toast.error(
                "Failed to update attendance"
            )
        } finally {
            setSaving(false)
        }
    }


    useEffect(() => {
        fetchConfig()
    }, [])

    return (
        <div>

        </div>
    )
}

export default ManageSessions
