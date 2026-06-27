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
  currentJob: string | null
  employmentType: 'permanent' | 'temporary'
}

type JobTitle = {
  _id: string
  title: string
}

type SiteJob = {
  _id: string
  name: string
}

interface Props {
  onAdd: (newEmployee: NewEmployee) => Promise<void>
  assignedSiteId: string
}

function AddTemporaryWorker({ onAdd, assignedSiteId }: Props) {
  const [open, setOpen] = useState(false)
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([])
  const [siteJobs, setSiteJobs] = useState<SiteJob[]>([])
  const [selectedJob, setSelectedJob] = useState<string>("")
  const [formData, setFormData] = useState<Omit<NewEmployee, "currentSite" | "employmentType" | "currentJob">>({
    name: "",
    employeeId: "",
    jobTitle: "",
  })

  const fetchTitles = async () => {
    try {
      const res = await api.get<JobTitle[]>('/api/employees/jobTitles')
      setJobTitles(res.data)
    } catch (error) {
      console.log(error)
    }
  }

  const fetchSiteJobs = async () => {
    try {
      const res = await api.get(`/api/site/${assignedSiteId}`)
      if (res.data && res.data.jobs) {
        const activeJobs = res.data.jobs.filter((j: any) => j.isActive && !j.isDeleted && !j.isCompleted)
        setSiteJobs(activeJobs)
      }
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

    const jobVal = selectedJob && selectedJob !== "none" ? selectedJob : null;

    await onAdd({
      ...formData,
      currentSite: assignedSiteId,
      currentJob: jobVal,
      employmentType: "temporary",
    })

    setFormData({
      name: "",
      employeeId: "",
      jobTitle: "",
    })
    setSelectedJob("")
    setOpen(false)
  }

  useEffect(() => {
    if (open) {
      fetchTitles()
      fetchSiteJobs()
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
            value={selectedJob}
            onValueChange={setSelectedJob}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select Active Job (Optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No Job / Unassigned</SelectItem>
              {siteJobs.map((job) => (
                <SelectItem key={job._id} value={job._id}>
                  {job.name}
                </SelectItem>
              ))}
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
