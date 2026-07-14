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
  DEFAULT_CUTOFF_HOUR,
  getCurrentCutoff,
  resolveCutoffForDate,
  type WorkConfig,
} from "@/lib/dateUtils"

/**
 * Single source of the work schedule for the whole app.
 *
 * Previously every component fetched /api/config into its own useState and fell back to a
 * hardcoded cutoff of 7 (one fell back to 0). That made the cutoff a per-component guess.
 * It is now fetched once here, and — critically — exposed as TWO different accessors:
 *
 *   cutoffFor(date)  the cutoff in force on a specific record's business day. Use this
 *                    whenever you are reading, validating or editing an existing record;
 *                    its stored timestamps were combined under that day's cutoff.
 *   currentCutoff    the cutoff in force right now. Use this only for "what is today's
 *                    business day" questions (rosters, banners, marking today's attendance).
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
  currentCutoff: DEFAULT_CUTOFF_HOUR,
  cutoffFor: () => DEFAULT_CUTOFF_HOUR,
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
