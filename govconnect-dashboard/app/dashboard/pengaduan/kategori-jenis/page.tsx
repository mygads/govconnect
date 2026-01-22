"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { AlertCircle, PlusCircle, ShieldAlert } from "lucide-react"

interface ComplaintCategory {
  id: string
  name: string
  description?: string | null
}

interface ComplaintType {
  id: string
  name: string
  description?: string | null
  category_id: string
  is_urgent: boolean
  require_address: boolean
  send_important_contacts: boolean
  important_contact_category?: string | null
  category?: ComplaintCategory
}

interface ImportantContactCategory {
  id: string
  name: string
}

export default function ComplaintMetaPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [categories, setCategories] = useState<ComplaintCategory[]>([])
  const [types, setTypes] = useState<ComplaintType[]>([])
  const [importantCategories, setImportantCategories] = useState<ImportantContactCategory[]>([])
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null)

  const [newCategory, setNewCategory] = useState({
    name: "",
    description: "",
  })

  const [newType, setNewType] = useState({
    category_id: "",
    name: "",
    description: "",
    is_urgent: false,
    require_address: true,
    send_important_contacts: false,
    important_contact_category: "",
  })

  const fetchAll = async () => {
    try {
      setLoading(true)
      const [categoriesRes, typesRes, importantRes] = await Promise.all([
        fetch("/api/complaints/categories", {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }),
        fetch("/api/complaints/types", {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }),
        fetch("/api/important-contacts/categories", {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }),
      ])

      if (categoriesRes.ok) {
        const data = await categoriesRes.json()
        setCategories(data.data || [])
      }

      if (typesRes.ok) {
        const data = await typesRes.json()
        setTypes(data.data || [])
      }

      if (importantRes.ok) {
        const data = await importantRes.json()
        setImportantCategories(data.data || [])
      }
    } catch (error) {
      console.error("Failed to load complaint meta", error)
      toast({
        title: "Gagal memuat data",
        description: "Terjadi kesalahan saat memuat kategori & jenis pengaduan.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAll()
  }, [])

  const handleSaveCategory = async () => {
    if (!newCategory.name.trim()) return

    try {
      const url = editingCategoryId
        ? `/api/complaints/categories/${editingCategoryId}`
        : "/api/complaints/categories"
      const method = editingCategoryId ? "PATCH" : "POST"

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          name: newCategory.name,
          description: newCategory.description,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Gagal menambah kategori")
      }

      toast({
        title: editingCategoryId ? "Kategori diperbarui" : "Kategori ditambahkan",
        description: editingCategoryId
          ? "Kategori pengaduan berhasil diperbarui."
          : "Kategori pengaduan berhasil dibuat.",
      })
      setNewCategory({ name: "", description: "" })
      setEditingCategoryId(null)
      fetchAll()
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal menyimpan kategori",
        variant: "destructive",
      })
    }
  }

  const handleEditCategory = (category: ComplaintCategory) => {
    setEditingCategoryId(category.id)
    setNewCategory({ name: category.name, description: category.description || "" })
  }

  const handleDeleteCategory = async (id: string) => {
    if (!confirm("Hapus kategori ini? Kategori hanya bisa dihapus jika tidak punya jenis pengaduan. (Hapus jenisnya dulu)") ) return

    try {
      const response = await fetch(`/api/complaints/categories/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Gagal menghapus kategori")
      }

      toast({
        title: "Kategori dihapus",
        description: "Kategori pengaduan berhasil dihapus.",
      })
      fetchAll()
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal menghapus kategori",
        variant: "destructive",
      })
    }
  }

  const handleSaveType = async () => {
    if (!newType.category_id || !newType.name.trim()) return

    if (newType.send_important_contacts && !newType.important_contact_category) {
      toast({
        title: "Kategori nomor penting wajib",
        description: "Pilih kategori nomor penting untuk jenis urgent.",
        variant: "destructive",
      })
      return
    }

    try {
      const url = editingTypeId
        ? `/api/complaints/types/${editingTypeId}`
        : "/api/complaints/types"
      const method = editingTypeId ? "PATCH" : "POST"

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          category_id: newType.category_id,
          name: newType.name,
          description: newType.description,
          is_urgent: newType.is_urgent,
          require_address: newType.require_address,
          send_important_contacts: newType.send_important_contacts,
          important_contact_category: newType.send_important_contacts
            ? newType.important_contact_category
            : null,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Gagal menambah jenis")
      }

      toast({
        title: editingTypeId ? "Jenis diperbarui" : "Jenis ditambahkan",
        description: editingTypeId
          ? "Jenis pengaduan berhasil diperbarui."
          : "Jenis pengaduan berhasil dibuat.",
      })
      setNewType({
        category_id: "",
        name: "",
        description: "",
        is_urgent: false,
        require_address: true,
        send_important_contacts: false,
        important_contact_category: "",
      })
      setEditingTypeId(null)
      fetchAll()
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal menyimpan jenis",
        variant: "destructive",
      })
    }
  }

  const handleEditType = (type: ComplaintType) => {
    setEditingTypeId(type.id)
    setNewType({
      category_id: type.category_id,
      name: type.name,
      description: type.description || "",
      is_urgent: type.is_urgent,
      require_address: type.require_address,
      send_important_contacts: type.send_important_contacts,
      important_contact_category: type.important_contact_category || "",
    })
  }

  const handleDeleteType = async (id: string) => {
    if (!confirm("Hapus jenis pengaduan ini?")) return

    try {
      const response = await fetch(`/api/complaints/types/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Gagal menghapus jenis")
      }

      toast({
        title: "Jenis dihapus",
        description: "Jenis pengaduan berhasil dihapus.",
      })
      fetchAll()
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal menghapus jenis",
        variant: "destructive",
      })
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Kategori & Jenis Pengaduan</h1>
        <p className="text-muted-foreground mt-2">
          Kelola kategori dan jenis laporan, termasuk penanda urgent dan aturan wajib alamat.
        </p>
      </div>

      {loading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PlusCircle className="h-5 w-5" />
                Tambah Kategori
              </CardTitle>
              <CardDescription>Kategori untuk mengelompokkan jenis laporan.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Label htmlFor="category-name">Nama Kategori</Label>
              <Input
                id="category-name"
                value={newCategory.name}
                onChange={(e) => setNewCategory((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Bencana, Infrastruktur, Sosial"
              />
              <Label htmlFor="category-desc">Deskripsi</Label>
              <Textarea
                id="category-desc"
                value={newCategory.description}
                onChange={(e) => setNewCategory((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Ringkasan kategori"
              />
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleSaveCategory}>
                  {editingCategoryId ? "Simpan Perubahan" : "Simpan Kategori"}
                </Button>
                {editingCategoryId && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditingCategoryId(null)
                      setNewCategory({ name: "", description: "" })
                    }}
                  >
                    Batal
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5" />
                Tambah Jenis Pengaduan
              </CardTitle>
              <CardDescription>Atur aturan urgent, wajib alamat, dan nomor penting.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label>Kategori</Label>
                <Select
                  value={newType.category_id}
                  onValueChange={(value: string) => setNewType((prev) => ({ ...prev, category_id: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih kategori" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Label htmlFor="type-name">Nama Jenis</Label>
              <Input
                id="type-name"
                value={newType.name}
                onChange={(e) => setNewType((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Banjir, Kebakaran, Jalan Rusak"
              />
              <Label htmlFor="type-desc">Deskripsi</Label>
              <Textarea
                id="type-desc"
                value={newType.description}
                onChange={(e) => setNewType((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Deskripsi singkat jenis laporan"
              />

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-1">
                  <Label>Urgent / Darurat</Label>
                  <p className="text-xs text-muted-foreground">Menampilkan alert prioritas di dashboard.</p>
                </div>
                <Switch
                  checked={newType.is_urgent}
                  onCheckedChange={(value: boolean) => setNewType((prev) => ({ ...prev, is_urgent: value }))}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-1">
                  <Label>Wajib Alamat</Label>
                  <p className="text-xs text-muted-foreground">AI wajib meminta alamat sebelum membuat laporan.</p>
                </div>
                <Switch
                  checked={newType.require_address}
                  onCheckedChange={(value: boolean) => setNewType((prev) => ({ ...prev, require_address: value }))}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-1">
                  <Label>Kirim Nomor Penting</Label>
                  <p className="text-xs text-muted-foreground">Balasan AI akan menyertakan kontak darurat.</p>
                </div>
                <Switch
                  checked={newType.send_important_contacts}
                  onCheckedChange={(value: boolean) => setNewType((prev) => ({ ...prev, send_important_contacts: value }))}
                />
              </div>

              {newType.send_important_contacts && (
                <div className="space-y-2">
                  <Label>Kategori Nomor Penting</Label>
                  <Select
                    value={newType.important_contact_category}
                    onValueChange={(value: string) => setNewType((prev) => ({ ...prev, important_contact_category: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih kategori nomor" />
                    </SelectTrigger>
                    <SelectContent>
                      {importantCategories.map((category) => (
                        <SelectItem key={category.id} value={category.name}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button onClick={handleSaveType}>
                  {editingTypeId ? "Simpan Perubahan" : "Simpan Jenis"}
                </Button>
                {editingTypeId && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditingTypeId(null)
                      setNewType({
                        category_id: "",
                        name: "",
                        description: "",
                        is_urgent: false,
                        require_address: true,
                        send_important_contacts: false,
                        important_contact_category: "",
                      })
                    }}
                  >
                    Batal
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Daftar Kategori</CardTitle>
            <CardDescription>Semua kategori pengaduan yang aktif.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {categories.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                Belum ada kategori.
              </div>
            ) : (
              <div className="space-y-2">
                {categories.map((category) => (
                  <div key={category.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{category.name}</div>
                        {category.description && (
                          <p className="text-sm text-muted-foreground mt-1">{category.description}</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => handleEditCategory(category)}>
                          Ubah
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleDeleteCategory(category.id)}>
                          Hapus
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Daftar Jenis Pengaduan</CardTitle>
            <CardDescription>Jenis laporan per kategori beserta aturan khusus.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {types.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                Belum ada jenis pengaduan.
              </div>
            ) : (
              <div className="space-y-3">
                {types.map((type) => (
                  <div key={type.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{type.name}</div>
                        <p className="text-xs text-muted-foreground">
                          {type.category?.name || "Kategori tidak ditemukan"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {type.is_urgent && (
                          <span className="text-xs rounded-full bg-red-100 text-red-700 px-2 py-1">
                            URGENT
                          </span>
                        )}
                        <Button size="sm" variant="outline" onClick={() => handleEditType(type)}>
                          Ubah
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleDeleteType(type.id)}>
                          Hapus
                        </Button>
                      </div>
                    </div>
                    {type.description && (
                      <p className="text-sm text-muted-foreground mt-2">{type.description}</p>
                    )}
                    <div className="mt-2 text-xs text-muted-foreground space-y-1">
                      <div>Wajib alamat: {type.require_address ? "Ya" : "Tidak"}</div>
                      <div>Kirim nomor penting: {type.send_important_contacts ? "Ya" : "Tidak"}</div>
                      {type.send_important_contacts && type.important_contact_category && (
                        <div>Kategori nomor: {type.important_contact_category}</div>
                      )}
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