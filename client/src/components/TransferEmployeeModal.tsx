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

interface TransferEmployeeModalProps {
  open: boolean
  onClose: () => void
  employeeId: string
  employeeName: string
  fromSiteId: string
  date: string
  isSupervisor?: boolean
  onTransferred?: (result: { pending: boolean }) => void
}

function TransferEmployeeModal({
  open,
  onClose,
  employeeId,
  employeeName,
  fromSiteId,
  date,
  isSupervisor = false,
  onTransferred,
}: TransferEmployeeModalProps) {
  const [sites, setSites] = useState<Site[]>([])
  const [loadingSites, setLoadingSites] = useState(false)
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [onlyForToday, setOnlyForToday] = useState(false)
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
      setOnlyForToday(false)
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
    try {
      setTransferring(true)
      const res = await api.post("/api/attendance/transfer", {
        employeeId,
        fromSiteId,
        toSiteId: selectedSiteId,
        jobId: selectedJobId || null,
        date,
        onlyForToday,
      })
      toast.success(res.data.message || "Employee transferred")
      onTransferred?.({ pending: !!res.data.pending })
      onClose()
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message || "Failed to transfer employee"
      )
    } finally {
      setTransferring(false)
    }
  }

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
            Transfer Employee
          </DialogTitle>
          <DialogDescription>
            Transfer {employeeName || "this employee"} to another site. Their
            check-out here becomes their check-in there.
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
              {selectedSite.jobs.map((job) => (
                <SelectItem key={job._id} value={job._id}>
                  {job.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-accent/50">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary mt-0.5"
            checked={onlyForToday}
            onChange={(e) => setOnlyForToday(e.target.checked)}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Only for today</p>
            <p className="text-xs text-muted-foreground">
              {onlyForToday
                ? isSupervisor
                  ? "A visit for today only — their home site and attendance assignment stay unchanged; back on their own site tomorrow."
                  : "A visit for today only — their home site stays unchanged; back on it tomorrow."
                : isSupervisor
                ? "Permanent move — their home site and attendance assignment move to the destination."
                : "Permanent move — their home site moves to the destination from today."}
            </p>
          </div>
        </label>

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
            disabled={transferring || !selectedSiteId}
          >
            {transferring ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <ArrowLeftRight className="h-4 w-4 mr-2" />
            )}
            Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default TransferEmployeeModal
