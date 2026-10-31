import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { Check, Eye, EyeOff, Loader2, Search, Truck, UserPlus, X } from "lucide-react"

import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type Role = "supervisor" | "driverSupervisor" | "admin" | "superadmin"

const ROLES: { key: Role; label: string; desc: string }[] = [
  { key: "supervisor", label: "Supervisor", desc: "Marks attendance for their employee's site." },
  { key: "driverSupervisor", label: "Driver Supervisor", desc: "Marks every driver with no site." },
  { key: "admin", label: "Admin", desc: "Manages sites, employees and users." },
  { key: "superadmin", label: "Superadmin", desc: "Admin plus user management." },
]

type EmployeeHit = { _id: string; name: string; employeeId: string; jobTitle: string; user?: string | null }

const MIN_PASSWORD = 6

/**
 * (The parent re-keys this dialog on every open, so it always starts blank.)
 * Manage Users → Add user: one dialog for every account type. The role is picked first and
 * the form adapts — a linked employee is REQUIRED for a Supervisor (their site access follows
 * that employee) and optional for a Driver Supervisor; admins have none.
 */
export default function AddUserDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const [role, setRole] = useState<Role>("supervisor")
  const [employee, setEmployee] = useState<EmployeeHit | null>(null)
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<EmployeeHit[]>([])
  const [searching, setSearching] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)

  const needsEmployee = role === "supervisor"
  const allowsEmployee = role === "supervisor" || role === "driverSupervisor"

  // Employee search (debounced), only employees without an account.
  useEffect(() => {
    if (!open || !allowsEmployee || employee) return
    const q = query.trim()
    if (!q) return
    let alive = true
    const t = window.setTimeout(async () => {
      setSearching(true)
      try {
        const res = await api.get<{ employees: EmployeeHit[] }>("/api/employees", {
          params: { search: q, notSupervisor: "true", page: 1, limit: 8 },
        })
        if (alive) setHits(res.data.employees || [])
      } catch {
        if (alive) setHits([])
      } finally {
        if (alive) setSearching(false)
      }
    }, 250)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [query, open, allowsEmployee, employee])

  // Results only while something is typed (an emptied box shows none, no state reset needed).
  const visibleHits = query.trim() ? hits : []

  const pickEmployee = (emp: EmployeeHit) => {
    setEmployee(emp)
    setHits([])
    setQuery("")
    if (!name.trim()) setName(emp.name)
  }

  const passwordOk = password.length >= MIN_PASSWORD && password === confirm
  const canSubmit =
    !!name.trim() && !!email.trim() && passwordOk && (!needsEmployee || !!employee) && !saving

  const submit = async () => {
    if (!canSubmit) return
    setSaving(true)
    try {
      const base = { name: name.trim(), email: email.trim(), password }
      if (role === "supervisor") {
        await api.post("/api/employees/Supervisor", { ...base, employeeId: employee!.employeeId })
      } else if (role === "driverSupervisor") {
        await api.post("/api/user/driver-supervisor", { ...base, employeeId: employee?.employeeId })
      } else {
        await api.post(role === "superadmin" ? "/api/user/superadmin" : "/api/user/admin", base)
      }
      toast.success(`${ROLES.find((r) => r.key === role)!.label} created`)
      onSuccess()
      onClose()
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message || "Couldn't create the user")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-[560px] max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Add user
          </DialogTitle>
          <DialogDescription>Pick a role first; the form adapts to it.</DialogDescription>
        </DialogHeader>

        <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <legend className="mb-1.5 text-sm font-medium">Role</legend>
          {ROLES.map((r) => {
            const active = role === r.key
            return (
              <button
                key={r.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  setRole(r.key)
                  if (r.key === "admin" || r.key === "superadmin") setEmployee(null)
                }}
                className={cn(
                  "flex min-h-[64px] items-start gap-2.5 rounded-lg border p-3 text-left transition-colors",
                  active ? "border-foreground ring-1 ring-foreground" : "hover:bg-muted/50"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                    active ? "border-foreground" : "border-muted-foreground/50"
                  )}
                >
                  {active && <span className="h-2 w-2 rounded-full bg-foreground" />}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {r.key === "driverSupervisor" && <Truck className="h-3.5 w-3.5" />}
                    {r.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">{r.desc}</span>
                </span>
              </button>
            )
          })}
        </fieldset>

        {allowsEmployee && (
          <div className="space-y-1.5">
            <Label htmlFor="add-user-employee">
              Linked employee{" "}
              <span className={cn("font-normal", needsEmployee ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                {needsEmployee ? "(required for supervisors)" : "(optional)"}
              </span>
            </Label>
            {employee ? (
              <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{employee.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {employee.employeeId} • {employee.jobTitle}
                  </p>
                </div>
                <Button variant="ghost" size="icon" aria-label="Clear employee" onClick={() => setEmployee(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="add-user-employee"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search employee by name or ID…"
                  className="pl-9"
                  autoComplete="off"
                />
                {(visibleHits.length > 0 || (searching && !!query.trim())) && (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
                    {searching && visibleHits.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>
                    ) : (
                      visibleHits.map((h) => (
                        <button
                          key={h._id}
                          type="button"
                          onClick={() => pickEmployee(h)}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm">{h.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {h.employeeId} • {h.jobTitle}
                            </span>
                          </span>
                          <Check className="h-4 w-4 opacity-0" />
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
            {role === "supervisor" && (
              <p className="text-xs text-muted-foreground">
                Site access follows this employee's permanent site; temporary visits don't change it.
              </p>
            )}
          </div>
        )}

        {role === "driverSupervisor" && (
          <div className="flex gap-2.5 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            <Truck className="h-4 w-4 shrink-0" />
            <span>
              No site for this role. After sign-in they land on <strong className="text-foreground">Drivers Attendance</strong>, the only page in their sidebar.
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="add-user-name">Full name</Label>
            <Input id="add-user-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="add-user-email">Email</Label>
            <Input id="add-user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.om" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-user-password">Password</Label>
            <div className="relative">
              <Input
                id="add-user-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={`At least ${MIN_PASSWORD} characters`}
                className="pr-9"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-user-confirm">Confirm password</Label>
            <Input
              id="add-user-confirm"
              type={showPassword ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          {password && password.length < MIN_PASSWORD && (
            <p className="text-xs text-red-600 dark:text-red-400 sm:col-span-2">Password must be at least {MIN_PASSWORD} characters.</p>
          )}
          {confirm && password !== confirm && (
            <p className="text-xs text-red-600 dark:text-red-400 sm:col-span-2">Passwords don't match.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Create {ROLES.find((r) => r.key === role)!.label.toLowerCase()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
