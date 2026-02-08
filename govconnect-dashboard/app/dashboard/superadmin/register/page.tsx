"use client"

import { useEffect, useMemo, useState } from "react"
import { redirect, useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuth } from "@/components/auth/AuthContext"
import { UserPlus, CheckCircle2, AlertCircle } from "lucide-react"

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
}

export default function SuperadminRegisterPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [slugEdited, setSlugEdited] = useState(false)
  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid" | "error">("idle")
  const [slugMessage, setSlugMessage] = useState("")

  const [form, setForm] = useState({
    username: "",
    password: "",
    confirmPassword: "",
    name: "",
    village_name: "",
    village_slug: "",
    short_name: "",
  })

  useEffect(() => {
    if (user && user.role !== "superadmin") {
      redirect("/dashboard")
    }
  }, [user])

  useEffect(() => {
    if (!slugEdited) {
      setForm((prev) => ({
        ...prev,
        village_slug: slugify(prev.village_name),
      }))
    }
  }, [form.village_name, slugEdited])

  useEffect(() => {
    const slug = form.village_slug.trim().toLowerCase()

    if (!slug) {
      setSlugStatus("idle")
      setSlugMessage("")
      return
    }

    const isValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    if (!isValid) {
      setSlugStatus("invalid")
      setSlugMessage("Slug hanya boleh huruf kecil, angka, dan tanda hubung.")
      return
    }

    setSlugStatus("checking")
    setSlugMessage("Memeriksa ketersediaan slug...")

    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(`/api/public/villages/check-slug?slug=${encodeURIComponent(slug)}`)
        const result = await response.json()

        if (!response.ok) {
          throw new Error(result?.error || "Gagal memeriksa slug")
        }

        if (result.available) {
          setSlugStatus("available")
          setSlugMessage("Slug tersedia.")
        } else {
          setSlugStatus("taken")
          setSlugMessage("Slug sudah digunakan. Pilih slug lain.")
        }
      } catch (err: any) {
        setSlugStatus("error")
        setSlugMessage(err.message || "Gagal memeriksa slug")
      }
    }, 500)

    return () => clearTimeout(timeout)
  }, [form.village_slug])

  const isPasswordMatch = useMemo(() => {
    if (!form.confirmPassword) return true
    return form.password === form.confirmPassword
  }, [form.password, form.confirmPassword])

  const passwordStrength = useMemo(() => {
    const value = form.password
    const rules = [
      value.length >= 8,
      /[a-z]/.test(value),
      /[A-Z]/.test(value),
      /\d/.test(value),
      /[^A-Za-z0-9]/.test(value),
    ]
    const score = rules.filter(Boolean).length

    let label = "Lemah"
    let color = "bg-red-500"
    if (score >= 4) {
      label = "Kuat"
      color = "bg-green-500"
    } else if (score >= 2) {
      label = "Sedang"
      color = "bg-amber-500"
    }

    return { score, label, color }
  }, [form.password])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSuccess("")

    if (!isPasswordMatch) {
      setError("Konfirmasi password tidak sesuai.")
      return
    }

    if (form.password.length < 8) {
      setError("Password minimal 8 karakter.")
      return
    }

    if (passwordStrength.score < 2) {
      setError("Kekuatan password terlalu lemah. Gunakan kombinasi huruf besar, kecil, angka, dan simbol.")
      return
    }

    if (slugStatus === "checking") {
      setError("Sedang memeriksa ketersediaan slug. Mohon tunggu sebentar.")
      return
    }

    if (slugStatus === "taken" || slugStatus === "invalid" || slugStatus === "error") {
      setError("Slug desa belum valid atau sudah digunakan.")
      return
    }

    setIsSubmitting(true)
    try {
      const token = localStorage.getItem("token")
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          username: form.username,
          password: form.password,
          name: form.name,
          village_name: form.village_name,
          village_slug: form.village_slug,
          short_name: form.short_name || undefined,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || "Registrasi gagal")
      }

      setSuccess(`Desa "${form.village_name}" berhasil didaftarkan!`)
      setForm({
        username: "",
        password: "",
        confirmPassword: "",
        name: "",
        village_name: "",
        village_slug: "",
        short_name: "",
      })
      setSlugEdited(false)
      setSlugStatus("idle")
      setSlugMessage("")
    } catch (err: any) {
      setError(err.message || "Registrasi gagal")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Register Desa Baru</h1>
          <p className="text-muted-foreground">
            Daftarkan desa/kelurahan baru beserta akun admin-nya.
          </p>
        </div>
        <UserPlus className="h-8 w-8 text-muted-foreground" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Form Registrasi Desa</CardTitle>
          <CardDescription>
            Isi data desa/kelurahan dan buat akun admin untuk mengelolanya.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Admin Info */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                Informasi Admin
              </h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Nama Admin</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Nama lengkap admin"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="username">Nama Pengguna</Label>
                  <Input
                    id="username"
                    value={form.username}
                    onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
                    placeholder="nama pengguna"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Password */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                Kata Sandi
              </h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="password">Kata Sandi</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={form.password}
                      onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                      placeholder="Minimal 8 karakter"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs"
                    >
                      {showPassword ? "Sembunyikan" : "Lihat"}
                    </button>
                  </div>
                  <div className="space-y-2">
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full ${passwordStrength.color} transition-all`}
                        style={{ width: `${(passwordStrength.score / 5) * 100}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>Kekuatan: {passwordStrength.label}</span>
                      <span>Minimal 8 karakter</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Konfirmasi Kata Sandi</Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      value={form.confirmPassword}
                      onChange={(e) => setForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                      placeholder="Ulangi kata sandi"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs"
                    >
                      {showConfirmPassword ? "Sembunyikan" : "Lihat"}
                    </button>
                  </div>
                  {!isPasswordMatch && (
                    <p className="text-xs text-destructive">Konfirmasi password tidak sesuai.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Village Info */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                Informasi Desa
              </h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="village_name">Nama Desa/Kelurahan</Label>
                  <Input
                    id="village_name"
                    value={form.village_name}
                    onChange={(e) => setForm((prev) => ({ ...prev, village_name: e.target.value }))}
                    placeholder="Desa Melati"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="village_slug">Slug Desa</Label>
                  <Input
                    id="village_slug"
                    value={form.village_slug}
                    onChange={(e) => {
                      setSlugEdited(true)
                      setForm((prev) => ({ ...prev, village_slug: e.target.value }))
                    }}
                    placeholder="desa-melati"
                    required
                  />
                  {slugMessage && (
                    <p
                      className={`text-[11px] ${
                        slugStatus === "available"
                          ? "text-emerald-600"
                          : slugStatus === "checking"
                            ? "text-muted-foreground"
                            : "text-destructive"
                      }`}
                    >
                      {slugMessage}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    Digunakan untuk URL form publik: /form/slug-desa/slug-layanan
                  </p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="short_name">Nama Singkat (Opsional)</Label>
                  <Input
                    id="short_name"
                    value={form.short_name}
                    onChange={(e) => setForm((prev) => ({ ...prev, short_name: e.target.value }))}
                    placeholder="melati"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Jenis Instansi</Label>
                  <Select value="desa" disabled>
                    <SelectTrigger>
                      <SelectValue placeholder="Desa/Kelurahan" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="desa">Desa/Kelurahan (default)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Saat ini hanya mendukung desa/kelurahan.
                  </p>
                </div>
              </div>
            </div>

            {/* Error/Success Messages */}
            {error && (
              <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-lg text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            {success && (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-800 dark:text-emerald-400 px-4 py-3 rounded-lg text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <div>
                  {success}{" "}
                  <button
                    type="button"
                    onClick={() => router.push("/dashboard/superadmin/villages")}
                    className="underline font-medium"
                  >
                    Lihat daftar desa
                  </button>
                </div>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11"
              disabled={isSubmitting || slugStatus === "checking" || slugStatus === "taken" || slugStatus === "invalid"}
            >
              {isSubmitting ? "Memproses..." : "Daftarkan Desa Baru"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
