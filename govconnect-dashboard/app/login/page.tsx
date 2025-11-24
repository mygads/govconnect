"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/components/auth/AuthContext"
import { Loader2, LogIn } from "lucide-react"

export default function LoginPage() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const { login, user } = useAuth()
  const router = useRouter()
  const { theme, resolvedTheme } = useTheme()

  useEffect(() => {
    if (user) {
      router.push("/dashboard")
    }
  }, [user, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setIsLoading(true)

    try {
      await login(username, password)
      // Router push handled by AuthContext after successful login
    } catch (err: any) {
      setError(err.message || "Login gagal. Periksa username dan password Anda.")
    } finally {
      setIsLoading(false)
    }
  }

  const currentTheme = resolvedTheme || theme || "light"
  const logoSrc = currentTheme === "dark" ? "/images/logo-dark.svg" : "/images/logo-light.svg"

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-secondary/10 p-4">
      <Card className="w-full max-w-md shadow-2xl border-2">
        <CardHeader className="space-y-4 text-center pb-6">
          <div className="flex justify-center">
            <div className="relative h-16 w-16">
              <Image
                src={logoSrc}
                alt="GovConnect Logo"
                fill
                className="object-contain"
                priority
                onError={(e) => {
                  const target = e.target as HTMLImageElement
                  target.style.display = 'none'
                }}
              />
            </div>
          </div>
          <div>
            <CardTitle className="text-2xl font-bold text-foreground">GovConnect</CardTitle>
            <CardDescription className="text-base mt-2">Admin Dashboard</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                placeholder="Masukkan username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
                required
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Masukkan password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                required
                className="h-11"
              />
            </div>
            {error && (
              <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded-md text-sm">
                {error}
              </div>
            )}
            <Button
              type="submit"
              className="w-full h-11 text-base font-semibold"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Logging in...
                </>
              ) : (
                <>
                  <LogIn className="mr-2 h-5 w-5" />
                  Login
                </>
              )}
            </Button>
          </form>
          <div className="mt-6 text-center text-xs text-muted-foreground">
            <p>Default credentials:</p>
            <p className="font-mono mt-1">username: <span className="font-semibold">admin</span> | password: <span className="font-semibold">admin123</span></p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
