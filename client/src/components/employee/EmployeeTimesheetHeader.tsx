import { useState, type ReactNode } from "react"
import {
  ArrowLeft,
  CalendarPlus,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Loader2,
  Siren,
} from "lucide-react"

import GrantLeaveDialog, { type LeaveType } from "@/components/GrantLeaveDialog"
import { MonthYearPicker } from "@/components/MonthYearPicker"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ABSENT_REASONS,
  ANNUAL_LEAVE,
  type AbsentCounts,
} from "@/lib/leaveComposition"
import type { MonthYear } from "@/lib/monthYear"
import { round2 } from "@/lib/timesheetExport"
import { cn } from "@/lib/utils"

export interface TimesheetEmployee {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
  companyId?: string | null
  isActive: boolean
}

export interface LeaveBalance {
  year: number
  defaultDays: number
  override: number | null
  entitlement: number
  used: number
  remaining: number
  // Emergency (unpaid, excused) leave days taken this year — informational, no allowance.
  emergencyUsed?: number
}

/** The month's payroll tally, computed by the page (see `totals` there). */
export interface TimesheetTotals {
  totalHours: number
  otHours: number
  holidayHours: number
  daysHalf: number
  daysAnnual: number
  daysPending: number
  // Days before today with no record; in absent.none when unmarkedAsAbsent.
  daysUnmarked: number
  unmarkedAsAbsent: boolean
  absent: AbsentCounts
  workingDays: number
  daysAbsent: number
  paymentDays: number
}

type ErpExportType = "attendance" | "timesheet"

interface Props {
  employee: TimesheetEmployee | null
  canWrite: boolean
  totals: TimesheetTotals
  leaveBalance: LeaveBalance | null
  period: MonthYear
  onPeriodChange: (value: MonthYear) => void
  sortOrder: "asc" | "desc"
  onSortChange: (value: "asc" | "desc") => void
  erpBusy: boolean
  onExportSpreadsheet: () => void
  onExportErp: (type: ErpExportType, label: string) => void
  onLeaveGranted: () => void | Promise<void>
  onBack: () => void
}

// The block above the timesheet: who the employee is, the month/sort/actions toolbar,
// and the month's stats — one card, three bands.
export default function EmployeeTimesheetHeader({
  employee,
  canWrite,
  totals,
  leaveBalance,
  period,
  onPeriodChange,
  sortOrder,
  onSortChange,
  erpBusy,
  onExportSpreadsheet,
  onExportErp,
  onLeaveGranted,
  onBack,
}: Props) {
  return (
    <Card className="gap-0 py-0">
      {/* IDENTITY */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
          <ArrowLeft />
        </Button>

        <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
          {initialsOf(employee?.name)}
        </div>

        {employee ? (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-bold tracking-tight">
                {employee.name}
              </h1>
              {!employee.isActive && <Badge variant="secondary">Inactive</Badge>}
            </div>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <Badge variant="outline" className="font-mono font-normal">
                {employee.employeeId}
              </Badge>
              {employee.companyId && (
                <Badge
                  variant="outline"
                  className="font-mono font-normal"
                  title="Company ID"
                >
                  {employee.companyId}
                </Badge>
              )}
              <span>{employee.jobTitle}</span>
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="h-6 w-48 animate-pulse rounded bg-muted" />
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          </div>
        )}

        {/* Leave balance (admin only) — low priority, so small and to the side. */}
        {canWrite && leaveBalance && (
          <LeaveBalanceInline balance={leaveBalance} className="lg:ml-auto" />
        )}
      </div>

      {/* TOOLBAR */}
      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
        {/* MONTH + YEAR (same picker as the Monthly Report) */}
        <MonthYearPicker value={period} onChange={(v) => v && onPeriodChange(v)} />

        <Select
          value={sortOrder}
          onValueChange={(value: "asc" | "desc") => onSortChange(value)}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="asc">Oldest first</SelectItem>
            <SelectItem value="desc">Latest first</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canWrite && employee && (
            <GrantLeaveMenu
              employee={employee}
              balance={leaveBalance}
              onGranted={onLeaveGranted}
            />
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={erpBusy}>
                {erpBusy ? <Loader2 className="animate-spin" /> : <Download />}
                Export
                <ChevronDown className="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            {/* Explicit width — the content otherwise takes the trigger's width. */}
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onSelect={onExportSpreadsheet}>
                <FileSpreadsheet />
                Timesheet (.xlsx)
              </DropdownMenuItem>
              {/* ERPNext Data Import CSVs scoped to this employee (hours + status only). */}
              {canWrite && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>ERPNext import (CSV)</DropdownMenuLabel>
                  <DropdownMenuItem
                    disabled={erpBusy}
                    onSelect={() => onExportErp("attendance", "Attendance (payroll)")}
                  >
                    Attendance (payroll)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={erpBusy}
                    onSelect={() => onExportErp("timesheet", "Timesheet (job cost)")}
                  >
                    Timesheet (job cost)
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* STATS — cells divided by 1px lines (the gap shows the border color through).
          Two columns on mobile (dense flow fills the hole the wide Absent cell leaves),
          one row of nine tracks from lg up (Absent takes four). */}
      {employee && (
        <div className="grid grid-flow-row-dense grid-cols-2 gap-px border-t bg-border lg:grid-cols-9">
          {/* PAYMENT DAYS — the figure to check against the ERPNext salary slip. */}
          <StatCell
            label="Payment days"
            hint="Every calendar day − absent days − ½ per half day"
            value={
              <>
                {round2(totals.paymentDays)}
                <span className="text-xs font-normal text-muted-foreground">
                  {" "}
                  / {totals.workingDays}
                </span>
              </>
            }
            // Days with no record counted as paid (work schedule set to "Present").
            sub={
              !totals.unmarkedAsAbsent && totals.daysUnmarked > 0
                ? `incl. ${totals.daysUnmarked} unmarked (paid)`
                : undefined
            }
          />

          <AbsentCell totals={totals} />

          <StatCell
            label="Half days"
            hint="Each deducts 0.5 day"
            value={totals.daysHalf}
            muted={totals.daysHalf === 0}
          />

          {/* ANNUAL LEAVE — paid, so never part of the absent days. */}
          <StatCell
            label={ANNUAL_LEAVE.label}
            hint="Paid leave"
            value={totals.daysAnnual}
            muted={totals.daysAnnual === 0}
            valueClass={cn(totals.daysAnnual > 0 && ANNUAL_LEAVE.text)}
          />

          <StatCell
            label="Regular hrs"
            value={round2(totals.totalHours - totals.otHours - totals.holidayHours)}
          />

          <StatCell
            label="OT hrs"
            className="col-span-2 lg:col-span-1"
            value={round2(totals.otHours + totals.holidayHours)}
            sub={
              totals.holidayHours > 0
                ? `incl. ${round2(totals.holidayHours)} holiday`
                : undefined
            }
          />
        </div>
      )}
    </Card>
  )
}

const initialsOf = (name?: string) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase()

function StatCell({
  label,
  value,
  sub,
  hint,
  muted,
  valueClass,
  className,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  hint?: string
  muted?: boolean
  valueClass?: string
  className?: string
}) {
  return (
    <div className={cn("min-w-0 bg-card px-4 py-3", className)} title={hint}>
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-lg font-semibold leading-tight tabular-nums",
          muted && "text-muted-foreground/60",
          valueClass
        )}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{sub}</p>
      )}
    </div>
  )
}

// ABSENT — the unpaid-day total, then one bordered column per reason, colored like the
// Status badges.
function AbsentCell({ totals }: { totals: TimesheetTotals }) {
  return (
    <div className="col-span-2 flex min-w-0 bg-card lg:col-span-4">
      <div className="shrink-0 px-4 py-3">
        <p className="text-xs text-muted-foreground">Days absent</p>
        <p
          className={cn(
            "text-lg font-semibold leading-tight tabular-nums",
            totals.daysAbsent === 0 && "text-muted-foreground/60"
          )}
        >
          {totals.daysAbsent}
        </p>
        {/* An open check-in counts as absent (no reason) until it is closed. */}
        {totals.daysPending > 0 && (
          <p className="mt-0.5 text-[11px] font-medium leading-tight text-amber-700 dark:text-amber-400">
            incl. {totals.daysPending} pending
          </p>
        )}
        {/* Days with no record, when the work schedule counts them as absent. */}
        {totals.unmarkedAsAbsent && totals.daysUnmarked > 0 && (
          <p
            className="mt-0.5 text-[11px] font-medium leading-tight text-amber-700 dark:text-amber-400"
            title="Days before today with no attendance record (holidays excluded), counted as absent — Configure → ERPNext Export"
          >
            incl. {totals.daysUnmarked} unmarked
          </p>
        )}
      </div>

      <dl className="grid min-w-0 flex-1 grid-cols-4 divide-x border-l">
        {ABSENT_REASONS.map((reason) => {
          const days = totals.absent[reason.key]
          return (
            <div key={reason.key} className="min-w-0 px-2 py-3 sm:px-2.5" title={reason.label}>
              <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className={cn("size-1.5 shrink-0 rounded-full", reason.dot)} />
                <span className="truncate xl:hidden">{reason.short}</span>
                <span className="hidden truncate xl:inline">{reason.name}</span>
              </dt>
              <dd
                className={cn(
                  "text-base font-semibold leading-tight tabular-nums",
                  days > 0 ? reason.text : "text-muted-foreground/60"
                )}
              >
                {days}
              </dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}

function LeaveBalanceInline({
  balance,
  className,
}: {
  balance: LeaveBalance
  className?: string
}) {
  const usedPct =
    balance.entitlement > 0
      ? Math.min(100, (balance.used / balance.entitlement) * 100)
      : 0
  const emergencyUsed = balance.emergencyUsed ?? 0

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground",
        className
      )}
    >
      {/* Annual: paid, drawn from a yearly allowance */}
      <span
        className="flex items-center gap-1.5"
        title={`Annual leave ${balance.year}: ${balance.used} of ${balance.entitlement} used${
          balance.override !== null ? " (custom allowance)" : ""
        }`}
      >
        <span className="size-2 rounded-full bg-violet-500" />
        Annual {balance.year}
        <span className="h-1 w-14 overflow-hidden rounded-full bg-violet-500/15">
          <span
            className="block h-full rounded-full bg-violet-500"
            style={{ width: `${usedPct}%` }}
          />
        </span>
        <span>
          <b className="font-semibold text-foreground">{balance.remaining}</b>/
          {balance.entitlement} left
          {balance.override !== null && " (custom)"}
        </span>
      </span>

      {/* Emergency: excused but unpaid, no allowance — just a count */}
      <span
        className="flex items-center gap-1.5"
        title={`Emergency leave ${balance.year}: unpaid, no yearly limit`}
      >
        <span className="size-2 rounded-full bg-orange-500" />
        Emergency
        <span>
          <b
            className={cn(
              "font-semibold",
              emergencyUsed > 0
                ? "text-orange-700 dark:text-orange-400"
                : "text-foreground"
            )}
          >
            {emergencyUsed}
          </b>{" "}
          taken
        </span>
      </span>
    </div>
  )
}

// One "Grant leave ▾" button. Both dialogs stay mounted (controlled, trigger-less) so
// the closing one keeps its title during the close animation.
function GrantLeaveMenu({
  employee,
  balance,
  onGranted,
}: {
  employee: TimesheetEmployee
  balance: LeaveBalance | null
  onGranted: () => void | Promise<void>
}) {
  const [open, setOpen] = useState<LeaveType | null>(null)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <CalendarPlus />
            Grant leave
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => setOpen("annual")}>
            <CalendarPlus />
            Annual leave
            {balance && (
              <DropdownMenuShortcut className="tracking-normal">
                {balance.remaining} left
              </DropdownMenuShortcut>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpen("emergency")}>
            <Siren />
            Emergency leave
            <DropdownMenuShortcut className="tracking-normal">unpaid</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <GrantLeaveDialog
        employeeId={employee._id}
        employeeName={employee.name}
        onGranted={onGranted}
        open={open === "annual"}
        onOpenChange={(v) => setOpen(v ? "annual" : null)}
        hideTrigger
      />
      <GrantLeaveDialog
        employeeId={employee._id}
        employeeName={employee.name}
        leaveType="emergency"
        onGranted={onGranted}
        open={open === "emergency"}
        onOpenChange={(v) => setOpen(v ? "emergency" : null)}
        hideTrigger
      />
    </>
  )
}
