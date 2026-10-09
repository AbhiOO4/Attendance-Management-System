import { useState } from "react"
import toast from "react-hot-toast"
import { Loader2, MessageSquare } from "lucide-react"

import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const MAX_LEN = 500

/**
 * Edit the supervisor remark on one saved attendance record (PATCH /api/attendance/:id/remark —
 * written with timestamps off server-side, so it never trips RECORD_CHANGED on the row).
 * Opened from the drivers sheet's row kebab.
 */
export default function RemarkDialog({
  open,
  onOpenChange,
  attendanceId,
  employeeName,
  initialRemark,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  attendanceId: string | null
  employeeName: string
  initialRemark: string
  onSaved?: (remark: string) => void
}) {
  // The parent keys this dialog by record, so it mounts fresh with that record's remark.
  const [remark, setRemark] = useState(initialRemark)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!attendanceId) return
    setSaving(true)
    try {
      await api.patch(`/api/attendance/${attendanceId}/remark`, { remark })
      toast.success(remark.trim() ? "Remark saved" : "Remark cleared")
      onSaved?.(remark.trim())
      onOpenChange(false)
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message || "Couldn't save the remark")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Remark
          </DialogTitle>
          <DialogDescription>{employeeName} · today's record</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Textarea
            value={remark}
            onChange={(e) => setRemark(e.target.value.slice(0, MAX_LEN))}
            placeholder="Add a note for this day (e.g. late return, vehicle breakdown)…"
            rows={4}
            aria-label="Remark"
          />
          <div className="text-right text-[11px] text-muted-foreground">
            {remark.length}/{MAX_LEN}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || remark.trim() === initialRemark.trim()}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
