// pages/SitesPage.tsx

import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { MapPin, Search, Trash2 } from "lucide-react"

import { api } from "@/lib/api"

import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import toast from "react-hot-toast"

import AddSiteModal from "@/components/AddSiteModal"

type Site = {
  _id: string
  siteName: string
  locationDetails: string
  isActive: boolean
  isPermanent?: boolean
  isCompleted?: boolean
}

export default function SitesPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(false)

  const [search, setSearch] = useState("")
  const [activeOnly, setActiveOnly] = useState(false)

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [siteToDelete, setSiteToDelete] = useState<Site | null>(null)
  const [deletingSite, setDeletingSite] = useState(false)

  const fetchSites = async (showLoading = false) => {
    try {
      if (showLoading || sites.length === 0) {
        setLoading(true)
      }

      const response = await api.get("/api/site", {
        params: {
          siteName: search,
          isActive: activeOnly,
        },
      })

      const fetchedSites = response.data || []
      const sortedSites = [...fetchedSites].sort((a, b) => {
        const aComp = a.isCompleted ? 1 : 0
        const bComp = b.isCompleted ? 1 : 0
        if (aComp !== bComp) {
          return aComp - bComp // incomplete (0) first, completed (1) last
        }
        const aPerm = a.isPermanent ? 1 : 0
        const bPerm = b.isPermanent ? 1 : 0
        return bPerm - aPerm
      })
      setSites(sortedSites)
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message || "Failed to fetch sites"
      )
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteSite = async () => {
    if (!siteToDelete) return
    try {
      setDeletingSite(true)
      await api.delete(`/api/site/${siteToDelete._id}`)
      toast.success("Site soft-deleted successfully")
      setConfirmDeleteOpen(false)
      setSiteToDelete(null)
      fetchSites(true)
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to delete site")
    } finally {
      setDeletingSite(false)
    }
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      fetchSites(true)
    }, 400)

    return () => clearTimeout(timeout)
  }, [search, activeOnly])

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">
              Sites
            </h1>

            <p className="mt-1 text-muted-foreground">
              Manage all your sites
            </p>
          </div>

          <AddSiteModal fetchSites={fetchSites} />
        </div>

        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

            <Input
              placeholder="Search by site name..."
              className="pl-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex items-center space-x-3 rounded-xl border bg-background px-4 py-2.5">
            <Checkbox
              id="active-only"
              checked={activeOnly}
              onCheckedChange={(checked) =>
                setActiveOnly(checked === true)
              }
            />

            <Label
              htmlFor="active-only"
              className="cursor-pointer text-sm font-medium"
            >
              Show active sites only
            </Label>
          </div>
        </div>

        <div className="space-y-3">
          {loading ? (
            <div className="py-20 text-center text-muted-foreground">
              Loading sites...
            </div>
          ) : sites.length === 0 ? (
            <div className="rounded-xl border bg-background py-20 text-center">
              <p className="text-muted-foreground">
                No sites found
              </p>
            </div>
          ) : (
            sites.map((site) => (
              <Link
                to={`/site/${site._id}`}
                key={site._id}
                className="block"
              >
                <Card className="relative flex flex-col gap-4 rounded-xl border bg-card p-5 transition-colors hover:border-primary/50 md:flex-row md:items-center md:justify-between md:gap-6">
                  {/* Info + status */}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold tracking-tight">
                        {site.siteName}
                      </h2>

                      <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            site.isActive
                              ? "bg-emerald-500"
                              : "bg-muted-foreground/40"
                          }`}
                        />
                        {site.isActive ? "Active" : "Inactive"}
                      </span>

                      <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            site.isCompleted ? "bg-indigo-500" : "bg-amber-500"
                          }`}
                        />
                        {site.isCompleted ? "Completed" : "In Progress"}
                      </span>

                      {site.isPermanent && (
                        <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary">
                          Permanent Home
                        </span>
                      )}
                    </div>

                    <div className="mt-2.5 flex items-start gap-1.5 text-muted-foreground">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <p className="text-sm leading-relaxed">
                        {site.locationDetails}
                      </p>
                    </div>
                  </div>

                  {/* Actions — stacked on mobile, right-aligned on desktop */}
                  {(site.isActive || !site.isPermanent) && (
                    <div className="flex flex-wrap items-center gap-1.5 md:shrink-0">
                      {site.isActive && !site.isPermanent && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async (e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            try {
                              const updatedStatus = !site.isCompleted
                              await api.patch(`/api/site/${site._id}`, { isCompleted: updatedStatus })
                              toast.success(`Site marked as ${updatedStatus ? 'completed' : 'incomplete'}`)
                              // Update local state only – don't re-fetch so the card stays in place
                              setSites((prev) =>
                                prev.map((s) =>
                                  s._id === site._id ? { ...s, isCompleted: updatedStatus } : s
                                )
                              )
                            } catch (error: any) {
                              toast.error(error?.response?.data?.message || "Failed to update site status")
                            }
                          }}
                          className="rounded-lg text-muted-foreground"
                        >
                          {site.isCompleted ? "Reopen Site" : "Complete Site"}
                        </Button>
                      )}

                      {!site.isPermanent && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setSiteToDelete(site)
                            setConfirmDeleteOpen(true)
                          }}
                          className="rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="mr-1 h-4 w-4" />
                          Delete
                        </Button>
                      )}
                    </div>
                  )}
                </Card>
              </Link>
            ))
          )}
        </div>
      </div>

      {/* Delete Warning Dialog */}
      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-destructive flex items-center gap-2">
              <Trash2 className="h-5 w-5" />
              Delete Site?
            </DialogTitle>
            <DialogDescription className="pt-2 text-base">
              Are you sure you want to delete <strong>{siteToDelete?.siteName}</strong>?
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 rounded-xl border bg-destructive/5 border-destructive/10 p-4 text-sm text-destructive space-y-2">
            <p className="font-semibold">This action is permanent for the active roster:</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>All associated jobs will be soft-deleted.</li>
              <li>All assigned employees will have their site/job assignments cleared.</li>
              <li>Any assigned supervisor will have their site assignment cleared.</li>
              {siteToDelete?.isPermanent && (
                <li className="font-bold underline text-red-600">WARNING: This is a Permanent Home Site!</li>
              )}
            </ul>
          </div>

          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              disabled={deletingSite}
              onClick={() => {
                setConfirmDeleteOpen(false)
                setSiteToDelete(null)
              }}
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
    </div>
  )
}