"use client"

import { useEffect, useState } from "react"
import { redirect } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/components/auth/AuthContext"
import { Eye } from "lucide-react"
import Link from "next/link"

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
  const [loading, setLoading] = useState(true)
  const [villages, setVillages] = useState<VillageItem[]>([])

  useEffect(() => {
    if (user && user.role !== "superadmin") {
      redirect("/dashboard")
    }
  }, [user])

  useEffect(() => {
    const fetchVillages = async () => {
      try {
        setLoading(true)
        const response = await fetch("/api/superadmin/villages", {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        })

        if (!response.ok) {
          throw new Error("Gagal memuat data desa")
        }

        const result = await response.json()
        setVillages(result.data || [])
      } catch (error) {
        console.error("Failed to load villages:", error)
      } finally {
        setLoading(false)
      }
    }

    if (user?.role === "superadmin") {
      fetchVillages()
    }
  }, [user])

  if (user?.role !== "superadmin") {
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
                  <TableHead>Profil Singkat</TableHead>
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
                          {village.profile?.short_name || "-"}
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
                        <Link href={`/dashboard/superadmin/villages/${village.id}`}>
                          <Button variant="ghost" size="sm">
                            <Eye className="h-4 w-4 mr-1" /> Detail
                          </Button>
                        </Link>
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
