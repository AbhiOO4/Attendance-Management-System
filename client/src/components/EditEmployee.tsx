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
import { COMPANY_ID_RE } from "@/lib/utils"
import { isDriverTitle } from "@/lib/driverJobs"

interface Employee {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
  employmentType: 'permanent' | 'temporary'
  nationality?: 'foreign' | 'omani'
  companyId?: string | null
  // Their site, if any — a driver title takes them off it (drivers live on Drivers Attendance).
  currentSite?: string | null
}

type UpdateInfo = {
  name: string
  employeeId: string
  jobTitle: string
  employmentType: 'permanent' | 'temporary'
  nationality: 'foreign' | 'omani'
  // null → clear the company ID.
  companyId?: string | null
}

type JobTitle = {
  _id: string
  title: string
}

interface Props {
  employee: Employee

  // Resolves true on success; the dialog stays open (keeping the input) otherwise.
  onSave: ( id: string, updateInfo: UpdateInfo ) => Promise<boolean>

  // Optional controlled mode: pass open/onOpenChange to drive the dialog from a
  // parent (e.g. a kebab menu item) and hideTrigger to drop the built-in button.
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}

function EditEmployee({ employee, onSave, open: controlledOpen, onOpenChange, hideTrigger }: Props) {

  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = (v: boolean) => {
    if (!isControlled) setInternalOpen(v)
    onOpenChange?.(v)
  }

  const [jobTitles, setJobTitles] = useState<JobTitle[]>([])

  const [formData, setFormData] =
    useState<UpdateInfo>({
      name: employee.name,
      employeeId: employee.employeeId,
      jobTitle: employee.jobTitle,
      employmentType: employee.employmentType || "permanent",
      nationality: employee.nationality || "foreign",
    })

  // Optional company ID, blank = none (clears it on save).
  const [companyId, setCompanyId] = useState<string>(employee.companyId ?? "")

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

    const trimmedCompanyId = companyId.trim()
    if (trimmedCompanyId && !COMPANY_ID_RE.test(trimmedCompanyId)) {
      toast.error("Company ID may only contain letters, numbers and hyphens")
      return
    }

    const ok = await onSave(employee._id, {
      ...formData,
      companyId: trimmedCompanyId || null,
    })
    if (ok) setOpen(false)
  }

  useEffect(() => {
    if (open) {
      fetchTitles()
      // Sync formData with latest employee prop when reopening
      setFormData({
        name: employee.name,
        employeeId: employee.employeeId,
        jobTitle: employee.jobTitle,
        employmentType: employee.employmentType || "permanent",
        nationality: employee.nationality || "foreign",
      })
      setCompanyId(employee.companyId ?? "")
      // Fetch the full doc for the freshest company ID.
      api
        .get(`/api/employees/${employee._id}`)
        .then((res) => {
          setCompanyId(res.data?.companyId ?? "")
        })
        .catch(() => {})
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button variant="outline">
            Edit
          </Button>
        </DialogTrigger>
      )}

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
            placeholder="Company ID (optional, e.g. NGDP-105)"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
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
          {isDriverTitle(formData.jobTitle) && !isDriverTitle(employee.jobTitle) && employee.currentSite && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
              Drivers are marked only on Drivers Attendance. Saving takes this employee off their
              current site and job; their past attendance stays as it is.
            </p>
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
