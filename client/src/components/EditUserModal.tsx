import { useEffect, useState } from "react"
import toast from "react-hot-toast"

import { api } from "@/lib/api"
import { Eye, EyeOff } from "lucide-react"
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

interface User {
  _id: string
  name: string
  employeeId: string
  email: string
  assignedSite: string
}

interface Site {
  _id: string
  siteName: string
}

interface Props {
  open: boolean
  onClose: () => void
  user: User | null
  sites: Site[]
  onSuccess: () => void
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
  const [assignedSite, setAssignedSite] = useState("")
  const [showPassword, setShowPassword] = useState(false)

  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (user) {
      setEmail(user.email)
      setAssignedSite(user.assignedSite || "")
      setPassword("")
    }
  }, [user])

  const handleUpdate = async () => {

    if (!user) return

    try {
      setLoading(true)

      const payload: {
        email: string
        assignedSite: string
        password?: string
      } = {
        email,
        assignedSite,
      }

      if (password.trim()) {
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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>

        <DialogHeader>
          <DialogTitle>Edit Supervisor</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">

          <div>
            <Label>Name</Label>
            <Input value={user?.name || ""} disabled />
          </div>

          <div>
            <Label>Employee ID</Label>
            <Input value={user?.employeeId || ""} disabled />
          </div>

          <div>
            <Label>Email</Label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <Label>Password</Label>

            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Enter new password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
              />

              <button
                type="button"
                onClick={() =>
                  setShowPassword(!showPassword)
                }
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <Label>Assigned Site</Label>

            <Select
              value={assignedSite}
              onValueChange={setAssignedSite}
            >
              <SelectTrigger>
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

          <Button
            onClick={handleUpdate}
            disabled={loading}
            className="w-full"
          >
            {loading ? "Updating..." : "Update User"}
          </Button>

        </div>

      </DialogContent>
    </Dialog>
  )
}

export default EditUserModal