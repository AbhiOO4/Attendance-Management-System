import { api } from "@/lib/api"
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment, memo } from "react"
import { useWorkConfig } from "@/context/WorkConfigContext"
import toast from "react-hot-toast"
import { useNavigate, useParams } from "react-router-dom"
import EditSiteRecord from "@/components/EditSiteRecord"
import BulkAssignNightShift from "@/components/BulkAssignNightShift"
import TransferEmployeeModal from "@/components/TransferEmployeeModal"
import UpdateDefaultsDialog, { type DefaultChange } from "@/components/sites/UpdateDefaultsDialog"
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog"
import { getCurrentTargetDateString, hoursFromOffset, isCrossMidnight, formatLogicalDateLabel, formatCurrentDateLabel, getCurrentTargetDayName, getCurrentTargetTime, validateSessionTimesV2, deriveOffsets, combineFromOffset, toLocalTimeString as toTimeValue, formatLocalTime12h } from "@/lib/dateUtils"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { Button } from "@/components/ui/button"

import { Input } from "@/components/ui/input"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { Badge } from "@/components/ui/badge"


import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"

import {
  Loader2,
  Pencil,
  Plus,
  Save,
  X,
  ArrowLeft,
  Clock3,
  Undo,
  Moon,
  Sun,
  Calendar,
  Users,
  MoreVertical,
  Check,
  ArrowLeftRight,
  ChevronDown,
} from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { cn } from "@/lib/utils"
import { Plane } from "lucide-react"

// The four roster categories (collarType × nationality), their labels and the
// ✈️ foreign marker live in a shared module so SiteDetail stays in sync.
import {
  categoryOf,
  CATEGORY_LABELS,
  CATEGORY_IS_FOREIGN,
  type CollarType,
  type Nationality,
  type RosterCategory,
} from "@/lib/rosterUtils"

interface Employee {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
  currentSite: string | null
  currentJob: Job | null
  user: string | null
  employmentType?: 'permanent' | 'temporary'
  collarType?: CollarType
  nationality?: Nationality
  pendingTransferCheckIn?: string | null
  pendingTransferSiteId?: string | null
  pendingTransferDate?: string | null
  // Populated source site of a pending transfer into the current site.
  pendingTransferFromSiteId?: { _id: string; siteName: string } | null
}

// Source site of an inbound transfer, shown as the "Transferred from" badge.
type TransferredFrom = { siteId: string; name: string } | null

interface EmployeesResponse {
  employees: Employee[]
}

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
  defaultCheckIn?: string
  defaultCheckOut?: string
  nightDefaultCheckIn?: string
  nightDefaultCheckOut?: string
  staffDefaultCheckIn?: string
  staffDefaultCheckOut?: string
  staffNightDefaultCheckIn?: string
  staffNightDefaultCheckOut?: string
  omaniDefaultCheckIn?: string
  omaniDefaultCheckOut?: string
  omaniNightDefaultCheckIn?: string
  omaniNightDefaultCheckOut?: string
  omaniStaffDefaultCheckIn?: string
  omaniStaffDefaultCheckOut?: string
  omaniStaffNightDefaultCheckIn?: string
  omaniStaffNightDefaultCheckOut?: string
}

export interface AttendanceSession {
  _id?: string

  siteId: string,

  jobId: string | null,

  checkIn: string | null

  checkOut: string | null

  workedHours: number

  isNightShift?: boolean

  manuallyCleared?: boolean
}

export interface AttendanceRecord {
  attendanceId: string

  employee: string

  name: string

  employeeId: string

  jobTitle: string

  status: "fullday" | "halfday" | "absent"

  totalWorkHours: number

  overtimeHours: number

  date: string

  sessions: AttendanceSession[]

  user?: string | null

  employmentType?: 'permanent' | 'temporary'

  collarType?: CollarType

  nationality?: Nationality

  breaksTaken?: number | null

  totalRawHours?: number

  isSickLeave?: boolean

  // Set (day-scoped) when this employee was transferred into this site.
  transferredFrom?: TransferredFrom
}



interface FetchedAttendance {
  totalRecords: number,
  isHoliday: boolean,
  data: AttendanceRecord[]
}

interface DraftSession {
  siteId: string,
  job: Job | null,
  checkIn: string,
  checkOut: string,
  workedHours: number,
  isNightShift: boolean
  // True when the supervisor deliberately cleared this session (Absent button /
  // manually emptied check-in). Immune to empty→time default propagation.
  manuallyCleared?: boolean
}
//siteId, date, isHoliday are common fields
interface DraftAttendanceRecord {
  employee: {
    _id: string,
    name: string,
    user?: string | null,
    employmentType?: 'permanent' | 'temporary'
  }, //refering to the employee models object id
  employeeId: string,
  jobTitle: string,
  collarType?: CollarType,
  nationality?: Nationality,
  jobId: string | null,
  sessions: DraftSession[]
  breaksTaken?: number | null
  isSickLeave?: boolean
  // Snapshot of the first session's times before sick leave cleared them,
  // so toggling sick leave back off restores what was there.
  sickClearedSession?: {
    checkIn: string
    checkOut: string
    isNightShift: boolean
    workedHours: number
  } | null
  // Set when this employee was transferred into this site (pending transfer).
  transferredFrom?: TransferredFrom
}


interface DraftAttendancePayload {
  siteId: string,
  date: string,
  isHoliday: boolean
  attendance : DraftAttendanceRecord[]
}

// Search query filter type is a single string

type CategoryFilter = 'temporary' | null

type OverlapError = {
  employeeId: string

  conflictingSession: {
    siteId: string
    siteName: string
    checkIn: string
    checkOut: string
  }
}

const formatConflictingSessionTime = (overlap: OverlapError | null) => {
  if (!overlap?.conflictingSession) return ""
  const { checkIn, checkOut } = overlap.conflictingSession
  const inStr = checkIn ? formatLocalTime12h(checkIn) : ""
  const outStr = checkOut ? formatLocalTime12h(checkOut) : "Present"
  return `${inStr} - ${outStr}`
}

const isSessionNonEmpty = (session?: { checkIn?: string | null; checkOut?: string | null }) => {
  return !!session?.checkIn || !!session?.checkOut
}

// A record has an open session while any session is checked in but not out.
// Break auto-calc can't finalize until every session is closed, so the saved
// display shows "Auto" instead of a provisional number in that state.
const hasOpenSession = (
  record: { sessions: Array<{ checkIn?: string | null; checkOut?: string | null }> }
) => record.sessions.some((s) => !!s.checkIn && !s.checkOut)

/**
 * Blank the draft sessions of employees who still have an open shift from yesterday.
 *
 * An employee mid-carryover cannot also have started today, so today's row must be empty
 * (absent) until the carryover is closed — the same rule the fresh-roster build applies.
 * This covers the paths that bypass that build: a draft restored from localStorage, and the
 * moment a carryover is closed. `manuallyCleared` stays false so this is treated as "not
 * marked yet", not as a deliberate absence.
 */
const clearCarryoverSessions = (
  records: DraftAttendanceRecord[],
  carryoverIds: Set<string>
): DraftAttendanceRecord[] => {
  if (!carryoverIds || carryoverIds.size === 0) return records
  return records.map((rec) =>
    carryoverIds.has(String(rec.employee._id))
      ? {
          ...rec,
          sessions: rec.sessions.map((s) => ({
            ...s,
            checkIn: "",
            checkOut: "",
            workedHours: 0,
            isNightShift: false,
            manuallyCleared: false,
          })),
        }
      : rec
  )
}

const isEmployeeAbsent = (
  sessions: Array<{ siteId: string; checkIn?: string | null; checkOut?: string | null }>,
  currentSiteId?: string
) => {
  if (!currentSiteId) return false
  const siteSessions = sessions.filter(s => String(s.siteId) === String(currentSiteId))
  return siteSessions.length === 0 || siteSessions.every(s => !s.checkIn && !s.checkOut)
}

const AbsentIndicator = () => (
  <span className="relative flex h-2.5 w-2.5 shrink-0" title="Absent">
    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
  </span>
)

const SickLeaveBadge = () => (
  <Badge
    variant="secondary"
    className="bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300 border border-sky-200/50 dark:border-sky-800/30 text-[10px] px-1.5 py-0 h-4"
  >
    Sick Leave
  </Badge>
)

// Shown (day-scoped) on employees transferred into the current site so the
// supervisor knows where they came from. These rows are also floated to the top.
const TransferredFromBadge = ({ siteName }: { siteName: string }) => (
  <Badge
    variant="secondary"
    className="bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300 border border-violet-200/50 dark:border-violet-800/30 text-[10px] px-1.5 py-0 h-4"
    title={`Transferred from ${siteName}`}
  >
    Transferred from {siteName}
  </Badge>
)

// Shown on an employee's today-row when they have an OPEN (un-checked-out) session on
// yesterday's record for this site. Persists all day (the prominent pinned card above
// the roster only shows before noon; this row badge is what remains after — and stays
// clickable so a forgotten check-out can still be closed once the card is gone).
const CarryoverBadge = ({ onClick }: { onClick?: () => void }) => (
  <Badge
    variant="secondary"
    onClick={onClick}
    className={cn(
      "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/30 text-[10px] px-1.5 py-0 h-4",
      onClick && "cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/40"
    )}
    title="Open check-out from yesterday's night shift — click to close it"
  >
    ⏳ Carryover
  </Badge>
)

/**
 * Per-row 3-dot actions menu. Currently only exposes the Sick Leave toggle,
 * but is the home for future row-level actions. The green tick on the left of
 * the item reflects the current sick-leave state.
 */
function RowActionsMenu({
  isSick,
  onToggleSick,
  saving = false,
  showSick = true,
  sickDisabled = false,
  sickDisabledReason,
  showTransfer = false,
  onTransfer,
  transferDisabled = false,
  transferDisabledReason,
  transferSaving = false,
}: {
  isSick: boolean
  onToggleSick: () => void
  saving?: boolean
  showSick?: boolean
  sickDisabled?: boolean
  sickDisabledReason?: string
  showTransfer?: boolean
  onTransfer?: () => void
  transferDisabled?: boolean
  transferDisabledReason?: string
  transferSaving?: boolean
}) {
  const [open, setOpen] = useState(false)

  // Touch-threshold gating: on touch devices a finger that lands on the kebab
  // and then scrolls should NOT open the menu. We track the touch start point
  // and only treat it as a deliberate tap if the finger stayed within a small
  // movement threshold. Mouse/keyboard fall through to Radix's default.
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const touchMoved = useRef(false)
  const MOVE_THRESHOLD = 10 // px

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          title="More actions"
          onPointerDown={(e) => {
            // Suppress Radix's built-in open-on-pointerdown for touch so a
            // scroll gesture can't trigger it; we decide on touch end instead.
            if (e.pointerType === "touch") e.preventDefault()
          }}
          onTouchStart={(e) => {
            const t = e.touches[0]
            touchStart.current = { x: t.clientX, y: t.clientY }
            touchMoved.current = false
          }}
          onTouchMove={(e) => {
            if (!touchStart.current) return
            const t = e.touches[0]
            if (
              Math.abs(t.clientX - touchStart.current.x) > MOVE_THRESHOLD ||
              Math.abs(t.clientY - touchStart.current.y) > MOVE_THRESHOLD
            ) {
              touchMoved.current = true
            }
          }}
          onTouchEnd={() => {
            // Deliberate tap (no meaningful movement) → toggle the menu.
            if (touchStart.current && !touchMoved.current) {
              setOpen((o) => !o)
            }
            touchStart.current = null
          }}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {showSick && (
          <DropdownMenuItem
            disabled={saving || sickDisabled}
            title={sickDisabled ? sickDisabledReason : undefined}
            onSelect={(e) => {
              e.preventDefault()
              if (!saving && !sickDisabled) onToggleSick()
            }}
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check
                className={cn(
                  "mr-2 h-4 w-4 text-emerald-600",
                  isSick ? "opacity-100" : "opacity-0"
                )}
              />
            )}
            Sick Leave
          </DropdownMenuItem>
        )}
        {showTransfer && (
          <DropdownMenuItem
            disabled={transferSaving || transferDisabled}
            title={transferDisabled ? transferDisabledReason : undefined}
            onSelect={(e) => {
              e.preventDefault()
              if (!transferSaving && !transferDisabled) onTransfer?.()
            }}
          >
            {transferSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ArrowLeftRight className="mr-2 h-4 w-4" />
            )}
            Transfer
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface DraftRowProps {
  record: DraftAttendanceRecord
  siteId?: string
  breakDurationMinutes: number
  fullDayHours: number
  /** Overlap details when this row conflicts with another session, else null. */
  overlap: OverlapError | null
  /** True when this row was just cleared and can be undone. */
  showUndo: boolean
  /** True when this employee has an open (un-checked-out) session on yesterday's record. */
  hasCarryover?: boolean
  /** Opens yesterday's carryover record for this employee so its check-out can be filled. */
  onOpenCarryover?: (employeeId: string) => void
  onUpdateSession: (employeeId: string, sessionIndex: number, field: "checkIn" | "checkOut", value: string) => void
  onToggleSick: (employeeId: string) => void
  onUpdateBreaks: (employeeId: string, value: number | null) => void
  onClearSession: (employeeId: string, sessionIndex: number) => void
  onUndoClear: () => void
}

/**
 * Memoized draft rows (mobile card + desktop table row). Draft edits update
 * one record while the rest keep their identity, so React.memo lets every
 * other row skip re-rendering on each keystroke — the main render cost on
 * sites with large rosters.
 */
const DraftAttendanceMobileCard = memo(function DraftAttendanceMobileCard({
  record,
  siteId,
  breakDurationMinutes,
  fullDayHours,
  overlap,
  showUndo,
  hasCarryover,
  onOpenCarryover,
  onUpdateSession,
  onToggleSick,
  onUpdateBreaks,
  onClearSession,
  onUndoClear,
}: DraftRowProps) {
  const session = record.sessions[0]

  return (
    <Card
      className={
        overlap
          ? "border-red-500"
          : ""
      }
    >
      <CardContent className="space-y-4 pt-4">

        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium">
                {record.employee.name}
              </p>
              {record.employee.user && (
                <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-800/30 text-[10px] px-1.5 py-0 h-4">
                  Supervisor
                </Badge>
              )}
              {record.employee.employmentType === 'temporary' && (
                <Badge variant="secondary" className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/30 text-[10px] px-1.5 py-0 h-4">
                  Temporary
                </Badge>
              )}
              {record.transferredFrom && (
                <TransferredFromBadge siteName={record.transferredFrom.name} />
              )}
              {hasCarryover && <CarryoverBadge onClick={() => onOpenCarryover?.(record.employee._id)} />}
            </div>

            <p className="text-sm text-muted-foreground">
              {record.employeeId} • {record.jobTitle}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {record.isSickLeave ? (
              <SickLeaveBadge />
            ) : isEmployeeAbsent(record.sessions, siteId) ? (
              <AbsentIndicator />
            ) : null}
            <RowActionsMenu
              isSick={!!record.isSickLeave}
              onToggleSick={() => onToggleSick(record.employee._id)}
              showTransfer
              transferDisabled
              transferDisabledReason="Save attendance before transferring"
              onTransfer={() => {}}
            />
          </div>
        </div>

        {hasCarryover && (
          <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-2.5 space-y-2 dark:border-amber-800/50 dark:bg-amber-950/20">
            <p className="text-[11px] text-amber-800 dark:text-amber-300">
              This employee is still on yesterday's shift. Enter their check-out to unlock today.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="w-full h-9 gap-1.5 bg-background border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-800/60 dark:text-amber-300 dark:hover:bg-amber-950/30 dark:hover:text-amber-200"
              onClick={() => onOpenCarryover?.(record.employee._id)}
            >
              <Clock3 className="h-4 w-4" />
              Check out yesterday's shift
            </Button>
          </div>
        )}

        <Input
          type="time"
          value={session.checkIn}
          disabled={!!record.isSickLeave || !!hasCarryover}
          onChange={(e) =>
            onUpdateSession(
              record.employee._id,
              0,
              "checkIn",
              e.target.value
            )
          }
        />

        <Input
          type="time"
          value={session.checkOut}
          disabled={!!record.isSickLeave || !!hasCarryover}
          onChange={(e) =>
            onUpdateSession(
              record.employee._id,
              0,
              "checkOut",
              e.target.value
            )
          }
        />

        <div className="text-sm font-medium flex items-center gap-1.5">
          <span>Shift:</span>
          {(session.isNightShift || (session.checkIn && session.checkOut && isCrossMidnight(session.checkIn, session.checkOut, session.isNightShift))) ? (
            <span className="inline-flex items-center gap-1 text-indigo-600 font-medium">
              🌙 Night
            </span>
          ) : (
            <span className="text-muted-foreground">☀️ Day</span>
          )}
        </div>

        {breakDurationMinutes > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">Breaks:</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="h-6 w-6 rounded border text-xs font-bold hover:bg-muted transition-colors disabled:opacity-40"
                disabled={record.breaksTaken !== null && record.breaksTaken !== undefined && record.breaksTaken <= 0}
                onClick={() => {
                  const auto = Math.floor((record.sessions[0]?.workedHours || 0) / fullDayHours)
                  onUpdateBreaks(record.employee._id, Math.max(0, (record.breaksTaken ?? auto) - 1))
                }}
              >−</button>
              <span className="min-w-[40px] text-center text-xs">
                {record.breaksTaken !== null && record.breaksTaken !== undefined
                  ? record.breaksTaken
                  : "Auto"}
              </span>
              <button
                type="button"
                className="h-6 w-6 rounded border text-xs font-bold hover:bg-muted transition-colors"
                onClick={() => {
                  const auto = Math.floor((record.sessions[0]?.workedHours || 0) / fullDayHours)
                  onUpdateBreaks(record.employee._id, (record.breaksTaken ?? auto) + 1)
                }}
              >+</button>
              {record.breaksTaken !== null && record.breaksTaken !== undefined && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground ml-1"
                  onClick={() => onUpdateBreaks(record.employee._id, null)}
                  title="Reset to auto"
                >✕</button>
              )}
            </div>
          </div>
        )}


        {showUndo ? (
          <div className="flex justify-start">
            <Button
              variant="outline"
              size="sm"
              className="w-28 mt-2 flex items-center justify-center gap-1.5 px-3.5 h-8 text-xs font-medium"
              onClick={onUndoClear}
            >
              <Undo className="h-4 w-4" />
              Undo
            </Button>
          </div>
        ) : isSessionNonEmpty(session) ? (
          <div className="flex justify-start">
            <Button
              variant="outline"
              size="sm"
              className="w-28 mt-2 px-3.5 h-8 text-xs font-medium"
              onClick={() => onClearSession(record.employee._id, 0)}
            >
              Absent
            </Button>
          </div>
        ) : null}

        {overlap && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl space-y-1 text-sm text-red-700 dark:bg-red-950/20 dark:border-red-800/30 dark:text-red-200">
            <div className="font-medium">
              Conflicts with existing session
            </div>
            <div>
              Site: {overlap.conflictingSession?.siteName}
            </div>
            <div>
              Time: {formatConflictingSessionTime(overlap)}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
})

const DraftAttendanceDesktopRow = memo(function DraftAttendanceDesktopRow({
  record,
  siteId,
  breakDurationMinutes,
  fullDayHours,
  overlap,
  showUndo,
  hasCarryover,
  onOpenCarryover,
  onUpdateSession,
  onToggleSick,
  onUpdateBreaks,
  onClearSession,
  onUndoClear,
}: DraftRowProps) {
  const session = record.sessions[0]

  return (
    <>
      <TableRow
        className={
          overlap
            ? "bg-red-50 dark:bg-red-950/20 border-red-500"
            : ""
        }
      >
        <TableCell>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium">
                  {record.employee.name}
                </p>
                {record.employee.user && (
                  <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-800/30 text-[10px] px-1.5 py-0 h-4">
                    Supervisor
                  </Badge>
                )}
                {record.employee.employmentType === 'temporary' && (
                  <Badge variant="secondary" className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/30 text-[10px] px-1.5 py-0 h-4">
                    Temporary
                  </Badge>
                )}
                {record.transferredFrom && (
                  <TransferredFromBadge siteName={record.transferredFrom.name} />
                )}
                {hasCarryover && <CarryoverBadge onClick={() => onOpenCarryover?.(record.employee._id)} />}
              </div>

              <p className="text-sm text-muted-foreground">
                {record.employeeId} • {record.jobTitle}
              </p>
            </div>
            {record.isSickLeave ? (
              <SickLeaveBadge />
            ) : isEmployeeAbsent(record.sessions, siteId) ? (
              <AbsentIndicator />
            ) : null}
          </div>
        </TableCell>

        <TableCell>
          <Input
            type="time"
            value={
              session.checkIn
            }
            disabled={!!record.isSickLeave || !!hasCarryover}
            onChange={(e) =>
              onUpdateSession(
                record.employee._id,
                0,
                "checkIn",
                e.target.value
              )
            }
          />
        </TableCell>

        <TableCell>
          <Input
            type="time"
            value={
              session.checkOut
            }
            disabled={!!record.isSickLeave || !!hasCarryover}
            onChange={(e) =>
              onUpdateSession(
                record.employee._id,
                0,
                "checkOut",
                e.target.value
              )
            }
          />
        </TableCell>

        <TableCell>
          {(session.isNightShift || (session.checkIn && session.checkOut && isCrossMidnight(session.checkIn, session.checkOut, session.isNightShift))) ? (
            <span className="inline-flex items-center gap-1 text-indigo-600 font-medium">
              🌙 Night
            </span>
          ) : (
            <span className="text-muted-foreground">☀️ Day</span>
          )}
        </TableCell>

        <TableCell>
          {
            session.workedHours
          }
        </TableCell>

        {breakDurationMinutes > 0 && (
          <TableCell>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="h-6 w-6 rounded border text-xs font-bold hover:bg-muted transition-colors disabled:opacity-40"
                disabled={record.breaksTaken !== null && record.breaksTaken !== undefined && record.breaksTaken <= 0}
                onClick={() => {
                  const auto = Math.floor((record.sessions[0]?.workedHours || 0) / fullDayHours)
                  onUpdateBreaks(record.employee._id, Math.max(0, (record.breaksTaken ?? auto) - 1))
                }}
              >−</button>
              <span className="min-w-[44px] text-center text-xs">
                {record.breaksTaken !== null && record.breaksTaken !== undefined
                  ? record.breaksTaken
                  : "Auto"}
              </span>
              <button
                type="button"
                className="h-6 w-6 rounded border text-xs font-bold hover:bg-muted transition-colors"
                onClick={() => {
                  const auto = Math.floor((record.sessions[0]?.workedHours || 0) / fullDayHours)
                  onUpdateBreaks(record.employee._id, (record.breaksTaken ?? auto) + 1)
                }}
              >+</button>
              {record.breaksTaken !== null && record.breaksTaken !== undefined && (
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:text-foreground ml-1"
                  onClick={() => onUpdateBreaks(record.employee._id, null)}
                  title="Reset to auto"
                >✕</button>
              )}
            </div>
          </TableCell>
        )}

        <TableCell className="text-right">
          <div className="flex justify-end items-center gap-2">
            {hasCarryover ? (
              // Carryover row's primary action lives here (not under the check-in
              // input) so it can't collide with the neighbouring time cells — the
              // row is locked until yesterday's shift is closed anyway.
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 whitespace-nowrap border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-800/60 dark:text-amber-300 dark:hover:bg-amber-950/30 dark:hover:text-amber-200 px-3 h-8 text-xs font-medium"
                title="Enter yesterday's check-out to unlock today"
                onClick={() => onOpenCarryover?.(record.employee._id)}
              >
                <Clock3 className="h-3.5 w-3.5" />
                Check out
              </Button>
            ) : showUndo ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onUndoClear}
                className="inline-flex items-center gap-1.5 px-3.5 h-8 text-xs font-medium"
              >
                <Undo className="h-4 w-4" />
                Undo
              </Button>
            ) : isSessionNonEmpty(session) ? (
              <Button
                variant="outline"
                size="sm"
                className="px-3.5 h-8 text-xs font-medium"
                onClick={() => onClearSession(record.employee._id, 0)}
              >
                Absent
              </Button>
            ) : null}
            <RowActionsMenu
              isSick={!!record.isSickLeave}
              onToggleSick={() => onToggleSick(record.employee._id)}
              showTransfer
              transferDisabled
              transferDisabledReason="Save attendance before transferring"
              onTransfer={() => {}}
            />
          </div>
        </TableCell>
      </TableRow>
      {overlap && (
        <TableRow className="border-red-500/30">
          <TableCell
            colSpan={6}
            className="bg-red-50 dark:bg-red-950/20"
          >
            <div className="space-y-1 text-sm text-red-700 dark:text-red-200">
              <div className="font-medium">
                Conflicts with existing session
              </div>

              <div>
                Site:
                {" "}
                {overlap.conflictingSession?.siteName}
              </div>

              <div>
                Time:
                {" "}
                {formatConflictingSessionTime(overlap)}
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
})

const EmptyState = () => (
  <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
    <div className="p-4 rounded-full bg-muted/60 text-muted-foreground/60 mb-4 animate-pulse">
      <Users className="h-10 w-10 stroke-[1.5]" />
    </div>
    <h3 className="text-base font-semibold text-foreground">No records found</h3>
    <p className="text-xs text-muted-foreground mt-1.5 max-w-[280px]">
      We couldn't find any employees matching the search filters or selected category.
    </p>
  </div>
)

function SiteAttendance() {
  const {id} = useParams()

  const navigate = useNavigate()

  // This page always operates on the CURRENT business day, which is simply today's calendar
  // date — a night shift that runs past midnight stays on the day it started, and is closed
  // the next morning through the carryover flow below.
  const { config: workConfig, loading: configLoading } = useWorkConfig()
  const breakDurationMinutes = workConfig?.breakDurationMinutes ?? 60
  const fullDayHours = workConfig?.fullDayHours ?? 8

  const [site, setSite] = useState<Site | null>(null)

  const today = useMemo(() => getCurrentTargetDateString(), [])

  const formattedDate = formatCurrentDateLabel()

  // ---- Carryover (cutoff redesign, Phase 5) ----
  // Yesterday's records with an OPEN (checked-in, not checked-out) session for this site.
  // Surfaced today so a supervisor can enter the real check-out; rolling one-day window.
  const [carryoverRecords, setCarryoverRecords] = useState<AttendanceRecord[]>([])
  // The pinned panel only shows before noon; after that the per-row badge remains.
  // It's collapsed by default — the header (with a count) is always visible, and the
  // supervisor expands it to see and action the individual pending check-outs.
  const [carryoverPanelOpen, setCarryoverPanelOpen] = useState(false)
  const beforeNoon = getCurrentTargetTime().getUTCHours() < 12
  const carryoverEmpIds = useMemo(
    () => new Set(carryoverRecords.map((r) => String(r.employee))),
    [carryoverRecords]
  )
  const yesterdayOf = (todayStr: string) => {
    const [y, m, d] = todayStr.split("-").map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d))
    dt.setUTCDate(dt.getUTCDate() - 1)
    return dt.toISOString().split("T")[0]
  }

  const [showLeaveDialog, setShowLeaveDialog] = useState(false)

  const [pendingPath, setPendingPath] = useState<string | null>(null)

  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])

  const [draftAttendance, setDraftAttendance] = useState<DraftAttendanceRecord[]>([])

  // Draft persistence is debounced (see the sync effect further down) —
  // serializing the whole roster to localStorage on every keystroke caused
  // jank on large sites. Anything queued here but not yet written is flushed
  // on unmount and on beforeunload so no edits are lost.
  const pendingDraftWriteRef = useRef<{ key: string; data: DraftAttendanceRecord[] } | null>(null)

  const flushPendingDraftWrite = () => {
    const pending = pendingDraftWriteRef.current
    if (pending) {
      localStorage.setItem(pending.key, JSON.stringify(pending.data))
      pendingDraftWriteRef.current = null
    }
  }

  // Drop the queued write without persisting it — used when the draft is
  // deliberately discarded (successful submit, or leaving via the unsaved-
  // changes dialog) so the flush can't resurrect it.
  const discardPendingDraftWrite = () => {
    pendingDraftWriteRef.current = null
  }

  const [lastCleared, setLastCleared] = useState<{
    employeeId: string
    checkIn: string
    checkOut: string
    isNightShift: boolean
  } | null>(null)

  const [lastClearedSaved, setLastClearedSaved] = useState<{
    attendanceId: string
    checkIn: string
    checkOut: string
    isNightShift: boolean
    breaksTaken?: number | null
  } | null>(null)


  const [loading, setLoading] = useState(true)

  const [saving, setSaving] = useState(false)

  const [attendanceExists, setAttendanceExists] = useState(false)

  const [isDirty, setIsDirty] = useState(false)

  const [isHoliday, setIsHoliday] = useState(false)

  const [selectedRecord, setSelectedRecord] =
    useState<AttendanceRecord | null>(null)

  const [editOpen, setEditOpen] =
    useState(false)

  // inline editing of a saved record (single incomplete session)
  const [editingRowId, setEditingRowId] =
    useState<string | null>(null)

  const [inlineEdit, setInlineEdit] =
    useState<{ checkIn: string; checkOut: string; isNightShift: boolean; breaksTaken: number | null }>({
      checkIn: "",
      checkOut: "",
      isNightShift: false,
      breaksTaken: null,
    })
  const [inlineEditError, setInlineEditError] = useState<string | null>(null)

  const [rowSaving, setRowSaving] = useState(false)

  // Tracks which saved record is currently having its sick-leave flag toggled.
  const [sickSavingId, setSickSavingId] = useState<string | null>(null)

  // Transfer flow: site-picker modal state, plus a marker used to
  // auto-open the modal once a forced checkout edit (see handleTransferClick)
  // finishes saving.
  const [transferModalOpen, setTransferModalOpen] = useState(false)
  const [transferTargetRecord, setTransferTargetRecord] = useState<AttendanceRecord | null>(null)
  const [pendingTransferAfterCheckout, setPendingTransferAfterCheckout] = useState<AttendanceRecord | null>(null)

  const [isEditingDefaults, setIsEditingDefaults] = useState(false)
  const [editDefaultCheckIn, setEditDefaultCheckIn] = useState("")
  const [editDefaultCheckOut, setEditDefaultCheckOut] = useState("")
  const [editNightDefaultCheckIn, setEditNightDefaultCheckIn] = useState("")
  const [editNightDefaultCheckOut, setEditNightDefaultCheckOut] = useState("")
  const [editStaffDefaultCheckIn, setEditStaffDefaultCheckIn] = useState("")
  const [editStaffDefaultCheckOut, setEditStaffDefaultCheckOut] = useState("")
  const [editStaffNightDefaultCheckIn, setEditStaffNightDefaultCheckIn] = useState("")
  const [editStaffNightDefaultCheckOut, setEditStaffNightDefaultCheckOut] = useState("")
  const [editOmaniDefaultCheckIn, setEditOmaniDefaultCheckIn] = useState("")
  const [editOmaniDefaultCheckOut, setEditOmaniDefaultCheckOut] = useState("")
  const [editOmaniNightDefaultCheckIn, setEditOmaniNightDefaultCheckIn] = useState("")
  const [editOmaniNightDefaultCheckOut, setEditOmaniNightDefaultCheckOut] = useState("")
  const [editOmaniStaffDefaultCheckIn, setEditOmaniStaffDefaultCheckIn] = useState("")
  const [editOmaniStaffDefaultCheckOut, setEditOmaniStaffDefaultCheckOut] = useState("")
  const [editOmaniStaffNightDefaultCheckIn, setEditOmaniStaffNightDefaultCheckIn] = useState("")
  const [editOmaniStaffNightDefaultCheckOut, setEditOmaniStaffNightDefaultCheckOut] = useState("")
  const [savingDefaults, setSavingDefaults] = useState(false)

  // Update defaults dialog state
  const [updateDefaultsDialogOpen, setUpdateDefaultsDialogOpen] = useState(false)
  const [pendingDefaultChanges, setPendingDefaultChanges] = useState<DefaultChange[]>([])
  const [skippedEmployeeIds, setSkippedEmployeeIds] = useState<Set<string>>(new Set())
  const [skippedReasons, setSkippedReasons] = useState<Map<string, string>>(new Map())

  const [bulkAssignOpen, setBulkAssignOpen] = useState(false)

  // Mount only ONE of the mobile/desktop trees. Both used to be rendered and
  // the inactive one hidden with CSS (md:hidden / hidden md:block), which
  // doubled the DOM size and the re-render work on every keystroke.
  // 767px matches Tailwind's md breakpoint (and the window.innerWidth < 768
  // checks used elsewhere in this file).
  const [isMobileView, setIsMobileView] = useState(
    () => window.matchMedia("(max-width: 767px)").matches
  )

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)")
    const onChange = (e: MediaQueryListEvent) => setIsMobileView(e.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  useEffect(() => {
    if (site) {
      setEditDefaultCheckIn(site.defaultCheckIn || "")
      setEditDefaultCheckOut(site.defaultCheckOut || "")
      setEditNightDefaultCheckIn(site.nightDefaultCheckIn || "")
      setEditNightDefaultCheckOut(site.nightDefaultCheckOut || "")
      setEditStaffDefaultCheckIn(site.staffDefaultCheckIn || "")
      setEditStaffDefaultCheckOut(site.staffDefaultCheckOut || "")
      setEditStaffNightDefaultCheckIn(site.staffNightDefaultCheckIn || "")
      setEditStaffNightDefaultCheckOut(site.staffNightDefaultCheckOut || "")
      setEditOmaniDefaultCheckIn(site.omaniDefaultCheckIn || "")
      setEditOmaniDefaultCheckOut(site.omaniDefaultCheckOut || "")
      setEditOmaniNightDefaultCheckIn(site.omaniNightDefaultCheckIn || "")
      setEditOmaniNightDefaultCheckOut(site.omaniNightDefaultCheckOut || "")
      setEditOmaniStaffDefaultCheckIn(site.omaniStaffDefaultCheckIn || "")
      setEditOmaniStaffDefaultCheckOut(site.omaniStaffDefaultCheckOut || "")
      setEditOmaniStaffNightDefaultCheckIn(site.omaniStaffNightDefaultCheckIn || "")
      setEditOmaniStaffNightDefaultCheckOut(site.omaniStaffNightDefaultCheckOut || "")
    }
  }, [site])

  const openEditRecord = (
    record: AttendanceRecord
  ) => {
    setSelectedRecord(record)
    setEditOpen(true)
  }

  // Open yesterday's carryover record for an employee (from the row badge) so its
  // check-out can be filled. Stable across keystroke re-renders (depends only on the
  // carryover set) so it doesn't defeat the memoized rows.
  const handleOpenCarryover = useCallback(
    (empId: string) => {
      const rec = carryoverRecords.find((r) => String(r.employee) === String(empId))
      if (rec) {
        setSelectedRecord(rec)
        setEditOpen(true)
      }
    },
    [carryoverRecords]
  )

  const handleRecordUpdated = (updatedRecord: AttendanceRecord) => {
    setAttendance((prev) =>
      prev.map((record) =>
        record.attendanceId === updatedRecord.attendanceId
          ? {
              // The update endpoints return the raw attendance doc, which lacks
              // the employee-derived display fields (name, jobTitle, collarType,
              // etc.). Merge so those survive — otherwise collarType is lost and
              // the row jumps back to the Skilled Labour tab until a refresh.
              ...record,
              ...updatedRecord,
              name: updatedRecord.name ?? record.name,
              employeeId: updatedRecord.employeeId ?? record.employeeId,
              jobTitle: updatedRecord.jobTitle ?? record.jobTitle,
              collarType: updatedRecord.collarType ?? record.collarType,
              nationality: updatedRecord.nationality ?? record.nationality,
              employmentType: updatedRecord.employmentType ?? record.employmentType,
              user: updatedRecord.user ?? record.user,
            }
          : record
      )
    )
  }

   const handleSafeNavigation = (path: string) => {
    if (!isDirty) {
      navigate(path)
      return
    }

    setPendingPath(path)
    setShowLeaveDialog(true)
  }

  const fetchSite = async () => {
    try {
      const res = await api.get(`/api/site/${id}`)

      setSite(res.data)

      return res.data
    } catch (error) {
      console.log(error)
    }
  }


  //client side filtering
  const [searchQuery, setSearchQuery] = useState("")
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const filtersRef = useRef<HTMLDivElement>(null)

  // Scrolls the sticky filters bar to the top of the main scroll container.
  // The target is recomputed as a delta from the *current* scroll position, so
  // it self-corrects even while the layout/viewport is still shifting.
  const scrollFiltersToContainerTop = (behavior: ScrollBehavior = "smooth") => {
    const scrollContainer = document.getElementById("main-scroll-container")
    if (!scrollContainer || !filtersRef.current) return
    const containerRect = scrollContainer.getBoundingClientRect()
    const filtersRect = filtersRef.current.getBoundingClientRect()
    const target = scrollContainer.scrollTop + (filtersRect.top - containerRect.top)
    scrollContainer.scrollTo({ top: Math.max(target, 0), behavior })
  }

  // On real mobile devices, focusing the search input opens the virtual
  // keyboard. The browser then runs its OWN "scroll focused element into view",
  // which races with — and usually clobbers — a single timed programmatic
  // scroll. A fixed timeout is just a guess at when the keyboard animation ends
  // (it varies per device), so it's unreliable. Instead we listen to the
  // visualViewport resize events the keyboard actually emits and re-assert our
  // target position every time the viewport settles, for a short window after
  // focus, so we win the race regardless of animation timing.
  const scrollFiltersToTopWithKeyboard = () => {
    const vv = window.visualViewport
    if (!vv) {
      // No visualViewport support: fall back to a single delayed scroll that
      // fires after the keyboard has (hopefully) finished animating.
      setTimeout(scrollFiltersToContainerTop, 350)
      return
    }

    let settleTimer: ReturnType<typeof setTimeout>
    const onViewportResize = () => {
      clearTimeout(settleTimer)
      settleTimer = setTimeout(scrollFiltersToContainerTop, 100)
    }
    vv.addEventListener("resize", onViewportResize)

    // Stop listening and do a final pass once the keyboard has surely settled.
    setTimeout(() => {
      vv.removeEventListener("resize", onViewportResize)
      clearTimeout(settleTimer)
      scrollFiltersToContainerTop()
    }, 700)

    // Optimistic first pass (covers the case where the keyboard is already open).
    scrollFiltersToContainerTop()
  }

  const handleSearchFocus = () => {
    setIsSearchFocused(true)
    if (window.innerWidth < 768) {
      scrollFiltersToTopWithKeyboard()
    }
  }

  const handleSearchDismiss = () => {
    setIsSearchFocused(false)
    setCategoryFilter(null)
    setSearchQuery("")
    searchInputRef.current?.blur()
    if (window.innerWidth < 768) {
      const scrollContainer = document.getElementById("main-scroll-container")
      if (scrollContainer) {
        scrollContainer.scrollTo({ top: 0, behavior: "smooth" })
      }
    }
  }

  const handleCategoryFilterChange = (key: CategoryFilter) => {
    const nextVal = categoryFilter === key ? null : key
    setCategoryFilter(nextVal)
    if (nextVal) {
      setIsSearchFocused(true)
      // The scroll-to-top is handled by a layout effect keyed on categoryFilter
      // (below), so it runs synchronously after the result-set reflow and before
      // paint — avoiding the "jump down then back up" flicker, especially when
      // the filter yields no records.
    }
    // Deselecting (and Clear below) intentionally KEEPS the expanded focus
    // mode. Collapsing it would remove the extra scroll room (min-height /
    // bottom padding), letting the browser clamp scrollTop — which is what
    // made the filters bar drift down from the top. The focus mode ends via
    // the back arrow (handleSearchDismiss) or the scroll-up gesture (see the
    // touch effect near the top of the component's effects).
  }

  const handleClearCategoryFilter = () => {
    setCategoryFilter(null)
    // Stay in the expanded focus mode — see handleCategoryFilterChange.
  }

  // Active roster category tab (one of the four collar × nationality groups). Records
  // without explicit collarType/nationality resolve to foreignSkilled (older data).
  const [collarTab, setCollarTab] = useState<RosterCategory>("foreignSkilled")

  const initializeAttendanceFromEmployees = async (siteData: Site, carryoverIds: Set<string> = new Set()) => {
    try {
      const activeToday = today
      const cached = localStorage.getItem(`attendance_draft_${id}_${activeToday}`)
      if (cached) {
        // A draft cached BEFORE the carryover appeared can still hold an auto-prefilled
        // check-in for an employee who is now mid-shift from yesterday. Strip those so a
        // carryover employee always starts today clear (their row is locked anyway).
        setDraftAttendance(clearCarryoverSessions(JSON.parse(cached), carryoverIds))
        setIsDirty(true)
        return
      }

      const res =
        await api.get<EmployeesResponse>(
          "/api/employees",
          {
            params: { site: id },
          }
        )

      // The server's ?site= now also returns only-for-today visitors (pendingTransferSiteId
      // = this site) whose home is elsewhere. Keep on-site members plus TODAY-dated
      // visitors; drop stale pendingTransfer* rows an abandoned draft may have left behind
      // (otherwise they'd render as apparently-present roster members).
      const rosterEmployees = res.data.employees.filter((emp) => {
        if (String(emp.currentSite) === String(siteData._id)) return true
        return (
          !!emp.pendingTransferSiteId &&
          String(emp.pendingTransferSiteId) === String(siteData._id) &&
          !!emp.pendingTransferDate &&
          String(emp.pendingTransferDate).slice(0, 10) === activeToday.slice(0, 10)
        )
      })

      const mappedDraft =
        rosterEmployees.map((emp) => {
          const hasPendingTransfer =
            !!emp.pendingTransferSiteId &&
            String(emp.pendingTransferSiteId) === String(siteData._id) &&
            !!emp.pendingTransferDate &&
            String(emp.pendingTransferDate).slice(0, 10) === activeToday.slice(0, 10)

          // Each of the four categories prefills from its OWN day default check-in;
          // never fall back across categories — if the applicable default is empty, the
          // check-in is left empty.
          const category = categoryOf(emp.collarType, emp.nationality)
          const dayDefaultByCategory: Record<RosterCategory, string> = {
            foreignSkilled: siteData.defaultCheckIn || "",
            foreignStaff: siteData.staffDefaultCheckIn || "",
            omaniSkilled: siteData.omaniDefaultCheckIn || "",
            omaniStaff: siteData.omaniStaffDefaultCheckIn || "",
          }
          const roleDefaultIn = dayDefaultByCategory[category]
          // Carryover employees default to ABSENT (empty) — they're still finishing
          // yesterday's shift, so we don't auto-prefill a fresh check-in for them.
          const isCarryover = carryoverIds.has(emp._id)
          const defaultIn = isCarryover
            ? ""
            : hasPendingTransfer && emp.pendingTransferCheckIn
            ? toTimeValue(emp.pendingTransferCheckIn)
            : roleDefaultIn
          // A fresh draft row has no check-out yet, so it can't cross midnight. The flag is
          // re-derived from the entered times (deriveOffsets) as soon as one is filled in.
          const isNightShift = false
          return {
            employee: {
              _id: emp._id,
              name: emp.name,
              user: emp.user || null,
              employmentType: emp.employmentType,
            },

            employeeId: emp.employeeId,

            jobTitle: emp.jobTitle,

            collarType: emp.collarType,

            nationality: emp.nationality,

            jobId:
              emp.currentJob?._id || null,

            sessions: [
              {
                siteId: siteData._id,
                job: emp.currentJob,
                checkIn: defaultIn,
                checkOut: "",
                workedHours: 0,
                isNightShift,
              },
            ],

            isSickLeave: false,

            transferredFrom: hasPendingTransfer && emp.pendingTransferFromSiteId
              ? {
                  siteId: emp.pendingTransferFromSiteId._id,
                  name: emp.pendingTransferFromSiteId.siteName,
                }
              : null,
          }
        })

      setDraftAttendance(mappedDraft)
    } catch (error) {
      console.log(error)
      setDraftAttendance([])
    }
  }

  const [overlapError, setOverlapError] = useState<OverlapError | null>(null)

  const formatConflictingTime = () => formatConflictingSessionTime(overlapError)

  const [holidayReason, setHolidayReason] = useState("")

  const checkHolidayStatus = async (targetDate?: string) => {
    try {
      const weeklyHolidays = workConfig?.weeklyHolidays || []

      let todayDay = ""
      if (targetDate) {
        const [year, month, day] = targetDate.split('-').map(Number)
        todayDay = new Date(year, month - 1, day)
          .toLocaleDateString("en-US", { weekday: "long" })
          .toLowerCase()
      } else {
        todayDay = getCurrentTargetDayName()
      }

      if (
        weeklyHolidays.includes(
          todayDay
        )
      ) {
        setIsHoliday(true)

        setHolidayReason(
          "Weekly Holiday"
        )

        return
      }

      const activeDateStr = targetDate || today
      const holidayRes =
        await api.get(
          "/api/config/custom-holidays/check",
          {
            params: {
              date: activeDateStr,
            },
          }
        )

      if (
        holidayRes.data.isHoliday
      ) {
        setIsHoliday(true)

        setHolidayReason(
          holidayRes.data.reason
        )
      } else {
        setIsHoliday(false)

        setHolidayReason("")
      }

    } catch (error) {
      console.log(error)
    }
  }

  const isOverlapRow = (employeeId: string) => {
    return (
      overlapError?.employeeId === employeeId
    )
  }


  ///api/attendance/reports/daily?date=2026-05-29&siteId=69e231212487b777fb7eb7b5

  const fetchAttendance = async (targetDate: string = today) => {
    try {
      const res = await api.get<FetchedAttendance>("/api/attendance/reports/daily",
        {
          params: {
            date: targetDate,
            siteId: id,
          },
        })

      setIsHoliday(res.data.isHoliday)

      setAttendance(res.data.data)

      // Also resolve and set the holidayReason
      await checkHolidayStatus(targetDate)

    } catch (error) {
      console.log(error)
    }
  }

  // Fetch yesterday's OPEN sessions for this site (checked in, no check-out) — the
  // carryover night shifts to surface today. Returns the set of employee ids so the
  // draft build can skip auto-prefilling them (they default to absent). Rolling
  // one-day window: only the day before `targetToday`.
  const fetchCarryovers = async (targetToday: string = today): Promise<Set<string>> => {
    try {
      const prevDate = yesterdayOf(targetToday)
      const res = await api.get<FetchedAttendance>("/api/attendance/reports/daily", {
        params: { date: prevDate, siteId: id },
      })
      const open = (res.data.data || []).filter((rec) =>
        rec.sessions?.some(
          (s) => String(s.siteId) === String(id) && !!s.checkIn && !s.checkOut
        )
      )
      setCarryoverRecords(open)
      return new Set(open.map((r) => String(r.employee)))
    } catch (error) {
      console.log(error)
      setCarryoverRecords([])
      return new Set<string>()
    }
  }

  const handleSubmit = async () => {
    try {
      setSaving(true)

      setOverlapError(null)

      const payload: DraftAttendancePayload = {
        siteId: id || "",
        date: today,
        isHoliday,
        attendance: draftAttendance,
      }

      // console.log(payload)

      const res = await api.post(
        "/api/attendance/submit",
        payload
      )

      if (res.data.success) {
        toast.success(
          res.data.message ||
          "Attendance submitted successfully"
        )

        // Reconcile sick leave: any employee we requested as sick but who came
        // back not-sick was force-cleared by the backend (they have a filled
        // session at another site). Surface this instead of silently reverting.
        const requestedSick = new Set(
          draftAttendance
            .filter((r) => r.isSickLeave)
            .map((r) => String(r.employee._id))
        )
        if (requestedSick.size > 0) {
          const returned = res.data.data || []
          const revoked = returned.filter(
            (doc: any) =>
              requestedSick.has(String(doc.employee)) && !doc.isSickLeave
          )
          if (revoked.length > 0) {
            toast.error(
              `${revoked.length} employee(s) weren't marked sick — they have attendance at another site today.`,
              { duration: 6000 }
            )
          }
        }

        // Drop any debounced draft write queued before the submit so it can't
        // resurrect the draft we just cleared.
        discardPendingDraftWrite()
        localStorage.removeItem(`attendance_draft_${id}_${today}`)
        localStorage.removeItem(`active_inline_edit_row_${id}`)
        localStorage.removeItem(`active_inline_edit_data_${id}`)

        setAttendanceExists(true)

        setIsDirty(false)

        await fetchAttendance(today)
      }
    } catch (error: any) {
      console.log(error)

      const responseData = error?.response?.data

      if (responseData?.overlap) {
        setOverlapError(responseData.overlap)

        toast.error(
          responseData.message ||
          "Attendance sessions overlap"
        )
      } else {
        setOverlapError(null)

        toast.error(
          responseData?.message ||
          "Failed to submit attendance"
        )
      }
    } finally {
      setSaving(false)
    }
  }

  const checkAttendanceStatus = async (targetDate?: string) => {
    try {
      const res = await api.post(
        `/api/site/${id}/check-pending`,
        {
          date: targetDate ?? today,
        }
      )

      const exists = res.data.status || false

      const locked = res.data.lock?.isLocked || false

      setAttendanceExists(exists)

      return {
        exists,
        locked,
      }
    } catch (error) {
      console.log(error)

      setAttendanceExists(false)

      return {
        exists: false,
        locked: false,
      }
    }
  }

  const calculateHours = useCallback(
    // Cutoff-free (cutoff redesign): hours from the raw times + derived day offsets, so a
    // night check-out at/after the old cutoff (e.g. 07:00, 08:00) is no longer clamped to 0.
    // isNightShift is accepted for call-site compatibility but no longer needed.
    (checkIn: string, checkOut: string, _isNightShift: boolean = false) => {
      const { checkInNextDay, checkOutNextDay } = deriveOffsets(checkIn, checkOut)
      return hoursFromOffset(checkIn, checkOut, checkInNextDay, checkOutNextDay)
    },
    []
  )

  const getSiteWorkedHours = (
    record: AttendanceRecord
  ) => {
    return Number(
      record.sessions
        .reduce((total, session) => {
          return total + session.workedHours
        }, 0)
        .toFixed(2)
    )
  }

  // A record routes to the modal (edit + add) once it has a complete
  // session or more than one session. Otherwise it can be edited inline.
  const isRecordComplete = (
    record: AttendanceRecord
  ) => {
    if (record.sessions.length === 0) return false

    if (record.sessions.length > 1) return true

    const session = record.sessions[0]

    return !!session.checkIn && !!session.checkOut
  }



   const startInlineEdit = (
    record: AttendanceRecord
  ) => {
    // Carryover lock: today's session can't be edited until yesterday's open shift is
    // closed (the employee is still on yesterday's clock). Central guard covers every
    // entry point (both Edit buttons + the localStorage restore).
    if (carryoverEmpIds.has(record.employee)) {
      toast("Close yesterday's open shift first — tap the ⏳ Carryover badge.", { icon: "🔒" })
      return
    }

    const session = record.sessions[0]

    setEditingRowId(record.attendanceId)
    setOverlapError(null)
    setLastClearedSaved(null)
    setInlineEditError(null)

    setInlineEdit({
      checkIn: toTimeValue(session?.checkIn),
      checkOut: toTimeValue(session?.checkOut),
      isNightShift: session?.isNightShift ?? false,
      breaksTaken: record.breaksTaken ?? null,
    })
  }

  const cancelInlineEdit = () => {
    setEditingRowId(null)
    setOverlapError(null)
    setInlineEditError(null)

    setInlineEdit({ checkIn: "", checkOut: "", isNightShift: false, breaksTaken: null })
    setLastClearedSaved(null)
  }



  const saveInlineEdit = async (
    record: AttendanceRecord
  ) => {
    const { checkIn, checkOut } = inlineEdit

    // Cutoff-free validation: derive day offsets from the raw times (ordering + duration
    // only). The server re-derives the authoritative offsets on save.
    const { checkInNextDay, checkOutNextDay } = deriveOffsets(checkIn, checkOut);
    const validationError = validateSessionTimesV2(checkIn, checkOut, checkInNextDay, checkOutNextDay);
    if (validationError) {
      setInlineEditError(validationError);
      return;
    }
    setInlineEditError(null);


    try {
      setRowSaving(true)
      setOverlapError(null)

      const existing = record.sessions[0]

      const payload = {
        sessions: [
          {
            _id: existing?._id,
            siteId: existing?.siteId ?? site?._id,
            jobId: existing?.jobId ?? null,
            checkIn: combineFromOffset(record.date, checkIn || null, checkInNextDay),
            checkOut: combineFromOffset(record.date, checkOut || null, checkOutNextDay),
            checkInNextDay,
            checkOutNextDay,
            isNightShift: checkInNextDay || checkOutNextDay,
          },
        ],
        // Pass the inline edited breaksTaken
        breaksTaken: inlineEdit.breaksTaken,
      }


      const res = await api.patch(
        `/api/attendance/update/${record.attendanceId}?siteId=${site?._id}`,
        payload
      )

      const updatedRecord = {
        ...res.data.attendance,
        sessions: res.data.attendance.sessions.filter(
          (session: AttendanceSession) =>
            String(session.siteId) === String(site?._id)
        ),
      }

      handleRecordUpdated(updatedRecord as AttendanceRecord)

      toast.success("Attendance updated successfully")

      cancelInlineEdit()

      // If this edit was forced by a Transfer click (checkout wasn't filled
      // yet), proceed straight to the site-picker modal now that it is.
      if (pendingTransferAfterCheckout?.attendanceId === record.attendanceId) {
        setTransferTargetRecord(updatedRecord as AttendanceRecord)
        setTransferModalOpen(true)
        setPendingTransferAfterCheckout(null)
      }
    } catch (error: any) {
      console.log(error)
      const responseData = error?.response?.data
      if (responseData?.overlap) {
        setOverlapError(responseData.overlap)
        toast.error(responseData.message || "Attendance sessions overlap")
      } else {
        setOverlapError(null)
        toast.error(
          responseData?.message ||
          "Failed to update attendance"
        )
      }
    } finally {
      setRowSaving(false)
    }
  }

  // Transfer entry point from the kebab menu. If the current site's session
  // isn't checked out yet, force that edit first (reusing the existing
  // inline-edit row) and only open the site-picker modal once it saves.
  const handleTransferClick = (record: AttendanceRecord) => {
    const currentSession = record.sessions[0]
    if (!currentSession?.checkOut) {
      setPendingTransferAfterCheckout(record)
      startInlineEdit(record)
      return
    }
    setTransferTargetRecord(record)
    setTransferModalOpen(true)
  }

  const updateDraftSession = useCallback((
    employeeId: string,
    sessionIndex: number,
    field: "checkIn" | "checkOut",
    value: string
  ) => {
    setDraftAttendance(prev =>
      prev.map(record => {
        if (record.employee._id !== employeeId) {
          return record
        }

        const sessions = [...record.sessions]
        const session = { ...sessions[sessionIndex], [field]: value }

        // No boundary rules: any pair of times is accepted. A check-out that reads earlier
        // than the check-in simply means the shift crossed midnight (deriveOffsets), so a
        // 06:00 day start and an 08:00 night end are both valid here.
        const { checkInNextDay, checkOutNextDay } = deriveOffsets(session.checkIn, session.checkOut)
        const nextIsNightShift = session.checkIn
          ? checkInNextDay || checkOutNextDay
          : sessions[sessionIndex].isNightShift || false

        // Deliberate-absence flag: typing a check-in clears it; manually
        // emptying the check-in sets it (same intent as the Absent button).
        let nextManuallyCleared = sessions[sessionIndex].manuallyCleared || false
        if (field === "checkIn") {
          nextManuallyCleared = value === ""
        } else if (session.checkIn) {
          nextManuallyCleared = false
        }

        sessions[sessionIndex] = {
          ...session,
          isNightShift: nextIsNightShift,
          manuallyCleared: nextManuallyCleared,
        }

        sessions[sessionIndex].workedHours =
          calculateHours(
            sessions[sessionIndex].checkIn,
            sessions[sessionIndex].checkOut,
            sessions[sessionIndex].isNightShift
          )

        return {
          ...record,
          sessions,
          // Entering any time means the employee is not on sick leave.
          isSickLeave: value ? false : record.isSickLeave,
        }
      })
    )

    setIsDirty(true)
  }, [calculateHours])

  // Draft: toggle sick leave locally. Turning it on clears the session times
  // (sick = empty session); the backend remains the arbiter on submit.
  const toggleDraftSickLeave = useCallback((employeeId: string) => {
    setDraftAttendance((prev) =>
      prev.map((record) => {
        if (record.employee._id !== employeeId) return record

        const turningOn = !record.isSickLeave

        if (turningOn) {
          // Snapshot the current first-session times, then clear them.
          const s0 = record.sessions[0]
          const snapshot = s0
            ? {
                checkIn: s0.checkIn,
                checkOut: s0.checkOut,
                isNightShift: s0.isNightShift,
                workedHours: s0.workedHours,
              }
            : null

          const sessions = record.sessions.map((s, i) =>
            i === 0 ? { ...s, checkIn: "", checkOut: "", workedHours: 0 } : s
          )

          return {
            ...record,
            isSickLeave: true,
            sessions,
            sickClearedSession: snapshot,
          }
        }

        // Turning off: restore the snapshot the toggle had cleared.
        const snap = record.sickClearedSession
        const sessions = record.sessions.map((s, i) =>
          i === 0 && snap
            ? {
                ...s,
                checkIn: snap.checkIn,
                checkOut: snap.checkOut,
                isNightShift: snap.isNightShift,
                workedHours: snap.workedHours,
              }
            : s
        )

        return {
          ...record,
          isSickLeave: false,
          sessions,
          sickClearedSession: null,
        }
      })
    )
    setIsDirty(true)
  }, [])

  // Saved record: toggle sick leave via the backend, which validates against
  // the full cross-site record. A filled session anywhere → 400 + toast.
  const toggleSavedSickLeave = async (record: AttendanceRecord) => {
    try {
      setSickSavingId(record.attendanceId)
      const nextValue = !record.isSickLeave

      const res = await api.patch(
        `/api/attendance/update/${record.attendanceId}?siteId=${site?._id}`,
        { isSickLeave: nextValue }
      )

      const updatedRecord = {
        ...res.data.attendance,
        sessions: res.data.attendance.sessions.filter(
          (session: AttendanceSession) =>
            String(session.siteId) === String(site?._id)
        ),
      }

      handleRecordUpdated(updatedRecord as AttendanceRecord)

      toast.success(
        nextValue ? "Marked as sick leave" : "Sick leave removed"
      )
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message ||
          "Failed to update sick leave"
      )
    } finally {
      setSickSavingId(null)
    }
  }

  const updateDraftBreaksTaken = useCallback((employeeId: string, value: number | null) => {
    setDraftAttendance((prev) =>
      prev.map((record) => {
        if (record.employee._id !== employeeId) return record
        return { ...record, breaksTaken: value }
      })
    )
    setIsDirty(true)
  }, [])

  // Mirror of draftAttendance for stable callbacks (clearDraftSession) that
  // need to READ the current draft without depending on it — a dependency
  // would change the callback identity on every keystroke and defeat the
  // React.memo on the draft rows.
  const draftAttendanceRef = useRef<DraftAttendanceRecord[]>(draftAttendance)
  useEffect(() => {
    draftAttendanceRef.current = draftAttendance
  }, [draftAttendance])

  const clearDraftSession = useCallback((employeeId: string, sessionIndex: number) => {

    const record = draftAttendanceRef.current.find((r) => r.employee._id === employeeId)
    const session = record?.sessions[sessionIndex]
    if (record && session) {
      setLastCleared({
        employeeId,
        checkIn: session.checkIn,
        checkOut: session.checkOut,
        isNightShift: session.isNightShift,
      })
    }

    setDraftAttendance((prev) =>
      prev.map((record) => {
        if (record.employee._id !== employeeId) {
          return record
        }

        const sessions = [...record.sessions]
        sessions[sessionIndex] = {
          ...sessions[sessionIndex],
          checkIn: "",
          checkOut: "",
          workedHours: 0,
          isNightShift: sessions[sessionIndex].isNightShift || false,
          // Deliberate absence: immune to empty→time default propagation.
          manuallyCleared: true,
        }

        return {
          ...record,
          sessions,
        }
      })
    )
    setIsDirty(true)
  }, [])

  const undoClearDraftSession = useCallback(() => {
    if (!lastCleared) return

    setDraftAttendance((prev) =>
      prev.map((record) => {
        if (record.employee._id !== lastCleared.employeeId) {
          return record
        }

        const sessions = [...record.sessions]
        sessions[0] = {
          ...sessions[0],
          checkIn: lastCleared.checkIn,
          checkOut: lastCleared.checkOut,
          isNightShift: lastCleared.isNightShift,
          workedHours: calculateHours(
            lastCleared.checkIn,
            lastCleared.checkOut,
            lastCleared.isNightShift
          ),
          // Undoing the clear restores presence; the session is no longer a
          // deliberate absence (unless the restored check-in is itself empty).
          manuallyCleared: !lastCleared.checkIn,
        }

        return {
          ...record,
          sessions,
        }
      })
    )
    setIsDirty(true)
    setLastCleared(null)
  }, [lastCleared, calculateHours])

  const clearInlineEdit = (record: AttendanceRecord) => {
    setLastClearedSaved({
      attendanceId: record.attendanceId,
      checkIn: inlineEdit.checkIn,
      checkOut: inlineEdit.checkOut,
      isNightShift: inlineEdit.isNightShift,
      breaksTaken: inlineEdit.breaksTaken,
    })
    setInlineEdit({
      checkIn: "",
      checkOut: "",
      isNightShift: inlineEdit.isNightShift || false,
      breaksTaken: null,
    })
  }

  const undoClearInlineEdit = () => {
    if (!lastClearedSaved) return
    setInlineEdit({
      checkIn: lastClearedSaved.checkIn,
      checkOut: lastClearedSaved.checkOut,
      isNightShift: lastClearedSaved.isNightShift,
      breaksTaken: lastClearedSaved.breaksTaken ?? null,
    })
    setLastClearedSaved(null)
  }

  /**
   * Detect which default shift time fields have actually changed.
   * Returns an array of DefaultChange objects for the confirmation dialog.
   */
  const detectDefaultChanges = (): DefaultChange[] => {
    if (!site) return []
    const changes: DefaultChange[] = []

    const fieldMap: Array<{ key: string; label: string; editVal: string; siteVal: string }> = [
      { key: "defaultCheckIn", label: "Day Shift Check-in", editVal: editDefaultCheckIn, siteVal: site.defaultCheckIn || "" },
      { key: "defaultCheckOut", label: "Day Shift Check-out", editVal: editDefaultCheckOut, siteVal: site.defaultCheckOut || "" },
      { key: "nightDefaultCheckIn", label: "Night Shift Check-in", editVal: editNightDefaultCheckIn, siteVal: site.nightDefaultCheckIn || "" },
      { key: "nightDefaultCheckOut", label: "Night Shift Check-out", editVal: editNightDefaultCheckOut, siteVal: site.nightDefaultCheckOut || "" },
      { key: "staffDefaultCheckIn", label: "Staff Day Check-in", editVal: editStaffDefaultCheckIn, siteVal: site.staffDefaultCheckIn || "" },
      { key: "staffDefaultCheckOut", label: "Staff Day Check-out", editVal: editStaffDefaultCheckOut, siteVal: site.staffDefaultCheckOut || "" },
      { key: "staffNightDefaultCheckIn", label: "Staff Night Check-in", editVal: editStaffNightDefaultCheckIn, siteVal: site.staffNightDefaultCheckIn || "" },
      { key: "staffNightDefaultCheckOut", label: "Staff Night Check-out", editVal: editStaffNightDefaultCheckOut, siteVal: site.staffNightDefaultCheckOut || "" },
      { key: "omaniDefaultCheckIn", label: "Omani Day Check-in", editVal: editOmaniDefaultCheckIn, siteVal: site.omaniDefaultCheckIn || "" },
      { key: "omaniDefaultCheckOut", label: "Omani Day Check-out", editVal: editOmaniDefaultCheckOut, siteVal: site.omaniDefaultCheckOut || "" },
      { key: "omaniNightDefaultCheckIn", label: "Omani Night Check-in", editVal: editOmaniNightDefaultCheckIn, siteVal: site.omaniNightDefaultCheckIn || "" },
      { key: "omaniNightDefaultCheckOut", label: "Omani Night Check-out", editVal: editOmaniNightDefaultCheckOut, siteVal: site.omaniNightDefaultCheckOut || "" },
      { key: "omaniStaffDefaultCheckIn", label: "Omani Staff Day Check-in", editVal: editOmaniStaffDefaultCheckIn, siteVal: site.omaniStaffDefaultCheckIn || "" },
      { key: "omaniStaffDefaultCheckOut", label: "Omani Staff Day Check-out", editVal: editOmaniStaffDefaultCheckOut, siteVal: site.omaniStaffDefaultCheckOut || "" },
      { key: "omaniStaffNightDefaultCheckIn", label: "Omani Staff Night Check-in", editVal: editOmaniStaffNightDefaultCheckIn, siteVal: site.omaniStaffNightDefaultCheckIn || "" },
      { key: "omaniStaffNightDefaultCheckOut", label: "Omani Staff Night Check-out", editVal: editOmaniStaffNightDefaultCheckOut, siteVal: site.omaniStaffNightDefaultCheckOut || "" },
    ]

    for (const { label, editVal, siteVal } of fieldMap) {
      // Any real difference counts — including setting a default for the first
      // time (empty → time, fills eligible empty sessions) and clearing one
      // (time → empty, empties sessions still holding the old default).
      if (siteVal !== editVal) {
        changes.push({
          field: label,
          oldValue: siteVal || "--:--",
          newValue: editVal || "--:--",
        })
      }
    }

    return changes
  }

  /**
   * Core save logic — called after user decision on whether to propagate.
   */
  const executeSaveDefaults = async (updateTodayRecords: boolean) => {
    if (!site) return

    try {
      setSavingDefaults(true)
      const res = await api.patch(`/api/site/${id}`, {
        defaultCheckIn: editDefaultCheckIn,
        defaultCheckOut: editDefaultCheckOut,
        nightDefaultCheckIn: editNightDefaultCheckIn,
        nightDefaultCheckOut: editNightDefaultCheckOut,
        staffDefaultCheckIn: editStaffDefaultCheckIn,
        staffDefaultCheckOut: editStaffDefaultCheckOut,
        staffNightDefaultCheckIn: editStaffNightDefaultCheckIn,
        staffNightDefaultCheckOut: editStaffNightDefaultCheckOut,
        omaniDefaultCheckIn: editOmaniDefaultCheckIn,
        omaniDefaultCheckOut: editOmaniDefaultCheckOut,
        omaniNightDefaultCheckIn: editOmaniNightDefaultCheckIn,
        omaniNightDefaultCheckOut: editOmaniNightDefaultCheckOut,
        omaniStaffDefaultCheckIn: editOmaniStaffDefaultCheckIn,
        omaniStaffDefaultCheckOut: editOmaniStaffDefaultCheckOut,
        omaniStaffNightDefaultCheckIn: editOmaniStaffNightDefaultCheckIn,
        omaniStaffNightDefaultCheckOut: editOmaniStaffNightDefaultCheckOut,
        updateTodayRecords,
      })

      const updatedSite = res.data

      // Handle propagation results
      if (updateTodayRecords && updatedSite.propagation) {
        const { updated, skipped, error } = updatedSite.propagation

        if (error) {
          toast.error(error)
        } else if (skipped && skipped.length > 0) {
          toast.success(`Updated ${updated} record(s). ${skipped.length} record(s) skipped.`)

          // Highlight skipped records
          const newSkippedIds = new Set<string>()
          const newSkippedReasons = new Map<string, string>()
          for (const s of skipped) {
            newSkippedIds.add(s.employeeId)
            const reasonLabel = s.reason === 'overlap'
              ? 'Skipped due to session overlap'
              : 'Skipped due to invalid worked hours'
            newSkippedReasons.set(s.employeeId, reasonLabel)
          }
          setSkippedEmployeeIds(newSkippedIds)
          setSkippedReasons(newSkippedReasons)

          // Auto-clear highlights after 10 seconds
          setTimeout(() => {
            setSkippedEmployeeIds(new Set())
            setSkippedReasons(new Map())
          }, 10000)
        } else {
          toast.success(`Default shift times updated. ${updated} record(s) updated.`)
        }

        // Refresh attendance data to show updated values
        await fetchAttendance(today)
      } else {
        toast.success("Default shift times updated successfully")
      }

      // Propagate default time changes to unsaved drafts (attendance not yet
      // submitted). Same matrix as the server-side propagation, collar-aware
      // (staff rows follow ONLY the staff defaults, no fallback):
      //  - update (A→B): sessions holding the previous default move to the new one.
      //  - clear  (A→""): sessions holding the previous default are emptied
      //    (check-ins only when there's no check-out). NOT marked as deliberate
      //    absences, so a future default can refill them.
      //  - fill  (""→B): empty sessions of the matching shift get the new
      //    check-in — except deliberate absences (manuallyCleared) and sick
      //    leave. Draft check-outs are never pre-filled.
      if (!attendanceExists && draftAttendance.length > 0) {
        type Transition = "update" | "clear" | "fill" | "none"
        const transitionOf = (oldV: string, newV: string): Transition =>
          oldV === newV ? "none" : oldV && newV ? "update" : oldV ? "clear" : "fill"

        type Candidate = { old: string; next: string; night: boolean }
        const defaultsByCategory: Record<
          RosterCategory,
          { checkIn: Candidate[]; checkOut: Candidate[] }
        > = {
          foreignSkilled: {
            checkIn: [
              { old: site.defaultCheckIn || "", next: editDefaultCheckIn, night: false },
              { old: site.nightDefaultCheckIn || "", next: editNightDefaultCheckIn, night: true },
            ],
            checkOut: [
              { old: site.defaultCheckOut || "", next: editDefaultCheckOut, night: false },
              { old: site.nightDefaultCheckOut || "", next: editNightDefaultCheckOut, night: true },
            ],
          },
          foreignStaff: {
            checkIn: [
              { old: site.staffDefaultCheckIn || "", next: editStaffDefaultCheckIn, night: false },
              { old: site.staffNightDefaultCheckIn || "", next: editStaffNightDefaultCheckIn, night: true },
            ],
            checkOut: [
              { old: site.staffDefaultCheckOut || "", next: editStaffDefaultCheckOut, night: false },
              { old: site.staffNightDefaultCheckOut || "", next: editStaffNightDefaultCheckOut, night: true },
            ],
          },
          omaniSkilled: {
            checkIn: [
              { old: site.omaniDefaultCheckIn || "", next: editOmaniDefaultCheckIn, night: false },
              { old: site.omaniNightDefaultCheckIn || "", next: editOmaniNightDefaultCheckIn, night: true },
            ],
            checkOut: [
              { old: site.omaniDefaultCheckOut || "", next: editOmaniDefaultCheckOut, night: false },
              { old: site.omaniNightDefaultCheckOut || "", next: editOmaniNightDefaultCheckOut, night: true },
            ],
          },
          omaniStaff: {
            checkIn: [
              { old: site.omaniStaffDefaultCheckIn || "", next: editOmaniStaffDefaultCheckIn, night: false },
              { old: site.omaniStaffNightDefaultCheckIn || "", next: editOmaniStaffNightDefaultCheckIn, night: true },
            ],
            checkOut: [
              { old: site.omaniStaffDefaultCheckOut || "", next: editOmaniStaffDefaultCheckOut, night: false },
              { old: site.omaniStaffNightDefaultCheckOut || "", next: editOmaniStaffNightDefaultCheckOut, night: true },
            ],
          },
        }

        setDraftAttendance(prev =>
          prev.map(record => {
            const { checkIn: inCands, checkOut: outCands } = defaultsByCategory[categoryOf(record.collarType, record.nationality)]
            return {
              ...record,
              sessions: record.sessions.map(session => {
                const sessionNight = session.isNightShift || false
                let nextIn = session.checkIn
                let nextOut = session.checkOut
                let nextCleared = session.manuallyCleared || false
                let modified = false

                for (const c of inCands) {
                  const t = transitionOf(c.old, c.next)
                  if (t === "none") continue
                  if (t === "fill") {
                    if (record.isSickLeave) continue
                    if (nextIn || nextOut) continue
                    if (nextCleared) continue
                    if (sessionNight !== c.night) continue
                    nextIn = c.next
                    modified = true
                  } else if (nextIn && nextIn === c.old) {
                    if (t === "clear") {
                      // Never wipe worked data.
                      if (nextOut) continue
                      nextIn = ""
                      // Emptied by a default change, not a deliberate absence.
                      nextCleared = false
                      modified = true
                    } else {
                      nextIn = c.next
                      modified = true
                    }
                  }
                }

                for (const c of outCands) {
                  const t = transitionOf(c.old, c.next)
                  // Drafts never pre-fill check-outs; the cron/saved-record
                  // propagation handles those after submit.
                  if (t === "none" || t === "fill") continue
                  if (!nextOut || nextOut !== c.old) continue
                  nextOut = t === "clear" ? "" : c.next
                  modified = true
                }

                if (!modified) return session

                const workedHours = calculateHours(nextIn, nextOut, sessionNight)
                return {
                  ...session,
                  checkIn: nextIn,
                  checkOut: nextOut,
                  manuallyCleared: nextCleared,
                  workedHours,
                }
              }),
            }
          })
        )
        setIsDirty(true)
      }

      // Remove response-only fields before setting site state
      const { propagation: _propagation, ...siteData } = updatedSite
      setSite(siteData)
      setIsEditingDefaults(false)
      setUpdateDefaultsDialogOpen(false)
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to update default shift times")
    } finally {
      setSavingDefaults(false)
    }
  }

  const handleSaveDefaults = async () => {
    if (!site) return

    const toMinutes = (t: string) => {
      const [h, m] = t.split(":").map(Number)
      return h * 60 + m
    }

    // Mirror of the server's rules in siteController.updateSite: in < out ordering, plus
    // absolute night-shift bounds. Day and night windows may overlap freely.

    const NOON = 12 * 60

    // --- DAY SHIFT VALIDATION (all four categories): check-out after check-in ---
    const dayPairs: Array<[string, string, string]> = [
      [editDefaultCheckIn, editDefaultCheckOut, "Skilled day"],
      [editStaffDefaultCheckIn, editStaffDefaultCheckOut, "Staff day"],
      [editOmaniDefaultCheckIn, editOmaniDefaultCheckOut, "Omani day"],
      [editOmaniStaffDefaultCheckIn, editOmaniStaffDefaultCheckOut, "Omani staff day"],
    ]
    for (const [inV, outV, label] of dayPairs) {
      if (inV && outV && toMinutes(outV) <= toMinutes(inV)) {
        toast.error(`${label} check-out must be after check-in (before midnight)`)
        return
      }
    }

    // --- NIGHT SHIFT VALIDATION (all four categories): check-in in PM, check-out in AM ---
    const nightIns: Array<[string, string]> = [
      [editNightDefaultCheckIn, "Night"],
      [editStaffNightDefaultCheckIn, "Staff night"],
      [editOmaniNightDefaultCheckIn, "Omani night"],
      [editOmaniStaffNightDefaultCheckIn, "Omani staff night"],
    ]
    for (const [v, label] of nightIns) {
      if (v && toMinutes(v) < NOON) {
        toast.error(`${label} check-in must be 12:00 (noon) or later`)
        return
      }
    }
    const nightOuts: Array<[string, string]> = [
      [editNightDefaultCheckOut, "Night"],
      [editStaffNightDefaultCheckOut, "Staff night"],
      [editOmaniNightDefaultCheckOut, "Omani night"],
      [editOmaniStaffNightDefaultCheckOut, "Omani staff night"],
    ]
    for (const [v, label] of nightOuts) {
      if (v && toMinutes(v) > NOON) {
        toast.error(`${label} check-out must be at or before 12:00 (noon)`)
        return
      }
    }

    // Detect what changed
    const changes = detectDefaultChanges()

    // If attendance exists and there are meaningful changes (old non-empty → new non-empty),
    // show the confirmation dialog
    if (attendanceExists && changes.length > 0) {
      setPendingDefaultChanges(changes)
      setIsEditingDefaults(false)
      setUpdateDefaultsDialogOpen(true)
      return
    }

    // No changes that need propagation, or drafts only — save directly
    await executeSaveDefaults(false)
  }

  // Sync all edit fields from the saved site values.
  const syncDefaultsFromSite = () => {
    setEditDefaultCheckIn(site?.defaultCheckIn || "")
    setEditDefaultCheckOut(site?.defaultCheckOut || "")
    setEditNightDefaultCheckIn(site?.nightDefaultCheckIn || "")
    setEditNightDefaultCheckOut(site?.nightDefaultCheckOut || "")
    setEditStaffDefaultCheckIn(site?.staffDefaultCheckIn || "")
    setEditStaffDefaultCheckOut(site?.staffDefaultCheckOut || "")
    setEditStaffNightDefaultCheckIn(site?.staffNightDefaultCheckIn || "")
    setEditStaffNightDefaultCheckOut(site?.staffNightDefaultCheckOut || "")
    setEditOmaniDefaultCheckIn(site?.omaniDefaultCheckIn || "")
    setEditOmaniDefaultCheckOut(site?.omaniDefaultCheckOut || "")
    setEditOmaniNightDefaultCheckIn(site?.omaniNightDefaultCheckIn || "")
    setEditOmaniNightDefaultCheckOut(site?.omaniNightDefaultCheckOut || "")
    setEditOmaniStaffDefaultCheckIn(site?.omaniStaffDefaultCheckIn || "")
    setEditOmaniStaffDefaultCheckOut(site?.omaniStaffDefaultCheckOut || "")
    setEditOmaniStaffNightDefaultCheckIn(site?.omaniStaffNightDefaultCheckIn || "")
    setEditOmaniStaffNightDefaultCheckOut(site?.omaniStaffNightDefaultCheckOut || "")
  }

  // Open the modal with a fresh copy of the saved values.
  const openEditDefaults = () => {
    syncDefaultsFromSite()
    setIsEditingDefaults(true)
  }

  // Cancel: discard edits (restore saved values) and close.
  const cancelEditDefaults = () => {
    syncDefaultsFromSite()
    setIsEditingDefaults(false)
  }

  // Records default to 'skilled' when collarType is missing (older data);
  // filters/stats below compare (record.collarType ?? "skilled") === collarTab.

  // Deferring the query keeps typing in the search box responsive: the input
  // updates immediately while the (heavier) list re-filter renders at lower
  // priority.
  const deferredSearchQuery = useDeferredValue(searchQuery)

  const filteredDraftAttendance = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase()
    return draftAttendance.filter((record) => {
      const categoryMatch =
        !categoryFilter ||
        (categoryFilter === 'temporary' && record.employee.employmentType === 'temporary')
      const matchesQuery =
        !query ||
        record.employee.name.toLowerCase().includes(query) ||
        record.employeeId.toLowerCase().includes(query) ||
        record.jobTitle.toLowerCase().includes(query)
      return (
        categoryOf(record.collarType, record.nationality) === collarTab &&
        categoryMatch &&
        matchesQuery
      )
    })
    // Float transferred-in employees to the top (stable: preserves order otherwise).
    .sort((a, b) => Number(!!b.transferredFrom) - Number(!!a.transferredFrom))
  }, [draftAttendance, categoryFilter, deferredSearchQuery, collarTab])

  const filteredAttendance = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase()
    return attendance.filter((record) => {
      const categoryMatch =
        !categoryFilter ||
        (categoryFilter === 'temporary' && record.employmentType === 'temporary')
      const matchesQuery =
        !query ||
        record.name.toLowerCase().includes(query) ||
        record.employeeId.toLowerCase().includes(query) ||
        record.jobTitle.toLowerCase().includes(query)
      return (
        categoryOf(record.collarType, record.nationality) === collarTab &&
        categoryMatch &&
        matchesQuery
      )
    })
    // Float transferred-in employees to the top (stable: preserves order otherwise).
    .sort((a, b) => Number(!!b.transferredFrom) - Number(!!a.transferredFrom))
  }, [attendance, categoryFilter, deferredSearchQuery, collarTab])

  // Counts per category (unaffected by name/id/title filters) for the tabs.
  const collarCounts = useMemo(() => {
    const source = attendanceExists ? attendance : draftAttendance
    const counts: Record<RosterCategory, number> = {
      foreignSkilled: 0, foreignStaff: 0, omaniSkilled: 0, omaniStaff: 0,
    }
    for (const r of source) {
      counts[categoryOf(r.collarType, r.nationality)]++
    }
    return counts
  }, [attendanceExists, attendance, draftAttendance])

  // Stats source is nationality/collar-agnostic; both the per-tab and global tallies
  // reuse this shape (an employee can be assigned to both day AND night on the same day,
  // so those buckets can overlap; "present" = at least one check-in on this site).
  type StatsRecord = { collarType?: CollarType; nationality?: Nationality; sessions: Array<{ siteId: string; checkIn?: string | null; isNightShift?: boolean }> }

  const computeSiteStats = useCallback((records: StatsRecord[]) => {
    const onSite = (s: { siteId: string }) => String(s.siteId) === String(id)
    const dayShiftAssigned = records.filter(rec => rec.sessions.some(s => onSite(s) && !s.isNightShift))
    const nightShiftAssigned = records.filter(rec => rec.sessions.some(s => onSite(s) && s.isNightShift))
    return {
      totalAssigned: records.length,
      totalPresent: records.filter(rec => rec.sessions.some(s => onSite(s) && s.checkIn)).length,
      totalDayShift: dayShiftAssigned.length,
      totalNightShift: nightShiftAssigned.length,
      dayShiftPresent: dayShiftAssigned.filter(rec => rec.sessions.some(s => onSite(s) && !s.isNightShift && s.checkIn)).length,
      nightShiftPresent: nightShiftAssigned.filter(rec => rec.sessions.some(s => onSite(s) && s.isNightShift && s.checkIn)).length,
    }
  }, [id])

  // Attendance statistics for the ACTIVE category tab.
  const stats = useMemo(() => {
    const source: StatsRecord[] = attendanceExists ? attendance : draftAttendance
    return computeSiteStats(source.filter((rec) => categoryOf(rec.collarType, rec.nationality) === collarTab))
  }, [attendanceExists, attendance, draftAttendance, collarTab, computeSiteStats])

  // Site-wide attendance statistics across ALL four categories (the top-of-page summary).
  const globalStats = useMemo(() => {
    const source: StatsRecord[] = attendanceExists ? attendance : draftAttendance
    return computeSiteStats(source)
  }, [attendanceExists, attendance, draftAttendance, computeSiteStats])

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty) return

      // Persist any debounced-but-unwritten draft edits before the tab closes.
      flushPendingDraftWrite()

      e.preventDefault()
      e.returnValue = ""
    }

    window.addEventListener(
      "beforeunload",
      handleBeforeUnload
    )

    return () => {
      window.removeEventListener(
        "beforeunload",
        handleBeforeUnload
      )
    }
  }, [isDirty])

  // Sync draft attendance to local storage — debounced (see
  // pendingDraftWriteRef near the top of the component).
  useEffect(() => {
    if (!(isDirty && draftAttendance && draftAttendance.length > 0 && id)) {
      // Draft no longer eligible for persistence (e.g. just submitted) —
      // drop anything queued so a stale draft can't be re-written later.
      pendingDraftWriteRef.current = null
      return
    }

    pendingDraftWriteRef.current = {
      key: `attendance_draft_${id}_${today}`,
      data: draftAttendance,
    }

    const timer = setTimeout(flushPendingDraftWrite, 300)
    return () => clearTimeout(timer)
  }, [draftAttendance, isDirty, id, today])

  // Flush any pending draft write when leaving the page (SPA navigation).
  useEffect(() => {
    return () => {
      flushPendingDraftWrite()
    }
  }, [])

  // Sync inline edits to local storage
  useEffect(() => {
    if (id) {
      if (editingRowId) {
        localStorage.setItem(`active_inline_edit_row_${id}`, editingRowId)
        localStorage.setItem(`active_inline_edit_data_${id}`, JSON.stringify(inlineEdit))
      } else {
        localStorage.removeItem(`active_inline_edit_row_${id}`)
        localStorage.removeItem(`active_inline_edit_data_${id}`)
      }
    }
  }, [editingRowId, inlineEdit, id])

  // Restore inline edits from local storage
  useEffect(() => {
    if (id) {
      const cachedRowId = localStorage.getItem(`active_inline_edit_row_${id}`)
      const cachedData = localStorage.getItem(`active_inline_edit_data_${id}`)
      if (cachedRowId && cachedData) {
        setEditingRowId(cachedRowId)
        setInlineEdit(JSON.parse(cachedData))
      }
    }
  }, [id])

  useEffect(() => {
    if (!isDirty) return

    const handlePopState = () => {
      setPendingPath("BACK")
      setShowLeaveDialog(true)

      window.history.pushState(
        null,
        "",
        window.location.pathname
      )
    }

    window.history.pushState(
      null,
      "",
      window.location.pathname
    )

    window.addEventListener(
      "popstate",
      handlePopState
    )

    return () => {
      window.removeEventListener(
        "popstate",
        handlePopState
      )
    }
  }, [isDirty])

  // Mobile drag gestures while the search/filter UI is engaged:
  //  - ANY drag blurs the search input so the keyboard gets out of the way
  //    while browsing results.
  //  - A deliberate DOWNWARD drag (finger top→bottom = scrolling up) that has
  //    actually unpinned the sticky filters bar — i.e. the user is revealing
  //    the upper section of the page — ends the focused/expanded mode
  //    entirely. Scrolling down through results never collapses it.
  // We key off touch events (real fingers only) instead of the scroll event,
  // so our own programmatic scrolls can never trigger any of this.
  // Note: we intentionally do NOT auto-focus the input when isSearchFocused
  // becomes true — selecting a category expands this same UI, and focusing
  // there would pop the keyboard and cause overscroll. The search field is
  // focused directly by the user's tap (see the Input's onPointerDown/onFocus).
  useEffect(() => {
    let startY: number | null = null

    const onTouchStart = (e: TouchEvent) => {
      startY = e.touches[0]?.clientY ?? null
    }

    const onTouchMove = (e: TouchEvent) => {
      if (window.innerWidth >= 768) return

      // Get the keyboard out of the way on any drag.
      if (document.activeElement === searchInputRef.current) {
        searchInputRef.current?.blur()
      }

      if (startY === null) return
      const dy = (e.touches[0]?.clientY ?? startY) - startY
      // Finger moving down = scrolling toward the top. Require a deliberate
      // drag so tap wobble and downward-list scrolling never collapse the UI.
      if (dy < 30) return

      const scrollContainer = document.getElementById("main-scroll-container")
      if (!scrollContainer || !filtersRef.current) return
      const gap =
        filtersRef.current.getBoundingClientRect().top -
        scrollContainer.getBoundingClientRect().top
      // gap > 0 means the sticky bar has unpinned from the container top —
      // the upper section (page header) is being revealed. End focus mode.
      if (gap > 2) {
        setIsSearchFocused(false)
        startY = null
      }
    }

    const onTouchEnd = () => {
      startY = null
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true })
    window.addEventListener("touchmove", onTouchMove, { passive: true })
    window.addEventListener("touchend", onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener("touchstart", onTouchStart)
      window.removeEventListener("touchmove", onTouchMove)
      window.removeEventListener("touchend", onTouchEnd)
    }
  }, [])

  // Pin the filters bar to the top when a category filter expands the sticky UI
  // on mobile. Runs as a layout effect (after the result-set reflow, before
  // paint) so switching to an empty result set can't briefly shift the view
  // down before we correct it. Instant scroll ("auto") avoids any animated
  // wobble; the delta math self-corrects if we're already at the top.
  useLayoutEffect(() => {
    if (window.innerWidth >= 768) return
    if (!categoryFilter) return
    // Instant scroll before paint avoids the reflow flicker in the common case.
    scrollFiltersToContainerTop("auto")
    // On the FIRST selection, isSearchFocused flips false→true in this same
    // commit, and the expanded min-height that provides scroll room isn't
    // reliably usable synchronously — so the scroll above can clamp short of the
    // top. Re-assert on the next frame, once that height is in effect, so the
    // bar reliably reaches the top. Both passes are instant and converge, so
    // there's no visible wobble.
    const raf = requestAnimationFrame(() => scrollFiltersToContainerTop("auto"))
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter])

  useEffect(() => {
    // Wait for WorkConfigProvider so the pay numbers are available before the roster renders.
    if (configLoading) return

    const initialize = async () => {
      try {
        setLoading(true)

        const siteData = await fetchSite()
        const calculatedDate = today

        // Yesterday's open sessions — surfaced today, and used to skip auto-prefill for
        // employees who are still finishing a carried-over shift.
        const carryoverIds = await fetchCarryovers(calculatedDate)

        const statusRes = await checkAttendanceStatus(calculatedDate)

        if (statusRes?.exists) {
          await fetchAttendance(calculatedDate)
        } else {
          await Promise.all([
            checkHolidayStatus(calculatedDate),
            siteData ? initializeAttendanceFromEmployees(siteData, carryoverIds) : Promise.resolve()
          ])
        }

      } catch (error) {
        console.log(error)

        toast.error(
          "Failed to load attendance"
        )
      } finally {
        setLoading(false)
      }
    }

    initialize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoading])

  if (loading || configLoading) {
    return (
      <div className="flex justify-center items-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    // NOTE: no transition on this container — the expanded padding below is
    // the scroll room that lets the filters bar pin to the top. Animating it
    // (transition-all) meant the room didn't exist yet when the pre-paint
    // scroll ran, so the first category tap clamped short of the top.
    <div className={cn(
      "space-y-6 p-6",
      isSearchFocused && "min-h-[120vh] pb-[60vh] md:min-h-0 md:pb-0"
    )}>

      {/* PAGE HEADER */}
      <Card className="overflow-hidden">
        {isHoliday && (
          <div className="bg-amber-50 dark:bg-amber-950/20 border-b border-amber-100 dark:border-amber-900/30 px-6 py-2 flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
            <Calendar className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Today is a Holiday: <strong>{holidayReason}</strong></span>
          </div>
        )}
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">

            <div className="flex items-start gap-3">

              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  handleSafeNavigation("/attendance")
                }
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>

              <div>
                <CardTitle className="flex items-center gap-2.5 flex-wrap">
                  <span>{site?.siteName}</span>
                  <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground ring-1 ring-inset ring-muted-foreground/10">
                    {stats.totalPresent} / {stats.totalAssigned} Present
                  </span>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "gap-1",
                      (collarTab === "foreignStaff" || collarTab === "omaniStaff")
                        ? "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300 border border-violet-200/50 dark:border-violet-800/30"
                        : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200/50 dark:border-emerald-800/30"
                    )}
                  >
                    {CATEGORY_IS_FOREIGN[collarTab] && <Plane className="h-3 w-3" />}
                    {CATEGORY_LABELS[collarTab]}
                  </Badge>
                </CardTitle>


                <p className="text-sm text-muted-foreground mt-1">
                  {formattedDate}
                </p>

                {site?.locationDetails && (
                  <p className="text-sm text-muted-foreground">
                    {site.locationDetails}
                  </p>
                )}

                {/* Site-wide attendance across ALL categories — deliberately subtle and
                    compact (one wrapping row). Per-category figures live in the tabs: the
                    "Present" badge in the title above reflects the ACTIVE category tab. */}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span className="font-medium text-muted-foreground/80">All:</span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3 shrink-0" />
                    <strong className="text-foreground font-semibold">{globalStats.totalPresent}/{globalStats.totalAssigned}</strong>
                    present
                  </span>
                  <span className="inline-flex items-center gap-1" title="Day shift present">
                    <Sun className="h-3 w-3 text-amber-500 shrink-0" />
                    <strong className="text-foreground font-semibold">{globalStats.dayShiftPresent}/{globalStats.totalDayShift}</strong>
                  </span>
                  <span className="inline-flex items-center gap-1" title="Night shift present">
                    <Moon className="h-3 w-3 text-indigo-400 shrink-0" />
                    <strong className="text-foreground font-semibold">{globalStats.nightShiftPresent}/{globalStats.totalNightShift}</strong>
                  </span>
                </div>
              </div>

            </div>

            <div className="grid grid-cols-1 gap-2">

              {attendanceExists ? (
                <Button disabled>
                  Attendance Submitted
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Save Attendance"
                  )}
                </Button>
              )}

            </div>

          </div>
        </CardHeader>
      </Card>

      {/* DEFAULT SHIFT TIMES — compact summary + edit modal */}
      <Card className="rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between px-4 py-3 sm:px-5 sm:py-4">

          {/* Sections: Skilled + Staff */}
          <div className="flex flex-col gap-3 sm:flex-row sm:gap-6 min-w-0">

            {/* Skilled */}
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Skilled</p>
              <div className="flex flex-col gap-1">
                {[
                  { label: "Day", cin: site?.defaultCheckIn, cout: site?.defaultCheckOut },
                  { label: "Night", cin: site?.nightDefaultCheckIn, cout: site?.nightDefaultCheckOut },
                ].map((s) => (
                  <div key={s.label} className="flex items-center gap-2 text-sm">
                    <span className="w-10 text-[11px] text-muted-foreground">{s.label}</span>
                    <span className="tabular-nums text-foreground font-medium">
                      {s.cin || "–"}
                    </span>
                    <span className="text-muted-foreground text-xs">→</span>
                    <span className="tabular-nums text-foreground font-medium">
                      {s.cout || "–"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Divider */}
            <div className="hidden sm:block w-px bg-border" />
            <div className="block sm:hidden h-px bg-border" />

            {/* Staff */}
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Staff</p>
              <div className="flex flex-col gap-1">
                {[
                  { label: "Day", cin: site?.staffDefaultCheckIn, cout: site?.staffDefaultCheckOut },
                  { label: "Night", cin: site?.staffNightDefaultCheckIn, cout: site?.staffNightDefaultCheckOut },
                ].map((s) => (
                  <div key={s.label} className="flex items-center gap-2 text-sm">
                    <span className="w-10 text-[11px] text-muted-foreground">{s.label}</span>
                    <span className="tabular-nums text-foreground font-medium">
                      {s.cin || "–"}
                    </span>
                    <span className="text-muted-foreground text-xs">→</span>
                    <span className="tabular-nums text-foreground font-medium">
                      {s.cout || "–"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
            <Button
              variant="outline"
              size="sm"
              onClick={openEditDefaults}
              className="rounded-md border-muted-foreground/30 hover:bg-accent flex items-center gap-1.5"
            >
              <Pencil className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Edit</span>
            </Button>
            <Button
              size="sm"
              onClick={() => setBulkAssignOpen(true)}
              className="rounded-md flex items-center gap-1.5"
              disabled={!attendanceExists}
              title={!attendanceExists ? "Attendance records must be saved first before assigning night shifts" : undefined}
            >
              <Moon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Assign Night Shift</span>
              <span className="sm:hidden">Night</span>
            </Button>
          </div>

        </div>
      </Card>

      {/* DEFAULT SHIFT TIMES — edit modal */}
      <Dialog
        open={isEditingDefaults}
        onOpenChange={(o) => {
          // Close only (no reset) so the propagation-confirm flow keeps the
          // edited values; the Cancel button handles discarding edits.
          if (!o && !savingDefaults) setIsEditingDefaults(false)
        }}
      >
        <DialogContent className="!max-w-[640px] flex flex-col max-h-[90dvh]">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Clock3 className="h-5 w-5" />
              Default Shift Times
            </DialogTitle>
            <DialogDescription>
              Used to pre-fill check-in and auto-fill check-out. Each category
              (✈️ foreign / Omani, skilled / staff) has its own day &amp; night times.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-1 overflow-y-auto flex-1 min-h-0 pr-1">

            {/* Per-category day/night defaults, laid out as a 2×2 grid of tiles. Each
                category prefills from its own times. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {(([
                {
                  key: "foreignSkilled", label: "Skilled Labour", foreign: true, staff: false,
                  rows: [
                    { label: "Day", inVal: editDefaultCheckIn, setIn: setEditDefaultCheckIn, outVal: editDefaultCheckOut, setOut: setEditDefaultCheckOut },
                    { label: "Night", inVal: editNightDefaultCheckIn, setIn: setEditNightDefaultCheckIn, outVal: editNightDefaultCheckOut, setOut: setEditNightDefaultCheckOut },
                  ],
                },
                {
                  key: "foreignStaff", label: "Staff", foreign: true, staff: true,
                  rows: [
                    { label: "Day", inVal: editStaffDefaultCheckIn, setIn: setEditStaffDefaultCheckIn, outVal: editStaffDefaultCheckOut, setOut: setEditStaffDefaultCheckOut },
                    { label: "Night", inVal: editStaffNightDefaultCheckIn, setIn: setEditStaffNightDefaultCheckIn, outVal: editStaffNightDefaultCheckOut, setOut: setEditStaffNightDefaultCheckOut },
                  ],
                },
                {
                  key: "omaniSkilled", label: "Omani Labour", foreign: false, staff: false,
                  rows: [
                    { label: "Day", inVal: editOmaniDefaultCheckIn, setIn: setEditOmaniDefaultCheckIn, outVal: editOmaniDefaultCheckOut, setOut: setEditOmaniDefaultCheckOut },
                    { label: "Night", inVal: editOmaniNightDefaultCheckIn, setIn: setEditOmaniNightDefaultCheckIn, outVal: editOmaniNightDefaultCheckOut, setOut: setEditOmaniNightDefaultCheckOut },
                  ],
                },
                {
                  key: "omaniStaff", label: "Omani Staff", foreign: false, staff: true,
                  rows: [
                    { label: "Day", inVal: editOmaniStaffDefaultCheckIn, setIn: setEditOmaniStaffDefaultCheckIn, outVal: editOmaniStaffDefaultCheckOut, setOut: setEditOmaniStaffDefaultCheckOut },
                    { label: "Night", inVal: editOmaniStaffNightDefaultCheckIn, setIn: setEditOmaniStaffNightDefaultCheckIn, outVal: editOmaniStaffNightDefaultCheckOut, setOut: setEditOmaniStaffNightDefaultCheckOut },
                  ],
                },
              ]) as { key: RosterCategory; label: string; foreign: boolean; staff: boolean; rows: { label: string; inVal: string; setIn: (v: string) => void; outVal: string; setOut: (v: string) => void }[] }[]).map((sec) => {
                return (
                  <div key={sec.key} className="rounded-xl border border-border bg-muted/[0.04] p-3">
                    <div className="flex items-center gap-1.5 mb-2.5">
                      <span className={cn("h-2 w-2 rounded-full shrink-0", sec.staff ? "bg-violet-500" : "bg-emerald-500")} />
                      {sec.foreign && <Plane className="h-3 w-3 text-muted-foreground shrink-0" />}
                      <span className="text-xs font-semibold text-foreground truncate">{sec.label}</span>
                    </div>
                    <div className="space-y-1.5">
                      {sec.rows.map((s) => {
                        const isDay = s.label === "Day"
                        return (
                          <div key={s.label} className="flex items-center gap-1.5">
                            {isDay
                              ? <Sun className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-label="Day" />
                              : <Moon className="h-3.5 w-3.5 text-indigo-400 shrink-0" aria-label="Night" />}
                            <Input
                              type="time"
                              value={s.inVal}
                              onChange={(e) => s.setIn(e.target.value)}
                              title={`${sec.label} ${s.label.toLowerCase()} check-in`}
                              className="h-8 text-xs px-1.5 flex-1 min-w-0 bg-background"
                            />
                            <span className="text-muted-foreground text-xs shrink-0">→</span>
                            <Input
                              type="time"
                              value={s.outVal}
                              onChange={(e) => s.setOut(e.target.value)}
                              title={`${sec.label} ${s.label.toLowerCase()} check-out`}
                              className="h-8 text-xs px-1.5 flex-1 min-w-0 bg-background"
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Night shifts are recorded on the day they START; their check-out is entered
                the next morning through the carryover flow on the roster. */}
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              <p>
                A shift is recorded on the day it <span className="font-semibold text-foreground">starts</span>.
                A night shift that runs past midnight stays on that day, and its check-out is
                entered the next morning from the roster's pending check-out list.
              </p>
            </div>

          </div>

          <DialogFooter className="shrink-0">
            <Button
              variant="outline"
              onClick={cancelEditDefaults}
              disabled={savingDefaults}
              className="flex items-center gap-1.5"
            >
              <X className="h-4 w-4" />
              Cancel
            </Button>
            <Button
              onClick={handleSaveDefaults}
              disabled={savingDefaults}
              className="flex items-center gap-1.5"
            >
              {savingDefaults ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The old "extended period" banner is gone: the roster is always today's calendar
          day, and an unfinished night shift from yesterday surfaces as a carryover row. */}



      {/* FILTERS — sticky */}
      <div ref={filtersRef} className="sticky top-0 z-20 -mx-6 px-6 pt-3 bg-background/90 backdrop-blur-md border-b border-border/50 shadow-[0_1px_6px_0_rgba(0,0,0,0.06)] space-y-2.5">
        <div className="w-full flex items-center gap-2">
          {isSearchFocused && (
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden shrink-0 -ml-2 h-9 w-9 text-muted-foreground hover:bg-muted"
              onClick={(e) => {
                e.stopPropagation()
                handleSearchDismiss()
              }}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <div className="relative flex-1">
            <Input
              ref={searchInputRef}
              placeholder="Search by name, ID, or job title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onPointerDown={(e) => {
                // Mobile: take control of focus so the browser's native
                // scroll-into-view (which fights our positioning when the
                // keyboard opens) never runs. We preventDefault to stop the
                // native tap-focus, then focus ourselves with preventScroll —
                // this still opens the keyboard (focus stays inside the tap
                // gesture) but leaves us as the only thing that scrolls.
                if (
                  window.innerWidth < 768 &&
                  document.activeElement !== searchInputRef.current
                ) {
                  e.preventDefault()
                  searchInputRef.current?.focus({ preventScroll: true })
                  // onFocus fires from this programmatic focus and runs
                  // handleSearchFocus, so no need to call it here.
                }
              }}
              onFocus={handleSearchFocus}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  handleSearchDismiss()
                }
              }}
              className="w-full bg-background placeholder:text-xs md:placeholder:text-sm placeholder:text-muted-foreground/60 pr-8"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground h-5 w-5 flex items-center justify-center rounded-full hover:bg-muted transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Category chips */}
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-[11px] text-muted-foreground font-medium shrink-0">Category:</span>
          {([
            { key: 'temporary' as const, label: 'Temporary Workers' },
          ] as { key: CategoryFilter & string; label: string }[]).map(({ key, label }) => {
            const active = categoryFilter === key
            return (
              <button
                key={key}
                onClick={() => handleCategoryFilterChange(key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-medium border transition-colors",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                )}
              >
                {active && <Check className="hidden sm:block h-3 w-3" />}
                {label}
              </button>
            )
          })}
          {categoryFilter && (
            <button
              onClick={handleClearCategoryFilter}
              className="ml-auto text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>

        {/* CATEGORY TABS: (Foreign) Skilled Labour / Staff — marked ✈️ — and Omani Labour / Omani Staff */}
        <div className="flex items-center gap-0 border-t border-muted/20 pt-1 -mx-6 px-6 overflow-x-auto">
          {(([
            { key: "foreignSkilled", label: "Skilled Labour", count: collarCounts.foreignSkilled, foreign: true },
            { key: "foreignStaff", label: "Staff", count: collarCounts.foreignStaff, foreign: true },
            { key: "omaniSkilled", label: "Omani Labour", count: collarCounts.omaniSkilled, foreign: false },
            { key: "omaniStaff", label: "Omani Staff", count: collarCounts.omaniStaff, foreign: false },
          ]) as { key: RosterCategory; label: string; count: number; foreign: boolean }[]).map((tab) => {
            const isActive = collarTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setCollarTab(tab.key)}
                className={`relative shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 px-4 pb-2.5 pt-1.5 text-sm font-semibold transition-colors duration-200 ${
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.foreign && <Plane className="h-3.5 w-3.5 shrink-0" aria-label="Foreign" />}
                {tab.label}
                <span
                  className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "bg-muted/60 text-muted-foreground"
                  }`}
                >
                  {tab.count}
                </span>
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-t-full" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {beforeNoon && carryoverRecords.length > 0 && (
        <Card className="mb-4 gap-0 py-0 border-amber-300 dark:border-amber-800/50 bg-amber-50/40 dark:bg-amber-950/10">
          <button
            type="button"
            onClick={() => setCarryoverPanelOpen((o) => !o)}
            aria-expanded={carryoverPanelOpen}
            className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-amber-100/40 dark:hover:bg-amber-900/20 rounded-xl"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300 min-w-0">
              <Clock3 className="h-4 w-4 shrink-0" />
              <span className="truncate">
                Pending check-out · {formatLogicalDateLabel(yesterdayOf(today))}
              </span>
              <Badge
                variant="secondary"
                className="shrink-0 bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200 border border-amber-300/60 dark:border-amber-700/40 text-[10px] px-1.5 py-0 h-4"
              >
                {carryoverRecords.length}
              </Badge>
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400 transition-transform duration-200",
                carryoverPanelOpen && "rotate-180"
              )}
            />
          </button>
          {carryoverPanelOpen && (
            <div className="px-4 pb-4 space-y-2">
              <p className="text-xs text-muted-foreground">
                These employees have an open shift from yesterday. Enter their real check-out time before it's forgotten.
              </p>
              {carryoverRecords.map((rec) => {
                const openSession = rec.sessions.find(
                  (s) => String(s.siteId) === String(id) && !!s.checkIn && !s.checkOut
                )
                return (
                  <div
                    key={rec.attendanceId}
                    className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{rec.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {rec.employeeId} • in {openSession?.checkIn ? formatLocalTime12h(openSession.checkIn) : "—"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 shrink-0 gap-1.5"
                      onClick={() => openEditRecord(rec)}
                    >
                      <Clock3 className="h-4 w-4" />
                      Check out
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">

          {attendanceExists ? (
            filteredAttendance.length === 0 ? (
              <EmptyState />
            ) : (
              <>
              {/* MOBILE */}
              {isMobileView && (
              <div className="space-y-3 md:hidden">
                {filteredAttendance.map((record) => {
                  const isEditing =
                    editingRowId === record.attendanceId

                  const complete = isRecordComplete(record)

                  return (
                    <Card
                      key={record.attendanceId}
                      className={
                        (isOverlapRow(record.employee) || (isEditing && !!inlineEditError))
                          ? "border-red-500 bg-red-50/50 dark:bg-red-950/10"
                          : skippedEmployeeIds.has(record.employeeId)
                            ? "border-amber-500 bg-amber-50/50 dark:bg-amber-950/10"
                            : ""
                      }
                      title={skippedEmployeeIds.has(record.employeeId) ? skippedReasons.get(record.employeeId) || '' : undefined}
                    >
                      <CardContent className="pt-4 space-y-3">

                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium">
                                {record.name}
                              </p>
                              {record.user && (
                                <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-800/30 text-[10px] px-1.5 py-0 h-4">
                                  Supervisor
                                </Badge>
                              )}
                              {record.employmentType === 'temporary' && (
                                <Badge variant="secondary" className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/30 text-[10px] px-1.5 py-0 h-4">
                                  Temporary
                                </Badge>
                              )}
                              {record.transferredFrom && (
                                <TransferredFromBadge siteName={record.transferredFrom.name} />
                              )}
                              {carryoverEmpIds.has(record.employee) && (
                                <CarryoverBadge onClick={() => handleOpenCarryover(record.employee)} />
                              )}
                            </div>

                            <p className="text-sm text-muted-foreground">
                              {record.employeeId} • {record.jobTitle}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {record.isSickLeave ? (
                              <SickLeaveBadge />
                            ) : isEmployeeAbsent(record.sessions, id) ? (
                              <AbsentIndicator />
                            ) : null}
                            {!isEditing && (
                              <RowActionsMenu
                                isSick={!!record.isSickLeave}
                                saving={sickSavingId === record.attendanceId}
                                sickDisabled={!isEmployeeAbsent(record.sessions, id)}
                                sickDisabledReason="Clear the check-in to mark sick leave"
                                onToggleSick={() => toggleSavedSickLeave(record)}
                                showTransfer
                                transferDisabled={false}
                                onTransfer={() => handleTransferClick(record)}
                              />
                            )}
                          </div>
                        </div>

                        <div>
                          <span className="font-medium">
                            Hours:
                          </span>{" "}
                          {isEditing
                            ? calculateHours(
                                inlineEdit.checkIn,
                                inlineEdit.checkOut,
                                inlineEdit.isNightShift
                              )
                            : getSiteWorkedHours(record)}
                        </div>

                        {breakDurationMinutes > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="font-medium">Breaks:</span>
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  className="h-6 w-6 rounded border text-xs font-bold hover:bg-muted transition-colors disabled:opacity-40"
                                  disabled={inlineEdit.breaksTaken !== null && inlineEdit.breaksTaken <= 0}
                                  onClick={() => {
                                    const currentSessionHours = record.sessions[0]?.workedHours || 0
                                    const otherSessionsHours = (record.totalRawHours || 0) - currentSessionHours
                                    const newTotalRawHours = otherSessionsHours + calculateHours(inlineEdit.checkIn, inlineEdit.checkOut, inlineEdit.isNightShift)
                                    const auto = Math.floor(newTotalRawHours / fullDayHours)
                                    setInlineEdit((prev) => ({
                                      ...prev,
                                      breaksTaken: Math.max(0, (prev.breaksTaken ?? auto) - 1)
                                    }))
                                  }}
                                >−</button>
                                <span className="text-xs">
                                  {inlineEdit.breaksTaken !== null
                                    ? inlineEdit.breaksTaken
                                    : "Auto"}
                                </span>
                                <button
                                  type="button"
                                  className="h-6 w-6 rounded border text-xs font-bold hover:bg-muted transition-colors"
                                  onClick={() => {
                                    const currentSessionHours = record.sessions[0]?.workedHours || 0
                                    const otherSessionsHours = (record.totalRawHours || 0) - currentSessionHours
                                    const newTotalRawHours = otherSessionsHours + calculateHours(inlineEdit.checkIn, inlineEdit.checkOut, inlineEdit.isNightShift)
                                    const auto = Math.floor(newTotalRawHours / fullDayHours)
                                    setInlineEdit((prev) => ({
                                      ...prev,
                                      breaksTaken: (prev.breaksTaken ?? auto) + 1
                                    }))
                                  }}
                                >+</button>
                                {inlineEdit.breaksTaken !== null && (
                                  <button
                                    type="button"
                                    className="text-[10px] text-muted-foreground hover:text-foreground ml-1"
                                    onClick={() => setInlineEdit((prev) => ({ ...prev, breaksTaken: null }))}
                                    title="Reset to auto"
                                  >✕</button>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs">
                                {(() => {
                                  const isAuto = record.breaksTaken === null || record.breaksTaken === undefined;
                                  if (isAuto && hasOpenSession(record)) {
                                    return (
                                      <span
                                        className="italic text-muted-foreground"
                                        title="Auto-calculated once the session is checked out"
                                      >
                                        Auto
                                      </span>
                                    );
                                  }
                                  const count = isAuto
                                    ? Math.floor((record.totalRawHours ?? record.sessions.reduce((acc, s) => acc + (s.workedHours || 0), 0)) / fullDayHours)
                                    : record.breaksTaken;
                                  return `${count}`;
                                })()}
                              </span>
                            )}
                          </div>
                        )}


                        {isEditing ? (
                          <div className="space-y-3">
                             <div className="space-y-1">
                              <p className="text-sm font-medium">
                                Check In
                              </p>

                              <Input
                                type="time"
                                value={inlineEdit.checkIn}
                               onChange={(e) => {
                                  const val = e.target.value
                                  // Cutoff-free: crosses midnight iff the check-out reads
                                  // earlier than the check-in.
                                  const { checkOutNextDay } = deriveOffsets(val, inlineEdit.checkOut)
                                  setInlineEdit((prev) => ({
                                    ...prev,
                                    checkIn: val,
                                    isNightShift: checkOutNextDay,
                                  }))
                                }}
                              />
                            </div>

                            <div className="space-y-1">
                              <p className="text-sm font-medium">
                                Check Out
                              </p>

                              <Input
                                type="time"
                                value={inlineEdit.checkOut}
                                onChange={(e) => {
                                  const val = e.target.value
                                  const { checkOutNextDay } = deriveOffsets(inlineEdit.checkIn, val)
                                  setInlineEdit((prev) => ({
                                    ...prev,
                                    checkOut: val,
                                    isNightShift: checkOutNextDay,
                                  }))
                                }}
                              />
                            </div>

                            <div className="text-sm mt-2 font-medium flex items-center gap-1.5">
                              <span>Shift:</span>
                              {(inlineEdit.isNightShift || (inlineEdit.checkIn && inlineEdit.checkOut && isCrossMidnight(inlineEdit.checkIn, inlineEdit.checkOut, inlineEdit.isNightShift))) ? (
                                <span className="inline-flex items-center gap-1 text-indigo-600 font-medium">
                                  🌙 Night
                                </span>
                              ) : (
                                <span className="text-muted-foreground">☀️ Day</span>
                              )}
                            </div>

                            {inlineEditError && (
                              <div className="text-red-500 text-xs mt-1 font-medium max-w-xs">
                                {inlineEditError}
                              </div>
                            )}

                            <div className="flex gap-2 flex-wrap">
                              {lastClearedSaved && lastClearedSaved.attendanceId === record.attendanceId && !inlineEdit.checkIn && !inlineEdit.checkOut ? (
                                <Button
                                  variant="outline"
                                  onClick={undoClearInlineEdit}
                                  className="flex items-center gap-1.5"
                                  disabled={rowSaving}
                                >
                                  <Undo className="h-4 w-4" />
                                  Undo
                                </Button>
                              ) : (inlineEdit.checkIn || inlineEdit.checkOut) ? (
                                <Button
                                  variant="outline"
                                  onClick={() => clearInlineEdit(record)}
                                  disabled={rowSaving}
                                >
                                  Absent
                                </Button>
                              ) : null}
                              <Button
                                onClick={() =>
                                  saveInlineEdit(record)
                                }
                                disabled={rowSaving}
                              >
                                {rowSaving ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <>
                                    <Save className="h-4 w-4 mr-2" />
                                    Save
                                  </>
                                )}
                              </Button>

                              <Button
                                variant="outline"
                                onClick={cancelInlineEdit}
                                disabled={rowSaving}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="space-y-3">
                              {record.sessions.map((session, idx) => (
                                <div key={session._id || idx} className="space-y-2 border-t pt-2 first:border-t-0 first:pt-0">
                                  {record.sessions.length > 1 && (
                                    <p className="text-xs font-semibold text-muted-foreground">
                                      Session #{idx + 1}
                                    </p>
                                  )}
                                  <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                      <p className="text-sm font-medium">
                                        Check In
                                      </p>
                                      <Input
                                        type="time"
                                        readOnly
                                        value={toTimeValue(session.checkIn)}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <p className="text-sm font-medium">
                                        Check Out
                                      </p>
                                      <Input
                                        type="time"
                                        readOnly
                                        value={toTimeValue(session.checkOut)}
                                      />
                                    </div>
                                  </div>
                                  <div className="text-sm font-medium flex items-center gap-1.5 mt-1">
                                    <span>Shift:</span>
                                    {(session.isNightShift || (session.checkIn && session.checkOut && isCrossMidnight(toTimeValue(session.checkIn), toTimeValue(session.checkOut), session.isNightShift))) ? (
                                      <span className="inline-flex items-center gap-1 text-indigo-600 font-medium">
                                        🌙 Night
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground">☀️ Day</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>

                            {carryoverEmpIds.has(record.employee) ? (
                              // Carryover takes over the row's primary action: closing
                              // yesterday's shift is the only thing to do here until done.
                              <Button
                                variant="outline"
                                className="border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-800/60 dark:text-amber-300 dark:hover:bg-amber-950/30 dark:hover:text-amber-200"
                                onClick={() => handleOpenCarryover(record.employee)}
                              >
                                <Clock3 className="h-4 w-4 mr-2" />
                                Check out yesterday
                              </Button>
                            ) : complete ? (
                              <Button
                                variant="outline"
                                onClick={() =>
                                  openEditRecord(record)
                                }
                              >
                                <Pencil className="h-4 w-4 mr-2" />
                                <Plus className="h-4 w-4 mr-2" />
                                Edit / Add
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                onClick={() =>
                                  startInlineEdit(record)
                                }
                              >
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit
                              </Button>
                            )}
                          </>
                        )}
                        {isOverlapRow(record.employee) && (
                          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl space-y-1 text-sm text-red-700 dark:bg-red-950/20 dark:border-red-800/30 dark:text-red-200">
                            <div className="font-medium">
                              Conflicts with existing session
                            </div>
                            <div>
                              Site: {overlapError?.conflictingSession?.siteName}
                            </div>
                            <div>
                              Time: {formatConflictingTime()}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
              )}
              {/* DESKTOP */}
              {!isMobileView && (
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Check In</TableHead>
                      <TableHead>Check Out</TableHead>
                      <TableHead>Shift</TableHead>
                      <TableHead>Hours</TableHead>
                      {breakDurationMinutes > 0 && <TableHead className="text-xs text-muted-foreground">☕ Breaks</TableHead>}
                      <TableHead className="text-right">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>

                    {filteredAttendance.map(
                      (record) => {
                        const isEditing =
                          editingRowId === record.attendanceId

                        const complete = isRecordComplete(record)

                        const sessions =
                          record.sessions.length > 0
                            ? record.sessions
                            : [null]

                        return sessions.map(
                          (session, sessionIndex) => {
                            const isLastSession = sessionIndex === sessions.length - 1
                            return (
                              <Fragment key={`${record.attendanceId}-${sessionIndex}`}>
                                <TableRow
                                  className={
                                    (isOverlapRow(record.employee) || (isEditing && !!inlineEditError))
                                      ? "bg-red-50 dark:bg-red-950/20 border-red-500"
                                      : skippedEmployeeIds.has(record.employeeId)
                                        ? "bg-amber-50 dark:bg-amber-950/20 border-amber-500"
                                        : ""
                                  }
                                  title={skippedEmployeeIds.has(record.employeeId) ? skippedReasons.get(record.employeeId) || '' : undefined}
                                >
                              {sessionIndex === 0 && (
                                <TableCell rowSpan={sessions.length}>
                                  <div className="flex items-center justify-between gap-4">
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <p className="font-medium">
                                          {record.name}
                                        </p>
                                        {record.user && (
                                          <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-800/30 text-[10px] px-1.5 py-0 h-4">
                                            Supervisor
                                          </Badge>
                                        )}
                                        {record.employmentType === 'temporary' && (
                                          <Badge variant="secondary" className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/30 text-[10px] px-1.5 py-0 h-4">
                                            Temporary
                                          </Badge>
                                        )}
                                        {record.transferredFrom && (
                                          <TransferredFromBadge siteName={record.transferredFrom.name} />
                                        )}
                                        {carryoverEmpIds.has(record.employee) && (
                                          <CarryoverBadge onClick={() => handleOpenCarryover(record.employee)} />
                                        )}
                                      </div>

                                      <p className="text-sm text-muted-foreground">
                                        {record.employeeId} • {record.jobTitle}
                                      </p>
                                    </div>
                                    {record.isSickLeave ? (
                                      <SickLeaveBadge />
                                    ) : isEmployeeAbsent(record.sessions, id) ? (
                                      <AbsentIndicator />
                                    ) : null}
                                  </div>
                                </TableCell>
                              )}

                              {/* CHECK IN */}
                              <TableCell>
                                {isEditing ? (
                                  <Input
                                    type="time"
                                    value={inlineEdit.checkIn}
                                    onChange={(e) => {
                                      const val = e.target.value
                                      // Cutoff-free: crosses midnight iff the check-out
                                      // reads earlier than the check-in.
                                      const { checkOutNextDay } = deriveOffsets(val, inlineEdit.checkOut)
                                      setInlineEdit((prev) => ({
                                        ...prev,
                                        checkIn: val,
                                        isNightShift: checkOutNextDay,
                                      }))
                                    }}
                                  />
                                ) : (
                                  <Input
                                    type="time"
                                    readOnly
                                    value={toTimeValue(
                                      session?.checkIn
                                    )}
                                  />
                                )}
                              </TableCell>

                              {/* CHECK OUT */}
                              <TableCell>
                                {isEditing ? (
                                  <div className="space-y-1">
                                    <Input
                                      type="time"
                                      value={inlineEdit.checkOut}
                                      onChange={(e) => {
                                        const val = e.target.value
                                        const { checkOutNextDay } = deriveOffsets(inlineEdit.checkIn, val)
                                        setInlineEdit((prev) => ({
                                          ...prev,
                                          checkOut: val,
                                          isNightShift: checkOutNextDay,
                                        }))
                                      }}
                                    />
                                    {inlineEditError && (
                                      <div className="text-red-500 text-xs mt-1 font-medium max-w-[180px] break-words">
                                        {inlineEditError}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <Input
                                    type="time"
                                    readOnly
                                    value={toTimeValue(
                                      session?.checkOut
                                    )}
                                  />
                                )}
                              </TableCell>

                              {/* SHIFT */}
                              <TableCell>
                                <span className="text-sm">
                                  {(isEditing ? (inlineEdit.isNightShift || (inlineEdit.checkIn && inlineEdit.checkOut && isCrossMidnight(inlineEdit.checkIn, inlineEdit.checkOut, inlineEdit.isNightShift))) : (session?.isNightShift || (session?.checkIn && session?.checkOut && isCrossMidnight(toTimeValue(session.checkIn), toTimeValue(session.checkOut), session.isNightShift)))) ? (
                                    <span title="Night shift" className="inline-flex items-center gap-1 text-indigo-600 font-medium">
                                      🌙 Night
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">☀️ Day</span>
                                  )}
                                </span>
                              </TableCell>

                              {/* HOURS */}
                              {sessionIndex === 0 && (
                                <TableCell rowSpan={sessions.length}>
                                  {isEditing
                                    ? calculateHours(
                                        inlineEdit.checkIn,
                                        inlineEdit.checkOut,
                                        inlineEdit.isNightShift
                                      )
                                    : getSiteWorkedHours(record)}
                                </TableCell>
                              )}

                              {breakDurationMinutes > 0 && sessionIndex === 0 && (
                                <TableCell rowSpan={sessions.length}>
                                  {isEditing ? (
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        className="h-6 w-6 rounded border text-xs font-bold hover:bg-muted transition-colors disabled:opacity-40"
                                        disabled={inlineEdit.breaksTaken !== null && inlineEdit.breaksTaken <= 0}
                                        onClick={() => {
                                          const currentSessionHours = record.sessions[0]?.workedHours || 0
                                          const otherSessionsHours = (record.totalRawHours || 0) - currentSessionHours
                                          const newTotalRawHours = otherSessionsHours + calculateHours(inlineEdit.checkIn, inlineEdit.checkOut, inlineEdit.isNightShift)
                                          const auto = Math.floor(newTotalRawHours / fullDayHours)
                                          setInlineEdit((prev) => ({
                                            ...prev,
                                            breaksTaken: Math.max(0, (prev.breaksTaken ?? auto) - 1)
                                          }))
                                        }}
                                      >−</button>
                                      <span className="min-w-[44px] text-center text-xs font-medium">
                                        {inlineEdit.breaksTaken !== null
                                          ? inlineEdit.breaksTaken
                                          : "Auto"}
                                      </span>
                                      <button
                                        type="button"
                                        className="h-6 w-6 rounded border text-xs font-bold hover:bg-muted transition-colors"
                                        onClick={() => {
                                          const currentSessionHours = record.sessions[0]?.workedHours || 0
                                          const otherSessionsHours = (record.totalRawHours || 0) - currentSessionHours
                                          const newTotalRawHours = otherSessionsHours + calculateHours(inlineEdit.checkIn, inlineEdit.checkOut, inlineEdit.isNightShift)
                                          const auto = Math.floor(newTotalRawHours / fullDayHours)
                                          setInlineEdit((prev) => ({
                                            ...prev,
                                            breaksTaken: (prev.breaksTaken ?? auto) + 1
                                          }))
                                        }}
                                      >+</button>
                                      {inlineEdit.breaksTaken !== null && (
                                        <button
                                          type="button"
                                          className="text-[10px] text-muted-foreground hover:text-foreground ml-1"
                                          onClick={() => setInlineEdit((prev) => ({ ...prev, breaksTaken: null }))}
                                          title="Reset to auto"
                                        >✕</button>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-xs">
                                      {(() => {
                                        const isAuto = record.breaksTaken === null || record.breaksTaken === undefined;
                                        if (isAuto && hasOpenSession(record)) {
                                          return (
                                            <span
                                              className="italic text-muted-foreground"
                                              title="Auto-calculated once the session is checked out"
                                            >
                                              Auto
                                            </span>
                                          );
                                        }
                                        const count = isAuto
                                          ? Math.floor((record.totalRawHours ?? record.sessions.reduce((acc, s) => acc + (s.workedHours || 0), 0)) / fullDayHours)
                                          : record.breaksTaken;
                                        return `${count}`;
                                      })()}
                                    </span>
                                  )}
                                </TableCell>
                              )}

                              {/* ACTIONS */}
                              {sessionIndex === 0 && (
                                <TableCell className="text-right" rowSpan={sessions.length}>
                                  {isEditing ? (
                                    <div className="flex justify-end gap-2 items-center">
                                      {lastClearedSaved && lastClearedSaved.attendanceId === record.attendanceId && !inlineEdit.checkIn && !inlineEdit.checkOut ? (
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={undoClearInlineEdit}
                                          className="inline-flex items-center gap-1.5"
                                          disabled={rowSaving}
                                        >
                                          <Undo className="h-4 w-4" />
                                          Undo
                                        </Button>
                                      ) : (inlineEdit.checkIn || inlineEdit.checkOut) ? (
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => clearInlineEdit(record)}
                                          disabled={rowSaving}
                                        >
                                          Absent
                                        </Button>
                                      ) : null}
                                      <Button
                                        size="icon"
                                        variant="outline"
                                        onClick={() =>
                                          saveInlineEdit(record)
                                        }
                                        disabled={rowSaving}
                                      >
                                        {rowSaving ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                          <Save className="h-4 w-4" />
                                        )}
                                      </Button>

                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={cancelInlineEdit}
                                        disabled={rowSaving}
                                      >
                                        <X className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  ) : (
                                    <div className="flex justify-end items-center gap-2">
                                      {carryoverEmpIds.has(record.employee) ? (
                                        // Carryover takes over the row's primary action. Kept
                                        // subtle (outline, not a solid fill) so it doesn't crowd
                                        // the kebab beside it on md-width laptops — the amber
                                        // ⏳ badge in the employee cell already flags the state.
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-800/60 dark:text-amber-300 dark:hover:bg-amber-950/30 dark:hover:text-amber-200"
                                          title="Enter yesterday's check-out to unlock today"
                                          onClick={() => handleOpenCarryover(record.employee)}
                                        >
                                          <Clock3 className="h-4 w-4" />
                                          Check out
                                        </Button>
                                      ) : complete ? (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          title="Edit & add sessions"
                                          onClick={() =>
                                            openEditRecord(record)
                                          }
                                        >
                                          <Pencil className="h-4 w-4" />
                                          <Plus className="h-4 w-4 ml-1" />
                                        </Button>
                                      ) : (
                                        <Button
                                          size="icon"
                                          variant="outline"
                                          title="Edit attendance"
                                          onClick={() =>
                                            startInlineEdit(record)
                                          }
                                        >
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                      )}
                                      <RowActionsMenu
                                        isSick={!!record.isSickLeave}
                                        saving={sickSavingId === record.attendanceId}
                                        sickDisabled={!isEmployeeAbsent(record.sessions, id)}
                                        sickDisabledReason="Clear the check-in to mark sick leave"
                                        onToggleSick={() => toggleSavedSickLeave(record)}
                                        showTransfer
                                        transferDisabled={false}
                                        onTransfer={() => handleTransferClick(record)}
                                      />
                                    </div>
                                  )}
                                </TableCell>
                              )}
                            </TableRow>
                                {isLastSession && isOverlapRow(record.employee) && (
                                  <TableRow className="border-red-500/30">
                                    <TableCell
                                      colSpan={6}
                                      className="bg-red-50 dark:bg-red-950/20"
                                    >
                                      <div className="space-y-1 text-sm text-red-700 dark:text-red-200">
                                        <div className="font-medium">
                                          Conflicts with existing session
                                        </div>
                                        <div>
                                          Site: {overlapError?.conflictingSession?.siteName}
                                        </div>
                                        <div>
                                          Time: {formatConflictingTime()}
                                        </div>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                )}
                              </Fragment>
                            )
                          }
                        )
                      }
                    )}

                  </TableBody>
                </Table>
              </div>
              )}
              </>
            )
          ) : (
            filteredDraftAttendance.length === 0 ? (
              <EmptyState />
            ) : (
              <>
                {/* MOBILE */}
                {isMobileView && (
                <div className="space-y-3 md:hidden">
                  {filteredDraftAttendance.map((record) => (
                    <DraftAttendanceMobileCard
                      key={record.employee._id}
                      record={record}
                      siteId={id}
                      breakDurationMinutes={breakDurationMinutes}
                      fullDayHours={fullDayHours}
                      hasCarryover={carryoverEmpIds.has(record.employee._id)}
                      onOpenCarryover={handleOpenCarryover}
                      overlap={overlapError?.employeeId === record.employee._id ? overlapError : null}
                      showUndo={!!(lastCleared && lastCleared.employeeId === record.employee._id && !record.sessions[0]?.checkIn && !record.sessions[0]?.checkOut)}
                      onUpdateSession={updateDraftSession}
                      onToggleSick={toggleDraftSickLeave}
                      onUpdateBreaks={updateDraftBreaksTaken}
                      onClearSession={clearDraftSession}
                      onUndoClear={undoClearDraftSession}
                    />
                  ))}
                </div>
                )}

              {/* desktop */}
              {!isMobileView && (
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Check In</TableHead>
                      <TableHead>Check Out</TableHead>
                      <TableHead>Shift</TableHead>
                      <TableHead>Hours</TableHead>
                      {breakDurationMinutes > 0 && <TableHead className="text-xs text-muted-foreground">☕ Breaks</TableHead>}
                      <TableHead className="text-right">Actions</TableHead>

                    </TableRow>
                  </TableHeader>

                  <TableBody>

                    {filteredDraftAttendance.map((record) => (
                      <DraftAttendanceDesktopRow
                        key={record.employee._id}
                        record={record}
                        siteId={id}
                        breakDurationMinutes={breakDurationMinutes}
                        fullDayHours={fullDayHours}
                        hasCarryover={carryoverEmpIds.has(record.employee._id)}
                        onOpenCarryover={handleOpenCarryover}
                        overlap={overlapError?.employeeId === record.employee._id ? overlapError : null}
                        showUndo={!!(lastCleared && lastCleared.employeeId === record.employee._id && !record.sessions[0]?.checkIn && !record.sessions[0]?.checkOut)}
                        onUpdateSession={updateDraftSession}
                        onToggleSick={toggleDraftSickLeave}
                        onUpdateBreaks={updateDraftBreaksTaken}
                        onClearSession={clearDraftSession}
                        onUndoClear={undoClearDraftSession}
                      />
                    ))}

                  </TableBody>
                </Table>
              </div>
              )}
            </>
          )
        )}

        </CardContent>
      </Card>
      <EditSiteRecord
        open={editOpen}
        onClose={() => setEditOpen(false)}
        attendanceId={selectedRecord?.attendanceId ?? null}
        site={site!}
        onUpdated={(updatedRecord) => {
          const edited = selectedRecord
          const wasCarryover =
            !!edited && String(edited.date).slice(0, 10) !== today
          handleRecordUpdated(updatedRecord as AttendanceRecord)
          // A carryover may have just been closed on yesterday's record — refresh the
          // pending-checkout list so it drops off once its check-out is filled.
          fetchCarryovers(today)
          if (wasCarryover && edited) {
            // Coming off a night shift, the employee starts today ABSENT rather than with a
            // prefilled morning check-in — the supervisor marks them only if they do work.
            setDraftAttendance((prev) =>
              clearCarryoverSessions(prev, new Set([String(edited.employee)]))
            )
          }
        }}
      />

      <BulkAssignNightShift
        open={bulkAssignOpen}
        onClose={() => setBulkAssignOpen(false)}
        siteId={id ?? ""}
        date={today}
        onAssigned={() => {
          fetchAttendance(today)
        }}
      />

      <TransferEmployeeModal
        open={transferModalOpen}
        onClose={() => {
          setTransferModalOpen(false)
          setTransferTargetRecord(null)
        }}
        employeeId={transferTargetRecord?.employee ?? ""}
        employeeName={transferTargetRecord?.name ?? ""}
        fromSiteId={id ?? ""}
        date={today}
        isSupervisor={!!transferTargetRecord?.user}
        onTransferred={() => {
          setTransferModalOpen(false)
          setTransferTargetRecord(null)
          fetchAttendance(today)
        }}
      />

      <UnsavedChangesDialog
        open={showLeaveDialog}
        onStay={() => {
          setShowLeaveDialog(false)
          setPendingPath(null)
        }}
        onLeave={() => {
          setShowLeaveDialog(false)
          setIsDirty(false)

          // The user chose to discard the draft — make sure the unmount flush
          // can't write it back after we remove it below.
          discardPendingDraftWrite()
          localStorage.removeItem(`attendance_draft_${id}_${today}`)
          localStorage.removeItem(`active_inline_edit_row_${id}`)
          localStorage.removeItem(`active_inline_edit_data_${id}`)

          if (pendingPath === "BACK") {
            window.history.go(-2)
          } else if (pendingPath) {
            navigate(pendingPath)
          }
        }}
      />

      <UpdateDefaultsDialog
        open={updateDefaultsDialogOpen}
        onOpenChange={setUpdateDefaultsDialogOpen}
        changes={pendingDefaultChanges}
        loading={savingDefaults}
        onConfirm={() => executeSaveDefaults(true)}
        onSkip={() => executeSaveDefaults(false)}
      />

    </div>
  )
}

export default SiteAttendance
