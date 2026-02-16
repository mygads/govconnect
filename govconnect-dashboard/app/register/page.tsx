"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { useTheme } from "next-themes"
import { motion } from "framer-motion"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft } from "lucide-react"

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
}

export default function RegisterPage() {
  const { resolvedTheme } = useTheme()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [slugEdited, setSlugEdited] = useState(false)
  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid" | "error">("idle")
  const [slugMessage, setSlugMessage] = useState("")
  const [mounted, setMounted] = useState(false)

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
    if (!slugEdited) {
      setForm((prev) => ({
        ...prev,
        village_slug: slugify(prev.village_name),
      }))
    }
  }, [form.village_name, slugEdited])

  useEffect(() => {
    setMounted(true)
  }, [])

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
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

      if (data?.token) {
        localStorage.setItem("token", data.token)
      }

      window.location.href = "/dashboard"
    } catch (err: any) {
      setError(err.message || "Registrasi gagal")
    } finally {
      setIsSubmitting(false)
    }
  }

  const logoSrc =
    mounted && resolvedTheme === "dark"
      ? "/logo-dashboard-dark.png"
      : "/logo-dashboard.png"

  return (
    <div className="min-h-screen flex">
      {/* Left Side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-linear-to-br from-primary via-primary/90 to-secondary relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-20 w-64 h-64 border border-white/30 rounded-full" />
          <div className="absolute top-40 right-20 w-32 h-32 border border-white/20 rounded-full" />
          <div className="absolute bottom-40 left-40 w-48 h-48 border border-white/20 rounded-full" />
          <div className="absolute bottom-20 right-40 w-24 h-24 bg-white/10 rounded-full" />
        </div>

        <div className="relative z-10 flex flex-col justify-center px-12 xl:px-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-4xl xl:text-5xl font-bold text-white mb-6 leading-tight">
              Mulai Gunakan
              <br />
              <span className="text-white/90">Tanggapin AI Dashboard</span>
            </h1>
            <p className="text-lg text-white/80 mb-8 max-w-md leading-relaxed">
              Daftarkan desa/kelurahan Anda untuk mengelola layanan, pengaduan, dan komunikasi warga.
            </p>

            <div className="space-y-4">
              {[
                "Pusat kendali layanan desa",
                "Pengaduan warga terstruktur",
                "Knowledge base untuk AI",
                "Channel WhatsApp terintegrasi",
              ].map((feature, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + index * 0.1 }}
                  className="flex items-center gap-3 text-white/90"
                >
                  <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                    <svg
                      className="w-3.5 h-3.5 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                  <span>{feature}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-32 bg-linear-to-t from-black/20 to-transparent" />
      </div>

      {/* Right Side - Register Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center bg-background p-6 sm:p-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-xl"
        >
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Kembali ke Beranda</span>
          </Link>

          <Card className="border-0 shadow-none lg:shadow-xl lg:border">
            <CardHeader className="space-y-4 text-center pb-2">
              <div className="flex justify-center">
                <div className="relative h-12 w-40">
                  <Image
                    src={logoSrc}
                    alt="Tanggapin AI Logo"
                    fill
                    className="object-contain"
                    priority
                  />
                </div>
              </div>
              <div>
                <CardTitle className="text-2xl font-bold">Daftar Akun Desa</CardTitle>
                <CardDescription className="text-base mt-2">
                  Buat akun admin untuk mengelola layanan desa/kelurahan.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-5">
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

              <div className="space-y-2">
                <Label>Jenis Akun</Label>
                <Select defaultValue="desa" disabled>
                  <SelectTrigger className="bg-muted">
                    <SelectValue placeholder="Pilih jenis akun" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desa">Desa/Kelurahan (Saat ini)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Saat ini registrasi hanya untuk tingkat desa/kelurahan. Tingkat kecamatan akan tersedia pada fase berikutnya.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="password">Kata Sandi</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={form.password}
                      onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                      placeholder="Minimal 6 karakter"
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

              <div className="grid gap-4 md:grid-cols-2">
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
                    Saat ini hanya mendukung desa/kelurahan. Kecamatan akan tersedia di fase berikutnya.
                  </p>
                </div>
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
              </div>

              <div className="grid gap-4 md:grid-cols-2">
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
                <div className="space-y-2">
                  <Label htmlFor="short_name">Nama Singkat (Opsional)</Label>
                  <Input
                    id="short_name"
                    value={form.short_name}
                    onChange={(e) => setForm((prev) => ({ ...prev, short_name: e.target.value }))}
                    placeholder="melati"
                  />
                </div>
              </div>

              {error && (
                <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-11 bg-secondary"
                disabled={isSubmitting || slugStatus === "checking" || slugStatus === "taken" || slugStatus === "invalid"}
              >
                {isSubmitting ? "Memproses..." : "Daftar"}
              </Button>

              <p className="text-sm text-muted-foreground text-center">
                Sudah punya akun?{" "}
                <Link href="/login" className="text-secondary hover:underline">
                  Login di sini
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
        </motion.div>
      </div>
    </div>
  )
}
