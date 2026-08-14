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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type NewEmployee = {
  name: string
  employeeId: string
  jobTitle: string
  currentSite: string
  employmentType: 'permanent' | 'temporary'
  nationality: 'foreign' | 'omani'
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
    nationality: "foreign",
  })

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

    await onAdd({
      ...formData,
      currentSite: assignedSiteId,
      employmentType: "temporary",
    })

    setFormData({
      name: "",
      employeeId: "",
      jobTitle: "",
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
          Add Hired Worker
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            Add Hired Worker
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
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
            value={formData.nationality}
            onValueChange={(value) =>
              setFormData({
                ...formData,
                nationality: value as "foreign" | "omani",
              })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Nationality" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="foreign">Foreign</SelectItem>
              <SelectItem value="omani">Omani</SelectItem>
            </SelectContent>
          </Select>

          <Button
            className="w-full mt-2"
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
