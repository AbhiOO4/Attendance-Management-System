import { useState } from "react"
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { MONTH_NAMES, currentMonthYear, type MonthYear } from "@/lib/monthYear"
import { cn } from "@/lib/utils"

// Oldest year the report endpoints accept.
const MIN_YEAR = 2000

// Months as a single ordinal, so comparisons and stepping cross year boundaries.
const toIndex = (v: MonthYear) => v.year * 12 + (v.month - 1)
const fromIndex = (i: number): MonthYear => ({
  year: Math.floor(i / 12),
  month: (i % 12) + 1,
})

interface MonthYearPickerProps {
  /** Selected month, or null for "Entire life cycle" (only with `allowAllTime`). */
  value: MonthYear | null
  onChange: (value: MonthYear | null) => void
  /** Offer an "Entire life cycle" choice that sets the value to null. */
  allowAllTime?: boolean
}

/**
 * Month + year selector: ‹ [📅 September 2026 ▾] › — the arrows step a month,
 * the button opens a year stepper over a 4×3 month grid. Future months are
 * disabled (reports have no data there).
 */
export function MonthYearPicker({
  value,
  onChange,
  allowAllTime = false,
}: MonthYearPickerProps) {
  const [open, setOpen] = useState(false)
  // Year shown in the popover grid — browsing years doesn't change the value.
  const [viewYear, setViewYear] = useState(() => (value ?? currentMonthYear()).year)

  const current = currentMonthYear()
  const currentIndex = toIndex(current)
  const valueIndex = value ? toIndex(value) : null

  function handleOpenChange(next: boolean) {
    if (next) setViewYear((value ?? current).year)
    setOpen(next)
  }

  function select(next: MonthYear | null) {
    onChange(next)
    setOpen(false)
  }

  const label = value
    ? `${MONTH_NAMES[value.month - 1]} ${value.year}`
    : "Entire life cycle"

  return (
    <div className="flex items-center gap-1">
      {value && (
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous month"
          disabled={value.year === MIN_YEAR && value.month === 1}
          onClick={() => onChange(fromIndex(toIndex(value) - 1))}
        >
          <ChevronLeft />
        </Button>
      )}

      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="min-w-[168px] justify-between">
            <span className="flex items-center gap-2">
              <CalendarDays className="text-muted-foreground" />
              {label}
            </span>
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-64">
          {/* Year stepper */}
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous year"
              disabled={viewYear <= MIN_YEAR}
              onClick={() => setViewYear((y) => y - 1)}
            >
              <ChevronLeft />
            </Button>
            <span className="text-sm font-semibold tabular-nums">{viewYear}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next year"
              disabled={viewYear >= current.year}
              onClick={() => setViewYear((y) => y + 1)}
            >
              <ChevronRight />
            </Button>
          </div>

          {/* Month grid */}
          <div className="grid grid-cols-4 gap-1">
            {MONTH_NAMES.map((name, i) => {
              const cell = { month: i + 1, year: viewYear }
              const cellIndex = toIndex(cell)
              const selected = cellIndex === valueIndex
              const isCurrent = cellIndex === currentIndex
              return (
                <Button
                  key={name}
                  variant={selected ? "default" : "ghost"}
                  size="sm"
                  disabled={cellIndex > currentIndex}
                  aria-pressed={selected}
                  className={cn(
                    "h-8",
                    isCurrent && !selected && "ring-1 ring-primary/50 text-primary"
                  )}
                  onClick={() => select(cell)}
                >
                  {name.slice(0, 3)}
                </Button>
              )
            })}
          </div>

          {/* Shortcuts */}
          <div className="flex items-center justify-between border-t pt-2">
            <Button variant="ghost" size="sm" onClick={() => select(current)}>
              This month
            </Button>
            {allowAllTime && (
              <Button
                variant={value === null ? "secondary" : "ghost"}
                size="sm"
                onClick={() => select(null)}
              >
                Entire life cycle
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {value && (
        <Button
          variant="outline"
          size="icon"
          aria-label="Next month"
          disabled={toIndex(value) >= currentIndex}
          onClick={() => onChange(fromIndex(toIndex(value) + 1))}
        >
          <ChevronRight />
        </Button>
      )}
    </div>
  )
}

export default MonthYearPicker
