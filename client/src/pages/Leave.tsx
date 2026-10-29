// pages/Leave.tsx — the Leave page (admin + superadmin): annual leave ALLOCATIONS
// (date-range, one employee each) and leave APPLICATIONS (annual = paid, capped by the
// allocations; emergency = unpaid, no cap). Applications are editable and cancellable
// here only, and deletable once cancelled. Server: /api/attendance/leave/* (attendanceController leave section,
// leaveAllocationController, utils/leaveBalance.js).

import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react"
import toast from "react-hot-toast"

import { api } from "@/lib/api"
import { getCurrentTargetDateString } from "@/lib/dateUtils"
import {
  apiErrorMessage,
  fmtLeaveRange,
  type LeaveAllocationRow,
  type LeaveApplication,
} from "@/lib/leave"
import LeaveHistoryTable from "@/components/employee/LeaveHistoryTable"
import LeaveAllocationDialog from "@/components/leave/LeaveAllocationDialog"
import LeaveApplicationDialog from "@/components/leave/LeaveApplicationDialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import HelpButton from "@/components/help/HelpButton"

type TabId = "applications" | "allocations"
const PAGE_SIZE = 25
const ALL = "all"

interface Paged {
  total: number
  page: number
  pages: number
}

export default function Leave() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: TabId = searchParams.get("tab") === "allocations" ? "allocations" : "applications"

  return (
    <div className="min-h-screen bg-muted/30 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <Card className="rounded-3xl border bg-card p-6 shadow-sm sm:p-8">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2 text-primary">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Leave</h1>
                <HelpButton topic="leave" />
              </div>
              <p className="text-sm text-muted-foreground">
                Allocate annual leave to employees for a period, and record annual or emergency
                leave applications against it.
              </p>
            </div>
          </div>
        </Card>

        <Tabs
          value={tab}
          onValueChange={(v) => setSearchParams({ tab: v }, { replace: true })}
          className="gap-4"
        >
          <TabsList>
            <TabsTrigger value="applications">Leave applications</TabsTrigger>
            <TabsTrigger value="allocations">Leave allocations</TabsTrigger>
          </TabsList>

          <TabsContent value="applications">
            <ApplicationsTab />
          </TabsContent>
          <TabsContent value="allocations">
            <AllocationsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

// Debounced copy of a value (search boxes).
function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative w-full sm:max-w-xs">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="pl-9 pr-9"
        placeholder="Search employee name or ID"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
          onClick={() => onChange("")}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

function Pager({
  paged,
  onPage,
  noun,
}: {
  paged: Paged | null
  onPage: (page: number) => void
  noun: string
}) {
  if (!paged || paged.total === 0) return null
  return (
    <div className="flex items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
      <span>
        {paged.total} {noun}
        {paged.total === 1 ? "" : "s"}
      </span>
      {paged.pages > 1 && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="Previous page"
            disabled={paged.page <= 1}
            onClick={() => onPage(paged.page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span>
            Page {paged.page} of {paged.pages}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="Next page"
            disabled={paged.page >= paged.pages}
            onClick={() => onPage(paged.page + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

function ApplicationsTab() {
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounced(search)
  const [type, setType] = useState(ALL)
  const [status, setStatus] = useState(ALL)
  const [page, setPage] = useState(1)

  const [leaves, setLeaves] = useState<LeaveApplication[]>([])
  const [paged, setPaged] = useState<Paged | null>(null)
  const [loading, setLoading] = useState(true)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<LeaveApplication | null>(null)

  // A filter change goes back to the first page.
  useEffect(() => setPage(1), [debouncedSearch, type, status])

  // Ignore a response a newer request superseded (a filter change also resets the
  // page, which can fire two loads back to back).
  const seq = useRef(0)
  const load = useCallback(async () => {
    const mine = ++seq.current
    setLoading(true)
    try {
      const res = await api.get("/api/attendance/leave", {
        params: {
          search: debouncedSearch.trim() || undefined,
          type: type === ALL ? undefined : type,
          status: status === ALL ? undefined : status,
          page,
          limit: PAGE_SIZE,
        },
      })
      if (mine !== seq.current) return
      const data = res.data.data
      setLeaves(data?.leaves || [])
      setPaged({ total: data?.total ?? 0, page: data?.page ?? 1, pages: data?.pages ?? 1 })
    } catch (error) {
      toast.error(apiErrorMessage(error, "Failed to load leave applications"))
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [debouncedSearch, type, status, page])

  useEffect(() => {
    load()
  }, [load])

  const openNew = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (leave: LeaveApplication) => {
    setEditing(leave)
    setDialogOpen(true)
  }

  const handleCancel = async (leaveId: string) => {
    try {
      await api.patch(`/api/attendance/leave/${leaveId}/cancel`)
      toast.success("Leave cancelled")
      await load()
    } catch (error) {
      toast.error(apiErrorMessage(error, "Failed to cancel leave"))
    }
  }

  const handleDelete = async (leaveId: string) => {
    try {
      await api.delete(`/api/attendance/leave/${leaveId}`)
      toast.success("Leave application deleted")
      // The last row of a later page: step back (the page change reloads).
      if (leaves.length === 1 && page > 1) setPage(page - 1)
      else await load()
    } catch (error) {
      toast.error(apiErrorMessage(error, "Failed to delete leave"))
    }
  }

  return (
    <Card className="gap-0 overflow-hidden rounded-3xl py-0 shadow-sm">
      <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchBox value={search} onChange={setSearch} />
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-full sm:w-[150px]" aria-label="Leave type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            <SelectItem value="annual">Annual</SelectItem>
            <SelectItem value="emergency">Emergency</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-[150px]" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Button className="sm:ml-auto" onClick={openNew}>
          <Plus className="mr-2 h-4 w-4" />
          New application
        </Button>
      </div>

      {loading && leaves.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <LeaveHistoryTable
          leaves={leaves}
          showEmployee
          onEdit={openEdit}
          onCancel={handleCancel}
          onDelete={handleDelete}
          emptyText={
            debouncedSearch || type !== ALL || status !== ALL
              ? "No leave applications match these filters."
              : "No leave applications yet."
          }
        />
      )}
      <Pager paged={paged} onPage={setPage} noun="application" />

      <LeaveApplicationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        application={editing}
        onSaved={load}
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Allocations
// ---------------------------------------------------------------------------

function AllocationsTab() {
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounced(search)
  const [page, setPage] = useState(1)

  const [allocations, setAllocations] = useState<LeaveAllocationRow[]>([])
  const [paged, setPaged] = useState<Paged | null>(null)
  const [loading, setLoading] = useState(true)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<LeaveAllocationRow | null>(null)
  const [deleting, setDeleting] = useState<LeaveAllocationRow | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const today = getCurrentTargetDateString()

  useEffect(() => setPage(1), [debouncedSearch])

  // Ignore a response a newer request superseded (a filter change also resets the
  // page, which can fire two loads back to back).
  const seq = useRef(0)
  const load = useCallback(async () => {
    const mine = ++seq.current
    setLoading(true)
    try {
      const res = await api.get("/api/attendance/leave/allocations", {
        params: { search: debouncedSearch.trim() || undefined, page, limit: PAGE_SIZE },
      })
      if (mine !== seq.current) return
      const data = res.data.data
      setAllocations(data?.allocations || [])
      setPaged({ total: data?.total ?? 0, page: data?.page ?? 1, pages: data?.pages ?? 1 })
    } catch (error) {
      toast.error(apiErrorMessage(error, "Failed to load leave allocations"))
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [debouncedSearch, page])

  useEffect(() => {
    load()
  }, [load])

  const openNew = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (allocation: LeaveAllocationRow) => {
    setEditing(allocation)
    setDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      setDeleteBusy(true)
      await api.delete(`/api/attendance/leave/allocations/${deleting._id}`)
      toast.success("Allocation deleted")
      setDeleting(null)
      await load()
    } catch (error) {
      toast.error(apiErrorMessage(error, "Failed to delete allocation"))
      setDeleting(null)
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <Card className="gap-0 overflow-hidden rounded-3xl py-0 shadow-sm">
      <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center">
        <SearchBox value={search} onChange={setSearch} />
        <Button className="sm:ml-auto" onClick={openNew}>
          <Plus className="mr-2 h-4 w-4" />
          New allocation
        </Button>
      </div>

      {loading && allocations.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : allocations.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          {debouncedSearch ? "No allocations match this search." : "No leave allocations yet."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Allocated</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allocations.map((a) => {
                const isCurrent =
                  a.fromDate.slice(0, 10) <= today && today <= a.toDate.slice(0, 10)
                return (
                  <TableRow key={a._id}>
                    <TableCell>
                      <Link
                        to={`/employees/${a.employee._id}`}
                        className="font-medium hover:underline"
                      >
                        {a.employee.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {a.employee.employeeId}
                        {a.employee.jobTitle ? ` · ${a.employee.jobTitle}` : ""}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {fmtLeaveRange(a.fromDate, a.toDate)}
                      {isCurrent && (
                        <Badge
                          variant="secondary"
                          className="ml-2 border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                        >
                          Current
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{a.days}</TableCell>
                    <TableCell className="text-right">{a.used}</TableCell>
                    <TableCell className="text-right font-semibold">
                      <span className={a.remaining > 0 ? "" : "text-destructive"}>
                        {a.remaining}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[240px] whitespace-normal text-muted-foreground">
                      {a.note || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => openEdit(a)}>
                          <Pencil />
                          Edit
                        </Button>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-8 w-8"
                          aria-label="Delete allocation"
                          title={
                            a.used > 0
                              ? "Annual leave is taken against this allocation"
                              : "Delete allocation"
                          }
                          disabled={a.used > 0}
                          onClick={() => setDeleting(a)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Pager paged={paged} onPage={setPage} noun="allocation" />

      <LeaveAllocationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        allocation={editing}
        onSaved={load}
      />

      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this allocation?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && (
                <>
                  {deleting.employee.name}: {deleting.days} day(s) for{" "}
                  {fmtLeaveRange(deleting.fromDate, deleting.toDate)}. They won't be able to take
                  annual leave in this period until it's allocated again.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteBusy}
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
            >
              {deleteBusy && <Loader2 className="animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
