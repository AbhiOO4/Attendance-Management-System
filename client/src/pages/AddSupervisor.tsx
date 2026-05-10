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
    <div className="max-w-2xl mx-auto p-6 space-y-8">

          <Button
              variant="outline"
              className="mb-2"
              onClick={() => navigate(-1)}
          >

              <ArrowLeft className="w-4 h-4 mr-2" />

              Back

          </Button>

      <div className="space-y-2">

        <h1 className="text-4xl font-bold">
          Create Supervisor Account
        </h1>

        <div className="border rounded-lg p-4 bg-muted/40">

          <p className="text-sm text-muted-foreground leading-relaxed">

            Copy the email id and password and send it to the
            supervisor, they can log in first time with the
            same email and password but they will be asked
            to change the password to a new one to continue.

          </p>

        </div>

      </div>

      <div className="space-y-6">

        {/* NAME */}

        <div className="space-y-2">

          <Label>
            Name
          </Label>

          <Input
            value={employee?.name || ""}
            disabled
          />

        </div>

        {/* EMPLOYEE ID */}

        <div className="space-y-2">

          <Label>
            Employee ID
          </Label>

          <Input
            value={employee?.employeeId || ""}
            disabled
          />

        </div>

        {/* EMAIL */}

        <div className="space-y-2">

          <Label>
            Email
          </Label>

          <div className="flex gap-2">

            <Input
              type="email"
              placeholder="Enter email"
              value={email}
              onChange={(e) =>
                setEmail(e.target.value)
              }
            />

            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() =>
                copyToClipboard(email, "email")
              }
              disabled={!email}
            >

              {copiedEmail ? (
                <Check className="w-4 h-4" />
              ) : (
                <Copy className="w-4 h-4" />
              )}

            </Button>

          </div>

        </div>

        {/* PASSWORD */}

        <div className="space-y-2">

          <Label>
            Password
          </Label>

          <div className="flex gap-2">

            <Input
              type="text"
              placeholder="Enter password"
              value={password}
              onChange={(e) =>
                setPassword(e.target.value)
              }
            />

            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() =>
                copyToClipboard(password, "password")
              }
              disabled={!password}
            >

              {copiedPassword ? (
                <Check className="w-4 h-4" />
              ) : (
                <Copy className="w-4 h-4" />
              )}

            </Button>

          </div>

        </div>

        {/* SUBMIT */}

        <Button
          className="w-full"
          onClick={handleCreateSupervisor}
          disabled={loading}
        >
          {loading
            ? "Creating Account..."
            : "Create Supervisor Account"}
        </Button>

      </div>

    </div>
  )
}

export default AddSupervisor