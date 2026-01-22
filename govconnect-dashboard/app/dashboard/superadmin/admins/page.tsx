"use client"

import { useEffect, useState } from "react"
import { redirect } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth/AuthContext"

interface AdminItem {
  id: string
  name: string
  username: string
  role: string
  is_active: boolean
  created_at: string
  village?: {
    id: string
    name: string
    slug: string
  } | null
}

export default function SuperadminAdminsPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [admins, setAdmins] = useState<AdminItem[]>([])
  const [updating, setUpdating] = useState<string | null>(null)

  useEffect(() => {
    if (user && user.role !== "superadmin") {
      redirect("/dashboard")
    }
  }, [user])

  const fetchAdmins = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/superadmin/admins", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      })

      if (!response.ok) {
        throw new Error("Gagal memuat data admin")
      }

      const result = await response.json()
      setAdmins(result.data || [])
    } catch (error) {
      console.error("Failed to load admins:", error)
      toast({
        title: "Gagal",
        description: "Tidak dapat memuat data admin desa.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user?.role === "superadmin") {
      fetchAdmins()
    }
  }, [user])

  const handleToggle = async (adminId: string, nextValue: boolean) => {
    try {
      setUpdating(adminId)
      const response = await fetch(`/api/superadmin/admins/${adminId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ is_active: nextValue }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || "Gagal memperbarui status admin")
      }

      setAdmins((prev) =>
        prev.map((admin) =>
          admin.id === adminId ? { ...admin, is_active: nextValue } : admin
        )
      )

      toast({
        title: "Berhasil",
        description: nextValue ? "Admin diaktifkan." : "Admin dinonaktifkan.",
      })
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal memperbarui status admin",
        variant: "destructive",
      })
    } finally {
      setUpdating(null)
    }
  }

  if (user?.role !== "superadmin") {
    return null
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Manajemen Admin Desa</h1>
        <p className="text-muted-foreground mt-2">
          Aktifkan atau nonaktifkan akun admin desa/kelurahan.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Admin</CardTitle>
          <CardDescription>Kelola status akun admin yang terdaftar.</CardDescription>
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
                  <TableHead>Nama</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Desa</TableHead>
                  <TableHead>Peran</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {admins.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Belum ada admin terdaftar.
                    </TableCell>
                  </TableRow>
                ) : (
                  admins.map((admin) => (
                    <TableRow key={admin.id}>
                      <TableCell className="font-medium">{admin.name}</TableCell>
                      <TableCell>{admin.username}</TableCell>
                      <TableCell>
                        <div className="text-sm">{admin.village?.name || "-"}</div>
                        <div className="text-xs text-muted-foreground">{admin.village?.slug || ""}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={admin.role === "superadmin" ? "default" : "secondary"}>
                          {admin.role === "superadmin" ? "Super Admin" : "Admin Desa"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Switch
                            checked={admin.is_active}
                            onCheckedChange={(value: boolean) => handleToggle(admin.id, value)}
                            disabled={updating === admin.id || admin.role === "superadmin"}
                          />
                          <span className="text-xs text-muted-foreground">
                            {admin.is_active ? "Aktif" : "Nonaktif"}
                          </span>
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
