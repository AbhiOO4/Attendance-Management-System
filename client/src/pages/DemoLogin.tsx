import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { ShieldAlert, ShieldCheck, Loader2 } from "lucide-react"
import { api } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import toast from "react-hot-toast"
import { useAuth } from "@/context/AuthContext"

export default function DemoLogin() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get("token")
  const navigate = useNavigate()
  const { refreshUser } = useAuth()

  const [status, setStatus] = useState<"idle" | "verifying" | "success" | "error">("idle")
  const [errorMessage, setErrorMessage] = useState("")

  useEffect(() => {
    if (!token) {
      setStatus("error")
      setErrorMessage("No demo login token was provided in the URL link.")
      return
    }

    const verifyDemoToken = async () => {
      setStatus("verifying")
      try {
        // Wait a brief moment to give a premium loading feel
        await new Promise((resolve) => setTimeout(resolve, 1500))

        const res = await api.post(
          "/api/user/demo-login",
          { token },
          { withCredentials: true }
        )

        if (res.data?.success) {
          setStatus("success")
          await refreshUser()
          toast.success("Welcome back! Signed in with demo session.")
          // Wait briefly to show success state before redirecting
          await new Promise((resolve) => setTimeout(resolve, 800))
          navigate("/dashboard", { replace: true })
        } else {
          throw new Error(res.data?.message || "Token verification failed.")
        }
      } catch (error: any) {
        setStatus("error")
        setErrorMessage(
          error?.response?.data?.message || error?.message || "Invalid or expired demo session link."
        )
      }
    }

    verifyDemoToken()
  }, [token, refreshUser, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-black px-4 relative overflow-hidden">
      {/* Decorative gradient glowing backgrounds */}
      <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-72 h-72 bg-blue-500/10 rounded-full blur-3xl" />

      <Card className="w-full max-w-md border border-neutral-800 bg-neutral-950/70 shadow-2xl backdrop-blur-md relative z-10">
        <CardHeader className="space-y-4 pb-2 text-center">
          <div className="flex justify-center w-full">
            <img
              src="/ngdp logo.png"
              alt="NGDP Logo"
              className="mx-auto h-20 sm:h-24 md:h-28 w-auto object-contain"
            />
          </div>
          <CardTitle className="text-xl font-semibold tracking-tight text-white">
            Demo Portal Authorization
          </CardTitle>
          <p className="text-xs text-neutral-400">
            Secure Demo Account Redirect
          </p>
        </CardHeader>

        <CardContent className="py-6 flex flex-col items-center justify-center min-h-[200px]">
          {status === "verifying" && (
            <div className="flex flex-col items-center space-y-4 animate-in fade-in zoom-in duration-300">
              <div className="relative flex items-center justify-center">
                <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-md animate-pulse" />
                <Loader2 className="h-12 w-12 text-emerald-500 animate-spin relative z-10" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-neutral-200">
                  Verifying Security Token
                </p>
                <p className="text-xs text-neutral-500">
                  Establishing a secure guest session...
                </p>
              </div>
            </div>
          )}

          {status === "success" && (
            <div className="flex flex-col items-center space-y-4 animate-in fade-in zoom-in duration-300">
              <div className="relative flex items-center justify-center">
                <div className="absolute inset-0 rounded-full bg-emerald-500/30 blur-md" />
                <ShieldCheck className="h-12 w-12 text-emerald-400 relative z-10 animate-bounce" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-emerald-400">
                  Authorization Approved
                </p>
                <p className="text-xs text-neutral-500">
                  Redirecting to dashboard...
                </p>
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center space-y-4 text-center animate-in fade-in zoom-in duration-300">
              <div className="relative flex items-center justify-center">
                <div className="absolute inset-0 rounded-full bg-rose-500/20 blur-md" />
                <ShieldAlert className="h-12 w-12 text-rose-500 relative z-10" />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-rose-500">
                  Authorization Failed
                </p>
                <p className="text-xs text-neutral-400 max-w-xs leading-relaxed">
                  {errorMessage}
                </p>
              </div>
              <Button
                variant="outline"
                className="mt-2 border-neutral-800 hover:bg-neutral-900 text-white"
                onClick={() => navigate("/login")}
              >
                Return to Login
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
