// pages/SitesPage.tsx

import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { MapPin, Search } from "lucide-react"

import { api } from "@/lib/api"

import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

import toast from "react-hot-toast"

import AddSiteModal from "@/components/AddSiteModal"

type Site = {
  _id: string
  siteName: string
  locationDetails: string
  isActive: boolean
}

export default function SitesPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(false)

  const [search, setSearch] = useState("")
  const [activeOnly, setActiveOnly] = useState(false)

  const fetchSites = async () => {
    try {
      setLoading(true)

      const response = await api.get("/api/site", {
        params: {
          siteName: search,
          isActive: activeOnly,
        },
      })

      setSites(response.data || [])
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message || "Failed to fetch sites"
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      fetchSites()
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

          <div className="flex items-center space-x-3 rounded-xl border bg-background px-4 py-3 shadow-sm">
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

        <div className="space-y-5">
          {loading ? (
            <div className="py-20 text-center text-muted-foreground">
              Loading sites...
            </div>
          ) : sites.length === 0 ? (
            <div className="rounded-2xl border bg-background py-20 text-center">
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
                <Card className="group rounded-2xl border bg-card p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <h2 className="text-2xl font-semibold transition-colors group-hover:text-primary">
                          {site.siteName}
                        </h2>

                        <div
                          className={`rounded-full px-3 py-1 text-xs font-medium ${
                            site.isActive
                              ? "bg-green-100 text-green-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {site.isActive ? "Active" : "Inactive"}
                        </div>
                      </div>

                      <div className="mt-4 flex items-start gap-2 text-muted-foreground">
                        <MapPin className="mt-1 h-4 w-4 shrink-0" />

                        <p className="text-base leading-relaxed">
                          {site.locationDetails}
                        </p>
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  )
}