"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth/AuthContext"
import { superadmin } from "@/lib/frontend-api"
import { isSuperadmin } from "@/lib/rbac"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

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

    const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [admins, setAdmins] = useState<AdminItem[]>([])
  const [updating, setUpdating] = useState<string | null>(null)
  const [pendingToggle, setPendingToggle] = useState<{ admin: AdminItem; nextValue: boolean } | null>(null)

  useEffect(() => {
    if (user && !isSuperadmin(user.role)) {
      router.replace("/dashboard")
    }
  }, [user, router])

  const fetchAdmins = async () => {
    try {
      setLoading(true)
      const result = await superadmin.getAdmins()
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
    if (isSuperadmin(user?.role)) {
      fetchAdmins()
    }
  }, [user, router])

  const requestToggle = (admin: AdminItem, nextValue: boolean) => {
    setPendingToggle({ admin, nextValue })
  }

  const handleToggle = async (adminId: string, nextValue: boolean) => {
    try {
      setUpdating(adminId)
      await superadmin.updateAdmin(adminId, { is_active: nextValue })

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

  if (!isSuperadmin(user?.role)) {
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

      <AlertDialog open={!!pendingToggle} onOpenChange={(open) => !open && setPendingToggle(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingToggle?.nextValue ? "Aktifkan admin?" : "Nonaktifkan admin?"}</AlertDialogTitle>
            <AlertDialogDescription>
              Status admin {pendingToggle?.admin.name} akan diubah menjadi {pendingToggle?.nextValue ? "aktif" : "nonaktif"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const action = pendingToggle
                setPendingToggle(null)
                if (action) await handleToggle(action.admin.id, action.nextValue)
              }}
            >
              Simpan Perubahan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                        <Badge variant={isSuperadmin(admin.role) ? "default" : "secondary"}>
                          {isSuperadmin(admin.role) ? "Super Admin" : "Admin Desa"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Switch
                            checked={admin.is_active}
                            onCheckedChange={(value: boolean) => requestToggle(admin, value)}
                            disabled={updating === admin.id || isSuperadmin(admin.role)}
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
