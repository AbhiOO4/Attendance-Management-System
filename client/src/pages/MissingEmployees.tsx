// MissingEmployees.tsx
//
// Standalone page listing employees with NO attendance record for a given date. Opened
// from the Edit Attendance header link (`/attendance/edit/missing?date=YYYY-MM-DD`).
//
// Two ways to backfill:
//  - Single: each row's Backfill button opens the per-employee BackfillModal.
//  - Bulk: the "Bulk Backfill" button enters selection mode (checkboxes on each row, a
//    site filter to narrow by currentSite). Selecting employees + "Backfill selected"
//    opens BulkBackfillModal, which applies one common site/job + check-in/out to all.
//    The selection persists across search / filter / page changes (cleared on date change)
//    and is listed as removable chips in the toolbar so hidden picks stay visible.
//    A selection is ALL drivers or ALL workers: the first pick locks the group (drivers'
//    hours are split across a site's jobs on the Drivers pool, workers take one site/job),
//    rows of the other group can't be ticked until the selection is cleared.

import { Fragment, useEffect, useMemo, useState } from "react"
import { api } from "@/lib/api"
import toast from "react-hot-toast"
import { useNavigate, useSearchParams } from "react-router-dom"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { ArrowLeft, Loader2, ListChecks, Truck, UserPlus, X } from "lucide-react"

import { getCurrentTargetDateString } from "@/lib/dateUtils"
import { fetchSitesWithDriverPool, isDriverTitle } from "@/lib/driverJobs"
import BackfillModal, { type MissingEmployee } from "@/components/BackfillModal"
import BulkBackfillModal, { type BulkBackfillResult } from "@/components/BulkBackfillModal"
import type { PickerSite } from "@/components/SessionSiteJobFields"
import HelpButton from "@/components/help/HelpButton"
import SelectionChips from "@/components/SelectionChips"

type Site = PickerSite

// Bulk backfill groups — never mixed in one selection (see header).
type BulkGroup = "drivers" | "workers"
const groupOf = (emp: MissingEmployee): BulkGroup =>
  isDriverTitle(emp.jobTitle) ? "drivers" : "workers"
// The group a selection is locked to (all members share it), or null when empty.
const groupOfSelection = (sel: Map<string, MissingEmployee>): BulkGroup | null => {
  const first = sel.values().next().value
  return first ? groupOf(first) : null
}

function MissingEmployees() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const todayDateString = getCurrentTargetDateString()

  // Date arrives as ?date=YYYY-MM-DD from the Edit Attendance page; clamp to today.
  const paramDate = searchParams.get("date")
  const date =
    paramDate && paramDate <= todayDateString ? paramDate : todayDateString

  const formattedDate = new Date(date).toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  const [employees, setEmployees] = useState<MissingEmployee[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({
    name: "",
    employeeId: "",
    jobTitle: "",
    site: "all",
    page: 1,
    limit: 10,
  })
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  // Single backfill
  const [backfillEmployee, setBackfillEmployee] = useState<MissingEmployee | null>(null)
  const [backfillOpen, setBackfillOpen] = useState(false)

  // Bulk backfill
  const [selectionMode, setSelectionMode] = useState(false)
  // Selected employees keyed by _id. Full objects (not just ids) so a selection survives
  // searching / filtering / paging — rows hidden by the current filter still reach the modal.
  const [selected, setSelected] = useState<Map<string, MissingEmployee>>(new Map())
  const [bulkOpen, setBulkOpen] = useState(false)

  const fetchSites = async () => {
    try {
      // With the Drivers pool: a filter option here, and a place in the backfill dialogs.
      setSites(await fetchSitesWithDriverPool<Site>())
    } catch (error) {
      console.log(error)
    }
  }

  const fetchMissing = async () => {
    try {
      setLoading(true)
      const res = await api.get("/api/attendance/missing", {
        params: {
          date,
          name: filters.name || undefined,
          employeeId: filters.employeeId || undefined,
          jobTitle: filters.jobTitle || undefined,
          site: filters.site === "all" ? undefined : filters.site,
          page: filters.page,
          limit: filters.limit,
        },
      })
      setEmployees(res.data.data)
      setTotalPages(res.data.pagination.totalPages)
      setTotalCount(res.data.pagination.totalEmployees)
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to fetch missing employees")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSites()
  }, [])

  // Any change to the date or filters reloads the list. The selection persists across
  // search / filter / page changes; it is only cleared when the date changes (a different
  // day has a different missing list).
  useEffect(() => {
    fetchMissing()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, filters])

  useEffect(() => {
    setSelected(new Map())
  }, [date])

  // On single backfill, drop the row and decrement the count in place.
  const handleBackfillCreated = (newRecord: any) => {
    const employeeId = newRecord.employee?.toString()
    setEmployees((prev) => prev.filter((e) => e._id !== employeeId))
    setTotalCount((prev) => Math.max(prev - 1, 0))
    setSelected((prev) => {
      if (!prev.has(employeeId)) return prev
      const next = new Map(prev)
      next.delete(employeeId)
      return next
    })
  }

  const handleBulkCompleted = (_result: BulkBackfillResult) => {
    // Created employees now have a record → refetch removes them; skipped/failed remain.
    setSelected(new Map())
    setSelectionMode(false)
    fetchMissing()
  }

  const toggleSelect = (emp: MissingEmployee) => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(emp._id)) next.delete(emp._id)
      // Locked to the first pick's group — the other group's rows are disabled anyway.
      else if (groupOfSelection(prev) && groupOfSelection(prev) !== groupOf(emp)) return prev
      else next.set(emp._id, emp)
      return next
    })
  }

  const removeSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }

  // The selection's group; with nothing picked yet, "Select all" follows the first shown row.
  const selectedGroup = groupOfSelection(selected)
  const selectAllGroup: BulkGroup | null = selectedGroup ?? (employees[0] ? groupOf(employees[0]) : null)
  const selectableShown = useMemo(
    () => employees.filter((e) => groupOf(e) === selectAllGroup),
    [employees, selectAllGroup]
  )
  const isLockedOut = (emp: MissingEmployee) => !!selectedGroup && groupOf(emp) !== selectedGroup

  const allLoadedSelected =
    selectableShown.length > 0 && selectableShown.every((e) => selected.has(e._id))

  // "Select all" adds / removes only the rows currently shown; selections made under
  // other filters are left untouched — and only those of the selection's group.
  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (allLoadedSelected) selectableShown.forEach((e) => next.delete(e._id))
      else selectableShown.forEach((e) => next.set(e._id, e))
      return next
    })
  }

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelected(new Map())
  }

  const selectedEmployees = useMemo(() => Array.from(selected.values()), [selected])
  const hiddenSelectedCount = useMemo(() => {
    const shown = new Set(employees.map((e) => e._id))
    return selectedEmployees.filter((e) => !shown.has(e._id)).length
  }, [employees, selectedEmployees])

  return (
    <div className="px-4 py-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 w-fit text-muted-foreground"
          onClick={() => navigate(`/attendance/edit?date=${date}`)}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to attendance
        </Button>

        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                Missing Employees
              </h1>
              <HelpButton topic="past-attendance" />
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              No attendance record for {formattedDate}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {totalCount > 0 && (
              <Badge variant="secondary" className="shrink-0">
                {totalCount} missing
              </Badge>
            )}
            {selectionMode ? (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={exitSelectionMode}>
                <X className="h-3.5 w-3.5" />
                Cancel
              </Button>
            ) : (
              <Button size="sm" className="gap-1.5" onClick={() => setSelectionMode(true)}>
                <ListChecks className="h-3.5 w-3.5" />
                Bulk Backfill
              </Button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="grid gap-2 sm:grid-cols-4">
          <Input
            placeholder="Name"
            value={filters.name}
            onChange={(e) => setFilters({ ...filters, name: e.target.value, page: 1 })}
          />
          <Input
            placeholder="Employee ID"
            value={filters.employeeId}
            onChange={(e) => setFilters({ ...filters, employeeId: e.target.value, page: 1 })}
          />
          <Input
            placeholder="Job Title"
            value={filters.jobTitle}
            onChange={(e) => setFilters({ ...filters, jobTitle: e.target.value, page: 1 })}
          />
          <Select
            value={filters.site}
            onValueChange={(value) => setFilters({ ...filters, site: value, page: 1 })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Site" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sites</SelectItem>
              {sites.filter((site) => !site.isDriverPool).map((site) => (
                <SelectItem key={site._id} value={site._id}>
                  {site.siteName}
                </SelectItem>
              ))}
              {/* Drivers (no site) — the drivers roster, whose records sit on the pool. */}
              {sites.filter((site) => site.isDriverPool).map((site) => (
                <Fragment key={site._id}>
                  <SelectSeparator />
                  <SelectItem value={site._id}>
                    <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                    Drivers
                  </SelectItem>
                </Fragment>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Bulk selection toolbar */}
        {selectionMode && (
          <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-y-2 rounded-lg border bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={allLoadedSelected}
                onCheckedChange={toggleSelectAll}
                disabled={selectableShown.length === 0}
              />
              Select all shown ({selectableShown.length}
              {selectAllGroup && selectableShown.length < employees.length
                ? ` ${selectAllGroup}`
                : ""}
              )
            </label>
            <div className="flex items-center gap-3">
              {selectedGroup && (
                <Badge variant="secondary" className="gap-1 font-normal">
                  {selectedGroup === "drivers" && <Truck className="h-3 w-3" />}
                  {selectedGroup === "drivers" ? "Drivers only" : "Workers only"}
                </Badge>
              )}
              <span className="text-sm text-muted-foreground">
                {selected.size} selected
                {hiddenSelectedCount > 0 && ` · ${hiddenSelectedCount} not shown`}
              </span>
              <Button
                size="sm"
                disabled={selected.size === 0}
                onClick={() => setBulkOpen(true)}
              >
                Backfill selected
              </Button>
            </div>
            <SelectionChips
              items={selectedEmployees.map((e) => ({ id: e._id, label: e.name, sublabel: e.employeeId }))}
              onRemove={removeSelected}
              onClear={() => setSelected(new Map())}
            />
          </div>
        )}

        {/* List */}
        <div className="min-h-[160px] divide-y rounded-lg border">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : employees.length === 0 ? (
            <div className="flex h-40 items-center justify-center px-4 text-center text-sm text-muted-foreground">
              🎉 Everyone has a record for this date
            </div>
          ) : (
            employees.map((emp) => {
              const checked = selected.has(emp._id)
              // In selection mode, rows of the other group than the selection's are locked out.
              const lockedOut = selectionMode && isLockedOut(emp)
              return (
                <div
                  key={emp._id}
                  className={`flex items-center justify-between gap-3 px-4 py-3 ${
                    lockedOut
                      ? "cursor-not-allowed opacity-50"
                      : selectionMode
                        ? "cursor-pointer hover:bg-muted/40"
                        : ""
                  } ${checked ? "bg-primary/5" : ""}`}
                  onClick={selectionMode && !lockedOut ? () => toggleSelect(emp) : undefined}
                  title={
                    lockedOut
                      ? selectedGroup === "drivers"
                        ? "Workers are backfilled separately — clear the selection to pick workers"
                        : "Drivers are backfilled separately — clear the selection to pick drivers"
                      : undefined
                  }
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {selectionMode && (
                      <Checkbox
                        checked={checked}
                        disabled={lockedOut}
                        onCheckedChange={() => toggleSelect(emp)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium">{emp.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {emp.employeeId} · <span className="capitalize">{emp.jobTitle}</span>
                        {emp.currentSite?.siteName ? ` · ${emp.currentSite.siteName}` : ""}
                      </p>
                    </div>
                  </div>
                  {!selectionMode && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 gap-1.5"
                      onClick={() => {
                        setBackfillEmployee(emp)
                        setBackfillOpen(true)
                      }}
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Backfill
                    </Button>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={filters.page <= 1}
            onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
          >
            Previous
          </Button>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              Page {filters.page} of {totalPages}
            </span>
            <Select
              value={String(filters.limit)}
              onValueChange={(value) => setFilters((f) => ({ ...f, limit: Number(value), page: 1 }))}
            >
              <SelectTrigger className="w-[72px]" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={filters.page >= totalPages}
            onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
          >
            Next
          </Button>
        </div>
      </div>

      <BackfillModal
        open={backfillOpen}
        onClose={() => {
          setBackfillOpen(false)
          setBackfillEmployee(null)
        }}
        employee={backfillEmployee}
        date={date}
        onCreated={handleBackfillCreated}
      />

      <BulkBackfillModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        date={date}
        employees={selectedEmployees}
        sites={sites}
        onCompleted={handleBulkCompleted}
      />
    </div>
  )
}

export default MissingEmployees
