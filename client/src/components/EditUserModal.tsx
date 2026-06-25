import { useEffect, useState } from "react"
import toast from "react-hot-toast"

import { api } from "@/lib/api"
import { Eye, EyeOff, User, Shield, KeyRound, Mail } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface UserType {
  _id: string
  name: string
  employeeId?: string
  email: string
  assignedSite?: string
  role?: string
}

interface Site {
  _id: string
  siteName: string
}

interface Props {
  open: boolean
  onClose: () => void
  user: UserType | null
  sites: Site[]
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

  const labels = ["", "Too Short", "Medium", "Strong", "Very Strong"]
  const colors = [
    "bg-muted",
    "bg-destructive", // Red
    "bg-amber-500",    // Amber
    "bg-emerald-500",  // Green
    "bg-blue-500",     // Blue
  ]

  return { score, label: labels[score], color: colors[score] }
}

function EditUserModal({
  open,
  onClose,
  user,
  sites,
  onSuccess,
}: Props) {

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  
  const [assignedSite, setAssignedSite] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (user) {
      setEmail(user.email)
      setAssignedSite(user.assignedSite || "")
      setPassword("")
      setConfirmPassword("")
    }
  }, [user])

  const strength = getPasswordStrength(password)
  const hasTypedPassword = password.length > 0
  const isPasswordMatch = password === confirmPassword
  
  const canUpdate = 
    email.trim() !== "" && 
    (!hasTypedPassword || (password.length >= 6 && isPasswordMatch))

  const handleUpdate = async () => {
    if (!user || !canUpdate) return

    try {
      setLoading(true)

      const payload: {
        email: string
        assignedSite?: string
        password?: string
      } = {
        email,
      }

      if (user.role !== 'admin' && user.role !== 'superadmin') {
        payload.assignedSite = assignedSite
      }

      if (hasTypedPassword) {
        payload.password = password
      }

      await api.patch(`/api/user/update/${user._id}`, payload)

      toast.success("User updated successfully")

      onSuccess()
      onClose()

    } catch (error) {
      console.log(error)
      toast.error("Failed to update user")
    } finally {
      setLoading(false)
    }
  }

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[460px] p-6 rounded-2xl">
        <DialogHeader className="flex flex-row items-center gap-3 border-b pb-4">
          <div className={`p-2.5 rounded-xl ${
            isAdmin ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" : "bg-primary/10 text-primary"
          }`}>
            {isAdmin ? <Shield className="h-6 w-6" /> : <User className="h-6 w-6" />}
          </div>
          <div>
            <DialogTitle className="text-xl font-bold">
              Edit {user?.role === 'superadmin' ? 'Super Admin' : user?.role === 'admin' ? 'Admin' : 'Supervisor'}
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Modify account credentials and system configuration.
            </p>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          
          {/* Read Only Details Group */}
          <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
            <div className="flex justify-between items-center text-sm border-b pb-2">
              <span className="text-muted-foreground font-medium">Name</span>
              <span className="font-semibold text-foreground">{user?.name}</span>
            </div>
            
            {!isAdmin && user?.employeeId && (
              <div className="flex justify-between items-center text-sm border-b pb-2">
                <span className="text-muted-foreground font-medium">Employee ID</span>
                <span className="font-mono text-foreground font-semibold">{user.employeeId}</span>
              </div>
            )}
            
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground font-medium">Role</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                isAdmin ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" : "bg-primary/10 text-primary"
              }`}>
                {user?.role || 'supervisor'}
              </span>
            </div>
          </div>

          {/* Email field */}
          <div className="grid gap-1.5">
            <Label className="text-sm font-medium">Email Address</Label>
            <div className="relative">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-9 bg-background/50 focus:bg-background"
              />
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
            </div>
          </div>

          {/* Assigned Site field for supervisors only */}
          {!isAdmin && (
            <div className="grid gap-1.5">
              <Label className="text-sm font-medium">Assigned Site</Label>
              <Select
                value={assignedSite}
                onValueChange={setAssignedSite}
              >
                <SelectTrigger className="bg-background/50">
                  <SelectValue placeholder="Select site" />
                </SelectTrigger>

                <SelectContent>
                  {sites.map((site) => (
                    <SelectItem
                      key={site._id}
                      value={site._id}
                    >
                      {site.siteName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Password fields */}
          <div className="grid gap-1.5 border-t pt-3">
            <Label className="text-sm font-medium">New Password</Label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Leave blank to keep current password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10 pl-9 bg-background/50 focus:bg-background"
              />
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
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

            {hasTypedPassword && (
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

          {/* Confirm Password (only visible if user starts typing new password) */}
          {hasTypedPassword && (
            <div className="grid gap-1.5 animate-fadeIn">
              <Label className="text-sm font-medium">Confirm New Password</Label>
              <div className="relative">
                <Input
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Re-type new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pr-10 pl-9 bg-background/50 focus:bg-background"
                />
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
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
          )}

          <Button
            onClick={handleUpdate}
            disabled={loading || !canUpdate}
            className="w-full mt-4 font-semibold shadow-sm transition-all duration-200"
          >
            {loading ? "Updating..." : "Update User"}
          </Button>

        </div>
      </DialogContent>
    </Dialog>
  )
}

export default EditUserModal