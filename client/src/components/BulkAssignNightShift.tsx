import { useEffect, useMemo, useState } from "react"
import { api } from "@/lib/api"
import toast from "react-hot-toast"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"

import { Loader2, Moon, Plane, Users } from "lucide-react"

import { cn } from "@/lib/utils"

// The four roster categories (collarType × nationality) and their labels live in
// a shared module so this modal stays in sync with the Site Attendance page.
import {
  categoryOf,
  CATEGORY_LABELS,
  CATEGORY_IS_FOREIGN,
  type CollarType,
  type Nationality,
  type RosterCategory,
} from "@/lib/rosterUtils"

const ROSTER_CATEGORIES: RosterCategory[] = [
  "foreignSkilled",
  "foreignStaff",
  "omaniSkilled",
  "omaniStaff",
]

interface Candidate {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
  currentJob?: { _id: string; name: string } | null
  collarType?: CollarType
  nationality?: Nationality
}

interface BulkAssignNightShiftProps {
  open: boolean
  onClose: () => void
  siteId: string
  date: string
  onAssigned?: () => void
}

function BulkAssignNightShift({
  open,
  onClose,
  siteId,
  date,
  onAssigned,
}: BulkAssignNightShiftProps) {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Roster-category filter. Empty set = "All" (no filter) — mirrors the Site
  // Attendance page's "null = all" convention and avoids a deselect-everything
  // dead end. When narrowed, only the chosen categories are shown/selectable.
  const [selectedCategories, setSelectedCategories] = useState<Set<RosterCategory>>(new Set())
  const [loading, setLoading] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [showOnlyEmpty, setShowOnlyEmpty] = useState(true)
  const [filters, setFilters] = useState({
    name: "",
    employeeId: "",
    jobTitle: "",
  })

  const fetchCandidates = async () => {
    if (!siteId || !date) return
    try {
      setLoading(true)
      const res = await api.get(
        "/api/attendance/night-shift/candidates",
        {
          params: {
            siteId,
            date,
            showOnlyEmpty,
            name: filters.name || undefined,
            employeeId: filters.employeeId || undefined,
            jobTitle: filters.jobTitle || undefined,
          },
        }
      )
      setCandidates(res.data.data || [])
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message || "Failed to load candidates"
      )
      setCandidates([])
    } finally {
      setLoading(false)
    }
  }

  // Refetch when opened or when filters / toggle change
  useEffect(() => {
    if (open) {
      fetchCandidates()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showOnlyEmpty, filters.name, filters.employeeId, filters.jobTitle])

  // Reset selection and category filter when closed
  useEffect(() => {
    if (!open) {
      setSelected(new Set())
      setSelectedCategories(new Set())
    }
  }, [open])

  // Candidates in the currently-selected categories (empty filter = all of them).
  const visibleCandidates = useMemo(() => {
    if (selectedCategories.size === 0) return candidates
    return candidates.filter((c) =>
      selectedCategories.has(categoryOf(c.collarType, c.nationality))
    )
  }, [candidates, selectedCategories])

  // Per-category counts for the chips (over the full candidate set, so a chip's
  // count doesn't change as you narrow the filter).
  const categoryCounts = useMemo(() => {
    const counts: Record<RosterCategory, number> = {
      foreignSkilled: 0, foreignStaff: 0, omaniSkilled: 0, omaniStaff: 0,
    }
    for (const c of candidates) {
      counts[categoryOf(c.collarType, c.nationality)]++
    }
    return counts
  }, [candidates])

  // Keep the selection a subset of what's visible: narrowing the category filter
  // (or a candidate refetch) drops now-hidden ids so a hidden employee is never
  // assigned and the "N selected" count stays honest. Widening keeps selections.
  useEffect(() => {
    const visibleIds = new Set(visibleCandidates.map((c) => c._id))
    setSelected((prev) => {
      if (prev.size === 0) return prev
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (visibleIds.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [visibleCandidates])

  const toggleCategory = (cat: RosterCategory) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const toggleOne = (empId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(empId)) next.delete(empId)
      else next.add(empId)
      return next
    })
  }

  const allSelected =
    visibleCandidates.length > 0 &&
    visibleCandidates.every((c) => selected.has(c._id))

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(visibleCandidates.map((c) => c._id)))
    }
  }

  const handleAssign = async () => {
    if (selected.size === 0) {
      toast.error("Select at least one employee")
      return
    }
    try {
      setAssigning(true)
      const res = await api.post(
        "/api/attendance/night-shift/assign",
        {
          siteId,
          date,
          employeeIds: Array.from(selected),
        }
      )
      toast.success(res.data.message || "Night shift assigned")
      setSelected(new Set())
      onAssigned?.()
      onClose()
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message ||
        "Failed to assign night shift"
      )
    } finally {
      setAssigning(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="!max-w-[700px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Moon className="h-5 w-5" />
            Assign Night Shift
          </DialogTitle>
          <DialogDescription>
            Select employees for night shift.
          </DialogDescription>
        </DialogHeader>

        {/* FILTERS */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input
            placeholder="Name"
            value={filters.name}
            onChange={(e) =>
              setFilters((p) => ({ ...p, name: e.target.value }))
            }
          />
          <Input
            placeholder="Employee ID"
            value={filters.employeeId}
            onChange={(e) =>
              setFilters((p) => ({ ...p, employeeId: e.target.value }))
            }
          />
          <Input
            placeholder="Job Title"
            value={filters.jobTitle}
            onChange={(e) =>
              setFilters((p) => ({ ...p, jobTitle: e.target.value }))
            }
          />
        </div>

        {/* CATEGORY CHIPS: filter the candidate list by roster category. "All"
            (empty selection) shows every category; picking chips narrows the list,
            and "Select all" then only selects the shown categories. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground font-medium shrink-0 mr-0.5">
            Category:
          </span>
          <button
            type="button"
            onClick={() => setSelectedCategories(new Set())}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-medium border transition-colors",
              selectedCategories.size === 0
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
            )}
          >
            All
          </button>
          {ROSTER_CATEGORIES.map((cat) => {
            const active = selectedCategories.has(cat)
            return (
              <button
                key={cat}
                type="button"
                onClick={() => toggleCategory(cat)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-medium border transition-colors",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                )}
              >
                {CATEGORY_IS_FOREIGN[cat] && <Plane className="h-3 w-3" />}
                {CATEGORY_LABELS[cat]}
                <span
                  className={cn(
                    "inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold",
                    active ? "bg-primary-foreground/20" : "bg-muted-foreground/10"
                  )}
                >
                  {categoryCounts[cat]}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Checkbox
              id="onlyEmpty"
              checked={showOnlyEmpty}
              onCheckedChange={(c) => setShowOnlyEmpty(c === true)}
            />
            <Label htmlFor="onlyEmpty" className="text-sm">
              Only employees without completed attendance
            </Label>
          </div>
          <div className="text-sm text-muted-foreground">
            {selected.size} selected
          </div>
        </div>

        {/* LIST */}
        <div className="flex-1 overflow-y-auto rounded-md border divide-y min-h-[200px]">
          {loading ? (
            <div className="flex justify-center items-center py-10">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : visibleCandidates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
              <Users className="h-6 w-6" />
              <p className="text-sm">
                {candidates.length === 0
                  ? "No eligible employees found"
                  : "No employees in the selected categories"}
              </p>
            </div>
          ) : (
            <>
              <label className="flex items-center gap-3 px-4 py-2 bg-muted/40 cursor-pointer">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                />
                <span className="text-sm font-medium">
                  Select all ({visibleCandidates.length})
                </span>
              </label>

              {visibleCandidates.map((c) => (
                <label
                  key={c._id}
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50"
                >
                  <Checkbox
                    checked={selected.has(c._id)}
                    onCheckedChange={() => toggleOne(c._id)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{c.name}</p>
                    <p className="text-sm text-muted-foreground truncate">
                      {c.employeeId} • {c.jobTitle}
                    </p>
                  </div>
                  {c.currentJob?.name && (
                    <Badge variant="secondary">
                      {c.currentJob.name}
                    </Badge>
                  )}
                </label>
              ))}
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={assigning}
          >
            Cancel
          </Button>
          <Button
            onClick={handleAssign}
            disabled={assigning || selected.size === 0}
          >
            {assigning ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Moon className="h-4 w-4 mr-2" />
            )}
            Assign Night Shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default BulkAssignNightShift
