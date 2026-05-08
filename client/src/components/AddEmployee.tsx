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

type NewEmployee = {
  name: string
  employeeId: string
  jobTitle: string
  monthlySalary: number
}

interface Props {
  onAdd: (
    newEmployee: NewEmployee
  ) => Promise<void>
}

function AddEmployee({ onAdd }: Props) {
  const [open, setOpen] = useState(false)

  const [formData, setFormData] =
    useState<NewEmployee>({
      name: "",
      employeeId: "",
      jobTitle: "",
      monthlySalary: 0,
    })

  const handleSubmit = async () => {
    await onAdd(formData)

    setFormData({
      name: "",
      employeeId: "",
      jobTitle: "",
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