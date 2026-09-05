// AttendanceRecordHistory.tsx
//
// The per-record edit log + editable supervisor remark for one attendance record, shown in a
// Dialog. Fetches GET /api/attendance/:id/history on open and lets an authorized user set the
// single remark (PATCH /api/attendance/:id/remark) — read and write share the same server
// authorization, so if the history loads the remark is editable too (no role prop needed).
//
// Two trigger modes:
//   trigger="icon" (default) — renders its own History icon-button trigger (modal headers,
//     employee-detail rows). A draft with no attendanceId renders the icon disabled.
//   trigger="none" — no trigger; the parent controls `open`/`onOpenChange` (e.g. opened from a
//     kebab-menu item on the Site Attendance page).

import { useEffect, useState } from "react"
import axios from "axios"
import { History, Loader2 } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import toast from "react-hot-toast"

type AuditEntry = {
  _id: string
  actorName: string
  type: string
  summary: string
  createdAt: string
}

interface Props {
  attendanceId: string | null
  /** "icon" renders a built-in History icon trigger; "none" is controlled by the parent. */
  trigger?: "icon" | "none"
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Dialog heading (e.g. the employee's name). */
  title?: string
  className?: string
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const s = Math.round((Date.now() - then) / 1000)
  if (s < 60) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

function errMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    return (err.response?.data as { message?: string } | undefined)?.message ?? fallback
  }
  return fallback
}

export default function AttendanceRecordHistory({
  attendanceId,
  trigger = "icon",
  open,
  onOpenChange,
  title = "Record history",
  className,
}: Props) {
  const isControlled = open !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const actualOpen = isControlled ? !!open : internalOpen

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [remark, setRemark] = useState("")
  const [savedRemark, setSavedRemark] = useState("")
  const [saving, setSaving] = useState(false)

  const disabled = !attendanceId

  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next)
    onOpenChange?.(next)
  }

  const load = async () => {
    if (!attendanceId) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.get(`/api/attendance/${attendanceId}/history`)
      const data = res.data?.data ?? { remark: "", entries: [] }
      setEntries(data.entries ?? [])
      setRemark(data.remark ?? "")
      setSavedRemark(data.remark ?? "")
    } catch (err) {
      setError(errMessage(err, "Failed to load history"))
    } finally {
      setLoading(false)
    }
  }

  // Fetch whenever the dialog opens (works for both controlled and uncontrolled modes).
  useEffect(() => {
    if (actualOpen) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actualOpen, attendanceId])

  const saveRemark = async () => {
    if (!attendanceId) return
    setSaving(true)
    try {
      const res = await api.patch(`/api/attendance/${attendanceId}/remark`, { remark })
      const saved: string = res.data?.data?.remark ?? remark.trim()
      setSavedRemark(saved)
      setRemark(saved)
      toast.success("Remark saved")
      load() // refresh so the remark_updated entry appears in the log
    } catch (err) {
      toast.error(errMessage(err, "Failed to save remark"))
    } finally {
      setSaving(false)
    }
  }

  const body = (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>

      {/* Supervisor remark */}
      <div className="flex flex-col gap-1.5">
        <div className="text-sm font-medium">Supervisor remark</div>
        <Textarea
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          maxLength={500}
          placeholder="Add a note about this day…"
          className="min-h-16 text-sm"
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">{remark.length}/500</span>
          <Button size="sm" onClick={saveRemark} disabled={saving || remark === savedRemark}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
          </Button>
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* Change history */}
      <div className="flex flex-col gap-1.5">
        <div className="text-sm font-medium">Change history</div>
        {loading ? (
          <div className="flex items-center gap-2 py-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : error ? (
          <div className="py-2 text-xs text-destructive">{error}</div>
        ) : entries.length === 0 ? (
          <div className="py-2 text-xs text-muted-foreground">No changes recorded yet.</div>
        ) : (
          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
            {entries.map((e) => (
              <li key={e._id} className="text-xs">
                <div className="text-foreground">{e.summary}</div>
                <div className="text-muted-foreground">
                  {e.actorName} · {relativeTime(e.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DialogContent>
  )

  // Parent-controlled, no built-in trigger (e.g. opened from a kebab-menu item).
  if (trigger === "none") {
    return (
      <Dialog open={actualOpen} onOpenChange={setOpen}>
        {body}
      </Dialog>
    )
  }

  // Draft with no saved record yet — a disabled icon, no dialog.
  if (disabled) {
    return (
      <button
        type="button"
        disabled
        title="Save attendance first"
        aria-label="Record history and remark"
        className={cn(
          "inline-flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-full text-muted-foreground opacity-40",
          className
        )}
      >
        <History className="h-4 w-4" />
      </button>
    )
  }

  return (
    <Dialog open={actualOpen} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          title="Record history & remark"
          aria-label="Record history and remark"
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            className
          )}
        >
          <History className="h-4 w-4" />
        </button>
      </DialogTrigger>
      {body}
    </Dialog>
  )
}
