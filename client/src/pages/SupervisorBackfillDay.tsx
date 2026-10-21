// SupervisorBackfillDay.tsx — /backfill/:date
//
// The supervisor's backfill for their site on one past day. "Add employees" picks people
// (BackfillEmployeePicker: on your site now / recently here / search everyone), then one set
// of sessions is applied to all of them (BackfillRowDialog, bulk) — there is no per-employee
// backfill. Rows can be edited or removed while the draft is open; "Send for approval" hands it
// to an admin and locks the day for the supervisor.
//
// A driver supervisor gets the same page for the Drivers pool (their assignedSite): only drivers
// are offered and each session names a site + job split (`driverMode`).

import { useCallback, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import toast from "react-hot-toast"
import { ArrowLeft, Loader2, Send, Trash2, UserPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import BackfillDocumentView from "@/components/backfill/BackfillDocumentView"
import BackfillEmployeePicker from "@/components/backfill/BackfillEmployeePicker"
import BackfillRowDialog, { type BackfillRowDialogTarget } from "@/components/backfill/BackfillRowDialog"
import ConfirmButton from "@/components/backfill/ConfirmButton"
import { useAuth } from "@/context/AuthContext"
import { api } from "@/lib/api"
import { formatFullDateLabel } from "@/lib/dateUtils"
import type { HolidayReason } from "@/lib/attendanceUtils"
import { notifyBackfillUpdated, onBackfillChange, type BackfillRequestDoc, type SiteJob } from "@/lib/backfillRequests"

type ByDayResponse = {
  data: BackfillRequestDoc | null
  site: { _id: string; siteName: string } | null
  isDriverPool?: boolean
  siteJobs?: SiteJob[]
  holiday?: { isHoliday: boolean; reason: HolidayReason }
  window: { from: string; to: string; days: number }
  canStart: boolean
}

export default function SupervisorBackfillDay() {
  const navigate = useNavigate()
  const { date = "" } = useParams()
  const { user } = useAuth()
  const siteId = user?.assignedSite || ""

  const [state, setState] = useState<ByDayResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [bulkTarget, setBulkTarget] = useState<BackfillRowDialogTarget | null>(null)

  const load = useCallback(async () => {
    if (!siteId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setLoading(false)
      return
    }
    try {
      const res = await api.get<ByDayResponse>("/api/backfill-requests/by-day", { params: { siteId, date } })
      setState(res.data)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to load the backfill")
    } finally {
      setLoading(false)
    }
  }, [siteId, date])

  useEffect(() => {
    load()
  }, [load])

  // An admin approving / sending it back shows up here live (via its notification). Driver
  // supervisors have no live stream, so returning to the tab refetches too.
  useEffect(() => {
    const off = onBackfillChange(() => load())
    const onFocus = () => load()
    window.addEventListener("focus", onFocus)
    return () => {
      off()
      window.removeEventListener("focus", onFocus)
    }
  }, [load])

  const doc = state?.data || null
  const siteName = doc?.siteName || state?.site?.siteName || ""
  const siteJobs = doc?.siteJobs || state?.siteJobs || []
  const holiday = doc?.holiday || state?.holiday || null
  const canAdd = doc ? doc.permissions.editable : !!state?.canStart
  const driverMode = !!(doc?.isDriverPool ?? state?.isDriverPool)
  const noun = driverMode ? "driver" : "employee"

  const setDoc = (next: BackfillRequestDoc | null) => setState((s) => (s ? { ...s, data: next } : s))

  const submit = async () => {
    if (!doc) return
    try {
      const res = await api.post<{ data: BackfillRequestDoc }>(`/api/backfill-requests/${doc._id}/submit`)
      setDoc(res.data.data)
      notifyBackfillUpdated()
      toast.success("Sent for approval")
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to send")
      load()
    }
  }

  const discard = async () => {
    if (!doc) return
    try {
      await api.delete(`/api/backfill-requests/${doc._id}`)
      notifyBackfillUpdated()
      toast.success("Draft discarded")
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to discard")
      load()
    }
  }

  const back = (
    <Button variant="ghost" size="sm" className="-ml-2 w-fit text-muted-foreground" onClick={() => navigate("/backfill")}>
      <ArrowLeft className="mr-1.5 h-4 w-4" />
      Back to backfill
    </Button>
  )

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const addButton = canAdd && (
    <Button size="sm" className="gap-1.5" onClick={() => setPickerOpen(true)}>
      <UserPlus className="h-3.5 w-3.5" />
      Add {noun}s
    </Button>
  )

  return (
    <div className="px-4 py-6">
      <div className="mx-auto max-w-3xl space-y-5">
        {back}

        {!state ? (
          <div className="rounded-xl border bg-background p-8 text-center text-sm text-muted-foreground">
            {siteId ? "This backfill couldn't be loaded." : "You have no site assigned."}
          </div>
        ) : doc ? (
          <>
            <BackfillDocumentView
              doc={doc}
              onChanged={setDoc}
              emptyHint={`Add the ${noun}s you forgot to mark for this day.`}
              actions={
                <>
                  {addButton}
                  {doc.permissions.canSubmit && (
                    <ConfirmButton
                      title="Send for approval?"
                      description={
                        <>
                          {doc.rows.length} {noun}{doc.rows.length === 1 ? "" : "s"} for {formatFullDateLabel(doc.date)} go to an
                          admin. After this you can't edit this backfill or add more people for this day.
                        </>
                      }
                      confirmLabel="Send"
                      onConfirm={submit}
                    >
                      <Send className="h-3.5 w-3.5" />
                      Send for approval
                    </ConfirmButton>
                  )}
                  {doc.permissions.canDiscard && (
                    <ConfirmButton
                      title="Discard this draft?"
                      description="Every row in it is deleted. Nothing was saved to attendance yet."
                      confirmLabel="Discard"
                      variant="outline"
                      onConfirm={discard}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Discard
                    </ConfirmButton>
                  )}
                </>
              }
            />
            <StatusNote doc={doc} />
          </>
        ) : (
          <div className="space-y-4 rounded-xl border bg-background p-6">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{siteName}</h1>
              <p className="text-sm text-muted-foreground">{formatFullDateLabel(date)}</p>
            </div>
            {state.canStart ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Nothing backfilled for this day yet. Pick the {noun}s you forgot to mark and enter their sessions —
                  it stays a draft until you send it for approval.
                </p>
                {addButton}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                This day is outside your backfill window (the past {state.window.days} day
                {state.window.days === 1 ? "" : "s"}). Ask an admin to backfill it.
              </p>
            )}
          </div>
        )}
      </div>

      {siteId && (
        <BackfillEmployeePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          siteId={siteId}
          siteName={siteName}
          date={date}
          driverMode={driverMode}
          onContinue={(employees) => {
            setPickerOpen(false)
            setBulkTarget({ mode: "bulk", employees })
          }}
        />
      )}

      <BackfillRowDialog
        open={!!bulkTarget}
        onClose={() => setBulkTarget(null)}
        target={bulkTarget}
        date={date}
        siteId={siteId}
        siteName={siteName}
        siteJobs={siteJobs}
        holiday={holiday}
        driverMode={driverMode}
        onSaved={(next) => {
          if (next) setDoc(next)
        }}
      />
    </div>
  )
}

function StatusNote({ doc }: { doc: BackfillRequestDoc }) {
  let text: string | null = null
  if (doc.status === "submitted") text = "Waiting for an admin to approve. You can't change it any more."
  else if (doc.status === "approved") text = "Approved — these records are now in attendance."
  else if (!doc.permissions.editable) text = "This day is outside your backfill window, so this draft can't be sent any more."
  else if (doc.submitDeadline) text = `Send it for approval by ${formatFullDateLabel(doc.submitDeadline)}.`
  else if (doc.wasRejected) text = "Fix what the admin asked for, then send it again."
  return text ? <p className="text-center text-xs text-muted-foreground">{text}</p> : null
}
