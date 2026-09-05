// SiteActivityLog.tsx
//
// A per-site, per-day activity feed (employee movements): transfer requests sent/decided,
// direct/permanent transfers, send-to-site pushes, and add/remove events. A button in the
// Site Attendance / Site Detail header opens a dialog that fetches
// GET /api/site/:siteId/activity?date=YYYY-MM-DD on open and lists the day's events, newest
// first. A transfer shows in both the source and destination site's feed (server-side).

import { useState } from "react"
import axios from "axios"
import { History, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { api } from "@/lib/api"

type ActivityEntry = {
  _id: string
  type: string
  actorName: string
  employeeName: string
  summary: string
  createdAt: string
}

interface Props {
  siteId: string
  date: string // YYYY-MM-DD business day to show
  className?: string
}

function timeOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export default function SiteActivityLog({ siteId, date, className }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [entries, setEntries] = useState<ActivityEntry[]>([])

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get(`/api/site/${siteId}/activity`, { params: { date } })
      setEntries(res.data?.data?.entries ?? [])
    } catch (err) {
      setError(
        axios.isAxiosError(err)
          ? ((err.response?.data as { message?: string } | undefined)?.message ?? "Failed to load activity")
          : "Failed to load activity"
      )
    } finally {
      setLoading(false)
    }
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) load()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={className}>
          <History className="h-4 w-4" />
          Activity
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Site activity · {date}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : error ? (
          <div className="py-6 text-sm text-destructive">{error}</div>
        ) : entries.length === 0 ? (
          <div className="py-6 text-sm text-muted-foreground">
            No employee movements recorded for this day.
          </div>
        ) : (
          <ul className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
            {entries.map((e) => (
              <li key={e._id} className="border-b border-border/60 pb-2 last:border-0">
                <div className="text-sm">{e.summary}</div>
                <div className="text-xs text-muted-foreground">
                  {e.actorName} · {timeOf(e.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
