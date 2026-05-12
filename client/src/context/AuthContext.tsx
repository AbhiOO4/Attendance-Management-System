import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react"

import { api } from "@/lib/api"

type User = {
  _id: string
  role: "admin" | "supervisor"
}

type AuthContextType = {
  user: User | null
  loading: boolean
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
})

export const AuthProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {

  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {

    const fetchMe = async () => {
      try {

        const res = await api.get("/api/user/me")

        setUser(res.data.user)

      } catch (error) {
        setUser(null)
      } finally {
        setLoading(false)
      }
    }

    fetchMe()

  }, [])

  return (
    <AuthContext.Provider
      value={{ user, loading }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)