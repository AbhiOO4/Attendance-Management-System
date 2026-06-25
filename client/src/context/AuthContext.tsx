import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"

import { api } from "@/lib/api"

export type User = {
  _id: string
  name: string
  role: "admin" | "supervisor" | "superadmin"
  assignedSite: string | null
}

type AuthContextType = {
  user: User | null
  loading: boolean
  refreshUser: () => Promise<User | null>
  clearUser: () => void
}

function normalizeAssignedSite(
  assignedSite: unknown
): string | null {
  if (!assignedSite) return null
  if (typeof assignedSite === "string") return assignedSite
  if (
    typeof assignedSite === "object" &&
    assignedSite !== null &&
    "_id" in assignedSite
  ) {
    return String((assignedSite as { _id: unknown })._id)
  }
  return String(assignedSite)
}

export function normalizeUser(raw: unknown): User | null {
  if (!raw || typeof raw !== "object") return null

const data = raw as {
  _id?: unknown
  name?: unknown
  role?: unknown
  assignedSite?: unknown
}

  if (
    data.role !== "admin" &&
    data.role !== "supervisor" &&
    data.role !== "superadmin"
  ) {
    return null
  }

  if (!data._id) return null

  return {
    _id: String(data._id),
    name: String(data.name ?? ""),
    role: data.role,
    assignedSite: normalizeAssignedSite(data.assignedSite),
  }
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  refreshUser: async () => null,
  clearUser: () => {},
})

export const AuthProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {

  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    try {
      const res = await api.get("/api/user/me")
      const nextUser = normalizeUser(res.data.user)
      setUser(nextUser)
      return nextUser
    } catch {
      setUser(null)
      return null
    }
  }, [])

  const clearUser = useCallback(() => {
    setUser(null)
  }, [])

  useEffect(() => {
    refreshUser().finally(() => setLoading(false))
  }, [refreshUser])

  return (
    <AuthContext.Provider
      value={{ user, loading, refreshUser, clearUser }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)