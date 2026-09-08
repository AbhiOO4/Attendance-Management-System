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
  employmentType: 'permanent' | 'temporary'
  nationality?: 'foreign' | 'omani'
}

type UpdateInfo = {
  name: string
  employeeId: string
  jobTitle: string
  employmentType: 'permanent' | 'temporary'
  nationality: 'foreign' | 'omani'
  // null → clear the per-employee override (fall back to the global default).
  annualLeaveEntitlement?: number | null
}

type JobTitle = {
  _id: string
  title: string
}

interface Props {
  employee: Employee

  onSave: ( id: string, updateInfo: UpdateInfo ) => Promise<void>

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

  // Per-employee annual-leave override, held as a string so an empty field means
  // "use the global default". Loaded from the full employee doc when the dialog opens.
  const [entitlement, setEntitlement] = useState<string>("")

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

    const trimmed = entitlement.trim()
    const annualLeaveEntitlement = trimmed === "" ? null : Number(trimmed)

    await onSave(employee._id, { ...formData, annualLeaveEntitlement })
    setOpen(false)
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
      // The list row doesn't carry the entitlement — fetch the full doc for it.
      api
        .get(`/api/employees/${employee._id}`)
        .then((res) => {
          const v = res.data?.annualLeaveEntitlement
          setEntitlement(v === null || v === undefined ? "" : String(v))
        })
        .catch(() => setEntitlement(""))
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

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Annual leave override (days/year)
            </label>
            <Input
              type="number"
              min={0}
              max={365}
              placeholder="Leave blank for the global default"
              value={entitlement}
              onChange={(e) => setEntitlement(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Overrides the company default for this employee. Blank = use default.
            </p>
          </div>

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
