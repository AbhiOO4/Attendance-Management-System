import { Navigate } from "react-router-dom"
import { useAuth } from "@/context/AuthContext"

type Props = {
  children: React.ReactNode
  allowedRoles: ("admin" | "supervisor")[]
}

export default function ProtectedRoute({
  children,
  allowedRoles,
}: Props) {

  const { user, loading } = useAuth()

  if (loading) {
    return <div>Loading...</div>
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (!allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />
  }

  return children
}