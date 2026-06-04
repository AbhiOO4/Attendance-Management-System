import { Navigate } from "react-router-dom"
import { useAuth } from "@/context/AuthContext"

export default function PublicRoute({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, loading } = useAuth()

  if (loading) {
    return <div>Loading...</div>
  }

  return user
    ? <Navigate to="/dashboard" replace />
    : <>{children}</>
}