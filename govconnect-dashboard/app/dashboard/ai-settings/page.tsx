"use client"

import Link from "next/link"
import { useEffect } from "react"
import { redirect } from "next/navigation"
import { Bot, Info } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/components/auth/AuthContext"

export default function AISettingsPage() {
  const { user } = useAuth()

  useEffect(() => {
    if (user && user.role !== 'superadmin') {
      redirect('/dashboard')
    }
  }, [user])

  if (user?.role !== 'superadmin') {
    return null
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
          <Bot className="h-8 w-8 text-primary" />
          Pengaturan AI (Read-Only)
        </h1>
        <p className="text-muted-foreground mt-2">
          Konfigurasi model AI tidak tersedia di dashboard dan hanya bisa diatur melalui ENV.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            Ketentuan Konfigurasi
          </CardTitle>
          <CardDescription>
            Untuk keamanan dan konsistensi produksi, perubahan model AI wajib dilakukan lewat environment.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Silakan gunakan ENV pada service AI Orchestrator dan lakukan deploy ulang setelah perubahan.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Model utama dan fallback diatur melalui ENV.</li>
            <li>Jangan ubah konfigurasi model melalui UI.</li>
            <li>Aktif/nonaktif AI dilakukan lewat Channel Connect.</li>
          </ul>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/whatsapp" className="text-primary hover:underline">
              Buka Channel Connect
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
