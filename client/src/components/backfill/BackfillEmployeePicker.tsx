// BackfillEmployeePicker.tsx
//
// Pick the employees a supervisor backfills for a past day
// (GET /api/backfill-requests/candidates). A current-site filter alone would miss anyone
// moved since the missed day, so it shows three tiers:
//   1. On your site now        — loaded on open
//   2. Recently at your site   — worked here around that day, now elsewhere; loaded on open
//   3. Search all employees    — everyone else, lazy-loaded by name / ID, page by page
// Everyone listed has no record that day and isn't in another open backfill. Selections are
// kept across tiers and searches.

import { useEffect, useMemo, useRef, useState } from "react"
import toast from "react-hot-toast"
import { History, Loader2, MapPin, Search, Users } from "lucide-react"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import type { CandidateEmployee } from "@/lib/backfillRequests"

type Group = { key: string; title: string; icon: typeof Users; items: CandidateEmployee[]; empty: string }

export default function BackfillEmployeePicker({
  open,
  onClose,
  siteId,
  siteName,
  date,
  onContinue,
}: {
  open: boolean
  onClose: () => void
  siteId: string
  siteName: string
  date: string
  onContinue: (employees: CandidateEmployee[]) => void
}) {
  const [siteTier, setSiteTier] = useState<CandidateEmployee[]>([])
  const [recentTier, setRecentTier] = useState<CandidateEmployee[]>([])
  const [loading, setLoading] = useState(false)

  const [query, setQuery] = useState("")
  const [results, setResults] = useState<CandidateEmployee[]>([])
  const [searchPage, setSearchPage] = useState(1)
  const [searchPages, setSearchPages] = useState(0)
  const [searching, setSearching] = useState(false)
  const searchSeq = useRef(0)

  const [selected, setSelected] = useState<Map<string, CandidateEmployee>>(new Map())

  useEffect(() => {
    if (!open) return
    setSelected(new Map())
    setQuery("")
    setResults([])
    setSearchPages(0)
    setLoading(true)
    const params = { siteId, date }
    Promise.all([
      api.get<{ data: CandidateEmployee[] }>("/api/backfill-requests/candidates", { params: { ...params, tier: "site" } }),
      api.get<{ data: CandidateEmployee[] }>("/api/backfill-requests/candidates", { params: { ...params, tier: "recent" } }),
    ])
      .then(([site, recent]) => {
        setSiteTier(site.data.data || [])
        setRecentTier(recent.data.data || [])
      })
      .catch((err) => toast.error(err?.response?.data?.message || "Failed to load employees"))
      .finally(() => setLoading(false))
  }, [open, siteId, date])

  const runSearch = async (q: string, page: number, seq = searchSeq.current) => {
    setSearching(true)
    try {
      const res = await api.get<{ data: CandidateEmployee[]; pagination: { page: number; totalPages: number } }>(
        "/api/backfill-requests/candidates",
        { params: { siteId, date, tier: "search", q, page } }
      )
      if (seq !== searchSeq.current) return
      setResults((prev) => (page === 1 ? res.data.data : [...prev, ...res.data.data]))
      setSearchPage(page)
      setSearchPages(res.data.pagination?.totalPages || 0)
    } catch (err: any) {
      if (seq === searchSeq.current) toast.error(err?.response?.data?.message || "Search failed")
    } finally {
      if (seq === searchSeq.current) setSearching(false)
    }
  }

  // Debounced search; a newer query wins over a slower older response.
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length < 2) {
      searchSeq.current++
      setResults([])
      setSearchPages(0)
      return
    }
    const seq = ++searchSeq.current
    const t = window.setTimeout(() => runSearch(q, 1, seq), 300)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open])

  // People already shown in tiers 1–2 aren't repeated in the search results.
  const shownIds = useMemo(() => new Set([...siteTier, ...recentTier].map((e) => e._id)), [siteTier, recentTier])
  const searchItems = results.filter((e) => !shownIds.has(e._id))

  const toggle = (emp: CandidateEmployee) =>
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(emp._id)) next.delete(emp._id)
      else next.set(emp._id, emp)
      return next
    })

  const toggleAll = (items: CandidateEmployee[]) =>
    setSelected((prev) => {
      const next = new Map(prev)
      const all = items.every((e) => next.has(e._id))
      for (const e of items) {
        if (all) next.delete(e._id)
        else next.set(e._id, e)
      }
      return next
    })

  const groups: Group[] = [
    { key: "site", title: `On ${siteName} now`, icon: MapPin, items: siteTier, empty: "Everyone on your site has a record for this day." },
    { key: "recent", title: "Recently at your site", icon: History, items: recentTier, empty: "Nobody else worked here around this day." },
  ]

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="!w-[95vw] !max-w-[560px] max-h-[90vh] overflow-hidden p-0 flex flex-col rounded-2xl">
        <div className="border-b px-5 py-4 sm:px-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Select employees</DialogTitle>
          </DialogHeader>
          <p className="mt-1 text-sm text-muted-foreground">
            Only people with no record for this day are listed.
          </p>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 sm:px-6">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.key} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 text-sm font-medium">
                    <g.icon className="h-4 w-4 text-muted-foreground" />
                    {g.title}
                    <span className="text-xs font-normal text-muted-foreground">({g.items.length})</span>
                  </h3>
                  {g.items.length > 0 && (
                    <button type="button" className="text-xs text-primary hover:underline" onClick={() => toggleAll(g.items)}>
                      {g.items.every((e) => selected.has(e._id)) ? "Clear all" : "Select all"}
                    </button>
                  )}
                </div>
                {g.items.length === 0 ? (
                  <p className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">{g.empty}</p>
                ) : (
                  <EmployeeList items={g.items} selected={selected} onToggle={toggle} showSite={g.key !== "site"} />
                )}
              </section>
            ))
          )}

          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-medium">
              <Search className="h-4 w-4 text-muted-foreground" />
              Search all employees
            </h3>
            <Input
              placeholder="Name or employee ID (2+ letters)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10"
            />
            {query.trim().length >= 2 && (
              searching && results.length === 0 ? (
                <div className="flex h-16 items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : searchItems.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">No other employee matches.</p>
              ) : (
                <>
                  <EmployeeList items={searchItems} selected={selected} onToggle={toggle} showSite />
                  {searchPage < searchPages && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={searching}
                      onClick={() => runSearch(query.trim(), searchPage + 1)}
                    >
                      {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Load more"}
                    </Button>
                  )}
                </>
              )
            )}
          </section>
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-5 py-3 sm:px-6">
          <span className="text-sm text-muted-foreground">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" disabled={selected.size === 0} onClick={() => onContinue([...selected.values()])}>
              Continue
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EmployeeList({
  items,
  selected,
  onToggle,
  showSite,
}: {
  items: CandidateEmployee[]
  selected: Map<string, CandidateEmployee>
  onToggle: (e: CandidateEmployee) => void
  showSite: boolean
}) {
  return (
    <div className="divide-y rounded-lg border">
      {items.map((emp) => {
        const checked = selected.has(emp._id)
        return (
          <div
            key={emp._id}
            className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/40 ${checked ? "bg-primary/5" : ""}`}
            onClick={() => onToggle(emp)}
          >
            <Checkbox checked={checked} onCheckedChange={() => onToggle(emp)} onClick={(e) => e.stopPropagation()} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{emp.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {emp.employeeId} · <span className="capitalize">{emp.jobTitle}</span>
                {showSite && ` · ${emp.currentSite?.siteName ? `now at ${emp.currentSite.siteName}` : "no site"}`}
                {emp.lastSeenHere && ` · last here ${emp.lastSeenHere}`}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
