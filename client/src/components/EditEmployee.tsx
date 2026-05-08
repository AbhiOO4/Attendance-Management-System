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

import { Input } from "@/components/ui/input"

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
  monthlySalary: number
}

interface Props {
  employee: Employee

  onSave: ( id: string, updateInfo: UpdateInfo ) => Promise<void>
}

function EditEmployee({employee, onSave }: Props) {
  const [open, setOpen] = useState(false)

  const [formData, setFormData] =
    useState<UpdateInfo>({
      name: employee.name,
      employeeId: employee.employeeId,
      jobTitle: employee.jobTitle,
      monthlySalary: employee.monthlySalary,
    })

  const handleSave = async () => {
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