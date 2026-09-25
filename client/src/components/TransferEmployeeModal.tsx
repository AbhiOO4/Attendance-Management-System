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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Loader2, ArrowLeftRight, MapPin } from "lucide-react"

interface Job {
  _id: string
  name: string
  isActive?: boolean
  isDeleted?: boolean
  isCompleted?: boolean
}

interface Site {
  _id: string
  siteName: string
  locationDetails?: string
  isActive: boolean
  isCompleted: boolean
  isPermanent?: boolean
  jobs: Job[]
}

type TransferMode = "today" | "permanent"

interface TransferEmployeeModalProps {
  open: boolean
  onClose: () => void
  employeeId: string
  employeeName: string
  fromSiteId: string
  // Business day of the record being transferred from: today, or yesterday for a night
  // shift still running past midnight (the carryover).
  date: string
  // The acting user's transfer will be held as a request the destination site's
  // supervisors must accept (true for supervisors; admins transfer immediately).
  willRequest?: boolean
  // False when this site may not re-home the employee (a supervisor on a visitor's row —
  // only their home site or an admin can move them permanently).
  permanentAllowed?: boolean
  onTransferred?: (result: { pending: boolean; requested?: boolean }) => void
}

function TransferEmployeeModal({
  open,
  onClose,
  employeeId,
  employeeName,
  fromSiteId,
  date,
  willRequest = false,
  permanentAllowed = true,
  onTransferred,
}: TransferEmployeeModalProps) {
  const [sites, setSites] = useState<Site[]>([])
  const [loadingSites, setLoadingSites] = useState(false)
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  // Nothing preselected: the user must consciously pick "For today" or "Permanent".
  const [mode, setMode] = useState<TransferMode | null>(null)
  const [transferring, setTransferring] = useState(false)

  const fetchSites = async () => {
    try {
      setLoadingSites(true)
      const res = await api.get("/api/site", { params: { isActive: true } })
      const eligible = (res.data as Site[]).filter(
        (s) => !s.isCompleted && String(s._id) !== String(fromSiteId)
      )
      setSites(eligible)
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to load sites")
      setSites([])
    } finally {
      setLoadingSites(false)
    }
  }

  useEffect(() => {
    if (open) {
      fetchSites()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fromSiteId])

  useEffect(() => {
    if (!open) {
      setSelectedSiteId(null)
      setSelectedJobId(null)
      setMode(null)
    }
  }, [open])

  const selectedSite = sites.find((s) => s._id === selectedSiteId) || null

  const handleSelectSite = (siteId: string) => {
    setSelectedSiteId(siteId)
    setSelectedJobId(null)
  }

  const handleTransfer = async () => {
    if (!selectedSiteId) {
      toast.error("Select a destination site")
      return
    }
    if (!mode) {
      toast.error("Choose 'For today' or 'Permanent'")
      return
    }
    try {
      setTransferring(true)
      const res = await api.post("/api/attendance/transfer", {
        employeeId,
        fromSiteId,
        toSiteId: selectedSiteId,
        jobId: selectedJobId || null,
        date,
        onlyForToday: mode === "today",
      })
      toast.success(res.data.message || "Employee transferred")
      onTransferred?.({ pending: !!res.data.pending, requested: !!res.data.requested })
      onClose()
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message || "Failed to transfer employee"
      )
    } finally {
      setTransferring(false)
    }
  }

  const blockClass = (active: boolean, disabled = false) =>
    `rounded-xl border p-3 text-left transition-colors ${
      disabled
        ? "border-border bg-muted/20 opacity-60 cursor-not-allowed"
        : active
        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
        : "border-border bg-muted/30 hover:border-primary/20"
    }`

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="!max-w-[600px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5" />
            {willRequest ? "Request Transfer" : "Transfer Employee"}
          </DialogTitle>
          <DialogDescription>
            Transfer {employeeName || "this employee"} to another site. Their
            check-out here becomes their check-in there.
            {willRequest &&
              " The destination site's supervisors must accept before the employee is added there."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto rounded-md border divide-y min-h-[200px]">
          {loadingSites ? (
            <div className="flex justify-center items-center py-10">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : sites.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
              <MapPin className="h-6 w-6" />
              <p className="text-sm">No eligible destination sites found</p>
            </div>
          ) : (
            sites.map((s) => (
              <label
                key={s._id}
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50"
              >
                <input
                  type="radio"
                  name="transferSite"
                  className="h-4 w-4 accent-primary"
                  checked={selectedSiteId === s._id}
                  onChange={() => handleSelectSite(s._id)}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{s.siteName}</p>
                  {s.locationDetails && (
                    <p className="text-sm text-muted-foreground truncate">
                      {s.locationDetails}
                    </p>
                  )}
                </div>
              </label>
            ))
          )}
        </div>

        {selectedSite && (
          <Select
            value={selectedJobId ?? "none"}
            onValueChange={(value) =>
              setSelectedJobId(value === "none" ? null : value)
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Assign Job (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No job</SelectItem>
              {selectedSite.jobs
                ?.filter((j) => j.isActive !== false && !j.isDeleted && !j.isCompleted)
                .map((job) => (
                  <SelectItem key={job._id} value={job._id}>
                    {job.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode("today")}
            className={blockClass(mode === "today")}
          >
            <div className="font-semibold text-sm text-foreground">For today</div>
            <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">
              A visit — back on their home site tomorrow.
            </div>
          </button>
          <button
            type="button"
            disabled={!permanentAllowed}
            onClick={() => permanentAllowed && setMode("permanent")}
            className={blockClass(mode === "permanent", !permanentAllowed)}
          >
            <div className="font-semibold text-sm text-foreground">Permanent</div>
            <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">
              {permanentAllowed
                ? "Their home site moves to the destination from today."
                : "Only their home site or an admin can move them permanently."}
            </div>
          </button>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={transferring}
          >
            Cancel
          </Button>
          <Button
            onClick={handleTransfer}
            disabled={transferring || !selectedSiteId || !mode}
          >
            {transferring ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <ArrowLeftRight className="h-4 w-4 mr-2" />
            )}
            {willRequest ? "Request transfer" : "Transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default TransferEmployeeModal
