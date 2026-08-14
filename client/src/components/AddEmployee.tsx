import { useState } from "react"
import { useEffect } from "react"


import { Button } from "@/components/ui/button"
import SearchableSelect from "./SearchableSelect"

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
import { api } from "@/lib/api"

type NewEmployee = {
  name: string
  employeeId: string
  jobTitle: string
  employmentType: 'permanent' | 'temporary'
  nationality: 'foreign' | 'omani'
}

type JobTitle = {
  _id: string
  title: string
}

interface Props {
  onAdd: ( newEmployee: NewEmployee ) => Promise<void>
}

function AddEmployee({ onAdd }: Props) {
  const [open, setOpen] = useState(false)

  const [jobTitles, setJobTitles] = useState<JobTitle[]>([])

  const [formData, setFormData] = useState<NewEmployee>({ name: "", employeeId: "", jobTitle: "", employmentType: "permanent", nationality: "foreign"})

  const fetchTitles = async () => {
    try {
      const res = await api.get<JobTitle[]>('/api/employees/jobTitles')
      console.log(res.data)
      setJobTitles(res.data)
    } catch (error) {
      console.log(error)
    }
  }

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

    await onAdd({ ...formData })

    setFormData({
      name: "",
      employeeId: "",
      jobTitle: "",
      employmentType: "permanent",
      nationality: "foreign",
    })

    setOpen(false)
  }

  useEffect(() => {
    if (open) {
      fetchTitles()
    }
  }, [open])

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

          <SearchableSelect
            jobs={jobTitles}
            value={formData.jobTitle}
            onChange={(value) =>
              setFormData({
                ...formData,
                jobTitle: value,
              })
            }
            placeholder="Select Job Title"
          />

          <Select
            value={formData.employmentType}
            onValueChange={(value) => setFormData({
              ...formData,
              employmentType: value as "permanent" | "temporary"
            })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Employment Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="permanent">Permanent</SelectItem>
              <SelectItem value="temporary">Temporary</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={formData.nationality}
            onValueChange={(value) => setFormData({
              ...formData,
              nationality: value as "foreign" | "omani"
            })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Nationality" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="foreign">Foreign</SelectItem>
              <SelectItem value="omani">Omani</SelectItem>
            </SelectContent>
          </Select>

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
