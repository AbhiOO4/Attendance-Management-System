// AddSupervisor.tsx

import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft } from "lucide-react"

import { api } from "@/lib/api"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { Copy, Check } from "lucide-react"

import toast from "react-hot-toast"

interface Employee {
  _id: string
  name: string
  employeeId: string
}

function AddSupervisor() {

  const { id } = useParams()

  const navigate = useNavigate()

  const [employee, setEmployee] = useState<Employee | null>(null)

  const [email, setEmail] = useState("")

  const [password, setPassword] = useState("")

  const [loading, setLoading] = useState(false)

  const [copiedEmail, setCopiedEmail] = useState(false)

  const [copiedPassword, setCopiedPassword] = useState(false)

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

    if (!employee) return

    if (!email || !password) {
      toast.error("Email and password are required")
      return
    }

    try {

      setLoading(true)

      await api.post("/api/employees/Supervisor", {
        name: employee.name,
        employeeId: employee.employeeId,
        email,
        password
      })

      toast.success("Supervisor account created")

      navigate("/supervisor")

    } catch (error) {

      console.log(error)

      toast.error("Failed to create supervisor")

    } finally {

      setLoading(false)
    }
  }

  async function copyToClipboard(
    value: string,
    type: "email" | "password"
  ) {

    try {

      await navigator.clipboard.writeText(value)

      if (type === "email") {

        setCopiedEmail(true)

        setTimeout(() => {
          setCopiedEmail(false)
        }, 1500)

      } else {

        setCopiedPassword(true)

        setTimeout(() => {
          setCopiedPassword(false)
        }, 1500)
      }

    } catch (error) {

      console.log(error)
    }
  }

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
              <Label htmlFor="sup-email" className="text-sm font-medium">
                Email
              </Label>
              <div className="relative">
                <Input
                  id="sup-email"
                  type="email"
                  placeholder="supervisor@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(email, "email")}
                  disabled={!email}
                  aria-label="Copy email"
                  className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                >
                  {copiedEmail ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="sup-password" className="text-sm font-medium">
                Temporary password
              </Label>
              <div className="relative">
                <Input
                  id="sup-password"
                  type="text"
                  placeholder="Enter a temporary password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(password, "password")}
                  disabled={!password}
                  aria-label="Copy password"
                  className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                >
                  {copiedPassword ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Footer actions */}
          <div className="mt-8 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateSupervisor}
              disabled={loading || !employee}
            >
              {loading ? "Creating…" : "Create account"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AddSupervisor