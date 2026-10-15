import { useState } from "react"
import { ArrowLeft, Check, ChevronDown, Globe, MapPin } from "lucide-react"

import { cachedDriverJobs, loadDriverJobs, type SiteJobs } from "@/lib/driverJobs"
import {
  GENERAL_PLACE_LABEL,
  placeGroup,
  placeJobsText,
  type DriverPlace,
  type SplitJob,
} from "@/lib/jobSplit"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/**
 * Site + job split picker for driver sessions (Drivers sheet, EditSiteRecord, Edit past,
 * Backfill, Bulk backfill). A driver serves a SITE: pick it from the list ("General" = the
 * global jobs, first; sites with no live job are shown muted and can't be picked), then its
 * jobs appear as checkboxes — all ticked on a fresh pick — and the session's hours are split
 * EQUALLY across the ticked ones. At least one job stays ticked.
 *
 * `knownJobs` names stored jobs that are no longer live (a past day's split), so they still
 * read properly and can be unticked. `invalid` paints the trigger red, like JobPicker.
 */
export default function SiteSplitPicker({
  value,
  onChange,
  knownJobs,
  invalid = false,
  disabled = false,
  showLastUsed = false,
  className,
}: {
  value: DriverPlace | null
  onChange: (place: DriverPlace) => void
  knownJobs?: SplitJob[]
  invalid?: boolean
  disabled?: boolean
  showLastUsed?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<"sites" | "jobs">("sites")
  const [places, setPlaces] = useState<SiteJobs[]>(cachedDriverJobs() ?? [])
  const [loading, setLoading] = useState(false)

  const openChange = (o: boolean) => {
    if (disabled) return
    setOpen(o)
    if (!o) return
    // Reopening an existing pick goes straight to its jobs; "All sites" switches site.
    setView(value ? "jobs" : "sites")
    setLoading(!cachedDriverJobs())
    loadDriverJobs()
      .then(setPlaces)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  const group = value ? placeGroup(places, value.siteId) : null
  const liveJobs = group?.jobs ?? []
  // Ticked jobs that aren't live any more (completed since) stay listed so they can be unticked.
  const staleJobs: SplitJob[] = value
    ? value.jobIds
        .filter((id) => !liveJobs.some((j) => j._id === id))
        .map((id) => knownJobs?.find((j) => j._id === id) ?? { _id: id, name: "Job (no longer active)" })
    : []
  const jobRows: SplitJob[] = [...liveJobs, ...staleJobs]

  const pickPlace = (p: SiteJobs) => {
    if (!p.jobs.length) return
    const siteId = p.isGlobal ? null : p._id
    if (!value || value.siteId !== siteId) {
      // A fresh site: every live job ticked.
      onChange({ siteId, siteName: p.isGlobal ? GENERAL_PLACE_LABEL : p.siteName, jobIds: p.jobs.map((j) => j._id) })
    }
    setView("jobs")
  }

  const toggleJob = (jobId: string) => {
    if (!value) return
    const ticked = value.jobIds.includes(jobId)
    if (ticked && value.jobIds.length === 1) return
    // Keep the listing's order so the stored order is stable.
    const next = ticked
      ? value.jobIds.filter((id) => id !== jobId)
      : jobRows.map((j) => j._id).filter((id) => id === jobId || value.jobIds.includes(id))
    onChange({ ...value, jobIds: next })
  }

  const isGeneral = value?.siteId === null

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className={cn(
            "flex h-11 w-full min-w-0 items-center gap-2 rounded-md border bg-background px-2.5 text-left shadow-xs transition-colors",
            "hover:border-muted-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-60",
            invalid && "border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-950/30",
            className
          )}
        >
          {isGeneral ? (
            <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <MapPin className={cn("h-4 w-4 shrink-0", invalid ? "text-red-600" : "text-muted-foreground")} />
          )}
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span
              className={cn(
                "truncate text-sm font-medium",
                !value && (invalid ? "text-red-700 dark:text-red-300" : "text-muted-foreground")
              )}
            >
              {value ? value.siteName : "Choose site"}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {value ? placeJobsText(value, group ? liveJobs.length : null) : "Hours split across its jobs"}
            </span>
          </span>
          {value && showLastUsed && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              last used
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(84vw,320px)] p-0 sm:w-[min(92vw,380px)]" align="center" collisionPadding={12}>
        {view === "jobs" && value ? (
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5 border-b px-1.5 py-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => setView("sites")}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                All sites
              </Button>
              <span className="min-w-0 flex-1 truncate text-right text-xs font-semibold sm:text-sm">{value.siteName}</span>
            </div>
            <div className="max-h-[min(50vh,280px)] overflow-y-auto p-1 sm:max-h-[320px]">
              {loading && !jobRows.length ? (
                <p className="py-4 text-center text-xs text-muted-foreground">Loading jobs…</p>
              ) : (
                jobRows.map((j) => {
                  const ticked = value.jobIds.includes(j._id)
                  const stale = !liveJobs.some((l) => l._id === j._id)
                  const lastTicked = ticked && value.jobIds.length === 1
                  return (
                    <label
                      key={j._id}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-muted sm:text-sm",
                        lastTicked && "cursor-default"
                      )}
                    >
                      <Checkbox checked={ticked} disabled={lastTicked} onCheckedChange={() => toggleJob(j._id)} />
                      <span className="min-w-11 max-w-[40%] shrink-0 truncate text-[11px] font-semibold tabular-nums text-muted-foreground sm:min-w-14 sm:text-xs">
                        {j.jobCode || "—"}
                      </span>
                      <span className={cn("min-w-0 flex-1 truncate", stale && "text-muted-foreground")}>{j.name}</span>
                    </label>
                  )
                })
              )}
            </div>
            <div className="flex items-center justify-between gap-2 border-t px-2.5 py-2">
              <span className="text-[11px] text-muted-foreground sm:text-xs">
                {value.jobIds.length === 1
                  ? "All hours go to this job"
                  : `Hours split equally between ${value.jobIds.length} jobs`}
              </span>
              <Button type="button" size="sm" className="h-7 px-3 text-xs" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <Command>
            <CommandInput placeholder="Search site…" className="text-xs sm:text-sm" />
            <CommandList className="max-h-[min(50vh,280px)] sm:max-h-[320px]">
              <CommandEmpty className="py-4 text-xs sm:py-6 sm:text-sm">
                {loading ? "Loading sites…" : "No site matches that search."}
              </CommandEmpty>
              <CommandGroup className={groupClass}>
                {places.map((p) => {
                  const siteId = p.isGlobal ? null : p._id
                  const selected = !!value && value.siteId === siteId
                  const empty = p.jobs.length === 0
                  return (
                    <CommandItem
                      key={p._id}
                      value={`${p._id} ${p.isGlobal ? `${GENERAL_PLACE_LABEL} global` : p.siteName}`}
                      disabled={empty}
                      onSelect={() => pickPlace(p)}
                      className={cn(itemClass, empty && "opacity-60")}
                    >
                      <div className="flex w-full min-w-0 items-center gap-1.5 sm:gap-2">
                        {p.isGlobal ? (
                          <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        <span className={cn("min-w-0 flex-1 truncate", empty && "text-muted-foreground")}>
                          {p.isGlobal ? `${GENERAL_PLACE_LABEL} (global jobs)` : p.siteName}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground sm:text-[11px]">
                          {empty ? "No jobs" : `${p.jobs.length} job${p.jobs.length === 1 ? "" : "s"}`}
                        </span>
                        <Check className={cn("h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4", selected ? "opacity-100" : "opacity-0")} />
                      </div>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  )
}

// Same compact sizing as JobPicker.
const groupClass = "p-0.5 sm:p-1"
const itemClass = "px-1.5 py-1 text-xs sm:px-2 sm:py-1.5 sm:text-sm"
