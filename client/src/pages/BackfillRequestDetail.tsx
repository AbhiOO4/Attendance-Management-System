// BackfillRequestDetail.tsx — /attendance/edit/backfill-requests/:id
//
// Admin review of one supervisor backfill request. While it awaits approval the admin can
// edit or remove rows, send it back with a reason, or approve it — which creates the
// Attendance records (rows that no longer fit are skipped/failed and shown on the rows).

import { useCallback, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import toast from "react-hot-toast"
import { ArrowLeft, CheckCircle2, Loader2, Undo2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import BackfillDocumentView from "@/components/backfill/BackfillDocumentView"
import ConfirmButton from "@/components/backfill/ConfirmButton"
import { api } from "@/lib/api"
import { formatFullDateLabel } from "@/lib/dateUtils"
import { notifyBackfillUpdated, type BackfillRequestDoc } from "@/lib/backfillRequests"
import HelpButton from "@/components/help/HelpButton"

export default function BackfillRequestDetail() {
  const navigate = useNavigate()
  const { id = "" } = useParams()
  const [doc, setDoc] = useState<BackfillRequestDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [rejecting, setRejecting] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ data: BackfillRequestDoc }>(`/api/backfill-requests/${id}`)
      setDoc(res.data.data)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to load the backfill request")
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const approve = async () => {
    try {
      const res = await api.post<{ data: BackfillRequestDoc; message: string; summary: { createdCount: number } }>(
        `/api/backfill-requests/${id}/approve`
      )
      setDoc(res.data.data)
      notifyBackfillUpdated()
      if (res.data.summary.createdCount > 0) toast.success(res.data.message)
      else toast.error(res.data.message)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to approve")
      load()
    }
  }

  const reject = async () => {
    if (!reason.trim()) {
      toast.error("Say what needs fixing")
      return
    }
    setRejecting(true)
    try {
      const res = await api.post<{ data: BackfillRequestDoc }>(`/api/backfill-requests/${id}/reject`, { reason: reason.trim() })
      setDoc(res.data.data)
      notifyBackfillUpdated()
      setRejectOpen(false)
      setReason("")
      toast.success("Sent back to the supervisor")
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to send back")
      load()
    } finally {
      setRejecting(false)
    }
  }

  return (
    <div className="px-4 py-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 w-fit text-muted-foreground"
            onClick={() => navigate("/attendance/edit/backfill-requests")}
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to approvals
          </Button>
          <HelpButton topic="backfill-approvals" />
        </div>

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !doc ? (
          <div className="rounded-xl border bg-background p-8 text-center text-sm text-muted-foreground">
            This backfill request couldn't be loaded.
          </div>
        ) : (
          <BackfillDocumentView
            doc={doc}
            onChanged={setDoc}
            actions={
              doc.permissions.canReview && (
                <>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setRejectOpen(true)}>
                    <Undo2 className="h-3.5 w-3.5" />
                    Send back
                  </Button>
                  <ConfirmButton
                    title="Approve this backfill?"
                    description={
                      <>
                        Creates attendance records for {doc.rows.length} employee{doc.rows.length === 1 ? "" : "s"} at{" "}
                        {doc.siteName} on {formatFullDateLabel(doc.date)}. Anyone who already has a record that day, or whose
                        times now overlap another day, is skipped and shown on their row.
                      </>
                    }
                    confirmLabel="Approve"
                    onConfirm={approve}
                    disabled={doc.rows.length === 0}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Approve
                  </ConfirmButton>
                </>
              )
            }
          />
        )}
      </div>

      <Dialog open={rejectOpen} onOpenChange={(o) => !rejecting && setRejectOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send back to the supervisor</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            They can fix it and send it again. Tell them what to change.
          </p>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={4}
            placeholder="e.g. The night session should end at 06:00, not 08:00"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={rejecting}>
              Cancel
            </Button>
            <Button onClick={reject} disabled={rejecting || !reason.trim()}>
              {rejecting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send back"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
