// pages/ActivityTypes.tsx — ERPNext activity types (costing/billing rate bands) and their
// allocation to employees. Superadmin only. Server: utils/activityTypes.js, routes under
// /api/activity-types. The ERPNext timesheet export stamps each employee's allocated type
// (and its automatic "- Overtime" twin) on their time-logs.

import { useEffect, useMemo, useState } from "react"
import { Download, Loader2, Pencil, Plus, Search, Tags, Trash2, X } from "lucide-react"
import toast from "react-hot-toast"
import { isAxiosError } from "axios"
import { saveAs } from "file-saver"

import { api } from "@/lib/api"
import {
  ACTIVITY_NAME_MAX,
  DEFAULT_OVERTIME_MULTIPLIER,
  type ActivityType,
  formatRate,
  hasOvertimeSuffix,
  OVERTIME_SUFFIX,
  overtimeNameFor,
  round3,
} from "@/lib/activityTypes"
import {
  CATEGORY_LABELS,
  categoryOf,
  type CollarType,
  type Nationality,
  type RosterCategory,
} from "@/lib/rosterUtils"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import HelpButton from "@/components/help/HelpButton"

interface Site {
  _id: string
  siteName: string
}

interface Employee {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
  currentSite: string | null
  collarType?: CollarType
  nationality?: Nationality
  activityType: { _id: string; name: string } | null
}

interface EmployeesResponse {
  employees: Employee[]
  totalEmployees: number
}

// The server's `message` for a failed request, else `fallback`.
const apiMessage = (error: unknown, fallback: string) =>
  (isAxiosError<{ message?: string }>(error) && error.response?.data?.message) || fallback

const PAGE_SIZE = 25
const ALL = "all"

const CATEGORY_FILTER: Record<RosterCategory, { collarType: CollarType; nationality: Nationality }> = {
  foreignSkilled: { collarType: "skilled", nationality: "foreign" },
  foreignStaff: { collarType: "staff", nationality: "foreign" },
  omaniSkilled: { collarType: "skilled", nationality: "omani" },
  omaniStaff: { collarType: "staff", nationality: "omani" },
}

type RateForm = { name: string; costingRate: string; billingRate: string }
const EMPTY_FORM: RateForm = { name: "", costingRate: "", billingRate: "" }

// A rate input → a number ≥ 0, or null when blank/invalid.
const parseRate = (value: string): number | null => {
  if (value.trim() === "") return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function ActivityTypes() {
  const [types, setTypes] = useState<ActivityType[]>([])
  const [multiplier, setMultiplier] = useState(DEFAULT_OVERTIME_MULTIPLIER)
  const [loadingTypes, setLoadingTypes] = useState(true)

  // Create / edit rates (editing = the type whose rates are edited; its name is fixed)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ActivityType | null>(null)
  const [form, setForm] = useState<RateForm>(EMPTY_FORM)
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)

  // Delete
  const [typeToDelete, setTypeToDelete] = useState<ActivityType | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [exporting, setExporting] = useState(false)

  // Allocation list
  const [sites, setSites] = useState<Site[]>([])
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [siteFilter, setSiteFilter] = useState(ALL)
  const [categoryFilter, setCategoryFilter] = useState<RosterCategory | "">("")
  const [activityFilter, setActivityFilter] = useState(ALL)

  // Picked employees (Mongo _ids). Deliberately survives filter and page changes so a group
  // can be built across several searches.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectingAll, setSelectingAll] = useState(false)
  const [targetTypeId, setTargetTypeId] = useState("")
  const [allocating, setAllocating] = useState(false)

  // Bumped to refetch the types / the employee list after a change.
  const [typesRev, setTypesRev] = useState(0)
  const [employeesRev, setEmployeesRev] = useState(0)
  const reloadTypes = () => setTypesRev((r) => r + 1)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ data: ActivityType[]; multiplier: number }>("/api/activity-types")
      .then((res) => {
        if (cancelled) return
        setTypes(res.data.data || [])
        setMultiplier(res.data.multiplier ?? DEFAULT_OVERTIME_MULTIPLIER)
      })
      .catch((error) => {
        console.log(error)
        if (!cancelled) toast.error("Failed to load activity types")
      })
      .finally(() => {
        if (!cancelled) setLoadingTypes(false)
      })
    return () => {
      cancelled = true
    }
  }, [typesRev])

  // The list filters as /api/employees params (shared by the paged list and "select all").
  const filterParams = useMemo(() => {
    const params: Record<string, string> = {}
    if (search) params.search = search
    if (siteFilter !== ALL) params.site = siteFilter
    if (categoryFilter) Object.assign(params, CATEGORY_FILTER[categoryFilter])
    if (activityFilter !== ALL) params.activityType = activityFilter
    return params
  }, [search, siteFilter, categoryFilter, activityFilter])

  // The last loaded page of employees, tagged with the request it answers; the list is
  // "loading" while that differs from the current request (so a stale response is ignored).
  const listKey = JSON.stringify({ filterParams, page, employeesRev })
  const [list, setList] = useState<{ key: string; employees: Employee[]; total: number } | null>(null)
  const loadingEmployees = list?.key !== listKey
  const employees = list?.employees ?? []
  const total = list?.total ?? 0

  useEffect(() => {
    let cancelled = false
    api
      .get<EmployeesResponse>("/api/employees", {
        params: { ...filterParams, page, limit: PAGE_SIZE },
      })
      .then((res) => {
        if (!cancelled) {
          setList({ key: listKey, employees: res.data.employees || [], total: res.data.totalEmployees || 0 })
        }
      })
      .catch((error) => {
        console.log(error)
        if (!cancelled) {
          toast.error("Failed to load employees")
          setList({ key: listKey, employees: [], total: 0 })
        }
      })
    return () => {
      cancelled = true
    }
  }, [filterParams, page, listKey])

  useEffect(() => {
    api
      .get<Site[]>("/api/site")
      .then((res) => setSites(res.data || []))
      .catch((error) => console.log(error))
  }, [])

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  // A deleted type can't stay the allocation target.
  const targetId = types.some((t) => t._id === targetTypeId) ? targetTypeId : ""

  const siteName = useMemo(() => new Map(sites.map((s) => [s._id, s.siteName])), [sites])
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const filtersActive =
    !!search || siteFilter !== ALL || !!categoryFilter || activityFilter !== ALL

  function setFilter(apply: () => void) {
    apply()
    setPage(1)
  }

  // ---- Create / edit ----
  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError("")
    setFormOpen(true)
  }

  function openEdit(type: ActivityType) {
    setEditing(type)
    setForm({
      name: type.name,
      costingRate: String(type.costingRate),
      billingRate: String(type.billingRate),
    })
    setFormError("")
    setFormOpen(true)
  }

  const formName = form.name.trim().replace(/\s+/g, " ")
  const formCosting = parseRate(form.costingRate)
  const formBilling = parseRate(form.billingRate)

  async function saveForm() {
    if (!editing) {
      if (!formName) return setFormError("Activity type name is required")
      if (hasOvertimeSuffix(formName)) {
        return setFormError(
          `A name can't end with "${OVERTIME_SUFFIX.trim()}" — the overtime type is created automatically`
        )
      }
    }
    if (formCosting === null) return setFormError("Costing rate is required (a number, 0 or more)")
    if (formBilling === null) return setFormError("Billing rate is required (a number, 0 or more)")

    try {
      setSaving(true)
      if (editing) {
        await api.patch(`/api/activity-types/${editing._id}`, {
          costingRate: formCosting,
          billingRate: formBilling,
        })
        toast.success("Rates updated")
      } else {
        await api.post("/api/activity-types", {
          name: formName,
          costingRate: formCosting,
          billingRate: formBilling,
        })
        toast.success(`Created "${formName}" and "${overtimeNameFor(formName)}"`)
      }
      setFormOpen(false)
      reloadTypes()
    } catch (error) {
      setFormError(apiMessage(error, editing ? "Failed to update rates" : "Failed to create activity type"))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!typeToDelete) return
    try {
      setDeleting(true)
      await api.delete(`/api/activity-types/${typeToDelete._id}`)
      setTypes((prev) => prev.filter((t) => t._id !== typeToDelete._id))
      setTypeToDelete(null)
      toast.success("Activity type deleted")
    } catch (error) {
      toast.error(apiMessage(error, "Failed to delete activity type"))
    } finally {
      setDeleting(false)
    }
  }

  async function exportMaster(mode: "insert" | "update") {
    try {
      setExporting(true)
      const res = await api.get("/api/activity-types/erpnext", {
        params: { mode },
        responseType: "blob",
      })
      saveAs(res.data as Blob, `erpnext-activity-types-${mode}.csv`)
    } catch (error) {
      console.log(error)
      toast.error("Failed to export activity types")
    } finally {
      setExporting(false)
    }
  }

  // ---- Selection ----
  const pageIds = employees.map((e) => e._id)
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id))
  const somePageSelected = pageIds.some((id) => selectedIds.has(id))

  const toggleOne = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const togglePage = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allPageSelected) pageIds.forEach((id) => next.delete(id))
      else pageIds.forEach((id) => next.add(id))
      return next
    })

  // Add every employee matching the current filters (all pages) to the selection.
  async function selectAllMatching() {
    try {
      setSelectingAll(true)
      const res = await api.get<EmployeesResponse>("/api/employees", { params: filterParams })
      const ids = (res.data.employees || []).map((e) => e._id)
      setSelectedIds((prev) => new Set([...prev, ...ids]))
    } catch (error) {
      console.log(error)
      toast.error("Failed to select employees")
    } finally {
      setSelectingAll(false)
    }
  }

  async function allocate(activityTypeId: string | null) {
    if (selectedIds.size === 0) return
    try {
      setAllocating(true)
      const res = await api.post("/api/activity-types/allocate", {
        activityTypeId,
        employeeIds: [...selectedIds],
      })
      toast.success(res.data?.message || "Allocation updated")
      setSelectedIds(new Set())
      reloadTypes()
      setEmployeesRev((r) => r + 1)
    } catch (error) {
      toast.error(apiMessage(error, "Failed to update allocation"))
    } finally {
      setAllocating(false)
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <Card className="rounded-3xl border bg-card p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2 text-primary">
                <Tags className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Activity Types</h1>
                  <HelpButton topic="activity-types" />
                </div>
                <p className="text-sm text-muted-foreground">
                  ERPNext activity types with their costing and billing rates. Each employee's
                  allocated type is used on their ERPNext timesheet export.
                </p>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="rounded-xl" disabled={exporting || types.length === 0}>
                    {exporting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    Export for ERPNext
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>Activity Type Data Import</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => exportMaster("insert")}>
                    New types (Insert New Records)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportMaster("update")}>
                    All types (Update Existing Records)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button className="rounded-xl" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                New Activity Type
              </Button>
            </div>
          </div>
        </Card>

        {/* Types */}
        <Card className="rounded-3xl border bg-card p-6 shadow-sm sm:p-8">
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
            <h2 className="text-lg font-semibold">Types</h2>
            <p className="text-xs text-muted-foreground">
              Overtime rates = {multiplier} × base (change the multiplier on Configure → ERPNext Export)
            </p>
          </div>

          {loadingTypes ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              Loading activity types...
            </div>
          ) : types.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 text-center">
              <p className="font-medium">No activity types yet</p>
              <p className="text-sm text-muted-foreground">
                Create one with its costing and billing rate; its overtime type is added automatically.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Activity Type</TableHead>
                    <TableHead className="text-right">Costing</TableHead>
                    <TableHead className="text-right">Billing</TableHead>
                    <TableHead className="text-right">OT Costing</TableHead>
                    <TableHead className="text-right">OT Billing</TableHead>
                    <TableHead className="text-right">Employees</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {types.map((t) => (
                    <TableRow key={t._id}>
                      <TableCell className="whitespace-normal">
                        <div className="font-medium">{t.name}</div>
                        <div className="text-xs text-muted-foreground">{t.overtimeName}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatRate(t.costingRate)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatRate(t.billingRate)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatRate(t.overtimeCostingRate)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatRate(t.overtimeBillingRate)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{t.allocatedCount}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="h-7 w-7"
                            aria-label={`Edit rates of ${t.name}`}
                            onClick={() => openEdit(t)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            aria-label={`Delete ${t.name}`}
                            onClick={() => setTypeToDelete(t)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        {/* Allocation */}
        <Card className="rounded-3xl border bg-card p-6 shadow-sm sm:p-8">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Allocate to employees</h2>
            <p className="text-sm text-muted-foreground">
              Pick employees (across searches and pages), then allocate a type or clear it. Employees
              with no type use the default activity types from Configure.
            </p>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search name, ID, job title"
                className="pl-9"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>

            <Select value={siteFilter} onValueChange={(v) => setFilter(() => setSiteFilter(v))}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Site" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All sites</SelectItem>
                <SelectItem value="null">Not assigned</SelectItem>
                {sites.map((s) => (
                  <SelectItem key={s._id} value={s._id}>
                    {s.siteName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={activityFilter} onValueChange={(v) => setFilter(() => setActivityFilter(v))}>
              <SelectTrigger className="w-full sm:w-52">
                <SelectValue placeholder="Activity type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any activity type</SelectItem>
                <SelectItem value="none">Unallocated</SelectItem>
                {types.map((t) => (
                  <SelectItem key={t._id} value={t._id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {filtersActive && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchInput("")
                  setSearch("")
                  setSiteFilter(ALL)
                  setCategoryFilter("")
                  setActivityFilter(ALL)
                  setPage(1)
                }}
              >
                <X className="mr-1 h-4 w-4" />
                Clear filters
              </Button>
            )}
          </div>

          {/* Category chips */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(Object.keys(CATEGORY_LABELS) as RosterCategory[]).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setFilter(() => setCategoryFilter((c) => (c === cat ? "" : cat)))}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  categoryFilter === cat
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:text-foreground"
                }`}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>

          {/* Selection / action bar */}
          <div className="mt-4 flex flex-col gap-3 rounded-xl border bg-muted/40 p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{selectedIds.size} selected</span>
              {selectedIds.size > 0 && (
                <Button variant="ghost" size="sm" className="h-7" onClick={() => setSelectedIds(new Set())}>
                  Clear
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                disabled={selectingAll || total === 0}
                onClick={selectAllMatching}
              >
                {selectingAll && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Select all {total} {filtersActive ? "matching" : ""}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select value={targetId} onValueChange={setTargetTypeId}>
                <SelectTrigger className="w-full sm:w-56">
                  <SelectValue placeholder="Choose activity type" />
                </SelectTrigger>
                <SelectContent>
                  {types.map((t) => (
                    <SelectItem key={t._id} value={t._id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={allocating || !targetId || selectedIds.size === 0}
                onClick={() => allocate(targetId)}
              >
                {allocating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Allocate to {selectedIds.size}
              </Button>
              <Button
                variant="outline"
                disabled={allocating || selectedIds.size === 0}
                onClick={() => allocate(null)}
              >
                Clear allocation
              </Button>
            </div>
          </div>

          {/* Employees */}
          <div className="mt-4 overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                      onCheckedChange={togglePage}
                      aria-label="Select all on this page"
                    />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Employee ID</TableHead>
                  <TableHead className="hidden md:table-cell">Job Title</TableHead>
                  <TableHead className="hidden lg:table-cell">Site</TableHead>
                  <TableHead>Activity Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingEmployees && employees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      Loading employees...
                    </TableCell>
                  </TableRow>
                ) : employees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No employees match these filters
                    </TableCell>
                  </TableRow>
                ) : (
                  employees.map((e) => (
                    <TableRow
                      key={e._id}
                      className={`cursor-pointer ${loadingEmployees ? "opacity-60" : ""}`}
                      onClick={() => toggleOne(e._id)}
                    >
                      <TableCell className="w-10" onClick={(ev) => ev.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(e._id)}
                          onCheckedChange={() => toggleOne(e._id)}
                          aria-label={`Select ${e.name}`}
                        />
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <div className="font-medium">{e.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {CATEGORY_LABELS[categoryOf(e.collarType, e.nationality)]}
                          <span className="md:hidden"> · {e.employeeId}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden font-mono text-sm md:table-cell">{e.employeeId}</TableCell>
                      <TableCell className="hidden capitalize md:table-cell">{e.jobTitle}</TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {e.currentSite ? siteName.get(e.currentSite) || "—" : "Not assigned"}
                      </TableCell>
                      <TableCell>
                        {e.activityType ? (
                          <Badge variant="secondary">{e.activityType.name}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Default</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {total} employee{total === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || loadingEmployees}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span>
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || loadingEmployees}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* Create / edit rates dialog */}
      <Dialog open={formOpen} onOpenChange={(o) => !saving && setFormOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl">
              {editing ? "Edit Rates" : "New Activity Type"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "The name is the ERPNext link and can't be changed. Re-import the master CSV into ERPNext after changing rates."
                : "Both rates are required. The overtime activity type is created automatically."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="activity-name">Name</label>
              <Input
                id="activity-name"
                placeholder="e.g. Construction Grade A"
                maxLength={ACTIVITY_NAME_MAX}
                disabled={!!editing}
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="activity-costing">
                  Costing Rate <span className="text-red-500">*</span>
                </label>
                <Input
                  id="activity-costing"
                  type="number"
                  min={0}
                  step={0.001}
                  inputMode="decimal"
                  placeholder="per hour"
                  value={form.costingRate}
                  onChange={(e) => setForm((p) => ({ ...p, costingRate: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="activity-billing">
                  Billing Rate <span className="text-red-500">*</span>
                </label>
                <Input
                  id="activity-billing"
                  type="number"
                  min={0}
                  step={0.001}
                  inputMode="decimal"
                  placeholder="per hour"
                  value={form.billingRate}
                  onChange={(e) => setForm((p) => ({ ...p, billingRate: e.target.value }))}
                />
              </div>
            </div>

            {/* Live preview of the automatic overtime twin */}
            <div className="rounded-xl border bg-muted/40 p-3 text-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Overtime type ({multiplier} × rates)
              </div>
              <div className="mt-1 font-medium">
                {formName ? overtimeNameFor(formName) : `…${OVERTIME_SUFFIX}`}
              </div>
              <div className="mt-1 text-muted-foreground tabular-nums">
                Costing {formCosting === null ? "—" : formatRate(round3(formCosting * multiplier))} · Billing{" "}
                {formBilling === null ? "—" : formatRate(round3(formBilling * multiplier))}
              </div>
            </div>

            {formError && <p className="text-sm text-red-500">{formError}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={saveForm}>
              {saving ? "Saving..." : editing ? "Save Rates" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={!!typeToDelete} onOpenChange={(o) => !o && setTypeToDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Activity Type?
            </DialogTitle>
            <DialogDescription className="pt-2 text-base">
              {typeToDelete && typeToDelete.allocatedCount > 0 ? (
                <>
                  <strong>{typeToDelete.name}</strong> is allocated to {typeToDelete.allocatedCount}{" "}
                  employee{typeToDelete.allocatedCount === 1 ? "" : "s"}. Clear or change their
                  allocation first.
                </>
              ) : (
                <>
                  Delete <strong>{typeToDelete?.name}</strong> and its overtime type? This doesn't
                  remove them from ERPNext.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" disabled={deleting} onClick={() => setTypeToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting || (typeToDelete?.allocatedCount ?? 0) > 0}
              onClick={handleDelete}
            >
              {deleting ? "Deleting..." : "Confirm Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default ActivityTypes
