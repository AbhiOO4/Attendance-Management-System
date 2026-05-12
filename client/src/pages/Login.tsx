import { useState } from "react"

import { useNavigate } from "react-router-dom"

import { Eye, EyeOff } from "lucide-react"

import { api } from "@/lib/api"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import toast from "react-hot-toast"

function Login() {

    const navigate = useNavigate()

    const [email, setEmail] = useState<string>("")
    const [password, setPassword] = useState<string>("")
    const [showPassword, setShowPassword] = useState<boolean>(false)
    const [loading, setLoading] = useState<boolean>(false)

    const handleLogin = async (
        e: React.FormEvent<HTMLFormElement>
    ) => {

        e.preventDefault()

        try {

            setLoading(true)

            const res = await api.post(
                "/api/user/login",
                {
                    email,
                    password,
                },
                {
                    withCredentials: true,
                }
            )

            toast.success(
                res.data.message || "Login successful"
            )

            window.location.href = "/dashboard"

        } catch (error: any) {

            toast.error(
                error?.response?.data?.message ||
                "Login failed"
            )

        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-black px-4">

            <Card className="w-full max-w-md shadow-xl">

                <CardHeader>
                    <CardTitle className="text-2xl font-bold text-center">
                        Login
                    </CardTitle>
                </CardHeader>

                <CardContent>

                    <form
                        onSubmit={handleLogin}
                        className="space-y-5"
                    >

                        <div className="space-y-2">

                            <Label htmlFor="email">
                                Email
                            </Label>

                            <Input
                                id="email"
                                type="email"
                                placeholder="Enter your email"
                                value={email}
                                onChange={(e) =>
                                    setEmail(e.target.value)
                                }
                                required
                            />

                        </div>

                        <div className="space-y-2">

                            <Label htmlFor="password">
                                Password
                            </Label>

                            <div className="relative">

                                <Input
                                    id="password"
                                    type={
                                        showPassword
                                            ? "text"
                                            : "password"
                                    }
                                    placeholder="Enter your password"
                                    value={password}
                                    onChange={(e) =>
                                        setPassword(e.target.value)
                                    }
                                    required
                                    className="pr-10"
                                />

                                <button
                                    type="button"
                                    onClick={() =>
                                        setShowPassword(
                                            !showPassword
                                        )
                                    }
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                                >

                                    {showPassword ? (
                                        <EyeOff className="h-5 w-5" />
                                    ) : (
                                        <Eye className="h-5 w-5" />
                                    )}

                                </button>

                            </div>

                        </div>

                        <Button
                            type="submit"
                            className="w-full"
                            disabled={loading}
                        >

                            {loading
                                ? "Logging in..."
                                : "Login"}

                        </Button>

                    </form>

                </CardContent>

            </Card>

        </div>
    )
}

export default Login