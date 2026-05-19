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

interface Site {
  _id: string
  siteName: string
}

type NewEmployee = {
  name: string
  employeeId: string
  jobTitle: string
  currentSite: string 
  monthlySalary: number
}

interface Props {
  onAdd: ( newEmployee: NewEmployee ) => Promise<void>
  sites: Site []
}

function AddEmployee({ onAdd, sites }: Props) {
  const [open, setOpen] = useState(false)

  const [formData, setFormData] = useState<NewEmployee>({ name: "", employeeId: "", jobTitle: "",currentSite: " ", monthlySalary: 0,})

  const handleSubmit = async () => {

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

    await onAdd(formData)

    setFormData({
      name: "",
      employeeId: "",
      jobTitle: "",
      currentSite: " ",
      monthlySalary: 0,
    })

    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          Add Employee
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Add Employee
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
            value={formData.currentSite}
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
            onClick={handleSubmit}
          >
            Add Employee
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default AddEmployee