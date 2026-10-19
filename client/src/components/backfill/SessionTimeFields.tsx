// SessionTimeFields.tsx
//
// Check-in / check-out inputs for ONE backfilled session on business day `date`, with the
// per-endpoint "next day" pills (as in EditSiteRecord), so a true 24h shift (08:00→08:00
// with check-out next day) or an after-midnight session is expressible. Typing a check-out
// earlier than the check-in rolls it to the next day automatically (deriveOffsets).
//
// Shared by the admin BulkBackfillModal and the supervisor backfill-request form.

import { Input } from "@/components/ui/input"
import { deriveOffsets, formatOffsetDayLabel } from "@/lib/dateUtils"

export type SessionTimes = {
  checkIn: string
  checkOut: string
  checkInNextDay: boolean
  checkOutNextDay: boolean
}

const pillClass = (on: boolean) =>
  `mt-1 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
    on
      ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800/50 dark:bg-indigo-950/40 dark:text-indigo-300"
      : "border-border text-muted-foreground hover:bg-muted"
  }`

export default function SessionTimeFields({
  date,
  value,
  onChange,
  disabled = false,
}: {
  date: string
  value: SessionTimes
  onChange: (next: SessionTimes) => void
  disabled?: boolean
}) {
  const { checkIn, checkOut, checkInNextDay, checkOutNextDay } = value

  // Preserve the check-in's own next-day intent, re-derive the check-out offset.
  const handleCheckInChange = (next: string) => {
    const offsets = deriveOffsets(next, checkOut, checkInNextDay)
    onChange({ ...value, checkIn: next, ...offsets })
  }

  const handleCheckOutChange = (next: string) => {
    const { checkOutNextDay: co } = deriveOffsets(checkIn, next, checkInNextDay)
    onChange({ ...value, checkOut: next, checkOutNextDay: co })
  }

  // Whether the shift STARTS on the next day (an after-midnight session recorded on this day).
  const toggleCheckInNextDay = () => {
    const offsets = deriveOffsets(checkIn, checkOut, !checkInNextDay)
    onChange({ ...value, ...offsets })
  }

  // Independent flip — how a true 24h shift or any late-crossing check-out is expressed.
  const toggleCheckOutNextDay = () => onChange({ ...value, checkOutNextDay: !checkOutNextDay })

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Check In</label>
        <Input
          className="h-10 text-sm"
          type="time"
          value={checkIn}
          disabled={disabled}
          onChange={(e) => handleCheckInChange(e.target.value)}
        />
        {checkIn && (
          <button
            type="button"
            onClick={toggleCheckInNextDay}
            disabled={disabled}
            className={pillClass(checkInNextDay)}
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
          disabled={disabled}
          onChange={(e) => handleCheckOutChange(e.target.value)}
        />
        {checkIn && checkOut && (
          <button
            type="button"
            onClick={toggleCheckOutNextDay}
            disabled={disabled}
            className={pillClass(checkOutNextDay)}
            title="Toggle whether the check-out is on the next day (for 24h or after-midnight shifts)"
          >
            {checkOutNextDay
              ? `🌙 Check-out next day · ${formatOffsetDayLabel(date, 1)}`
              : `Check-out same day · ${formatOffsetDayLabel(date, 0)}`}
          </button>
        )}
      </div>
    </div>
  )
}
