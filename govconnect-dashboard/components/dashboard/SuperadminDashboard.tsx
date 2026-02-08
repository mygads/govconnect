"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/components/auth/AuthContext"
import {
  Building2,
  Users,
  UserPlus,
  Shield,
  Activity,
  Cpu,
  Settings2,
  Database,
  TrendingUp,
} from "lucide-react"

interface VillageSummary {
  id: string
  name: string
  slug: string
  is_active: boolean
  admin_count: number
}

interface SuperadminStats {
  totalVillages: number
  activeVillages: number
  totalAdmins: number
  activeAdmins: number
  villages: VillageSummary[]
}

export function SuperadminDashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState<SuperadminStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const token = localStorage.getItem("token")
        
        // Fetch villages data
        const villagesRes = await fetch("/api/superadmin/villages", {
          headers: { Authorization: `Bearer ${token}` },
        })
        
        // Fetch admins data
        const adminsRes = await fetch("/api/superadmin/admins", {
          headers: { Authorization: `Bearer ${token}` },
        })

        let villages: VillageSummary[] = []
        let admins: { is_active: boolean }[] = []

        if (villagesRes.ok) {
          const vData = await villagesRes.json()
          villages = vData.villages || vData.data || []
        }

        if (adminsRes.ok) {
          const aData = await adminsRes.json()
          admins = aData.admins || aData.data || []
        }

        setStats({
          totalVillages: villages.length,
          activeVillages: villages.filter((v) => v.is_active).length,
          totalAdmins: admins.length,
          activeAdmins: admins.filter((a) => a.is_active).length,
          villages: villages.slice(0, 5),
        })
      } catch (err) {
        console.error("Failed to fetch superadmin stats:", err)
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Panel Super Admin</h1>
        <p className="text-muted-foreground mt-2">
          Selamat datang, {user?.name || "Super Admin"}. Kelola desa dan admin dari sini.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Desa
            </CardTitle>
            <div className="p-2 rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
              <Building2 className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{stats?.totalVillages || 0}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Desa Aktif
            </CardTitle>
            <div className="p-2 rounded-lg bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300">
              <Shield className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{stats?.activeVillages || 0}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Admin
            </CardTitle>
            <div className="p-2 rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300">
              <Users className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{stats?.totalAdmins || 0}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Admin Aktif
            </CardTitle>
            <div className="p-2 rounded-lg bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-300">
              <Activity className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{stats?.activeAdmins || 0}</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions + Recent Villages */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Aksi Cepat</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Link
              href="/dashboard/superadmin/register"
              className="p-4 rounded-lg border hover:bg-muted/50 transition-colors flex items-center gap-3"
            >
              <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <UserPlus className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="font-medium">Register Desa Baru</p>
                <p className="text-sm text-muted-foreground">Daftarkan desa dan admin baru</p>
              </div>
            </Link>

            <Link
              href="/dashboard/superadmin/villages"
              className="p-4 rounded-lg border hover:bg-muted/50 transition-colors flex items-center gap-3"
            >
              <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="font-medium">Kelola Desa</p>
                <p className="text-sm text-muted-foreground">Lihat dan kelola semua desa</p>
              </div>
            </Link>

            <Link
              href="/dashboard/superadmin/admins"
              className="p-4 rounded-lg border hover:bg-muted/50 transition-colors flex items-center gap-3"
            >
              <div className="h-10 w-10 rounded-lg bg-purple-100 flex items-center justify-center">
                <Users className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="font-medium">Kelola Admin</p>
                <p className="text-sm text-muted-foreground">Atur admin desa</p>
              </div>
            </Link>

            <Link
              href="/dashboard/superadmin/ai-usage"
              className="p-4 rounded-lg border hover:bg-muted/50 transition-colors flex items-center gap-3"
            >
              <div className="h-10 w-10 rounded-lg bg-orange-100 flex items-center justify-center">
                <Cpu className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="font-medium">AI Token Usage</p>
                <p className="text-sm text-muted-foreground">Monitor penggunaan AI</p>
              </div>
            </Link>

            <Link
              href="/dashboard/settings/cache"
              className="p-4 rounded-lg border hover:bg-muted/50 transition-colors flex items-center gap-3"
            >
              <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center">
                <Database className="h-5 w-5 text-slate-600" />
              </div>
              <div>
                <p className="font-medium">Cache Management</p>
                <p className="text-sm text-muted-foreground">Kelola cache sistem</p>
              </div>
            </Link>
          </CardContent>
        </Card>

        {/* Recent Villages */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Desa Terdaftar</CardTitle>
            <Link
              href="/dashboard/superadmin/villages"
              className="text-sm text-primary hover:underline"
            >
              Lihat Semua →
            </Link>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1 space-y-1">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : !stats?.villages?.length ? (
              <div className="text-center py-8">
                <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">Belum ada desa terdaftar</p>
                <Link
                  href="/dashboard/superadmin/register"
                  className="text-sm text-primary hover:underline mt-2 inline-block"
                >
                  Register desa pertama →
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {stats.villages.map((village) => (
                  <div
                    key={village.id}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="shrink-0 h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                      <Building2 className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">
                          {village.name}
                        </span>
                        <Badge
                          variant={village.is_active ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {village.is_active ? "Aktif" : "Nonaktif"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {village.admin_count || 0} admin · /{village.slug}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
