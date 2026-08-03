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
import { type WorkConfig } from "@/lib/dateUtils"

/**
 * Single source of the work schedule for the whole app (pay numbers, holidays, breaks).
 *
 * There is no business-day cutoff hour any more: a record's business day IS its
 * `Attendance.date`, and cross-midnight is an explicit per-session day offset. Nothing
 * here needs to resolve a boundary hour.
 */
type WorkConfigContextType = {
  config: WorkConfig | null
  loading: boolean
  refreshConfig: () => Promise<WorkConfig | null>
}

const WorkConfigContext = createContext<WorkConfigContextType>({
  config: null,
  loading: true,
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
      // Keep the last-known config on a transient failure rather than dropping to null.
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
  // singleton an admin can change at any time, and its pay numbers drive hours/OT display —
  // a tab holding a stale copy would show wrong totals.
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
