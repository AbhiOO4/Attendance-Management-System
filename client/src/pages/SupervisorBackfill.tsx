// SupervisorBackfill.tsx — /backfill
//
// The supervisor's backfill home: one card per day they may still backfill (yesterday back to
// N days ago — WorkSchedule.supervisorBackfillWindowDays) with that day's request status, and
// their earlier requests below (read-only). A day opens /backfill/:date.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import toast from "react-hot-toast"
import { CalendarClock, ChevronRight, History, Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { api } from "@/lib/api"
import { formatFullDateLabel } from "@/lib/dateUtils"
import { shiftDay } from "@/lib/backfillWindow"
import { onBackfillChange, STATUS_CLASS, STATUS_LABEL, type BackfillListItem } from "@/lib/backfillRequests"

type Window = { from: string; to: string; days: number }

export default function SupervisorBackfill() {
  const navigate = useNavigate()
  const [items, setItems] = useState<BackfillListItem[]>([])
  const [window_, setWindow] = useState<Window | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ data: BackfillListItem[]; window: Window }>("/api/backfill-requests", {
        params: { limit: 60 },
      })
      setItems(res.data.data)
      setWindow(res.data.window)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to load backfills")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const onUpdate = () => load()
    const off = onBackfillChange(onUpdate)
    window.addEventListener("focus", onUpdate)
    return () => {
      off()
      window.removeEventListener("focus", onUpdate)
    }
  }, [load])

  const byDate = useMemo(() => new Map(items.map((i) => [i.date, i])), [items])

  // The window's days, newest first (from the server, which owns "today").
  const days = useMemo(() => {
    if (!window_) return []
    const out: string[] = []
    for (let d = window_.to; d >= window_.from; d = shiftDay(d, -1)) out.push(d)
    return out
  }, [window_])

  const earlier = items.filter((i) => window_ && i.date < window_.from)

  return (
    <div className="px-4 py-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Backfill attendance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Forgot to mark someone? Add them for a past day, then send it to an admin for approval.
            {window_ && ` You can backfill the past ${window_.days} day${window_.days === 1 ? "" : "s"}.`}
          </p>
        </div>

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <section className="space-y-2">
              <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <CalendarClock className="h-4 w-4" /> Days you can backfill
              </h2>
              <div className="divide-y rounded-xl border bg-background">
                {days.map((d) => (
                  <DayRow key={d} date={d} item={byDate.get(d)} onOpen={() => navigate(`/backfill/${d}`)} />
                ))}
              </div>
            </section>

            {earlier.length > 0 && (
              <section className="space-y-2">
                <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  <History className="h-4 w-4" /> Earlier backfills
                </h2>
                <div className="divide-y rounded-xl border bg-background">
                  {earlier.map((i) => (
                    <DayRow key={i._id} date={i.date} item={i} onOpen={() => navigate(`/backfill/${i.date}`)} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function DayRow({ date, item, onOpen }: { date: string; item?: BackfillListItem; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{formatFullDateLabel(date)}</p>
        <p className="text-xs text-muted-foreground">
          {item
            ? `${item.rowCount} employee${item.rowCount === 1 ? "" : "s"}` +
              (item.status === "rejected" && item.rejectionReason ? ` · ${item.rejectionReason}` : "")
            : "Nothing backfilled"}
        </p>
      </div>
      {item && <Badge className={STATUS_CLASS[item.status]}>{STATUS_LABEL[item.status]}</Badge>}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  )
}
