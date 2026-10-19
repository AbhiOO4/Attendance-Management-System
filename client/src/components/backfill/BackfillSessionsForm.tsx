// BackfillSessionsForm.tsx
//
// The sessions of one backfilled day: one or more { job, check-in, check-out } blocks (a
// day session on one job plus a night session on another, say), a break override and a live
// preview of the day's totals as the server will compute them (lib/backfillRequests.ts
// previewDay). Used by the supervisor bulk apply and by single-row edits (supervisor or admin).
//
// The job picker offers the site's live jobs + the global jobs. A site with live jobs needs a
// job on every session (the server refuses it otherwise — JOB_REQUIRED); a site with none keeps
// it optional ("No job").

import { useMemo } from "react"
import { Moon, Plus, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import JobPicker from "@/components/drivers/JobPicker"
import SessionTimeFields from "@/components/backfill/SessionTimeFields"
import { useWorkConfig } from "@/context/WorkConfigContext"
import { MAX_BREAKS_PER_DAY } from "@/lib/attendanceUtils"
import type { HolidayReason } from "@/lib/attendanceUtils"
import { globalJobsGroup, useGlobalJobs } from "@/lib/globalJobs"
import { jobFromGroup, type DriverJob, type SiteJobs } from "@/lib/driverJobs"
import { emptySession, previewDay, type BackfillSession, type SiteJob } from "@/lib/backfillRequests"

const MAX_SESSIONS = 6

export default function BackfillSessionsForm({
  date,
  siteId,
  siteName,
  siteJobs,
  sessions,
  onSessionsChange,
  breaksTaken,
  onBreaksChange,
  holidayReason = null,
  disabled = false,
}: {
  date: string
  siteId: string
  siteName: string
  siteJobs: SiteJob[]
  sessions: BackfillSession[]
  onSessionsChange: (next: BackfillSession[]) => void
  breaksTaken: number | null
  onBreaksChange: (next: number | null) => void
  holidayReason?: HolidayReason
  disabled?: boolean
}) {
  const { config: workConfig } = useWorkConfig()
  const globalJobs = useGlobalJobs(true)
  const jobRequired = siteJobs.length > 0

  const groups: SiteJobs[] = useMemo(
    () => [
      { _id: siteId, siteName, jobs: siteJobs.map((j) => ({ _id: j._id, name: j.name, jobCode: j.jobCode ?? null })) },
      globalJobsGroup(globalJobs),
    ],
    [siteId, siteName, siteJobs, globalJobs]
  )

  // jobId → picker value; a stored job that's no longer offered keeps its saved label.
  const jobFor = (s: BackfillSession): DriverJob | null => {
    if (!s.jobId) return null
    for (const g of groups) {
      const j = g.jobs.find((x) => x._id === s.jobId)
      if (j) return jobFromGroup(g, j)
    }
    return { _id: s.jobId, name: s.jobName || "Job", jobCode: s.jobCode || null, isGlobal: s.isGlobalJob }
  }

  const update = (index: number, patch: Partial<BackfillSession>) =>
    onSessionsChange(sessions.map((s, i) => (i === index ? { ...s, ...patch } : s)))

  const preview = previewDay(sessions, breaksTaken, workConfig, holidayReason)
  const autoBreaks = previewDay(sessions, null, workConfig, holidayReason).breaks
  const breakDurationMinutes = workConfig?.breakDurationMinutes ?? 60

  return (
    <div className="space-y-4">
      {sessions.map((s, i) => (
        <div key={i} className="space-y-3 rounded-xl border p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">
              Session {i + 1}
              {(s.checkInNextDay || s.checkOutNextDay) && (
                <Badge variant="secondary" className="ml-2 gap-1 text-[11px] font-normal">
                  <Moon className="h-3 w-3" /> Night
                </Badge>
              )}
            </span>
            {sessions.length > 1 && !disabled && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-muted-foreground hover:text-destructive"
                onClick={() => onSessionsChange(sessions.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </Button>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Job {jobRequired && <span className="text-red-500">*</span>}
            </label>
            <JobPicker
              value={jobFor(s)}
              onChange={(job) =>
                update(i, { jobId: job._id, jobName: job.name, jobCode: job.jobCode || "", isGlobalJob: !!job.isGlobal })
              }
              onClear={jobRequired ? undefined : () => update(i, { jobId: null, jobName: "", jobCode: "", isGlobalJob: false })}
              sites={groups}
              invalid={jobRequired && !s.jobId && !!(s.checkIn || s.checkOut)}
              disabled={disabled}
              className="h-10"
            />
          </div>

          <SessionTimeFields
            date={date}
            value={s}
            onChange={(t) => update(i, t)}
            disabled={disabled}
          />
        </div>
      ))}

      {!disabled && sessions.length < MAX_SESSIONS && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full gap-1.5 border-dashed"
          onClick={() => onSessionsChange([...sessions, emptySession()])}
        >
          <Plus className="h-3.5 w-3.5" />
          Add another session
        </Button>
      )}

      {/* Breaks + summary */}
      <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
        {breakDurationMinutes > 0 && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">☕ Break ({breakDurationMinutes} min)</span>
            <div className="flex items-center gap-1.5">
              {[0, MAX_BREAKS_PER_DAY].map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={disabled}
                  onClick={() => onBreaksChange(n)}
                  className={`h-7 rounded-md border px-2.5 text-xs font-medium transition-colors ${
                    breaksTaken === n ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                >
                  {n === 0 ? "None" : "Taken"}
                </button>
              ))}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onBreaksChange(null)}
                className={`h-7 rounded-md border px-2.5 text-xs font-medium transition-colors ${
                  breaksTaken === null ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
                }`}
                title="Deduct the break automatically once the day is long enough"
              >
                Auto ({autoBreaks ? "taken" : "none"})
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Worked (raw)</span>
          <span className="font-semibold">{preview.rawHours} hrs</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total Work Hours</span>
          <span className="text-lg font-bold">{preview.netHours} hrs</span>
        </div>
        {preview.overtimeHours > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Overtime</span>
            <span className="font-bold">{preview.overtimeHours} hrs</span>
          </div>
        )}
        {preview.holidayHours > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Holiday hours</span>
            <span className="font-bold">{preview.holidayHours} hrs</span>
          </div>
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Status</span>
          <StatusBadge status={preview.status} />
        </div>
      </div>
    </div>
  )
}

export function StatusBadge({ status }: { status: "fullday" | "halfday" | "absent" }) {
  return (
    <Badge
      variant={status === "absent" ? "destructive" : "secondary"}
      className={
        status === "fullday"
          ? "border-transparent bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-400"
          : ""
      }
    >
      {status === "fullday" ? "Full day" : status === "halfday" ? "Half day" : "Absent"}
    </Badge>
  )
}
