import { useState } from "react"
import { CalendarRange, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { getCurrentTargetDateString } from "@/lib/dateUtils"
import {
  MAX_RANGE_DAYS,
  currentMonthToDate,
  daysInRange,
  formatDateRange,
  shiftDay,
  type DateRange,
} from "@/lib/monthYear"

interface DateRangePickerProps {
  value: DateRange
  onChange: (value: DateRange) => void
}

/**
 * From–to date selector: [📅 1 Sep – 15 Sep 2026 ▾] opens quick presets and two
 * date fields. Typed dates only take effect on Apply, so a year typed digit by digit
 * never fetches a report for a transient date. Future days are not selectable.
 */
export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false)
  // The dates being edited in the popover; `value` only changes on Apply or a preset.
  const [draft, setDraft] = useState<DateRange>(value)

  const today = getCurrentTargetDateString()

  function handleOpenChange(next: boolean) {
    if (next) setDraft(value)
    setOpen(next)
  }

  function apply(next: DateRange) {
    onChange(next)
    setOpen(false)
  }

  const presets: { label: string; range: DateRange }[] = [
    { label: "Last 7 days", range: { from: shiftDay(today, -6), to: today } },
    { label: "Last 30 days", range: { from: shiftDay(today, -29), to: today } },
    { label: "This month", range: currentMonthToDate() },
    { label: "Year to date", range: { from: `${today.slice(0, 4)}-01-01`, to: today } },
  ]

  const span = daysInRange(draft)
  const error = !draft.from || !draft.to
    ? "Pick both dates"
    : span === 0
      ? "“From” must be on or before “To”"
      : draft.to > today
        ? "Dates can't be in the future"
        : span > MAX_RANGE_DAYS
          ? `Pick at most ${MAX_RANGE_DAYS} days`
          : null

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="min-w-[168px] justify-between">
          <span className="flex items-center gap-2">
            <CalendarRange className="text-muted-foreground" />
            {formatDateRange(value)}
          </span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72">
        {/* Presets apply at once — they are always valid. */}
        <div className="grid grid-cols-2 gap-1">
          {presets.map((preset) => {
            const active =
              preset.range.from === value.from && preset.range.to === value.to
            return (
              <Button
                key={preset.label}
                variant={active ? "secondary" : "ghost"}
                size="sm"
                className="justify-start"
                onClick={() => apply(preset.range)}
              >
                {preset.label}
              </Button>
            )
          })}
        </div>

        {/* Custom range */}
        <div className="space-y-2 border-t pt-2.5">
          <div className="grid grid-cols-[3rem_1fr] items-center gap-2">
            <Label htmlFor="date-range-from" className="font-normal text-muted-foreground">
              From
            </Label>
            <Input
              id="date-range-from"
              type="date"
              value={draft.from}
              max={draft.to && draft.to < today ? draft.to : today}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            />
            <Label htmlFor="date-range-to" className="font-normal text-muted-foreground">
              To
            </Label>
            <Input
              id="date-range-to"
              type="date"
              value={draft.to}
              min={draft.from || undefined}
              max={today}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <span
              className={`text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}
            >
              {error ?? `${span} ${span === 1 ? "day" : "days"}`}
            </span>
            <Button size="sm" disabled={!!error} onClick={() => apply(draft)}>
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default DateRangePicker
