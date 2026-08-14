import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  ArrowLeft,
  Copy,
  Check,
  Sparkles,
  CheckCircle2,
} from "lucide-react"

import { api } from "@/lib/api"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import toast from "react-hot-toast"

interface Employee {
  _id: string
  name: string
  employeeId: string
}

// Unambiguous alphabet — no 0/O, 1/l/I — so a hand-copied password is unambiguous.
const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"

function generateStrongPassword(length = 12): string {
  const arr = new Uint32Array(length)
  crypto.getRandomValues(arr)
  let out = ""
  for (const n of arr) out += PASSWORD_ALPHABET[n % PASSWORD_ALPHABET.length]
  return out
}

const EMAIL_RE = /^\S+@\S+\.\S+$/
const MIN_PASSWORD_LEN = 8

function AddSupervisor() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  const [copiedEmail, setCopiedEmail] = useState(false)
  const [copiedPassword, setCopiedPassword] = useState(false)
  const [copiedBoth, setCopiedBoth] = useState(false)

  // Set once the account is created — flips the page into a success/summary view.
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null)

  const emailTouched = email.length > 0
  const passwordTouched = password.length > 0
  const emailValid = EMAIL_RE.test(email)
  const passwordValid = password.length >= MIN_PASSWORD_LEN
  const canSubmit = !!employee && emailValid && passwordValid && !loading

  async function fetchEmployee() {
    try {
      const res = await api.get(`/api/employees/${id}`)
      setEmployee(res.data)
    } catch (error) {
      console.log(error)
      toast.error("Failed to fetch employee")
    }
  }

  useEffect(() => {
    fetchEmployee()
  }, [])

  async function handleCreateSupervisor() {
    if (!canSubmit || !employee) return
    try {
      setLoading(true)
      await api.post("/api/employees/Supervisor", {
        name: employee.name,
        employeeId: employee.employeeId,
        email,
        password,
      })
      toast.success("Supervisor account created")
      setCreated({ email, password })
    } catch (error) {
      console.log(error)
      toast.error("Failed to create supervisor")
    } finally {
      setLoading(false)
    }
  }

  function flashCopied(setter: (v: boolean) => void) {
    setter(true)
    setTimeout(() => setter(false), 1500)
  }

  async function copyValue(value: string, setter: (v: boolean) => void) {
    try {
      await navigator.clipboard.writeText(value)
      flashCopied(setter)
    } catch (error) {
      console.log(error)
      toast.error("Couldn't copy")
    }
  }

  async function copyBoth() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(
        `Email: ${created.email}\nPassword: ${created.password}`
      )
      flashCopied(setCopiedBoth)
      toast.success("Credentials copied")
    } catch (error) {
      console.log(error)
      toast.error("Couldn't copy")
    }
  }

  // ---------------- SUCCESS VIEW ----------------
  if (created) {
    return (
      <div className="min-h-screen bg-muted/30">
        <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-10">
          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">
                Account created
              </h1>
              <p className="text-sm text-muted-foreground">
                Share these credentials with {employee?.name || "the supervisor"}.
                They'll be prompted to set a new password on first login.
              </p>
            </div>
          </div>

          {/* Credentials summary */}
          <div className="mt-8 rounded-xl border bg-card p-6 sm:p-8">
            <div className="space-y-4">
              <ReadOnlyField label="Email" value={created.email} />
              <ReadOnlyField label="Temporary password" value={created.password} mono />
            </div>

            <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
              This is the only time the password is shown. If you close this page
              without copying it, it can't be retrieved.
            </div>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => navigate("/supervisor")}>
                Done
              </Button>
              <Button onClick={copyBoth}>
                {copiedBoth ? (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy both
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---------------- FORM VIEW ----------------
  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-10">
        {/* Back */}
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        {/* Header */}
        <div className="mt-6 space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">
            Create supervisor account
          </h1>
          <p className="text-sm text-muted-foreground">
            Generate login credentials for this employee. Share them with the
            supervisor — they'll be asked to set a new password on first login.
          </p>
        </div>

        {/* Card */}
        <div className="mt-8 rounded-xl border bg-card p-6 sm:p-8">
          {/* Employee context */}
          <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
              {employee?.name
                ? employee.name
                    .trim()
                    .split(/\s+/)
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()
                : "—"}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {employee?.name || "Loading…"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                Employee ID: {employee?.employeeId || "—"}
              </p>
            </div>
          </div>

          {/* Credentials */}
          <div className="mt-6 space-y-5">
            {/* Email */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="sup-email" className="text-sm font-medium">
                  Email
                </Label>
                {copiedEmail && (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400">
                    Copied
                  </span>
                )}
              </div>
              <div className="relative">
                <Input
                  id="sup-email"
                  type="email"
                  placeholder="supervisor@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pr-10"
                  aria-invalid={emailTouched && !emailValid}
                />
                <button
                  type="button"
                  onClick={() => copyValue(email, setCopiedEmail)}
                  disabled={!email}
                  aria-label="Copy email"
                  className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                >
                  {copiedEmail ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              {emailTouched && !emailValid && (
                <p className="text-xs text-destructive">
                  Enter a valid email address.
                </p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="sup-password" className="text-sm font-medium">
                  Temporary password
                </Label>
                <div className="flex items-center gap-3">
                  {copiedPassword && (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400">
                      Copied
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setPassword(generateStrongPassword())}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Sparkles className="h-3 w-3" />
                    Generate
                  </button>
                </div>
              </div>
              <div className="relative">
                <Input
                  id="sup-password"
                  type="text"
                  placeholder={`At least ${MIN_PASSWORD_LEN} characters`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10 font-mono"
                  aria-invalid={passwordTouched && !passwordValid}
                />
                <button
                  type="button"
                  onClick={() => copyValue(password, setCopiedPassword)}
                  disabled={!password}
                  aria-label="Copy password"
                  className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                >
                  {copiedPassword ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              {passwordTouched && !passwordValid && (
                <p className="text-xs text-destructive">
                  Password must be at least {MIN_PASSWORD_LEN} characters.
                </p>
              )}
            </div>
          </div>

          {/* Footer actions */}
          <div className="mt-8 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button onClick={handleCreateSupervisor} disabled={!canSubmit}>
              {loading ? "Creating…" : "Create account"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ReadOnlyField({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        {copied && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            Copied
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div
          className={
            "flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 text-sm" +
            (mono ? " font-mono" : "")
          }
        >
          {value}
        </div>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${label.toLowerCase()}`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}

export default AddSupervisor
