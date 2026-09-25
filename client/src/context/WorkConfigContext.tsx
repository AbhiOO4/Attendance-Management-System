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
// Runtime feature switches the server reports alongside the schedule (server/src/utils/features.js).
export type Features = {
  // Shared cloud attendance draft on the Site Attendance page.
  cloudDraft: boolean
}

const NO_FEATURES: Features = { cloudDraft: false }

type WorkConfigContextType = {
  config: WorkConfig | null
  features: Features
  loading: boolean
  refreshConfig: () => Promise<WorkConfig | null>
}

const WorkConfigContext = createContext<WorkConfigContextType>({
  config: null,
  features: NO_FEATURES,
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
  const [features, setFeatures] = useState<Features>(NO_FEATURES)
  const [loading, setLoading] = useState(true)
  // The user whose first config fetch has completed (success or failure). Until it matches the
  // signed-in user, consumers see `loading`: a page's mount effect runs BEFORE this provider's
  // effect turns `loading` on for a newly signed-in user, and would otherwise start with no
  // schedule and no feature switches (e.g. SiteAttendance missing the weekly holiday).
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  // Revalidation must not flip `loading` — pages like SiteAttendance render a full-page
  // spinner while it is true, and we don't want that on every navigation.
  const inFlight = useRef<Promise<WorkConfig | null> | null>(null)

  const refreshConfig = useCallback(async () => {
    // Share a request already in flight rather than answering with a possibly stale value, so
    // the initial load below resolves only once the schedule has actually arrived.
    if (inFlight.current) return inFlight.current
    const run = (async () => {
      try {
        const res = await api.get("/api/config")
        const next = (res.data?.data ?? null) as WorkConfig | null
        setConfig(next)
        const cloudDraft = !!res.data?.features?.cloudDraft
        setFeatures((prev) => (prev.cloudDraft === cloudDraft ? prev : { cloudDraft }))
        return next
      } catch {
        // Keep the last-known config on a transient failure rather than dropping to null.
        return config
      }
    })()
    inFlight.current = run
    try {
      return await run
    } finally {
      inFlight.current = null
    }
  }, [config])

  // /api/config is auth-gated, so wait for the user before the first fetch.
  useEffect(() => {
    if (!user) {
      setConfig(null)
      setFeatures(NO_FEATURES)
      setLoading(false)
      return
    }
    setLoading(true)
    const userId = user._id
    refreshConfig().finally(() => {
      setLoading(false)
      setLoadedFor(userId)
    })
    // Only re-run on login/logout; navigation revalidation is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const effectiveLoading = loading || (!!user && loadedFor !== user._id)

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
      features,
      loading: effectiveLoading,
      refreshConfig,
    }),
    [config, features, effectiveLoading, refreshConfig]
  )

  return (
    <WorkConfigContext.Provider value={value}>
      {children}
    </WorkConfigContext.Provider>
  )
}

export const useWorkConfig = () => useContext(WorkConfigContext)
