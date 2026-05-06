"use client"

import Link from "next/link"
import Image from "next/image"
import { useTheme } from "next-themes"
import { motion } from "framer-motion"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft, ShieldAlert } from "lucide-react"

function RegisterPageDisabledNotice() {
  return (
    <Card className="border-amber-200 bg-amber-50/60 shadow-none dark:border-amber-900 dark:bg-amber-950/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
          <ShieldAlert className="h-5 w-5" />
          Registrasi umum dinonaktifkan
        </CardTitle>
        <CardDescription className="text-amber-700/90 dark:text-amber-200/80">
          Pembuatan akun desa hanya dapat dilakukan oleh superadmin melalui dashboard internal agar provisioning desa, admin, dan channel tetap konsisten.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row">
        <Button asChild>
          <Link href="/login">Masuk ke Dashboard</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Kembali ke Beranda</Link>
        </Button>
      </CardContent>
    </Card>
  )
}

export default function RegisterPage() {
  const { resolvedTheme } = useTheme()
  const logoSrc = resolvedTheme === "dark" ? "/logo-dashboard-dark.png" : "/logo-dashboard.png"

  return (
    <div className="min-h-screen flex">
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
              GovConnect
              <br />
              <span className="text-white/90">Dashboard Internal</span>
            </h1>
            <p className="text-lg text-white/80 mb-8 max-w-md leading-relaxed">
              Aktivasi desa baru dilakukan oleh superadmin dari dashboard internal untuk menjaga konsistensi data, hak akses, dan provisioning channel.
            </p>
          </motion.div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-32 bg-linear-to-t from-black/20 to-transparent" />
      </div>

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
                    alt="GovConnect Logo"
                    fill
                    className="object-contain"
                    priority
                  />
                </div>
              </div>
              <div>
                <CardTitle className="text-2xl font-bold">Registrasi Admin Desa</CardTitle>
                <CardDescription className="text-base mt-2">
                  Halaman publik tidak lagi dipakai untuk membuat akun desa baru.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <RegisterPageDisabledNotice />
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  )
}
