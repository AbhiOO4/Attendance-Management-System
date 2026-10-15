// BulkBackfillModal.tsx
//
// Backfill ONE common session (site + optional job + shared check-in/out) for MANY
// selected employees at once. Opened from the Missing Employees page after the user
// picks employees in bulk-selection mode. The time entry mirrors the session-management
// modal (EditSiteRecord): plain time inputs plus per-endpoint "next day" toggle pills, so
// a genuine 24h shift (08:00→08:00 with check-out next day) is expressible.
//
// Posts to POST /api/attendance/backfill/bulk, which creates one record per employee and
// returns a per-employee result (created / skipped / failed) shown here on completion.

import { useEffect, useMemo, useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Moon,
  Save,
  Truck,
  Users,
} from "lucide-react"

import { api } from "@/lib/api"
import toast from "react-hot-toast"
import {
  deriveOffsets,
  hoursFromOffset,
  validateSessionTimesV2,
  formatOffsetDayLabel,
} from "@/lib/dateUtils"
import { computeAutoBreaks, MAX_BREAKS_PER_DAY, resolveBreakMinHours } from "@/lib/attendanceUtils"
import { useWorkConfig } from "@/context/WorkConfigContext"
import type { MissingEmployee } from "@/components/BackfillModal"
import SiteSplitPicker from "@/components/drivers/SiteSplitPicker"
import type { PickerSite } from "@/components/SessionSiteJobFields"
import { isDriverTitle } from "@/lib/driverJobs"
import type { DriverPlace } from "@/lib/jobSplit"

type Site = PickerSite

interface BulkResultEntry {
  employeeId: string
  name: string | null
  reason?: string
  message?: string
}

export interface BulkBackfillResult {
  success: boolean
  message: string
  summary: { createdCount: number; skippedCount: number; failedCount: number }
  created: BulkResultEntry[]
  skipped: BulkResultEntry[]
  failed: BulkResultEntry[]
}

interface BulkBackfillModalProps {
  open: boolean
  onClose: () => void
  date: string // YYYY-MM-DD
  employees: MissingEmployee[] // the selected subset
  sites: Site[]
  onCompleted: (result: BulkBackfillResult) => void
}

const NOT_ASSIGNED = "not-assigned"

function BulkBackfillModal({
  open,
  onClose,
  date,
  employees,
  sites,
  onCompleted,
}: BulkBackfillModalProps) {
  const { config: workConfig } = useWorkConfig()
  const config = useMemo(
    () => ({
      fullDayHours: workConfig?.fullDayHours ?? 8,
      halfDayHours: workConfig?.halfDayHours ?? 4,
      overtimeThreshold: workConfig?.overtimeThreshold ?? 8,
      breakDurationMinutes: workConfig?.breakDurationMinutes ?? 60,
      breakMinHours: resolveBreakMinHours(workConfig),
    }),
    [workConfig]
  )

  const [siteId, setSiteId] = useState("")
  const [jobId, setJobId] = useState<string | null>(null)
  const [checkIn, setCheckIn] = useState("")
  const [checkOut, setCheckOut] = useState("")
  const [checkInNextDay, setCheckInNextDay] = useState(false)
  const [checkOutNextDay, setCheckOutNextDay] = useState(false)
  const [breaksTaken, setBreaksTaken] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<BulkBackfillResult | null>(null)
  // On "Drivers": the site the drivers served + the ticked jobs their hours are split across.
  const [driverPlace, setDriverPlace] = useState<DriverPlace | null>(null)

  // "Drivers" (the hidden pool) is offered — and preselected — only when every selected
  // employee is a driver; the server skips non-drivers anyway. Drivers live only on Drivers
  // Attendance, so an all-driver selection gets no regular sites, and on a site any selected
  // drivers are skipped by the server (noted below).
  const driverPool = sites.find((s) => s.isDriverPool)
  const allDrivers = employees.length > 0 && employees.every((e) => isDriverTitle(e.jobTitle))
  const driverCount = employees.filter((e) => isDriverTitle(e.jobTitle)).length
  const regularSites = allDrivers ? [] : sites.filter((s) => !s.isDriverPool)
  const onPool = !!driverPool && siteId === driverPool._id

  // Reset the form each time the modal opens.
  useEffect(() => {
    if (open) {
      setSiteId(allDrivers && driverPool ? driverPool._id : "")
      setJobId(null)
      setDriverPlace(null)
      setCheckIn("")
      setCheckOut("")
      setCheckInNextDay(false)
      setCheckOutNextDay(false)
      setBreaksTaken(null)
      setResult(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open only
  }, [open])

  const selectedSite = regularSites.find((s) => s._id === siteId)

  // --------------------------------------------------
  // TIME HANDLERS (mirror EditSiteRecord's offset logic)
  // --------------------------------------------------
  const handleCheckInChange = (value: string) => {
    // Preserve the check-in's own next-day intent, re-derive the check-out offset.
    const { checkInNextDay: ci, checkOutNextDay: co } = deriveOffsets(value, checkOut, checkInNextDay)
    setCheckIn(value)
    setCheckInNextDay(ci)
    setCheckOutNextDay(co)
  }

  const handleCheckOutChange = (value: string) => {
    const { checkOutNextDay: co } = deriveOffsets(checkIn, value, checkInNextDay)
    setCheckOut(value)
    setCheckOutNextDay(co)
  }

  // Toggle whether the shift STARTS on the next day (an after-midnight session recorded
  // on this day). Re-derives the check-out offset from the new check-in.
  const toggleCheckInNextDay = () => {
    const next = !checkInNextDay
    const { checkInNextDay: ci, checkOutNextDay: co } = deriveOffsets(checkIn, checkOut, next)
    setCheckInNextDay(ci)
    setCheckOutNextDay(co)
  }

  // Toggle whether the check-out is on the next day. Independent flip — this is how a true
  // 24h shift (08:00→08:00) or any late-crossing check-out is expressed.
  const toggleCheckOutNextDay = () => {
    setCheckOutNextDay((prev) => !prev)
  }

  // --------------------------------------------------
  // DERIVED PREVIEW
  // --------------------------------------------------
  const rawHours = useMemo(
    () => hoursFromOffset(checkIn, checkOut, checkInNextDay, checkOutNextDay),
    [checkIn, checkOut, checkInNextDay, checkOutNextDay]
  )

  const timeError = useMemo(
    () => validateSessionTimesV2(checkIn, checkOut, checkInNextDay, checkOutNextDay),
    [checkIn, checkOut, checkInNextDay, checkOutNextDay]
  )

  const autoBreaks = useMemo(
    () => computeAutoBreaks(rawHours, config.breakMinHours),
    [rawHours, config.breakMinHours]
  )
  const breaksApplied = breaksTaken !== null ? breaksTaken : autoBreaks

  const totalWorkHours = useMemo(() => {
    const breakHrs = breaksApplied * (config.breakDurationMinutes / 60)
    return Number(Math.max(rawHours - breakHrs, 0).toFixed(2))
  }, [rawHours, breaksApplied, config.breakDurationMinutes])

  const overtimeHours = useMemo(() => {
    if (totalWorkHours <= config.overtimeThreshold) return 0
    return Number((totalWorkHours - config.overtimeThreshold).toFixed(2))
  }, [totalWorkHours, config.overtimeThreshold])

  const status = useMemo(() => {
    if (rawHours >= config.fullDayHours) return "fullday"
    if (rawHours >= config.halfDayHours) return "halfday"
    return "absent"
  }, [rawHours, config.fullDayHours, config.halfDayHours])

  const isNight = checkInNextDay || checkOutNextDay

  const canSubmit = !!siteId && !!checkIn && !!checkOut && !timeError && employees.length > 0 && (!onPool || !!driverPlace?.jobIds.length)

  // --------------------------------------------------
  // SUBMIT
  // --------------------------------------------------
  const submit = async () => {
    if (!canSubmit) {
      if (!siteId) toast.error("Please select a site")
      else if (!checkIn || !checkOut) toast.error("Enter both check-in and check-out")
      else if (timeError) toast.error(timeError)
      else if (onPool && !driverPlace?.jobIds.length) toast.error("Pick the site the drivers worked for")
      return
    }

    setSaving(true)
    try {
      const payload = {
        date,
        employeeIds: employees.map((e) => e._id),
        siteId,
        jobId: onPool ? null : jobId || null,
        ...(onPool ? { splitJobIds: driverPlace?.jobIds ?? [] } : {}),
        checkIn,
        checkOut,
        checkInNextDay,
        checkOutNextDay,
        breaksTaken,
      }
      const res = await api.post<BulkBackfillResult>("/api/attendance/backfill/bulk", payload)
      const data = res.data

      onCompleted(data)

      const { createdCount, skippedCount, failedCount } = data.summary
      if (createdCount > 0) {
        toast.success(
          `Backfilled ${createdCount} employee${createdCount === 1 ? "" : "s"}` +
            (skippedCount || failedCount ? ` · ${skippedCount} skipped, ${failedCount} failed` : "")
        )
      } else {
        toast.error("No records were created — see details.")
      }

      // If everything succeeded cleanly, close; otherwise show the result breakdown.
      if (skippedCount === 0 && failedCount === 0) {
        onClose()
      } else {
        setResult(data)
      }
    } catch (error: any) {
      console.log(error)
      toast.error(error?.response?.data?.message || "Failed to bulk backfill")
    } finally {
      setSaving(false)
    }
  }

  // --------------------------------------------------
  // RENDER
  // --------------------------------------------------
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="!w-[95vw] !max-w-[540px] max-h-[90vh] overflow-hidden p-0 flex flex-col rounded-2xl">
        {/* HEADER */}
        <div className="border-b px-5 py-4 sm:px-6">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <DialogTitle className="text-lg font-semibold">Bulk Backfill</DialogTitle>
            </div>
          </DialogHeader>
          <p className="mt-2 text-sm text-muted-foreground">
            Applying one common session to{" "}
            <span className="font-medium text-foreground">
              {employees.length} employee{employees.length === 1 ? "" : "s"}
            </span>
            .
          </p>
          {driverCount > 0 && !allDrivers && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              {driverCount} driver{driverCount === 1 ? "" : "s"} will be skipped — drivers are
              backfilled on Drivers only.
            </p>
          )}
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6 space-y-5">
          {result ? (
            // ---------------- RESULT VIEW ----------------
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border bg-emerald-500/10 p-3">
                  <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                    {result.summary.createdCount}
                  </div>
                  <div className="text-xs text-muted-foreground">Created</div>
                </div>
                <div className="rounded-lg border bg-amber-500/10 p-3">
                  <div className="text-xl font-bold text-amber-600 dark:text-amber-400">
                    {result.summary.skippedCount}
                  </div>
                  <div className="text-xs text-muted-foreground">Skipped</div>
                </div>
                <div className="rounded-lg border bg-red-500/10 p-3">
                  <div className="text-xl font-bold text-red-600 dark:text-red-400">
                    {result.summary.failedCount}
                  </div>
                  <div className="text-xs text-muted-foreground">Failed</div>
                </div>
              </div>

              {result.skipped.length > 0 && (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4" /> Skipped
                  </p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {result.skipped.map((s) => (
                      <li key={s.employeeId}>
                        <span className="font-medium text-foreground">{s.name || s.employeeId}</span>
                        {" — "}
                        {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.failed.length > 0 && (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-red-700 dark:text-red-400">
                    <AlertTriangle className="h-4 w-4" /> Failed
                  </p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {result.failed.map((f) => (
                      <li key={f.employeeId}>
                        <span className="font-medium text-foreground">{f.name || f.employeeId}</span>
                        {" — "}
                        {f.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            // ---------------- FORM VIEW ----------------
            <>
              {/* Site + Job */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Site <span className="text-red-500">*</span>
                  </label>
                  <Select
                    value={siteId}
                    onValueChange={(value) => {
                      setSiteId(value)
                      setJobId(null)
                      setDriverPlace(null)
                    }}
                  >
                    <SelectTrigger className="w-full h-10 text-sm">
                      <SelectValue placeholder="Select site" />
                    </SelectTrigger>
                    <SelectContent>
                      {regularSites.map((site) => (
                        <SelectItem key={site._id} value={site._id}>
                          {site.siteName}
                        </SelectItem>
                      ))}
                      {driverPool && allDrivers && (
                        <>
                          <SelectSeparator />
                          <SelectGroup>
                            <SelectLabel>No site</SelectLabel>
                            <SelectItem value={driverPool._id}>
                              <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                              Drivers
                            </SelectItem>
                          </SelectGroup>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {onPool ? <>Worked for (hours split across its jobs) <span className="text-red-500">*</span></> : "Job"}
                  </label>
                  {onPool ? (
                    <SiteSplitPicker
                      value={driverPlace}
                      onChange={setDriverPlace}
                      invalid={!driverPlace?.jobIds.length && !!(checkIn || checkOut)}
                      className="h-10"
                    />
                  ) : (
                  <Select
                    value={jobId || NOT_ASSIGNED}
                    onValueChange={(value) => setJobId(value === NOT_ASSIGNED ? null : value)}
                    disabled={!selectedSite}
                  >
                    <SelectTrigger className="w-full h-10 text-sm">
                      <SelectValue placeholder="Select job" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NOT_ASSIGNED}>Not Assigned</SelectItem>
                      {selectedSite?.jobs.map((job) => (
                        <SelectItem key={job._id} value={job._id}>
                          {job.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  )}
                </div>
              </div>

              {/* Time inputs + next-day toggles */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Check In</label>
                  <Input
                    className="h-10 text-sm"
                    type="time"
                    value={checkIn}
                    onChange={(e) => handleCheckInChange(e.target.value)}
                  />
                  {checkIn && (
                    <button
                      type="button"
                      onClick={toggleCheckInNextDay}
                      className={`mt-1 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                        checkInNextDay
                          ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800/50 dark:bg-indigo-950/40 dark:text-indigo-300"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                      title="Toggle whether this shift STARTS on the next day (an after-midnight session recorded on this day)"
                    >
                      {checkInNextDay
                        ? `🌙 Starts next day · ${formatOffsetDayLabel(date, 1)}`
                        : `Starts same day · ${formatOffsetDayLabel(date, 0)}`}
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Check Out</label>
                  <Input
                    className="h-10 text-sm"
                    type="time"
                    value={checkOut}
                    onChange={(e) => handleCheckOutChange(e.target.value)}
                  />
                  {checkIn && checkOut && (
                    <button
                      type="button"
                      onClick={toggleCheckOutNextDay}
                      className={`mt-1 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                        checkOutNextDay
                          ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800/50 dark:bg-indigo-950/40 dark:text-indigo-300"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                      title="Toggle whether the check-out is on the next day (for 24h or after-midnight shifts)"
                    >
                      {checkOutNextDay
                        ? `🌙 Check-out next day · ${formatOffsetDayLabel(date, 1)}`
                        : `Check-out same day · ${formatOffsetDayLabel(date, 0)}`}
                    </button>
                  )}
                </div>
              </div>

              {timeError && (
                <p className="text-xs text-red-500 font-medium">{timeError}</p>
              )}

              {/* Breaks + summary */}
              <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
                {config.breakDurationMinutes > 0 && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">☕ Breaks</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        className="h-7 w-7 rounded-md border text-sm font-bold hover:bg-muted transition-colors disabled:opacity-40"
                        disabled={breaksTaken !== null && breaksTaken <= 0}
                        onClick={() => setBreaksTaken((prev) => Math.max(0, (prev ?? autoBreaks) - 1))}
                      >
                        −
                      </button>
                      <span className="min-w-[50px] text-center text-sm font-medium">
                        {breaksTaken !== null ? breaksTaken : autoBreaks}
                      </span>
                      <button
                        type="button"
                        className="h-7 w-7 rounded-md border text-sm font-bold hover:bg-muted transition-colors disabled:opacity-40"
                        disabled={(breaksTaken ?? autoBreaks) >= MAX_BREAKS_PER_DAY}
                        onClick={() => setBreaksTaken((prev) => Math.min(MAX_BREAKS_PER_DAY, (prev ?? autoBreaks) + 1))}
                      >
                        +
                      </button>
                      {breaksTaken !== null && (
                        <button
                          type="button"
                          className="ml-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() => setBreaksTaken(null)}
                          title="Reset to auto"
                        >
                          reset
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Worked (raw)</span>
                  <span className="font-semibold">{rawHours} hrs</span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Total Work Hours</span>
                  <span className="text-lg font-bold">{totalWorkHours} hrs</span>
                </div>

                {overtimeHours > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Overtime</span>
                    <span className="text-lg font-bold">{overtimeHours} hrs</span>
                  </div>
                )}

                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Status</span>
                  <div className="flex items-center gap-2">
                    {isNight && (
                      <Badge variant="secondary" className="text-xs gap-1 font-normal">
                        <Moon className="h-3 w-3" /> Night
                      </Badge>
                    )}
                    <Badge
                      variant={status === "absent" ? "destructive" : "secondary"}
                      className={`text-sm ${
                        status === "fullday"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25 border-transparent"
                          : ""
                      }`}
                    >
                      {status}
                    </Badge>
                  </div>
                </div>

                <p className="text-[11px] leading-relaxed text-muted-foreground pt-1 border-t">
                  Holiday hours (if this day is a holiday) are applied automatically per
                  employee — permanent workers get holiday credit, temporary workers are treated
                  as a normal working day.
                </p>
              </div>
            </>
          )}
        </div>

        {/* FOOTER */}
        <div className="border-t px-5 py-3 sm:px-6 flex justify-end gap-2">
          {result ? (
            <Button size="sm" onClick={onClose}>
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              Done
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={submit} disabled={saving || !canSubmit}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    Backfill {employees.length}
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default BulkBackfillModal
