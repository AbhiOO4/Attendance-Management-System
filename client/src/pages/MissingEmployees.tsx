// MissingEmployees.tsx
//
// Standalone page listing employees with NO attendance record for a given date,
// each with a one-click Backfill. Opened from the Edit Attendance header link
// (`/attendance/edit/missing?date=YYYY-MM-DD`). Kept deliberately minimal — a
// plain list rather than a full table — and lives on its own page so Backfill
// opens over a page instead of stacking modal-on-modal.

import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import toast from "react-hot-toast"
import { useNavigate, useSearchParams } from "react-router-dom"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { ArrowLeft, Loader2, UserPlus } from "lucide-react"

import { getCurrentTargetDateString } from "@/lib/dateUtils"
import BackfillModal, { type MissingEmployee } from "@/components/BackfillModal"

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
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({
    name: "",
    employeeId: "",
    jobTitle: "",
    page: 1,
    limit: 10,
  })
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  const [backfillEmployee, setBackfillEmployee] = useState<MissingEmployee | null>(null)
  const [backfillOpen, setBackfillOpen] = useState(false)

  const fetchMissing = async () => {
    try {
      setLoading(true)
      const res = await api.get("/api/attendance/missing", {
        params: {
          date,
          name: filters.name || undefined,
          employeeId: filters.employeeId || undefined,
          jobTitle: filters.jobTitle || undefined,
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
    fetchMissing()
  }, [date, filters])

  // On backfill, drop the row and decrement the count in place.
  const handleBackfillCreated = (newRecord: any) => {
    setEmployees((prev) => prev.filter((e) => e._id !== newRecord.employee?.toString()))
    setTotalCount((prev) => Math.max(prev - 1, 0))
  }

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
          {totalCount > 0 && (
            <Badge variant="secondary" className="shrink-0">
              {totalCount} missing
            </Badge>
          )}
        </div>

        {/* Filters */}
        <div className="grid gap-2 sm:grid-cols-3">
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
        </div>

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
            employees.map((emp) => (
              <div
                key={emp._id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{emp.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {emp.employeeId} · <span className="capitalize">{emp.jobTitle}</span>
                    {emp.currentSite?.siteName ? ` · ${emp.currentSite.siteName}` : ""}
                  </p>
                </div>
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
              </div>
            ))
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
    </div>
  )
}

export default MissingEmployees
