// SiteManpowerReport.tsx
//
// Admin "Manpower" report on the Site Detail page: how many of each trade (welders,
// fitters, …) are on the site today, split into present / absent / on leave once today's
// attendance is saved. A header button opens a dialog that fetches
// GET /api/site/:siteId/manpower on open (a point-in-time snapshot — Refresh re-takes it)
// and can export the same snapshot to Excel or PDF (lib/manpowerExport.ts).

import { Fragment, useState } from "react"
import axios from "axios"
import toast from "react-hot-toast"
import {
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  HardHat,
  Loader2,
  Plane,
  RefreshCw,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api } from "@/lib/api"
import { CATEGORY_IS_FOREIGN, CATEGORY_LABELS } from "@/lib/rosterUtils"
import {
  NOT_SAVED_NOTE,
  STATUS_LABELS,
  employeesByTrade,
  exportManpowerExcel,
  exportManpowerPdf,
  formatGeneratedAt,
  formatReportDate,
  manpowerColumns,
  tradeLabel,
  type ManpowerCounts,
  type ManpowerReport,
  type ManpowerStatus,
} from "@/lib/manpowerExport"

interface Props {
  siteId: string
  className?: string
}

const STATUS_CLASSES: Record<ManpowerStatus, string> = {
  present: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  absent: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  leave: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  emergency: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  sick: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  notMarked: "bg-muted text-muted-foreground",
}

// Tone of each count column's number (roster stays neutral).
const COUNT_CLASSES: Partial<Record<keyof ManpowerCounts, string>> = {
  present: "text-emerald-600 dark:text-emerald-400",
  absent: "text-red-600 dark:text-red-400",
  leave: "text-amber-600 dark:text-amber-400",
  notMarked: "text-muted-foreground",
}

export default function SiteManpowerReport({ siteId, className }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<ManpowerReport | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get(`/api/site/${siteId}/manpower`)
      setReport(res.data?.data ?? null)
    } catch (err) {
      setError(
        axios.isAxiosError(err)
          ? ((err.response?.data as { message?: string } | undefined)?.message ?? "Failed to load manpower report")
          : "Failed to load manpower report"
      )
    } finally {
      setLoading(false)
    }
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setExpanded(new Set())
      load()
    }
  }

  const toggleTrade = (jobTitle: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(jobTitle)) next.delete(jobTitle)
      else next.add(jobTitle)
      return next
    })
  }

  const runExport = async (kind: "excel" | "pdf") => {
    if (!report) return
    setExporting(kind)
    try {
      await (kind === "excel" ? exportManpowerExcel(report) : exportManpowerPdf(report))
      toast.success(kind === "excel" ? "Excel report downloaded" : "PDF report downloaded")
    } catch (err) {
      console.log(err)
      toast.error("Failed to export the manpower report")
    } finally {
      setExporting(null)
    }
  }

  const cols = report ? manpowerColumns(report) : []
  const groups = report ? employeesByTrade(report) : []
  const empty = !!report && report.totals.roster === 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={className}>
          <HardHat className="h-4 w-4" />
          Manpower
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] flex-col gap-3 sm:max-w-2xl">
        <DialogHeader className="pr-8">
          <DialogTitle>Manpower · {report?.site.siteName ?? "Site"}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {report ? (
              <span>
                {formatReportDate(report.date)} · as of {formatGeneratedAt(report.generatedAt)}
              </span>
            ) : (
              <span>Today's headcount by trade</span>
            )}
            <Button
              variant="ghost"
              size="xs"
              onClick={load}
              disabled={loading}
              aria-label="Refresh manpower report"
            >
              <RefreshCw className={loading ? "animate-spin" : undefined} />
              Refresh
            </Button>
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-4 min-h-0 flex-1 space-y-4 overflow-y-auto px-4">
          {loading && !report ? (
            <div className="flex items-center gap-2 py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : error ? (
            <div className="py-6 text-sm text-destructive">{error}</div>
          ) : !report ? null : empty ? (
            <div className="py-6 text-sm text-muted-foreground">
              No one is on this site's roster today.
            </div>
          ) : (
            <>
              {!report.attendanceSaved && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                  {NOT_SAVED_NOTE}
                </div>
              )}

              {/* Totals */}
              <div className="flex flex-wrap gap-2">
                {cols.map((c) => (
                  <div
                    key={c.key}
                    className="inline-flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5"
                  >
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {c.label}
                    </span>
                    <span className={`text-sm font-bold tabular-nums ${COUNT_CLASSES[c.key] ?? ""}`}>
                      {report.totals[c.key]}
                    </span>
                  </div>
                ))}
              </div>

              {/* By trade — tap a row for its names */}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">By trade</h3>
                <Table wrapperClassName="rounded-lg border">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Trade</TableHead>
                      {cols.map((c) => (
                        <TableHead key={c.key} className="text-center">
                          {c.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map(({ trade, employees }) => {
                      const isOpen = expanded.has(trade.jobTitle)
                      return (
                        <Fragment key={trade.jobTitle}>
                          <TableRow
                            className="cursor-pointer"
                            onClick={() => toggleTrade(trade.jobTitle)}
                            aria-expanded={isOpen}
                          >
                            <TableCell className="font-medium">
                              <span className="inline-flex items-center gap-1">
                                {isOpen ? (
                                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                )}
                                {tradeLabel(trade.jobTitle)}
                              </span>
                            </TableCell>
                            {cols.map((c) => (
                              <TableCell
                                key={c.key}
                                className={`text-center tabular-nums ${trade[c.key] ? COUNT_CLASSES[c.key] ?? "" : "text-muted-foreground/50"}`}
                              >
                                {trade[c.key]}
                              </TableCell>
                            ))}
                          </TableRow>
                          {isOpen && (
                            <TableRow className="hover:bg-transparent">
                              <TableCell colSpan={cols.length + 1} className="bg-muted/30 p-0">
                                <ul className="divide-y divide-border/60">
                                  {employees.map((e) => (
                                    <li
                                      key={e._id}
                                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 text-xs"
                                    >
                                      <span className="min-w-0">
                                        <span className="font-medium text-foreground">{e.name}</span>
                                        <span className="ml-1.5 text-muted-foreground">{e.employeeId}</span>
                                        {e.isVisitor && (
                                          <span className="ml-1.5 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                                            Visiting
                                          </span>
                                        )}
                                        {e.jobName && (
                                          <span className="block text-muted-foreground">{e.jobName}</span>
                                        )}
                                      </span>
                                      <span
                                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASSES[e.status]}`}
                                      >
                                        {STATUS_LABELS[e.status]}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      )
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold">Total</TableCell>
                      {cols.map((c) => (
                        <TableCell key={c.key} className="text-center font-semibold tabular-nums">
                          {report.totals[c.key]}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableFooter>
                </Table>
              </section>

              {/* By roster category */}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">By category</h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {report.categories.map((c) => (
                    <div key={c.category} className="rounded-lg border bg-muted/40 px-3 py-2">
                      <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        {CATEGORY_IS_FOREIGN[c.category] && (
                          <Plane className="h-3 w-3 shrink-0" aria-label="Foreign" />
                        )}
                        {CATEGORY_LABELS[c.category]}
                      </div>
                      <div className="text-lg font-bold tabular-nums">{c.roster}</div>
                      {report.attendanceSaved && c.roster > 0 && (
                        <div className="text-[11px] text-muted-foreground">
                          {c.present} present · {c.absent} absent
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => runExport("excel")}
            disabled={!report || empty || loading || exporting !== null}
          >
            {exporting === "excel" ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
            Export Excel
          </Button>
          <Button
            variant="outline"
            onClick={() => runExport("pdf")}
            disabled={!report || empty || loading || exporting !== null}
          >
            {exporting === "pdf" ? <Loader2 className="animate-spin" /> : <FileText />}
            Export PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
