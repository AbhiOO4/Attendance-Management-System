import { useState } from "react"
import toast from "react-hot-toast"
import { api } from "@/lib/api"
import { Eye, EyeOff, Shield } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

function getPasswordStrength(password: string): { score: number; label: string; color: string } {
  if (!password) return { score: 0, label: "", color: "bg-muted" }
  if (password.length < 6) return { score: 1, label: "Too Short", color: "bg-destructive" }

  let score = 1
  const hasUppercase = /[A-Z]/.test(password)
  const hasLowercase = /[a-z]/.test(password)
  const hasNumber = /[0-9]/.test(password)
  const hasSpecial = /[^A-Za-z0-9]/.test(password)

  const categories = [hasUppercase, hasLowercase, hasNumber, hasSpecial].filter(Boolean).length

  if (categories >= 2 && password.length >= 6) score = 2 // Medium
  if (categories >= 3 && password.length >= 8) score = 3 // Strong
  if (categories === 4 && password.length >= 10) score = 4 // Very Strong

  const labels = ["", "Weak", "Medium", "Strong", "Very Strong"]
  const colors = [
    "bg-muted",
    "bg-destructive", // Red
    "bg-amber-500",    // Amber
    "bg-emerald-500",  // Green
    "bg-blue-500",     // Blue
  ]

  return { score, label: labels[score], color: colors[score] }
}

function AddAdminModal({ open, onClose, onSuccess }: Props) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  const strength = getPasswordStrength(password)
  const isPasswordMatch = password === confirmPassword
  const canSubmit = 
    name.trim() !== "" && 
    email.trim() !== "" && 
    password.length >= 6 && 
    isPasswordMatch

  const handleCreate = async () => {
    if (!canSubmit) return

    try {
      setLoading(true)
      await api.post("/api/user/admin", {
        name,
        email,
        password,
      })

      toast.success("Admin created successfully")
      
      // Clear form
      setName("")
      setEmail("")
      setPassword("")
      setConfirmPassword("")
      
      onSuccess()
      onClose()
    } catch (error: any) {
      console.log(error)
      toast.error(error?.response?.data?.message || "Failed to create admin")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[460px] p-6 rounded-2xl">
        <DialogHeader className="flex flex-row items-center gap-3 border-b pb-4">
          <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <Shield className="h-6 w-6" />
          </div>
          <div>
            <DialogTitle className="text-xl font-bold">Add Admin User</DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Create a new administrator account with full privileges.
            </p>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          <div className="grid gap-1.5">
            <Label className="text-sm font-medium">Name</Label>
            <Input
              placeholder="e.g. John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-background/50 focus:bg-background"
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-sm font-medium">Email</Label>
            <Input
              type="email"
              placeholder="john@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-background/50 focus:bg-background"
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-sm font-medium">Password</Label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Choose a password (min 6 chars)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10 bg-background/50 focus:bg-background"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            
            {password && (
              <div className="space-y-1.5 mt-1">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">Strength:</span>
                  <span className={`font-semibold ${
                    strength.score === 1 ? 'text-destructive' : 
                    strength.score === 2 ? 'text-amber-500' : 
                    strength.score === 3 ? 'text-emerald-500' : 
                    strength.score === 4 ? 'text-blue-500' : ''
                  }`}>
                    {strength.label}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1.5 h-1.5">
                  {[1, 2, 3, 4].map((num) => (
                    <div
                      key={num}
                      className={`h-full rounded-full transition-all duration-300 ${
                        strength.score >= num ? strength.color : "bg-muted"
                      }`}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label className="text-sm font-medium">Confirm Password</Label>
            <div className="relative">
              <Input
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Re-enter password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="pr-10 bg-background/50 focus:bg-background"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showConfirmPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {confirmPassword && !isPasswordMatch && (
              <p className="text-xs text-destructive mt-1 font-medium">Passwords do not match</p>
            )}
            {confirmPassword && isPasswordMatch && (
              <p className="text-xs text-emerald-500 mt-1 font-medium">Passwords match</p>
            )}
          </div>

          <Button
            onClick={handleCreate}
            disabled={loading || !canSubmit}
            className="w-full mt-4 font-semibold shadow-sm transition-all duration-200"
          >
            {loading ? "Creating..." : "Create Admin"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default AddAdminModal
