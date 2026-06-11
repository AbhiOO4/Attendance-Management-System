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

type JobTitle = {
  _id: string
  title: string
}

interface Props {
  onAdd: ( newEmployee: NewEmployee ) => Promise<void>
  sites: Site []
}

function AddEmployee({ onAdd, sites }: Props) {
  const [open, setOpen] = useState(false)

  const [jobTitles, setJobTitles] = useState<JobTitle[]>([])

  const [formData, setFormData] = useState<NewEmployee>({ name: "", employeeId: "", jobTitle: "",currentSite: " ", monthlySalary: 0,})
  const [salaryInput, setSalaryInput] = useState("")

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

    const salary = parseFloat(salaryInput)
    if (isNaN(salary) || salary <= 0) {
      toast.error("Monthly salary must be greater than 0")
      return
    }

    await onAdd({
      ...formData,
      monthlySalary: salary,
    })

    setFormData({
      name: "",
      employeeId: "",
      jobTitle: "",
      currentSite: " ",
      monthlySalary: 0,
    })
    setSalaryInput("")

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
            type="number"
            step="any"
            placeholder="Monthly Salary"
            value={salaryInput}
            onChange={(e) => setSalaryInput(e.target.value)}
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