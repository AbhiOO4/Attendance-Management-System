import { Navigate } from "react-router-dom"
import { useAuth } from "@/context/AuthContext"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"

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
    return <div className="flex items-center justify-center"><Badge>
      <Spinner data-icon="inline-start" />
      Loading
    </Badge></div>
  }

  if (!user) {
    return <Navigate to="/" replace={true} />
  }

  if (!allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}