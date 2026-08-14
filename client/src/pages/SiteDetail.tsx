import { useEffect, useState } from "react"
import { useParams, useNavigate, useLocation } from "react-router-dom"
import {
  Plus,
  MapPin,
  ArrowLeft,
  Trash2,
  Briefcase,
  Users,
  CalendarDays,
} from "lucide-react"

import toast from "react-hot-toast"

import { api } from "@/lib/api"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

import SiteRoster from "@/components/site/SiteRoster"

interface Site {
  _id: string
  siteName: string
  locationDetails: string
  isActive: boolean
  jobs: string[]
  isPermanent?: boolean
  isCompleted?: boolean
  defaultCheckIn?: string
  defaultCheckOut?: string
}

interface Job {
  _id: string
  name: string
  jobCode: string
  isActive: boolean
  isCompleted?: boolean
}

interface SiteStats {
  siteId: string
  totalManHours: number
  totalManDays: number
  totalCalendarDays: number
}

function SiteDetail() {
  const { id } = useParams()

  const navigate = useNavigate()
  const location = useLocation()

  const [site, setSite] = useState<Site | null>(null)

  // Today-roster size, reported up from the embedded SiteRoster for the stat strip.
  const [todayCount, setTodayCount] = useState<number | null>(null)

  const [deactivateOpen, setDeactivateOpen] = useState(false)

  const [deactivating, setDeactivating] = useState(false)

  // jobs
  const [jobs, setJobs] = useState<Job[]>([])

  const [loadingJobs, setLoadingJobs] = useState(false)

  const [jobDialogOpen, setJobDialogOpen] = useState(false)

  const [creatingJob, setCreatingJob] = useState(false)

  const [jobForm, setJobForm] = useState({
    name: "",
    jobCode: "",
  })

  const [jobErrors, setJobErrors] = useState({
    name: "",
    jobCode: "",
    general: "",
  })

  const [reactivating, setReactivating] = useState(false)

  // Delete Site states
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deletingSite, setDeletingSite] = useState(false)

  // Delete Job states
  const [confirmDeleteJobOpen, setConfirmDeleteJobOpen] = useState(false)
  const [jobToDelete, setJobToDelete] = useState<Job | null>(null)
  const [deletingJob, setDeletingJob] = useState(false)

  // Edit Location state
  const [isEditingLocation, setIsEditingLocation] = useState(false)
  const [editedLocationDetails, setEditedLocationDetails] = useState("")
  const [savingLocation, setSavingLocation] = useState(false)

  const isSiteActive = site?.isActive

  const [siteStats, setSiteStats] = useState<SiteStats | null>(null)

  const [loadingSiteStats, setLoadingSiteStats] = useState(false)

  async function fetchSiteStats() {
    try {
      setLoadingSiteStats(true)

      const res = await api.get(`/api/site/${id}/site-data`)

      setSiteStats(res.data)
    } catch (error) {
      console.log(error)

      setSiteStats(null)
    } finally {
      setLoadingSiteStats(false)
    }
  }

  async function fetchJobs(showLoading = false) {
    try {
      if (showLoading || jobs.length === 0) {
        setLoadingJobs(true)
      }

      const res = await api.get(`/api/site/${id}/Jobs`)

      setJobs(res.data)
    } catch (error) {
      console.log(error)

      setJobs([])
    } finally {
      setLoadingJobs(false)
    }
  }

  async function fetchSite() {
    try {
      const res = await api.get(`/api/site/${id}`)

      setSite(res.data)
    } catch (error) {
      console.log(error)
    }
  }

  function validateJobForm() {
    const errors = {
      name: "",
      jobCode: "",
      general: "",
    }

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
    try {
      const isValid = validateJobForm()

      if (!isValid) return

      setCreatingJob(true)

      await api.post(`/api/site/${id}/add-job`, {
        name: jobForm.name.trim(),
        jobCode: jobForm.jobCode.trim(),
      })

      setJobForm({
        name: "",
        jobCode: "",
      })

      setJobErrors({
        name: "",
        jobCode: "",
        general: "",
      })

      setJobDialogOpen(false)

      fetchJobs(true)
    } catch (error: any) {
      console.log(error)

      setJobErrors((prev) => ({
        ...prev,
        general:
          error?.response?.data?.message || "Failed to create job",
      }))
    } finally {
      setCreatingJob(false)
    }
  }

  useEffect(() => {
    if (!id) return

    fetchSite()
    fetchSiteStats()
  }, [id])

  useEffect(() => {
    if (id) {
      fetchJobs(true)
    }
  }, [id])

  async function deactivateSite() {
    try {
      setDeactivating(true)

      await api.patch(`/api/site/deactivate/${id}`)

      await fetchSite()

      setDeactivateOpen(false)
    } catch (error) {
      console.log(error)
    } finally {
      setDeactivating(false)
    }
  }

  async function reactivateSite() {
    try {
      setReactivating(true)

      await api.patch(`/api/site/reactivate/${id}`)

      await fetchSite()
    } catch (error) {
      console.log(error)
    } finally {
      setReactivating(false)
    }
  }

  async function handleSaveLocation() {
    if (!site) return
    try {
      setSavingLocation(true)
      await api.patch(`/api/site/${site._id}`, {
        locationDetails: editedLocationDetails.trim(),
      })
      toast.success("Location details updated successfully")
      setIsEditingLocation(false)
      fetchSite()
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message || "Failed to update location details"
      )
    } finally {
      setSavingLocation(false)
    }
  }

  async function handleDeleteSite() {
    try {
      setDeletingSite(true)
      await api.delete(`/api/site/${id}`)
      toast.success("Site soft-deleted successfully")
      setConfirmDeleteOpen(false)
      navigate("/site")
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to delete site")
    } finally {
      setDeletingSite(false)
    }
  }

  async function handleDeleteJob() {
    if (!jobToDelete) return
    try {
      setDeletingJob(true)
      await api.delete(`/api/site/job/${jobToDelete._id}`)
      toast.success("Job soft-deleted successfully")
      setConfirmDeleteJobOpen(false)
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
        <button
          type="button"
          onClick={() => {
            if (location.state?.from === "dashboard") {
              navigate(-1)
            } else {
              navigate("/site")
            }
          }}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border bg-background">
            <ArrowLeft className="h-4 w-4" />
          </span>
          <span>Back</span>
        </button>

        {/* Site Header */}
        <Card className="rounded-3xl border bg-card p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                    {site?.siteName || "Site"}
                  </h1>

                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      site?.isActive
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                    }`}
                  >
                    {site?.isActive ? "Active" : "Inactive"}
                  </span>

                  {site?.isCompleted && (
                    <span className="rounded-full px-3 py-1 text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                      Completed
                    </span>
                  )}

                  {site?.isPermanent && (
                    <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 font-medium">
                      Permanent Home Site
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4 shrink-0" />
                  <p className="truncate">{site?.locationDetails}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                {isSiteActive && (
                  <>
                    <Button
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => {
                        if (site) {
                          setEditedLocationDetails(site.locationDetails)
                          setIsEditingLocation(true)
                        }
                      }}
                    >
                      Edit Location
                    </Button>

                    {!site?.isPermanent && (
                      <Button
                        variant="outline"
                        className={`rounded-xl transition-all ${
                          site?.isCompleted
                            ? "bg-indigo-500 hover:bg-indigo-600 text-white border-indigo-600 dark:bg-indigo-600 dark:hover:bg-indigo-700"
                            : "hover:bg-accent"
                        }`}
                        onClick={async () => {
                          if (!site) return
                          try {
                            const updatedStatus = !site.isCompleted
                            await api.patch(`/api/site/${site._id}`, {
                              isCompleted: updatedStatus,
                            })
                            toast.success(
                              `Site marked as ${
                                updatedStatus ? "completed" : "incomplete"
                              }`
                            )
                            fetchSite()
                          } catch (error: any) {
                            toast.error(
                              error?.response?.data?.message ||
                                "Failed to update site status"
                            )
                          }
                        }}
                      >
                        {site?.isCompleted ? "Reopen Site" : "Complete Site"}
                      </Button>
                    )}
                  </>
                )}

                {!site?.isPermanent &&
                  (isSiteActive ? (
                    <Dialog
                      open={deactivateOpen}
                      onOpenChange={setDeactivateOpen}
                    >
                      <DialogTrigger asChild>
                        <Button variant="destructive" className="rounded-xl">
                          Deactivate Site
                        </Button>
                      </DialogTrigger>

                      <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                          <DialogTitle className="text-2xl">
                            Deactivate Site?
                          </DialogTitle>

                          <DialogDescription className="pt-3 text-base leading-relaxed">
                            All employees and supervisors associated with this
                            site will be removed from the site upon
                            deactivation.
                            <br />
                            <br />
                            Jobs under this site will also become inactive.
                          </DialogDescription>
                        </DialogHeader>

                        <DialogFooter className="mt-4 flex-col gap-3 sm:flex-row">
                          <Button
                            variant="outline"
                            onClick={() => setDeactivateOpen(false)}
                          >
                            Cancel
                          </Button>

                          <Button
                            variant="destructive"
                            disabled={deactivating}
                            onClick={deactivateSite}
                          >
                            {deactivating
                              ? "Deactivating..."
                              : "Deactivate Site"}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  ) : (
                    <Button
                      className="rounded-xl"
                      disabled={reactivating}
                      onClick={reactivateSite}
                    >
                      {reactivating ? "Reactivating..." : "Re-Activate Site"}
                    </Button>
                  ))}

                {!site?.isPermanent && (
                  <Button
                    variant="destructive"
                    className="rounded-xl"
                    onClick={() => setConfirmDeleteOpen(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Site
                  </Button>
                )}
              </div>
            </div>

            {/* Stat strip */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex items-center gap-3 rounded-2xl border bg-muted/40 p-4">
                <div className="rounded-xl bg-background p-2.5 text-primary">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Employees
                  </div>
                  <div className="mt-0.5 text-2xl font-bold">
                    {todayCount === null ? "--" : todayCount}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-2xl border bg-muted/40 p-4">
                <div className="rounded-xl bg-background p-2.5 text-muted-foreground">
                  <Briefcase className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Active Jobs
                  </div>
                  <div className="mt-0.5 text-2xl font-bold">
                    {loadingJobs
                      ? "--"
                      : jobs.filter((job) => job.isActive).length}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-2xl border bg-muted/40 p-4">
                <div className="rounded-xl bg-background p-2.5 text-muted-foreground">
                  <CalendarDays className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Calendar Days
                  </div>
                  <div className="mt-0.5 text-2xl font-bold">
                    {loadingSiteStats
                      ? "--"
                      : siteStats?.totalCalendarDays ?? 0}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Employees Section */}
        <Card className="rounded-3xl border bg-card p-6 shadow-sm sm:p-8">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-2xl font-bold tracking-tight">Employees</h2>
          </div>

          {id && (
            <SiteRoster
              siteId={id}
              isSiteActive={!!isSiteActive}
              onTodayCountChange={setTodayCount}
            />
          )}
        </Card>

        {/* Jobs Section */}
        <Card className="rounded-3xl border bg-card p-6 shadow-sm sm:p-8">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2 text-primary">
                <Briefcase className="h-5 w-5" />
              </div>

              <h2 className="text-2xl font-bold tracking-tight">Jobs</h2>
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

                  <DialogDescription>
                    Add a new job under this site.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-5 py-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Job Name</label>

                    <Input
                      placeholder="Enter job name"
                      value={jobForm.name}
                      onChange={(e) =>
                        setJobForm((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                    />

                    {jobErrors.name && (
                      <p className="text-sm text-red-500">{jobErrors.name}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Job Code</label>

                    <Input
                      placeholder="Enter job code"
                      value={jobForm.jobCode}
                      onChange={(e) =>
                        setJobForm((prev) => ({
                          ...prev,
                          jobCode: e.target.value,
                        }))
                      }
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
                  <Button
                    variant="outline"
                    onClick={() => setJobDialogOpen(false)}
                  >
                    Cancel
                  </Button>

                  <Button disabled={creatingJob} onClick={createJob}>
                    {creatingJob ? "Creating..." : "Create Job"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

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
                  onClick={() => navigate(`/site/job/${job._id}`)}
                  className="group cursor-pointer rounded-2xl border bg-background p-5 transition hover:border-primary/30 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="rounded-xl bg-primary/10 p-2 text-primary">
                        <Briefcase className="h-5 w-5" />
                      </div>

                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-semibold">
                          {job.name}
                        </h3>
                        <p className="truncate text-sm text-muted-foreground">
                          {job.jobCode}
                        </p>
                      </div>
                    </div>

                    <Button
                      variant="destructive"
                      size="icon-xs"
                      className="h-7 w-7 shrink-0 rounded-lg p-0"
                      onClick={(e) => {
                        e.stopPropagation()
                        setJobToDelete(job)
                        setConfirmDeleteJobOpen(true)
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
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
                    </div>

                    {isSiteActive && job.isActive && (
                      <Button
                        variant="outline"
                        size="sm"
                        className={`h-7 rounded-lg px-2.5 text-xs font-medium transition-all ${
                          job.isCompleted
                            ? "bg-indigo-500 hover:bg-indigo-600 text-white border-indigo-600 dark:bg-indigo-600 dark:hover:bg-indigo-700"
                            : "hover:bg-accent"
                        }`}
                        onClick={async (e) => {
                          e.stopPropagation()
                          try {
                            await api.patch(
                              `/api/site/job/${job._id}/toggle-completed`
                            )
                            toast.success(
                              `Job marked as ${
                                !job.isCompleted ? "completed" : "incomplete"
                              }`
                            )
                            fetchJobs(false)
                          } catch (error: any) {
                            toast.error(
                              error?.response?.data?.message ||
                                "Failed to update job status"
                            )
                          }
                        }}
                      >
                        {job.isCompleted ? "Reopen" : "Complete"}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Delete Site Dialog */}
      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-destructive flex items-center gap-2">
              <Trash2 className="h-5 w-5" />
              Delete Site?
            </DialogTitle>
            <DialogDescription className="pt-2 text-base">
              Are you sure you want to delete <strong>{site?.siteName}</strong>?
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 rounded-xl border bg-destructive/5 border-destructive/10 p-4 text-sm text-destructive space-y-2">
            <p className="font-semibold">
              This action is permanent for the active roster:
            </p>
            <ul className="list-disc pl-4 space-y-1">
              <li>All associated jobs will be soft-deleted.</li>
              <li>
                All assigned employees will have their site/job assignments
                cleared.
              </li>
              <li>
                Any assigned supervisor will have their site assignment cleared.
              </li>
              {site?.isPermanent && (
                <li className="font-bold underline text-red-600">
                  WARNING: This is a Permanent Home Site!
                </li>
              )}
            </ul>
          </div>

          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              disabled={deletingSite}
              onClick={() => setConfirmDeleteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deletingSite}
              onClick={handleDeleteSite}
            >
              {deletingSite ? "Deleting..." : "Confirm Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Job Dialog */}
      <Dialog open={confirmDeleteJobOpen} onOpenChange={setConfirmDeleteJobOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-destructive flex items-center gap-2">
              <Trash2 className="h-5 w-5" />
              Delete Job?
            </DialogTitle>
            <DialogDescription className="pt-2 text-base">
              Are you sure you want to delete job{" "}
              <strong>{jobToDelete?.name}</strong> ({jobToDelete?.jobCode})?
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 rounded-xl border bg-destructive/5 border-destructive/10 p-4 text-sm text-destructive space-y-2">
            <p className="font-semibold">
              This action is permanent for the active roster:
            </p>
            <ul className="list-disc pl-4 space-y-1">
              <li>
                All employees assigned to this job will have their job
                assignments cleared (set to null).
              </li>
              <li>The job will be removed from the site's jobs array.</li>
            </ul>
          </div>

          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              disabled={deletingJob}
              onClick={() => {
                setConfirmDeleteJobOpen(false)
                setJobToDelete(null)
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deletingJob}
              onClick={handleDeleteJob}
            >
              {deletingJob ? "Deleting..." : "Confirm Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Site Location Dialog */}
      <Dialog open={isEditingLocation} onOpenChange={setIsEditingLocation}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              Edit Location Details
            </DialogTitle>
            <DialogDescription>
              Update the location details for this site.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Location Details</label>
              <Input
                placeholder="Enter location details"
                value={editedLocationDetails}
                onChange={(e) => setEditedLocationDetails(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              disabled={savingLocation}
              onClick={() => setIsEditingLocation(false)}
            >
              Cancel
            </Button>
            <Button disabled={savingLocation} onClick={handleSaveLocation}>
              {savingLocation ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default SiteDetail
