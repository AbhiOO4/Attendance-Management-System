// components/AddSiteModal.tsx

import { useState } from "react"
import toast from "react-hot-toast"

import { api } from "@/lib/api"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import { Plus } from "lucide-react"

type AddSiteModalProps = {
  fetchSites: () => void
}

export default function AddSiteModal({
  fetchSites,
}: AddSiteModalProps) {
  const [open, setOpen] = useState(false)

  const [formData, setFormData] = useState({
    name: "",
    location: "",
  })

  const [errors, setErrors] = useState({
    name: "",
    location: "",
  })

  const validateForm = () => {
    const newErrors = {
      name: "",
      location: "",
    }

    let isValid = true

    if (!formData.name.trim()) {
      newErrors.name = "Site name is required"
      isValid = false
    }

    if (!formData.location.trim()) {
      newErrors.location = "Location details are required"
      isValid = false
    }

    setErrors(newErrors)

    return isValid
  }

  const handleCreateSite = async () => {
    if (!validateForm()) return

    try {
      await api.post("/api/site", {
        siteName: formData.name,
        locationDetails: formData.location,
      })

      toast.success("Site created successfully")

      setFormData({
        name: "",
        location: "",
      })

      setOpen(false)

      fetchSites()
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message || "Failed to create site"
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="gap-2 rounded-xl px-6">
          <Plus className="h-5 w-5" />
          Add New Site
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>Add New Site</DialogTitle>

          <DialogDescription>
            Site name should be unique.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <div className="space-y-2">
            <Label>Site Name</Label>

            <Input
              placeholder="Enter site name"
              value={formData.name}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  name: e.target.value,
                })
              }
            />

            {errors.name && (
              <p className="text-sm text-red-500">
                {errors.name}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Location Details</Label>

            <Textarea
              placeholder="Enter location details"
              value={formData.location}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  location: e.target.value,
                })
              }
            />

            {errors.location && (
              <p className="text-sm text-red-500">
                {errors.location}
              </p>
            )}
          </div>

          <Button
            onClick={handleCreateSite}
            className="w-full rounded-xl"
          >
            Create Site
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}