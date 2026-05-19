// EditEmployee.tsx

import { useState } from "react"

import { Button } from "@/components/ui/button"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"


import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Input } from "@/components/ui/input"
import toast from "react-hot-toast"

interface Employee {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
  monthlySalary: number
  currentSite: string | null
}

type UpdateInfo = {
  name: string
  employeeId: string
  jobTitle: string
  currentSite: string | null
  monthlySalary: number
}

interface Site {
  _id: string
  siteName: string
}

interface Props {
  employee: Employee

  onSave: ( id: string, updateInfo: UpdateInfo ) => Promise<void>
  sites: Site []
}

function EditEmployee({employee, onSave, sites }: Props) {

  const [open, setOpen] = useState(false)

  const [formData, setFormData] =
    useState<UpdateInfo>({
      name: employee.name,
      employeeId: employee.employeeId,
      jobTitle: employee.jobTitle,
      currentSite: employee.currentSite,
      monthlySalary: employee.monthlySalary,
    })

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error("Name is required")
      return
    }

    if (!formData.employeeId.trim()) {
      toast.error("Employee ID is required")
      return
    }

    if (!formData.jobTitle.trim()) {
      toast.error("Job title is required")
      return
    }

    if (formData.monthlySalary <= 0) {
      toast.error("Monthly salary must be greater than 0")
      return
    }
    await onSave(employee._id, formData)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          Edit
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Edit Employee
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Input
            placeholder="Name"
            value={formData.name}
            onChange={(e) =>
              setFormData({
                ...formData,
                name: e.target.value,
              })
            }
          />

          <Input
            placeholder="Employee ID"
            value={formData.employeeId}
            onChange={(e) =>
              setFormData({
                ...formData,
                employeeId: e.target.value,
              })
            }
          />

          <Input
            placeholder="Job Title"
            value={formData.jobTitle}
            onChange={(e) =>
              setFormData({
                ...formData,
                jobTitle: e.target.value,
              })
            }
          />

           <Select
            value={formData.currentSite == null ? " ": formData.currentSite}
            onValueChange={(value) => setFormData({
              ...formData,
              currentSite: value
            })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Assign Site" />
            </SelectTrigger>

            <SelectContent>
              <SelectItem value=" ">
                Not Assigned
              </SelectItem>

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


          <Input
            placeholder="Monthly Salary"
            value={formData.monthlySalary || ""}
            onChange={(e) =>
              setFormData({
                ...formData,
                monthlySalary: Number(
                  e.target.value
                ),
              })
            }
          />

          <Button
            className="w-full"
            onClick={handleSave}
          >
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default EditEmployee