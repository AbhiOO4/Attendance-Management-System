import { useEffect, useState } from "react"
import axios from "axios"
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
import { Loader2, SendHorizontal, MapPin } from "lucide-react"

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
  jobs: Job[]
}

interface SendToSiteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  siteId: string
  employee: { _id: string; name: string } | null
  // Called after a successful send so the parent can refresh its roster.
  onSent: () => void
}

// Source-initiated "Send to site": the owner hands their own employee to another site
// for TODAY (a visit; home unchanged) or PERMANENTLY. No approval — the destination
// supervisor is only notified. Posts to POST /api/site/:siteId/send-employee.
function SendToSiteDialog({ open, onOpenChange, siteId, employee, onSent }: SendToSiteDialogProps) {
  const [sites, setSites] = useState<Site[]>([])
  const [loadingSites, setLoadingSites] = useState(false)
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [mode, setMode] = useState<"today" | "permanent">("today")
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!open) {
      setSelectedSiteId(null)
      setSelectedJobId(null)
      setMode("today")
      return
    }
    let cancelled = false
    const fetchSites = async () => {
      try {
        setLoadingSites(true)
        const res = await api.get("/api/site", { params: { isActive: true } })
        const eligible = (res.data as Site[]).filter(
          (s) => !s.isCompleted && String(s._id) !== String(siteId)
        )
        if (!cancelled) setSites(eligible)
      } catch (error) {
        if (!cancelled) {
          const msg = axios.isAxiosError(error) ? error.response?.data?.message : undefined
          toast.error(msg || "Failed to load sites")
          setSites([])
        }
      } finally {
        if (!cancelled) setLoadingSites(false)
      }
    }
    fetchSites()
    return () => {
      cancelled = true
    }
  }, [open, siteId])

  const selectedSite = sites.find((s) => s._id === selectedSiteId) || null

  const handleSend = async () => {
    if (!employee || !selectedSiteId) {
      toast.error("Select a destination site")
      return
    }
    setSending(true)
    try {
      const res = await api.post(`/api/site/${siteId}/send-employee`, {
        empId: employee._id,
        toSiteId: selectedSiteId,
        toJobId: selectedJobId || null,
        mode,
      })
      toast.success(res.data?.message || "Employee sent")
      // Today's draft cache for this site may now be stale (the employee left it).
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith(`attendance_draft_${siteId}_`)) {
          localStorage.removeItem(key)
        }
      })
      localStorage.removeItem(`active_inline_edit_row_${siteId}`)
      localStorage.removeItem(`active_inline_edit_data_${siteId}`)
      onSent()
      onOpenChange(false)
    } catch (error) {
      const msg = axios.isAxiosError(error) ? error.response?.data?.message : undefined
      toast.error(msg || "Failed to send employee")
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[560px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SendHorizontal className="h-5 w-5" />
            Send to another site
          </DialogTitle>
          <DialogDescription>
            Hand {employee?.name || "this employee"} to the site they belong at today.
            The other supervisor is notified — no approval needed.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto rounded-md border divide-y min-h-[180px]">
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
                  name="sendToSite"
                  className="h-4 w-4 accent-primary"
                  checked={selectedSiteId === s._id}
                  onChange={() => {
                    setSelectedSiteId(s._id)
                    setSelectedJobId(null)
                  }}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{s.siteName}</p>
                  {s.locationDetails && (
                    <p className="text-sm text-muted-foreground truncate">{s.locationDetails}</p>
                  )}
                </div>
              </label>
            ))
          )}
        </div>

        {selectedSite && (
          <Select
            value={selectedJobId ?? "none"}
            onValueChange={(value) => setSelectedJobId(value === "none" ? null : value)}
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
            className={`rounded-xl border p-3 text-left transition-colors ${
              mode === "today"
                ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                : "border-border bg-muted/30 hover:border-primary/20"
            }`}
          >
            <div className="font-semibold text-sm text-foreground">For today</div>
            <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">
              A visit — back on your roster tomorrow.
            </div>
          </button>
          <button
            type="button"
            onClick={() => setMode("permanent")}
            className={`rounded-xl border p-3 text-left transition-colors ${
              mode === "permanent"
                ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                : "border-border bg-muted/30 hover:border-primary/20"
            }`}
          >
            <div className="font-semibold text-sm text-foreground">Permanent</div>
            <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">
              Home site moves there from today.
            </div>
          </button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={sending || !selectedSiteId}>
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <SendHorizontal className="h-4 w-4 mr-2" />
            )}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default SendToSiteDialog
