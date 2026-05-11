"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useAuth } from "@/components/auth/AuthContext"
import { Eye, Loader2, Power, PowerOff } from "lucide-react"
import Link from "next/link"
import { superadmin } from "@/lib/frontend-api"
import { isSuperadmin } from "@/lib/rbac"

interface AdminUser {
  id: string
  name: string
  username: string
  role: string
  is_active: boolean
}

interface VillageProfile {
  short_name?: string | null
  address?: string | null
}

interface VillageItem {
  id: string
  name: string
  slug: string
  is_active: boolean
  created_at: string
  admin_count: number
  admins: AdminUser[]
  profile: VillageProfile | null
}

export default function SuperadminVillagesPage() {
    const { user } = useAuth()

    const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [villages, setVillages] = useState<VillageItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [updatingVillageId, setUpdatingVillageId] = useState<string | null>(null)

  useEffect(() => {
    if (user && !isSuperadmin(user.role)) {
      router.replace("/dashboard")
    }
  }, [user, router])

  const fetchVillages = async () => {
    try {
      setLoading(true)
      setError(null)
      const result = await superadmin.getVillages()
      setVillages(result.data || [])
    } catch (err: any) {
      setError(err?.message || "Gagal memuat data desa")
      console.error("Failed to load villages:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isSuperadmin(user?.role)) {
      fetchVillages()
    }
  }, [user, router])

  const updateVillageStatus = async (village: VillageItem, isActive: boolean) => {
    if (!isActive && !confirm(`Nonaktifkan ${village.name}? Admin desa tidak bisa login sampai desa diaktifkan lagi.`)) return

    try {
      setUpdatingVillageId(village.id)
      await superadmin.updateVillage(village.id, { is_active: isActive })
      await fetchVillages()
    } catch (err: any) {
      setError(err?.message || "Gagal memperbarui status desa")
      console.error("Failed to update village status:", err)
    } finally {
      setUpdatingVillageId(null)
    }
  }

  if (!isSuperadmin(user?.role)) {
    return null
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Daftar Desa/Kelurahan</h1>
        <p className="text-muted-foreground mt-2">
          Pantau seluruh desa/kelurahan yang terdaftar beserta admin aktifnya.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Terjadi kesalahan</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Ringkasan Desa</CardTitle>
          <CardDescription>Data desa, slug, admin, dan profil singkat.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama Desa</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Alias</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {villages.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Belum ada desa terdaftar.
                    </TableCell>
                  </TableRow>
                ) : (
                  villages.map((village) => (
                    <TableRow key={village.id}>
                      <TableCell className="font-medium">{village.name}</TableCell>
                      <TableCell>{village.slug}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="text-sm">{village.admin_count} admin</div>
                          <div className="text-xs text-muted-foreground">
                            {village.admins.map((admin) => admin.name).join(", ") || "-"}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {village.profile?.short_name ? `Alias: ${village.profile.short_name}` : "Tanpa alias"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {village.profile?.address || "Alamat belum diisi"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={village.is_active ? "default" : "secondary"}>
                          {village.is_active ? "Aktif" : "Nonaktif"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant={village.is_active ? "outline" : "default"}
                            size="sm"
                            disabled={updatingVillageId === village.id}
                            onClick={() => updateVillageStatus(village, !village.is_active)}
                          >
                            {updatingVillageId === village.id ? (
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            ) : village.is_active ? (
                              <PowerOff className="h-4 w-4 mr-1" />
                            ) : (
                              <Power className="h-4 w-4 mr-1" />
                            )}
                            {village.is_active ? "Nonaktifkan" : "Aktifkan"}
                          </Button>
                          <Link href={`/dashboard/superadmin/villages/${village.id}`}>
                            <Button variant="ghost" size="sm">
                              <Eye className="h-4 w-4 mr-1" /> Detail
                            </Button>
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
