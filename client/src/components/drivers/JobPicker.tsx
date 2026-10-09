import { useState } from "react"
import { Briefcase, Check, ChevronDown, MapPin } from "lucide-react"

import { cachedDriverJobs, jobLabel, loadDriverJobs, type DriverJob, type SiteJobs } from "@/lib/driverJobs"
import { cn } from "@/lib/utils"
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
 * Searchable job combobox for the Drivers Attendance sheet: every active job at every live
 * site, grouped by site, with the driver's last-used job shown first. `invalid` paints the
 * trigger red (a session with times but no job can't be saved).
 */
export default function JobPicker({
  value,
  onChange,
  recent,
  invalid = false,
  disabled = false,
  showLastUsed = false,
  className,
}: {
  value: DriverJob | null
  onChange: (job: DriverJob) => void
  recent?: DriverJob | null
  invalid?: boolean
  disabled?: boolean
  showLastUsed?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [sites, setSites] = useState<SiteJobs[]>(cachedDriverJobs() ?? [])
  const [loading, setLoading] = useState(false)

  // Load (or refresh from the shared cache) whenever the list is opened.
  const openChange = (o: boolean) => {
    if (disabled) return
    setOpen(o)
    if (!o) return
    setLoading(!cachedDriverJobs())
    loadDriverJobs()
      .then(setSites)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  const pick = (job: DriverJob) => {
    onChange(job)
    setOpen(false)
  }

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
          <Briefcase className={cn("h-4 w-4 shrink-0", invalid ? "text-red-600" : "text-muted-foreground")} />
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className={cn("truncate text-sm font-medium", !value && (invalid ? "text-red-700 dark:text-red-300" : "text-muted-foreground"))}>
              {value ? jobLabel(value) : "Choose job"}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {value?.site?.siteName || "Any site"}
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
      {/* Compact + centred under the trigger on phones (triggers are full-width there, so
          this centres it on screen); desktop keeps the roomier sizing. */}
      <PopoverContent
        className="w-[min(84vw,320px)] p-0 sm:w-[min(92vw,380px)]"
        align="center"
        collisionPadding={12}
      >
        <Command>
          <CommandInput placeholder="Search job code, job or site…" className="text-xs sm:text-sm" />
          <CommandList className="max-h-[min(50vh,280px)] sm:max-h-[320px]">
            <CommandEmpty className="py-4 text-xs sm:py-6 sm:text-sm">
              {loading ? "Loading jobs…" : "No job matches that search."}
            </CommandEmpty>
            {recent && (
              <CommandGroup heading="Last used" className={groupClass}>
                <CommandItem
                  value={`recent ${jobLabel(recent)} ${recent.site?.siteName ?? ""}`}
                  onSelect={() => pick(recent)}
                  className={itemClass}
                >
                  <JobRow job={recent} selected={value?._id === recent._id} withSite />
                </CommandItem>
              </CommandGroup>
            )}
            {sites.map((s) => (
              <CommandGroup
                key={s._id}
                className={groupClass}
                heading={
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {s.siteName}
                  </span>
                }
              >
                {s.jobs.map((j) => {
                  const job: DriverJob = { ...j, site: { _id: s._id, siteName: s.siteName } }
                  return (
                    <CommandItem
                      key={j._id}
                      value={`${j._id} ${jobLabel(job)} ${s.siteName}`}
                      onSelect={() => pick(job)}
                      className={itemClass}
                    >
                      <JobRow job={job} selected={value?._id === j._id} />
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// Smaller type and tighter padding below `sm`; the base ui/command sizes apply from `sm` up.
const groupClass = "p-0.5 **:[[cmdk-group-heading]]:py-1 **:[[cmdk-group-heading]]:text-[11px] sm:p-1 sm:**:[[cmdk-group-heading]]:py-1.5 sm:**:[[cmdk-group-heading]]:text-xs"
const itemClass = "px-1.5 py-1 text-xs sm:px-2 sm:py-1.5 sm:text-sm"

function JobRow({ job, selected, withSite = false }: { job: DriverJob; selected: boolean; withSite?: boolean }) {
  return (
    <div className="flex w-full min-w-0 items-center gap-1.5 sm:gap-2">
      <span className="w-11 shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground sm:w-14 sm:text-xs">
        {job.jobCode || "—"}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {job.name}
        {withSite && job.site && <span className="text-[11px] text-muted-foreground sm:text-xs"> · {job.site.siteName}</span>}
      </span>
      <Check className={cn("h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4", selected ? "opacity-100" : "opacity-0")} />
    </div>
  )
}
