import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useLocation } from "react-router-dom"

import { api } from "@/lib/api"
import { useAuth } from "@/context/AuthContext"
import {
  getCurrentCutoff,
  resolveCutoffForDate,
  type WorkConfig,
} from "@/lib/dateUtils"

/**
 * Single source of the work schedule for the whole app (pay numbers, holidays, breaks).
 *
 * CUTOFFS ARE PER-SITE NOW: each Site doc carries its own machine-derived
 * nightShiftCutoffHour + cutoffHistory (derived from the site's default shift times).
 * Site-scoped code must resolve from the site doc via dateUtils:
 *   getCurrentCutoff(site)                    — "now" questions for that site
 *   resolveCutoffForDate(site, record.date)   — reading/validating an existing record
 *
 * The two accessors here remain ONLY for (a) pages with no single site in scope
 * (MarkAttendance's site list, DashBoard's date label — an approximation when site cutoffs
 * diverge; the authoritative view is SiteAttendance) and (b) fallbacks while a site doc is
 * loading or for legacy sessions whose site is gone:
 *
 *   cutoffFor(date)  the GLOBAL fallback cutoff for a specific business day.
 *   currentCutoff    the GLOBAL fallback cutoff in force right now.
 */
type WorkConfigContextType = {
  config: WorkConfig | null
  loading: boolean
  currentCutoff: number
  cutoffFor: (businessDate: string | Date | null | undefined) => number
  refreshConfig: () => Promise<WorkConfig | null>
}

const WorkConfigContext = createContext<WorkConfigContextType>({
  config: null,
  loading: true,
  // Pre-fetch placeholder: 0 = midnight boundary (no early-morning window). Real values
  // always come from the fetched config/site docs.
  currentCutoff: 0,
  cutoffFor: () => 0,
  refreshConfig: async () => null,
})

export const WorkConfigProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const { user } = useAuth()
  const { pathname } = useLocation()

  const [config, setConfig] = useState<WorkConfig | null>(null)
  const [loading, setLoading] = useState(true)

  // Revalidation must not flip `loading` — pages like SiteAttendance render a full-page
  // spinner while it is true, and we don't want that on every navigation.
  const inFlight = useRef(false)

  const refreshConfig = useCallback(async () => {
    if (inFlight.current) return config
    inFlight.current = true
    try {
      const res = await api.get("/api/config")
      const next = (res.data?.data ?? null) as WorkConfig | null
      setConfig(next)
      return next
    } catch {
      // Keep the last-known config on a transient failure: a null cutoff history would
      // silently collapse every date onto the current cutoff.
      return config
    } finally {
      inFlight.current = false
    }
  }, [config])

  // /api/config is auth-gated, so wait for the user before the first fetch.
  useEffect(() => {
    if (!user) {
      setConfig(null)
      setLoading(false)
      return
    }
    setLoading(true)
    refreshConfig().finally(() => setLoading(false))
    // Only re-run on login/logout; navigation revalidation is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Revalidate on navigation and when the tab regains focus. The work schedule is a
  // singleton an admin can change at any time, and the cutoff history it carries decides how
  // every past record is validated — a tab holding a stale copy would reject edits that are
  // actually legal (or accept ones that aren't).
  useEffect(() => {
    if (!user) return
    refreshConfig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, user])

  useEffect(() => {
    if (!user) return

    const revalidate = () => {
      if (document.visibilityState === "visible") refreshConfig()
    }

    window.addEventListener("focus", revalidate)
    document.addEventListener("visibilitychange", revalidate)
    return () => {
      window.removeEventListener("focus", revalidate)
      document.removeEventListener("visibilitychange", revalidate)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, refreshConfig])

  const value = useMemo<WorkConfigContextType>(
    () => ({
      config,
      loading,
      currentCutoff: getCurrentCutoff(config),
      cutoffFor: (businessDate) => resolveCutoffForDate(config, businessDate),
      refreshConfig,
    }),
    [config, loading, refreshConfig]
  )

  return (
    <WorkConfigContext.Provider value={value}>
      {children}
    </WorkConfigContext.Provider>
  )
}

export const useWorkConfig = () => useContext(WorkConfigContext)
