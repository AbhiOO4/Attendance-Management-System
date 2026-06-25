import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import SearchableSelect from "./SearchableSelect"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import toast from "react-hot-toast"
import { api } from "@/lib/api"

type NewEmployee = {
  name: string
  employeeId: string
  jobTitle: string
  currentSite: string 
  monthlySalary: number
  employmentType: 'permanent' | 'temporary'
}

type JobTitle = {
  _id: string
  title: string
}

interface Props {
  onAdd: (newEmployee: NewEmployee) => Promise<void>
  assignedSiteId: string
}

function AddTemporaryWorker({ onAdd, assignedSiteId }: Props) {
  const [open, setOpen] = useState(false)
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([])
  const [formData, setFormData] = useState<Omit<NewEmployee, "currentSite" | "employmentType">>({
    name: "",
    employeeId: "",
    jobTitle: "",
    monthlySalary: 0,
  })
  const [salaryInput, setSalaryInput] = useState("")

  const fetchTitles = async () => {
    try {
      const res = await api.get<JobTitle[]>('/api/employees/jobTitles')
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
      currentSite: assignedSiteId,
      monthlySalary: salary,
      employmentType: "temporary",
    })

    setFormData({
      name: "",
      employeeId: "",
      jobTitle: "",
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
          Add Hired Worker
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Add Hired Worker
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
            Add Worker
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default AddTemporaryWorker
