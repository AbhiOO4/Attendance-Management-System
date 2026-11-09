// SelectionChips.tsx
//
// Compact, removable "chips" tray for bulk-selection toolbars. Selection persists across
// searches / filters / pages, so the user needs a way to see (and prune) everyone picked —
// including rows hidden by the current filter — without leaving the filtered view.
// Shows the first few chips and collapses the rest behind a "+N more" toggle.

import { useState } from "react"
import { X } from "lucide-react"

export interface SelectionChip {
  id: string
  label: string
  sublabel?: string
}

interface SelectionChipsProps {
  items: SelectionChip[]
  onRemove: (id: string) => void
  onClear: () => void
  /** Chips shown before collapsing behind "+N more". */
  collapsedCount?: number
}

function SelectionChips({ items, onRemove, onClear, collapsedCount = 8 }: SelectionChipsProps) {
  const [expanded, setExpanded] = useState(false)
  if (items.length === 0) return null

  const visible = expanded ? items : items.slice(0, collapsedCount)
  const hiddenCount = items.length - visible.length

  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 border-t pt-2">
      {visible.map((item) => (
        <span
          key={item.id}
          className="inline-flex max-w-[220px] items-center gap-1 rounded-full border bg-primary/5 py-0.5 pl-2.5 pr-1 text-xs"
          title={item.sublabel ? `${item.label} · ${item.sublabel}` : item.label}
        >
          <span className="truncate font-medium">{item.label}</span>
          {item.sublabel && (
            <span className="shrink-0 text-muted-foreground">{item.sublabel}</span>
          )}
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Remove ${item.label} from selection`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-xs font-medium text-primary hover:underline"
        >
          +{hiddenCount} more
        </button>
      )}
      {expanded && items.length > collapsedCount && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-xs font-medium text-muted-foreground hover:underline"
        >
          Show less
        </button>
      )}
      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
      >
        Clear selection
      </button>
    </div>
  )
}

export default SelectionChips
