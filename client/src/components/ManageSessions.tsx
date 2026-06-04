// ManageSession.tsx

interface AttendanceSession {
  _id: string

  siteId: string

  jobId?: {
    _id: string
    name: string
  } | null

  checkIn: string | null

  checkOut: string | null

  workedHours: number
}

interface AttendanceRecord {
  attendanceId: string

  employee: string

  name: string

  employeeId: string

  jobTitle: string

  siteId: string

  siteName: string

  date: string

  status:
    | "fullday"
    | "halfday"
    | "absent"

  isHoliday: boolean

  totalWorkHours: number

  overtimeHours: number

  sessions: AttendanceSession[]
}

interface Site {
  _id: string
  siteName: string
  locationDetails: string
  isActive: boolean
}

interface ManageSessionProps {
  open: boolean

  onClose: () => void

  record: AttendanceRecord | null

  site: Site | null

  onUpdated: (
    updatedRecord: AttendanceRecord
  ) => void
}

function ManageSession(_props: ManageSessionProps) {
  return null
}

export default ManageSession