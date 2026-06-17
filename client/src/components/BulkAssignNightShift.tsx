import { useEffect, useState } from "react"
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

import { Loader2, Moon, Users } from "lucide-react"

interface Candidate {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
  currentJob?: { _id: string; name: string } | null
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

  // Reset selection when closed
  useEffect(() => {
    if (!open) {
      setSelected(new Set())
    }
  }, [open])

  const toggleOne = (empId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(empId)) next.delete(empId)
      else next.add(empId)
      return next
    })
  }

  const allSelected =
    candidates.length > 0 &&
    candidates.every((c) => selected.has(c._id))

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(candidates.map((c) => c._id)))
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
            Bulk Assign Night Shift
          </DialogTitle>
          <DialogDescription>
            Select employees to create empty night-shift sessions. The
            auto check-in / check-out cron jobs fill the times using the
            site's night defaults.
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

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Checkbox
              id="onlyEmpty"
              checked={showOnlyEmpty}
              onCheckedChange={(c) => setShowOnlyEmpty(c === true)}
            />
            <Label htmlFor="onlyEmpty" className="text-sm">
              Only employees without attendance
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
          ) : candidates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
              <Users className="h-6 w-6" />
              <p className="text-sm">No eligible employees found</p>
            </div>
          ) : (
            <>
              <label className="flex items-center gap-3 px-4 py-2 bg-muted/40 cursor-pointer">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                />
                <span className="text-sm font-medium">
                  Select all ({candidates.length})
                </span>
              </label>

              {candidates.map((c) => (
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
