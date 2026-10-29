import { type ReactNode } from "react"
import {
  ArrowLeft,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Loader2,
} from "lucide-react"

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
import { fmtLeaveRange, type LeaveBalance } from "@/lib/leave"
import { cn } from "@/lib/utils"
import HelpButton from "@/components/help/HelpButton"

export interface TimesheetEmployee {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
  companyId?: string | null
  isActive: boolean
}

export type { LeaveBalance }

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
  // The month's records are still loading — nothing to export yet.
  exportLoading: boolean
  // Why the ERPNext files are off (the month's timesheet isn't approved), or null when
  // allowed. The spreadsheet is never gated.
  erpBlockedReason: string | null
  // The approval band, shown under the toolbar.
  approvalSlot?: ReactNode
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
  exportLoading,
  erpBlockedReason,
  approvalSlot,
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
              <HelpButton topic="employee-timesheet" />
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

        {/* The spreadsheet exports any time; only the ERPNext files need an APPROVED month. */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={erpBusy || exportLoading}>
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
                  {/* A disabled item shows no tooltip, so the reason is a line of its own. */}
                  {erpBlockedReason && (
                    <p className="px-2 pb-1.5 text-xs text-muted-foreground">
                      {erpBlockedReason}
                    </p>
                  )}
                  <DropdownMenuItem
                    disabled={erpBusy || !!erpBlockedReason}
                    onSelect={() => onExportErp("attendance", "Attendance (payroll)")}
                  >
                    Attendance (payroll)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={erpBusy || !!erpBlockedReason}
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

      {approvalSlot}

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
  const current = balance.current
  const usedPct =
    current && current.days > 0 ? Math.min(100, (current.used / current.days) * 100) : 0
  const emergencyUsed = balance.emergencyUsed ?? 0

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground",
        className
      )}
    >
      {/* Annual: paid, drawn from the allocation covering today */}
      {current ? (
        <span
          className="flex items-center gap-1.5"
          title={`Annual leave ${fmtLeaveRange(current.fromDate, current.toDate)}: ${current.used} of ${current.days} used`}
        >
          <span className="size-2 rounded-full bg-violet-500" />
          Annual
          <span className="h-1 w-14 overflow-hidden rounded-full bg-violet-500/15">
            <span
              className="block h-full rounded-full bg-violet-500"
              style={{ width: `${usedPct}%` }}
            />
          </span>
          <span>
            <b className="font-semibold text-foreground">{current.remaining}</b>/{current.days} left
          </span>
        </span>
      ) : (
        <span className="flex items-center gap-1.5" title="No annual leave allocation covers today">
          <span className="size-2 rounded-full bg-violet-500/40" />
          No annual allocation
        </span>
      )}

      {/* Emergency: excused but unpaid, no allowance — just a count */}
      <span
        className="flex items-center gap-1.5"
        title={`Emergency leave ${balance.year}: unpaid, no limit`}
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
