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

import { useEffect, useMemo, useState } from "react"
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
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { ArrowLeft, Loader2, ListChecks, UserPlus, X } from "lucide-react"

import { getCurrentTargetDateString } from "@/lib/dateUtils"
import BackfillModal, { type MissingEmployee } from "@/components/BackfillModal"
import BulkBackfillModal, { type BulkBackfillResult } from "@/components/BulkBackfillModal"

type Job = { _id: string; name: string }
type Site = { _id: string; siteName: string; jobs: Job[] }

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)

  const fetchSites = async () => {
    try {
      const res = await api.get("/api/site")
      setSites(res.data || [])
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

  // Any change to the date or filters reloads the list and clears the selection, so
  // "select all (loaded)" always refers to exactly what is on screen.
  useEffect(() => {
    fetchMissing()
    setSelectedIds(new Set())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, filters])

  // On single backfill, drop the row and decrement the count in place.
  const handleBackfillCreated = (newRecord: any) => {
    setEmployees((prev) => prev.filter((e) => e._id !== newRecord.employee?.toString()))
    setTotalCount((prev) => Math.max(prev - 1, 0))
  }

  const handleBulkCompleted = (_result: BulkBackfillResult) => {
    // Created employees now have a record → refetch removes them; skipped/failed remain.
    setSelectedIds(new Set())
    setSelectionMode(false)
    fetchMissing()
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allLoadedSelected =
    employees.length > 0 && employees.every((e) => selectedIds.has(e._id))

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (allLoadedSelected) {
        // Deselect the loaded rows only.
        const next = new Set(prev)
        employees.forEach((e) => next.delete(e._id))
        return next
      }
      const next = new Set(prev)
      employees.forEach((e) => next.add(e._id))
      return next
    })
  }

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  const selectedEmployees = useMemo(
    () => employees.filter((e) => selectedIds.has(e._id)),
    [employees, selectedIds]
  )

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
            <h1 className="text-2xl font-semibold tracking-tight">
              Missing Employees
            </h1>
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
              {sites.map((site) => (
                <SelectItem key={site._id} value={site._id}>
                  {site.siteName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Bulk selection toolbar */}
        {selectionMode && (
          <div className="sticky top-2 z-10 flex items-center justify-between rounded-lg border bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={allLoadedSelected}
                onCheckedChange={toggleSelectAll}
                disabled={employees.length === 0}
              />
              Select all ({employees.length})
            </label>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {selectedIds.size} selected
              </span>
              <Button
                size="sm"
                disabled={selectedIds.size === 0}
                onClick={() => setBulkOpen(true)}
              >
                Backfill selected
              </Button>
            </div>
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
              const checked = selectedIds.has(emp._id)
              return (
                <div
                  key={emp._id}
                  className={`flex items-center justify-between gap-3 px-4 py-3 ${
                    selectionMode ? "cursor-pointer hover:bg-muted/40" : ""
                  } ${checked ? "bg-primary/5" : ""}`}
                  onClick={selectionMode ? () => toggleSelect(emp._id) : undefined}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {selectionMode && (
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleSelect(emp._id)}
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
