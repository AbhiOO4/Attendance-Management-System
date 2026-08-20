// pages/SiteJobs.tsx

import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, Briefcase, Loader2, Plus, Trash2, Users } from "lucide-react"
import toast from "react-hot-toast"

import { api } from "@/lib/api"
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

interface Site {
  _id: string
  siteName: string
  isActive: boolean
}

interface Job {
  _id: string
  name: string
  jobCode: string
  isActive: boolean
  isCompleted?: boolean
  employeeCount?: number
}

function SiteJobs() {
  const { id } = useParams()

  const [site, setSite] = useState<Site | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [loadingJobs, setLoadingJobs] = useState(false)

  // Add job
  const [jobDialogOpen, setJobDialogOpen] = useState(false)
  const [creatingJob, setCreatingJob] = useState(false)
  const [jobForm, setJobForm] = useState({ name: "", jobCode: "" })
  const [jobErrors, setJobErrors] = useState({ name: "", jobCode: "", general: "" })

  // Delete job
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [jobToDelete, setJobToDelete] = useState<Job | null>(null)
  const [deletingJob, setDeletingJob] = useState(false)

  // Deactivate job (unassigns its employees)
  const [confirmDeactivateOpen, setConfirmDeactivateOpen] = useState(false)
  const [jobToDeactivate, setJobToDeactivate] = useState<Job | null>(null)

  // Per-job in-flight status toggle (id being toggled)
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null)

  const isSiteActive = site?.isActive

  async function fetchSite() {
    try {
      const res = await api.get(`/api/site/${id}`)
      setSite(res.data)
    } catch (error) {
      console.log(error)
    }
  }

  async function fetchJobs(showLoading = false) {
    try {
      if (showLoading || jobs.length === 0) setLoadingJobs(true)
      const res = await api.get(`/api/site/${id}/Jobs`)
      setJobs(res.data)
    } catch (error) {
      console.log(error)
      setJobs([])
    } finally {
      setLoadingJobs(false)
    }
  }

  useEffect(() => {
    if (!id) return
    fetchSite()
    fetchJobs(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  function validateJobForm() {
    const errors = { name: "", jobCode: "", general: "" }
    let valid = true
    if (!jobForm.name.trim()) {
      errors.name = "Job name is required"
      valid = false
    }
    if (!jobForm.jobCode.trim()) {
      errors.jobCode = "Job code is required"
      valid = false
    }
    setJobErrors(errors)
    return valid
  }

  async function createJob() {
    if (!validateJobForm()) return
    try {
      setCreatingJob(true)
      await api.post(`/api/site/${id}/add-job`, {
        name: jobForm.name.trim(),
        jobCode: jobForm.jobCode.trim(),
      })
      setJobForm({ name: "", jobCode: "" })
      setJobErrors({ name: "", jobCode: "", general: "" })
      setJobDialogOpen(false)
      toast.success("Job created")
      fetchJobs(true)
    } catch (error: any) {
      setJobErrors((prev) => ({
        ...prev,
        general: error?.response?.data?.message || "Failed to create job",
      }))
    } finally {
      setCreatingJob(false)
    }
  }

  async function toggleCompleted(job: Job) {
    try {
      setStatusBusyId(job._id)
      // The endpoint returns the updated job. Completing a job doesn't change any
      // of the per-job stats (employeeCount / man-hours), so patch it into local
      // state directly instead of triggering the heavy getSiteJobs refetch — the
      // label flips as soon as this single round-trip resolves.
      const res = await api.patch(`/api/site/job/${job._id}/toggle-completed`)
      const updated = res.data
      setJobs((prev) =>
        prev.map((j) =>
          j._id === job._id
            ? { ...j, isCompleted: updated.isCompleted, isActive: updated.isActive }
            : j
        )
      )
      toast.success(`Job marked as ${updated.isCompleted ? "completed" : "incomplete"}`)
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to update job status")
    } finally {
      setStatusBusyId(null)
    }
  }

  async function toggleActive(job: Job) {
    try {
      setStatusBusyId(job._id)
      await api.patch(`/api/site/job/${job._id}/status`)
      toast.success(job.isActive ? "Job deactivated" : "Job reactivated")
      setConfirmDeactivateOpen(false)
      setJobToDeactivate(null)
      fetchJobs(false)
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to update job status")
    } finally {
      setStatusBusyId(null)
    }
  }

  async function handleDeleteJob() {
    if (!jobToDelete) return
    try {
      setDeletingJob(true)
      await api.delete(`/api/site/job/${jobToDelete._id}`)
      toast.success("Job soft-deleted successfully")
      setConfirmDeleteOpen(false)
      setJobToDelete(null)
      fetchJobs(true)
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to delete job")
    } finally {
      setDeletingJob(false)
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <Link
          to={`/site/${id ?? ""}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border bg-background">
            <ArrowLeft className="h-4 w-4" />
          </span>
          <span>Back to site</span>
        </Link>

        {/* Header */}
        <Card className="rounded-3xl border bg-card p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2 text-primary">
                <Briefcase className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Jobs</h1>
                <p className="text-sm text-muted-foreground">{site?.siteName}</p>
              </div>
            </div>

            <Dialog open={jobDialogOpen} onOpenChange={setJobDialogOpen}>
              <DialogTrigger asChild>
                <Button className="rounded-xl" disabled={!isSiteActive}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Job
                </Button>
              </DialogTrigger>

              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="text-2xl">Create New Job</DialogTitle>
                  <DialogDescription>Add a new job under this site.</DialogDescription>
                </DialogHeader>

                <div className="space-y-5 py-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Job Name</label>
                    <Input
                      placeholder="Enter job name"
                      value={jobForm.name}
                      onChange={(e) => setJobForm((p) => ({ ...p, name: e.target.value }))}
                    />
                    {jobErrors.name && <p className="text-sm text-red-500">{jobErrors.name}</p>}
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Job Code</label>
                    <Input
                      placeholder="Enter job code"
                      value={jobForm.jobCode}
                      onChange={(e) => setJobForm((p) => ({ ...p, jobCode: e.target.value }))}
                    />
                    {jobErrors.jobCode && (
                      <p className="text-sm text-red-500">{jobErrors.jobCode}</p>
                    )}
                  </div>

                  {jobErrors.general && (
                    <p className="text-sm text-red-500">{jobErrors.general}</p>
                  )}
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setJobDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button disabled={creatingJob} onClick={createJob}>
                    {creatingJob ? "Creating..." : "Create Job"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </Card>

        {/* Jobs grid */}
        <Card className="rounded-3xl border bg-card p-6 shadow-sm sm:p-8">
          {loadingJobs ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              Loading jobs...
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-3 text-center">
              <div className="rounded-full bg-muted/60 p-3">
                <Briefcase className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">No jobs found</p>
                <p className="text-sm text-muted-foreground">
                  Create your first job for this site.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {jobs.map((job) => (
                <div
                  key={job._id}
                  className="rounded-2xl border bg-background p-5 transition hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="rounded-xl bg-primary/10 p-2 text-primary">
                        <Briefcase className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-semibold">{job.name}</h3>
                        <p className="truncate text-sm text-muted-foreground">{job.jobCode}</p>
                      </div>
                    </div>

                    <Button
                      variant="destructive"
                      size="icon-xs"
                      className="h-7 w-7 shrink-0 rounded-lg p-0"
                      onClick={() => {
                        setJobToDelete(job)
                        setConfirmDeleteOpen(true)
                      }}
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
                    {job.isCompleted && (
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                        Completed
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      <Users className="h-3 w-3" />
                      {job.employeeCount ?? 0}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {job.isActive && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={statusBusyId === job._id}
                        className={`h-8 rounded-lg px-2.5 text-xs font-medium transition-all ${
                          job.isCompleted
                            ? "bg-indigo-500 hover:bg-indigo-600 text-white border-indigo-600 dark:bg-indigo-600 dark:hover:bg-indigo-700"
                            : "hover:bg-accent"
                        }`}
                        onClick={() => toggleCompleted(job)}
                      >
                        {statusBusyId === job._id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          job.isCompleted ? "Reopen" : "Complete"
                        )}
                      </Button>
                    )}

                    {job.isActive ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={statusBusyId === job._id}
                        className="h-8 rounded-lg px-2.5 text-xs font-medium text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          setJobToDeactivate(job)
                          setConfirmDeactivateOpen(true)
                        }}
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
                        Reactivate
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Delete Job Dialog */}
      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Job?
            </DialogTitle>
            <DialogDescription className="pt-2 text-base">
              Are you sure you want to delete job <strong>{jobToDelete?.name}</strong> (
              {jobToDelete?.jobCode})?
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-2 rounded-xl border border-destructive/10 bg-destructive/5 p-4 text-sm text-destructive">
            <p className="font-semibold">This action is permanent for the active roster:</p>
            <ul className="list-disc space-y-1 pl-4">
              <li>
                All employees assigned to this job will have their job assignments cleared
                (set to null).
              </li>
              <li>The job will be removed from the site's jobs array.</li>
            </ul>
          </div>

          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              disabled={deletingJob}
              onClick={() => {
                setConfirmDeleteOpen(false)
                setJobToDelete(null)
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" disabled={deletingJob} onClick={handleDeleteJob}>
              {deletingJob ? "Deleting..." : "Confirm Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivate Job Dialog */}
      <Dialog open={confirmDeactivateOpen} onOpenChange={setConfirmDeactivateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl">Deactivate Job?</DialogTitle>
            <DialogDescription className="pt-3 text-base leading-relaxed">
              Employees associated with <strong>{jobToDeactivate?.name}</strong> will be
              removed from the job assignment upon deactivation.
              <br />
              <br />
              They will remain assigned to the site but will no longer belong to this job.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-4 flex-col gap-3 sm:flex-row">
            <Button variant="outline" onClick={() => setConfirmDeactivateOpen(false)}>
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

export default SiteJobs
