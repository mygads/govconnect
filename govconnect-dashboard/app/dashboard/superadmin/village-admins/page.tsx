"use client"

import { useEffect, useMemo, useState } from "react"
import { redirect } from "next/navigation"
import { Edit2, KeyRound, Loader2, Plus, Trash2 } from "lucide-react"

import { useAuth } from "@/components/auth/AuthContext"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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

interface VillageItem {
  id: string
  name: string
  slug: string
}

interface AdminItem {
  id: string
  name: string
  username: string
  role: string
  is_active: boolean
  village_id?: string | null
  created_at: string
  village?: {
    id: string
    name: string
    slug: string
  } | null
}

const emptyForm = {
  name: "",
  username: "",
  password: "",
  role: "village_admin",
}

export default function SuperadminVillageAdminsPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [villages, setVillages] = useState<VillageItem[]>([])
  const [selectedVillageId, setSelectedVillageId] = useState("")
  const [admins, setAdmins] = useState<AdminItem[]>([])
  const [loadingVillages, setLoadingVillages] = useState(true)
  const [loadingAdmins, setLoadingAdmins] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [formOpen, setFormOpen] = useState(false)
  const [editingAdmin, setEditingAdmin] = useState<AdminItem | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [pendingDelete, setPendingDelete] = useState<AdminItem | null>(null)
  const [pendingToggle, setPendingToggle] = useState<{ admin: AdminItem; nextValue: boolean } | null>(null)
  const [resetTarget, setResetTarget] = useState<AdminItem | null>(null)
  const [newPassword, setNewPassword] = useState("")

  useEffect(() => {
    if (user && user.role !== "superadmin") redirect("/dashboard")
  }, [user])

  const loadVillages = async () => {
    try {
      setLoadingVillages(true)
      const response = await fetch("/api/superadmin/villages", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || "Gagal memuat desa")
      const rows = Array.isArray(payload?.data) ? payload.data : []
      setVillages(rows)
    } catch (error: any) {
      toast({ title: "Gagal", description: error?.message || "Gagal memuat desa", variant: "destructive" })
    } finally {
      setLoadingVillages(false)
    }
  }

  const loadAdmins = async (villageId?: string) => {
    try {
      setLoadingAdmins(true)
      const params = villageId ? `?village_id=${encodeURIComponent(villageId)}` : ""
      const response = await fetch(`/api/superadmin/village-admins${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || "Gagal memuat admin desa")
      setAdmins(Array.isArray(payload?.data) ? payload.data : [])
    } catch (error: any) {
      toast({ title: "Gagal", description: error?.message || "Gagal memuat admin desa", variant: "destructive" })
    } finally {
      setLoadingAdmins(false)
    }
  }

  useEffect(() => {
    if (user?.role === "superadmin") void loadVillages()
  }, [user])

  useEffect(() => {
    void loadAdmins(selectedVillageId || undefined)
  }, [selectedVillageId])

  const filteredAdmins = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return admins
    return admins.filter((admin) => [admin.name, admin.username, admin.role].join(" ").toLowerCase().includes(normalized))
  }, [admins, query])

  const openCreate = () => {
    setEditingAdmin(null)
    setForm(emptyForm)
    setFormOpen(true)
  }

  const openEdit = (admin: AdminItem) => {
    setEditingAdmin(admin)
    setForm({ name: admin.name, username: admin.username, password: "", role: admin.role })
    setFormOpen(true)
  }

  const saveAdmin = async () => {
    if (!selectedVillageId) return
    if (!form.name.trim() || !form.username.trim()) {
      toast({ title: "Gagal", description: "Nama dan username wajib diisi", variant: "destructive" })
      return
    }
    if (!editingAdmin && form.password.length < 8) {
      toast({ title: "Gagal", description: "Password minimal 8 karakter", variant: "destructive" })
      return
    }

    try {
      setSubmitting(true)
      const response = await fetch(editingAdmin ? `/api/superadmin/village-admins/${encodeURIComponent(editingAdmin.id)}` : "/api/superadmin/village-admins", {
        method: editingAdmin ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify(editingAdmin ? {
          name: form.name.trim(),
          username: form.username.trim(),
          role: form.role,
        } : {
          village_id: selectedVillageId,
          name: form.name.trim(),
          username: form.username.trim(),
          password: form.password,
          role: form.role,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || "Gagal menyimpan admin")

      toast({ title: "Berhasil", description: editingAdmin ? "Admin berhasil diubah." : "Admin berhasil ditambahkan." })
      setFormOpen(false)
      setEditingAdmin(null)
      setForm(emptyForm)
      await loadAdmins(selectedVillageId || undefined)
    } catch (error: any) {
      toast({ title: "Gagal", description: error?.message || "Gagal menyimpan admin", variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  const confirmToggle = async () => {
    if (!pendingToggle) return
    try {
      setProcessingId(pendingToggle.admin.id)
      const response = await fetch(`/api/superadmin/village-admins/${encodeURIComponent(pendingToggle.admin.id)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ is_active: pendingToggle.nextValue }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || "Gagal memperbarui status admin")
      toast({ title: "Berhasil", description: pendingToggle.nextValue ? "Admin diaktifkan." : "Admin dinonaktifkan." })
      await loadAdmins(selectedVillageId || undefined)
    } catch (error: any) {
      toast({ title: "Gagal", description: error?.message || "Gagal memperbarui status admin", variant: "destructive" })
    } finally {
      setProcessingId(null)
      setPendingToggle(null)
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    try {
      setProcessingId(pendingDelete.id)
      const response = await fetch(`/api/superadmin/village-admins/${encodeURIComponent(pendingDelete.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || "Gagal menghapus admin")
      toast({ title: "Berhasil", description: "Admin berhasil dihapus." })
      await loadAdmins(selectedVillageId || undefined)
    } catch (error: any) {
      toast({ title: "Gagal", description: error?.message || "Gagal menghapus admin", variant: "destructive" })
    } finally {
      setProcessingId(null)
      setPendingDelete(null)
    }
  }

  const submitResetPassword = async () => {
    if (!resetTarget) return
    if (newPassword.length < 8) {
      toast({ title: "Gagal", description: "Password baru minimal 8 karakter", variant: "destructive" })
      return
    }

    try {
      setProcessingId(resetTarget.id)
      const response = await fetch(`/api/superadmin/village-admins/${encodeURIComponent(resetTarget.id)}/reset-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ new_password: newPassword }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || "Gagal reset password")
      toast({ title: "Berhasil", description: "Password admin berhasil direset." })
      setResetTarget(null)
      setNewPassword("")
    } catch (error: any) {
      toast({ title: "Gagal", description: error?.message || "Gagal reset password", variant: "destructive" })
    } finally {
      setProcessingId(null)
    }
  }

  if (user?.role !== "superadmin") return null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Admin Desa</h1>
          <p className="mt-2 text-muted-foreground">Kelola user admin per desa, termasuk create, update, reset sandi, dan nonaktif.</p>
        </div>
        <Button onClick={openCreate} disabled={villages.length === 0}><Plus className="mr-2 h-4 w-4" />Tambah Admin</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
          <CardDescription>Default menampilkan semua admin desa. Pilih desa untuk memfilter daftar.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Desa</Label>
            {loadingVillages ? <Skeleton className="h-10 w-full" /> : (
              <Select value={selectedVillageId || "all"} onValueChange={(value) => setSelectedVillageId(value === "all" ? "" : value)}>
                <SelectTrigger><SelectValue placeholder="Semua desa" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua desa</SelectItem>
                  {villages.map((village) => <SelectItem key={village.id} value={village.id}>{village.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <Label>Cari admin</Label>
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nama atau username" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Admin Desa</CardTitle>
          <CardDescription>{filteredAdmins.length} admin ditemukan{selectedVillageId ? " untuk desa terpilih" : " dari semua desa"}.</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingAdmins ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Desa</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAdmins.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">Belum ada admin desa.</TableCell>
                  </TableRow>
                ) : filteredAdmins.map((admin) => (
                  <TableRow key={admin.id}>
                    <TableCell className="font-medium">{admin.name}</TableCell>
                    <TableCell>{admin.username}</TableCell>
                    <TableCell>{admin.village?.name || "-"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{admin.role === "admin" ? "Admin" : "Village Admin"}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={admin.is_active}
                          disabled={processingId === admin.id}
                          onCheckedChange={(value) => setPendingToggle({ admin, nextValue: value })}
                        />
                        <span className="text-xs text-muted-foreground">{admin.is_active ? "Aktif" : "Nonaktif"}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => openEdit(admin)} disabled={processingId === admin.id}><Edit2 className="mr-2 h-4 w-4" />Edit</Button>
                        <Button size="sm" variant="outline" onClick={() => { setResetTarget(admin); setNewPassword("") }} disabled={processingId === admin.id}><KeyRound className="mr-2 h-4 w-4" />Reset Sandi</Button>
                        <Button size="sm" variant="destructive" onClick={() => setPendingDelete(admin)} disabled={processingId === admin.id}><Trash2 className="mr-2 h-4 w-4" />Hapus</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingAdmin ? "Edit Admin Desa" : "Tambah Admin Desa"}</DialogTitle>
            <DialogDescription>{editingAdmin ? "Ubah data admin desa." : "Buat user admin baru untuk desa yang dipilih."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Nama</Label><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></div>
            <div className="space-y-2"><Label>Username</Label><Input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} /></div>
            {!editingAdmin && <div className="space-y-2"><Label>Password</Label><Input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} /></div>}
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(value) => setForm((current) => ({ ...current, role: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="village_admin">Village Admin</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={submitting}>Batal</Button>
            <Button onClick={saveAdmin} disabled={submitting}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{editingAdmin ? "Simpan" : "Tambah"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetTarget} onOpenChange={(open) => !open && setResetTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Sandi</DialogTitle>
            <DialogDescription>Set password baru untuk {resetTarget?.name}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Password Baru</Label>
            <Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)} disabled={processingId === resetTarget?.id}>Batal</Button>
            <Button onClick={submitResetPassword} disabled={processingId === resetTarget?.id}>{processingId === resetTarget?.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Reset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus admin?</AlertDialogTitle>
            <AlertDialogDescription>Admin {pendingDelete?.name} akan dihapus permanen.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingToggle} onOpenChange={(open) => !open && setPendingToggle(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingToggle?.nextValue ? "Aktifkan admin?" : "Nonaktifkan admin?"}</AlertDialogTitle>
            <AlertDialogDescription>Status admin {pendingToggle?.admin.name} akan diubah.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmToggle}>Simpan</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
