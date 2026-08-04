// EditEmployee.tsx

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

interface Employee {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
  monthlySalary: number
  currentSite: string | null
  currentJob: string | null
  employmentType: 'permanent' | 'temporary'
  nationality?: 'foreign' | 'omani'
}

type UpdateInfo = {
  name: string
  employeeId: string
  jobTitle: string
  currentSite: string | null
  currentJob: string | null
  monthlySalary: number
  employmentType: 'permanent' | 'temporary'
  nationality: 'foreign' | 'omani'
}

interface Site {
  _id: string
  siteName: string
}

interface SiteJob {
  _id: string
  name: string
}

type JobTitle = {
  _id: string
  title: string
}

interface Props {
  employee: Employee

  onSave: ( id: string, updateInfo: UpdateInfo ) => Promise<void>
  sites: Site []
}

function EditEmployee({employee, onSave, sites }: Props) {

  const [open, setOpen] = useState(false)

  const [jobTitles, setJobTitles] = useState<JobTitle[]>([])
  const [siteJobs, setSiteJobs] = useState<SiteJob[]>([])
  const [loadingJobs, setLoadingJobs] = useState(false)

  const [formData, setFormData] =
    useState<UpdateInfo>({
      name: employee.name,
      employeeId: employee.employeeId,
      jobTitle: employee.jobTitle,
      currentSite: employee.currentSite,
      currentJob: employee.currentJob,
      monthlySalary: employee.monthlySalary,
      employmentType: employee.employmentType || "permanent",
      nationality: employee.nationality || "foreign",
    })
  const [salaryInput, setSalaryInput] = useState(String(employee.monthlySalary))

  const fetchTitles = async () => {
    try {
      const res = await api.get<JobTitle[]>(
        "/api/employees/jobTitles"
      )
      setJobTitles(res.data)
    } catch (error) {
      console.log(error)
    }
  }

  const fetchSiteJobs = async (siteId: string) => {
    if (!siteId || siteId.trim() === " " || siteId === "none") {
      setSiteJobs([])
      return
    }
    try {
      setLoadingJobs(true)
      const res = await api.get<SiteJob[]>(`/api/site/${siteId}/Jobs`)
      setSiteJobs(res.data || [])
    } catch (error) {
      console.log(error)
      setSiteJobs([])
    } finally {
      setLoadingJobs(false)
    }
  }

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

    const salary = parseFloat(salaryInput)
    if (isNaN(salary) || salary <= 0) {
      toast.error("Monthly salary must be greater than 0")
      return
    }
    await onSave(employee._id, {
      ...formData,
      monthlySalary: salary,
    })
    setOpen(false)
  }

  useEffect(() => {
    if (open) {
      fetchTitles()
      // Pre-load jobs for the current site
      if (formData.currentSite && formData.currentSite.trim() !== " ") {
        fetchSiteJobs(formData.currentSite)
      }
      // Sync formData with latest employee prop when reopening
      setFormData({
        name: employee.name,
        employeeId: employee.employeeId,
        jobTitle: employee.jobTitle,
        currentSite: employee.currentSite,
        currentJob: employee.currentJob,
        monthlySalary: employee.monthlySalary,
        employmentType: employee.employmentType || "permanent",
        nationality: employee.nationality || "foreign",
      })
      setSalaryInput(String(employee.monthlySalary))
    }
  }, [open])

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
            value={formData.currentSite == null ? " ": formData.currentSite}
            onValueChange={(value) => {
              const newSite = value === " " ? null : value
              setFormData({
                ...formData,
                currentSite: newSite,
                // reset job when site changes
                currentJob: null,
              })
              if (newSite) fetchSiteJobs(newSite)
              else setSiteJobs([])
            }}
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

          {/* Job selector — only shown when a site is selected */}
          {formData.currentSite && formData.currentSite.trim() !== " " && (
            <Select
              value={formData.currentJob ?? "none"}
              onValueChange={(value) =>
                setFormData({
                  ...formData,
                  currentJob: value === "none" ? null : value,
                })
              }
              disabled={loadingJobs}
            >
              <SelectTrigger>
                <SelectValue placeholder={loadingJobs ? "Loading jobs..." : "Assign Job (optional)"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not Assigned</SelectItem>
                {siteJobs.map((job) => (
                  <SelectItem key={job._id} value={job._id}>
                    {job.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}


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

          <Input
            type="number"
            step="any"
            placeholder="Monthly Salary"
            value={salaryInput}
            onChange={(e) => setSalaryInput(e.target.value)}
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