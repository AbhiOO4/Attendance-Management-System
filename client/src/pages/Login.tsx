import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Eye, EyeOff } from "lucide-react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import toast from "react-hot-toast"
import { useAuth } from "@/context/AuthContext"

function Login() {
  const navigate = useNavigate()
  const { refreshUser } = useAuth()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    try {
      setLoading(true)

      await api.post(
        "/api/user/login",
        { email, password },
        { withCredentials: true }
      )

      await refreshUser()

      toast.success("Login successful")

      navigate("/dashboard", {replace: true})

    } catch (error: any) {
      toast.error(
        error?.response?.data?.message || "Login failed"
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-black px-4">
      <Card className="w-full max-w-md border shadow-2xl backdrop-blur-sm">
        <CardHeader className="space-y-5 pb-2">
          <div className="flex justify-center w-full">
            <img
              src="/ngdp logo.png"
              alt="NGDP Logo"
              className="mx-auto h-20 sm:h-24 md:h-28 w-auto object-contain"
            />
          </div>

          <div className="text-center space-y-1">
            <CardTitle className="text-2xl font-bold">
              Welcome Back
            </CardTitle>

            <p className="text-sm text-muted-foreground">
              NGDP Attendance Management System
            </p>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleLogin} className="space-y-5">

            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>

              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pr-10"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full h-11 text-base" disabled={loading}>
              {loading ? "Logging in..." : "Login"}
            </Button>

            <div className="pt-2 text-center text-xs text-muted-foreground">
              © {new Date().getFullYear()} NGDP
            </div>

          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default Login