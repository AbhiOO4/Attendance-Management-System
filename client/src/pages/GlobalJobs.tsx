// pages/GlobalJobs.tsx — jobs common to every site (general-expense hours). Server:
// utils/globalJobs.js, routes under /api/jobs/global.

import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Globe, Loader2, Plus, Trash2 } from "lucide-react"
import toast from "react-hot-toast"
import { isAxiosError } from "axios"

import { api } from "@/lib/api"
import { invalidateDriverJobs } from "@/lib/driverJobs"
import { invalidateGlobalJobs, JOB_CODE_MAX_LENGTH, JOB_CODE_PATTERN } from "@/lib/globalJobs"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

interface GlobalJob {
  _id: string
  name: string
  jobCode: string | null
  isActive: boolean
  isCompleted?: boolean
}

// The server's `message` for a failed request, else `fallback`.
const apiMessage = (error: unknown, fallback: string) =>
  (isAxiosError<{ message?: string }>(error) && error.response?.data?.message) || fallback

// The pickers cache the job lists for a minute; drop them after any change here.
const invalidatePickers = () => {
  invalidateGlobalJobs()
  invalidateDriverJobs()
}

function GlobalJobs() {
  const navigate = useNavigate()

  // Back to the Sites page by POPPING history when we came from it (so its Back state is
  // kept); opened directly, navigate there instead.
  const backToSites = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate("/site")
  }

  const [jobs, setJobs] = useState<GlobalJob[]>([])
  const [loading, setLoading] = useState(true)

  // Add job
  const [dialogOpen, setDialogOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: "", jobCode: "" })
  const [errors, setErrors] = useState({ name: "", jobCode: "", general: "" })

  // Delete job
  const [jobToDelete, setJobToDelete] = useState<GlobalJob | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Deactivate job
  const [jobToDeactivate, setJobToDeactivate] = useState<GlobalJob | null>(null)

  // Per-job in-flight status toggle (id being toggled)
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null)

  async function fetchJobs() {
    try {
      const res = await api.get<{ data: GlobalJob[] }>("/api/jobs/global/manage")
      setJobs(res.data.data || [])
    } catch (error) {
      console.log(error)
      toast.error("Failed to load global jobs")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchJobs()
  }, [])

  function validateForm() {
    const next = { name: "", jobCode: "", general: "" }
    const code = form.jobCode.trim()
    if (!form.name.trim()) next.name = "Job name is required"
    if (!code) next.jobCode = "Job code is required"
    else if (code.length > JOB_CODE_MAX_LENGTH || !JOB_CODE_PATTERN.test(code)) {
      next.jobCode = "Use letters, numbers and single hyphens between them (e.g. GEN-EXP-01)"
    }
    setErrors(next)
    return !next.name && !next.jobCode
  }

  async function createJob() {
    if (!validateForm()) return
    try {
      setCreating(true)
      await api.post("/api/jobs/global", {
        name: form.name.trim(),
        jobCode: form.jobCode.trim(),
      })
      invalidatePickers()
      setForm({ name: "", jobCode: "" })
      setErrors({ name: "", jobCode: "", general: "" })
      setDialogOpen(false)
      toast.success("Global job created")
      fetchJobs()
    } catch (error) {
      setErrors((prev) => ({
        ...prev,
        general: apiMessage(error, "Failed to create global job"),
      }))
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(job: GlobalJob) {
    try {
      setStatusBusyId(job._id)
      const res = await api.patch(`/api/jobs/global/${job._id}/status`)
      const isActive = !!res.data?.data?.isActive
      invalidatePickers()
      setJobs((prev) => prev.map((j) => (j._id === job._id ? { ...j, isActive } : j)))
      setJobToDeactivate(null)
      toast.success(isActive ? "Global job reactivated" : "Global job deactivated")
    } catch (error) {
      toast.error(apiMessage(error, "Failed to update job status"))
    } finally {
      setStatusBusyId(null)
    }
  }

  async function handleDelete() {
    if (!jobToDelete) return
    try {
      setDeleting(true)
      await api.delete(`/api/jobs/global/${jobToDelete._id}`)
      invalidatePickers()
      setJobs((prev) => prev.filter((j) => j._id !== jobToDelete._id))
      setJobToDelete(null)
      toast.success("Global job deleted")
    } catch (error) {
      toast.error(apiMessage(error, "Failed to delete global job"))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <button
          type="button"
          onClick={backToSites}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border bg-background">
            <ArrowLeft className="h-4 w-4" />
          </span>
          <span>Back to sites</span>
        </button>

        {/* Header */}
        <Card className="rounded-3xl border bg-card p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2 text-primary">
                <Globe className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Global Jobs</h1>
                <p className="text-sm text-muted-foreground">
                  Jobs available on every site's attendance sheet and the drivers sheet — for
                  hours tracked against general expenses.
                </p>
              </div>
            </div>

            <Dialog
              open={dialogOpen}
              onOpenChange={(o) => {
                setDialogOpen(o)
                if (!o) setErrors({ name: "", jobCode: "", general: "" })
              }}
            >
              <DialogTrigger asChild>
                <Button className="shrink-0 rounded-xl">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Global Job
                </Button>
              </DialogTrigger>

              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="text-2xl">Create Global Job</DialogTitle>
                  <DialogDescription>
                    Once created it can be picked for any session on every site and on the
                    drivers sheet.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-5 py-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="global-job-name">Job Name</label>
                    <Input
                      id="global-job-name"
                      placeholder="e.g. General Expenses"
                      value={form.name}
                      onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    />
                    {errors.name && <p className="text-sm text-red-500">{errors.name}</p>}
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="global-job-code">Job Code</label>
                    <Input
                      id="global-job-code"
                      placeholder="e.g. GEN-EXP-01"
                      maxLength={JOB_CODE_MAX_LENGTH}
                      value={form.jobCode}
                      onChange={(e) => setForm((p) => ({ ...p, jobCode: e.target.value }))}
                    />
                    {errors.jobCode ? (
                      <p className="text-sm text-red-500">{errors.jobCode}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Letters, numbers and hyphens. Must match the ERPNext Job Order.
                      </p>
                    )}
                  </div>

                  {errors.general && <p className="text-sm text-red-500">{errors.general}</p>}
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button disabled={creating} onClick={createJob}>
                    {creating ? "Creating..." : "Create Job"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </Card>

        {/* Jobs grid */}
        <Card className="rounded-3xl border bg-card p-6 shadow-sm sm:p-8">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              Loading global jobs...
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-3 text-center">
              <div className="rounded-full bg-muted/60 p-3">
                <Globe className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">No global jobs yet</p>
                <p className="text-sm text-muted-foreground">
                  Create one to track hours against general expenses on any site.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {jobs.map((job) => (
                <div key={job._id} className="rounded-2xl border bg-background p-5 transition hover:shadow-md">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="rounded-xl bg-primary/10 p-2 text-primary">
                        <Globe className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-semibold">{job.name}</h3>
                        <p className="truncate font-mono text-sm text-muted-foreground">{job.jobCode}</p>
                      </div>
                    </div>

                    <Button
                      variant="destructive"
                      size="icon-xs"
                      className="h-7 w-7 shrink-0 rounded-lg p-0"
                      aria-label={`Delete ${job.name}`}
                      onClick={() => setJobToDelete(job)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        job.isActive
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                      }`}
                    >
                      {job.isActive ? "Active" : "Inactive"}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      All sites
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {job.isActive ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={statusBusyId === job._id}
                        className="h-8 rounded-lg px-2.5 text-xs font-medium text-destructive hover:bg-destructive/10"
                        onClick={() => setJobToDeactivate(job)}
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={statusBusyId === job._id}
                        className="h-8 rounded-lg px-2.5 text-xs font-medium"
                        onClick={() => toggleActive(job)}
                      >
                        {statusBusyId === job._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Reactivate"}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Delete dialog */}
      <Dialog open={!!jobToDelete} onOpenChange={(o) => !o && setJobToDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Global Job?
            </DialogTitle>
            <DialogDescription className="pt-2 text-base">
              Delete <strong>{jobToDelete?.name}</strong> ({jobToDelete?.jobCode})? It will no longer
              be offered on any attendance sheet. Sessions already logged against it keep it.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" disabled={deleting} onClick={() => setJobToDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={handleDelete}>
              {deleting ? "Deleting..." : "Confirm Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivate dialog */}
      <Dialog open={!!jobToDeactivate} onOpenChange={(o) => !o && setJobToDeactivate(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl">Deactivate Global Job?</DialogTitle>
            <DialogDescription className="pt-3 text-base leading-relaxed">
              <strong>{jobToDeactivate?.name}</strong> will stop being offered on the attendance
              sheets until it is reactivated. Hours already logged against it are kept.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-4 flex-col gap-3 sm:flex-row">
            <Button variant="outline" onClick={() => setJobToDeactivate(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={statusBusyId === jobToDeactivate?._id}
              onClick={() => jobToDeactivate && toggleActive(jobToDeactivate)}
            >
              {statusBusyId === jobToDeactivate?._id ? "Deactivating..." : "Deactivate Job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default GlobalJobs
