"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { 
  PlusCircle, 
  ShieldAlert, 
  Pencil, 
  Trash2, 
  FolderOpen,
  FileWarning,
  Siren,
  MapPin,
  Phone,
  MoreHorizontal,
  Search,
  Layers,
  X
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

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
  
  // Search
  const [searchCategory, setSearchCategory] = useState("")
  const [searchType, setSearchType] = useState("")

  // Modal states
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [typeModalOpen, setTypeModalOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<ComplaintCategory | null>(null)
  const [editingType, setEditingType] = useState<ComplaintType | null>(null)
  const [saving, setSaving] = useState(false)

  // Form states
  const [categoryForm, setCategoryForm] = useState({ name: "", description: "" })
  const [typeForm, setTypeForm] = useState({
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Category handlers
  const openCategoryModal = (category?: ComplaintCategory) => {
    if (category) {
      setEditingCategory(category)
      setCategoryForm({ name: category.name, description: category.description || "" })
    } else {
      setEditingCategory(null)
      setCategoryForm({ name: "", description: "" })
    }
    setCategoryModalOpen(true)
  }

  const handleSaveCategory = async () => {
    if (!categoryForm.name.trim()) return
    setSaving(true)

    try {
      const url = editingCategory
        ? `/api/complaints/categories/${editingCategory.id}`
        : "/api/complaints/categories"
      const method = editingCategory ? "PATCH" : "POST"

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify(categoryForm),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Gagal menyimpan kategori")
      }

      toast({
        title: editingCategory ? "Kategori diperbarui" : "Kategori ditambahkan",
        description: editingCategory
          ? "Kategori pengaduan berhasil diperbarui."
          : "Kategori pengaduan berhasil dibuat.",
      })
      setCategoryModalOpen(false)
      fetchAll()
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal menyimpan kategori",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteCategory = async (id: string) => {
    if (!confirm("Hapus kategori ini? Kategori hanya bisa dihapus jika tidak punya jenis pengaduan.")) return

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

  // Type handlers
  const openTypeModal = (type?: ComplaintType) => {
    if (type) {
      setEditingType(type)
      setTypeForm({
        category_id: type.category_id,
        name: type.name,
        description: type.description || "",
        is_urgent: type.is_urgent,
        require_address: type.require_address,
        send_important_contacts: type.send_important_contacts,
        important_contact_category: type.important_contact_category || "",
      })
    } else {
      setEditingType(null)
      setTypeForm({
        category_id: "",
        name: "",
        description: "",
        is_urgent: false,
        require_address: true,
        send_important_contacts: false,
        important_contact_category: "",
      })
    }
    setTypeModalOpen(true)
  }

  const handleSaveType = async () => {
    if (!typeForm.category_id || !typeForm.name.trim()) return

    if (typeForm.send_important_contacts && !typeForm.important_contact_category) {
      toast({
        title: "Kategori nomor penting wajib",
        description: "Pilih kategori nomor penting untuk jenis yang mengirim kontak darurat.",
        variant: "destructive",
      })
      return
    }

    setSaving(true)

    try {
      const url = editingType
        ? `/api/complaints/types/${editingType.id}`
        : "/api/complaints/types"
      const method = editingType ? "PATCH" : "POST"

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          ...typeForm,
          important_contact_category: typeForm.send_important_contacts
            ? typeForm.important_contact_category
            : null,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Gagal menyimpan jenis")
      }

      toast({
        title: editingType ? "Jenis diperbarui" : "Jenis ditambahkan",
        description: editingType
          ? "Jenis pengaduan berhasil diperbarui."
          : "Jenis pengaduan berhasil dibuat.",
      })
      setTypeModalOpen(false)
      fetchAll()
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal menyimpan jenis",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
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

  // Filter data
  const filteredCategories = categories.filter(c => 
    c.name.toLowerCase().includes(searchCategory.toLowerCase())
  )
  
  const filteredTypes = types.filter(t => 
    t.name.toLowerCase().includes(searchType.toLowerCase()) ||
    t.category?.name?.toLowerCase().includes(searchType.toLowerCase())
  )

  // Group types by category
  const typesByCategory = filteredTypes.reduce((acc, type) => {
    const catName = type.category?.name || "Lainnya"
    if (!acc[catName]) acc[catName] = []
    acc[catName].push(type)
    return acc
  }, {} as Record<string, ComplaintType[]>)

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">
            Kategori & Jenis Pengaduan
          </h1>
          <p className="text-muted-foreground mt-1">
            Kelola kategori dan jenis laporan masyarakat
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => openCategoryModal()} variant="outline" className="gap-2">
            <FolderOpen className="h-4 w-4" />
            Tambah Kategori
          </Button>
          <Button onClick={() => openTypeModal()} className="gap-2">
            <PlusCircle className="h-4 w-4" />
            Tambah Jenis
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5 text-gray-500" />
              <div>
                <p className="text-2xl font-bold">{categories.length}</p>
                <p className="text-sm text-muted-foreground">Total Kategori</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <FileWarning className="h-5 w-5 text-gray-500" />
              <div>
                <p className="text-2xl font-bold">{types.length}</p>
                <p className="text-sm text-muted-foreground">Total Jenis</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Siren className="h-5 w-5 text-gray-500" />
              <div>
                <p className="text-2xl font-bold">
                  {types.filter(t => t.is_urgent).length}
                </p>
                <p className="text-sm text-muted-foreground">Jenis Urgent</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-gray-500" />
              <div>
                <p className="text-2xl font-bold">
                  {types.filter(t => t.require_address).length}
                </p>
                <p className="text-sm text-muted-foreground">Wajib Alamat</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Categories Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Kategori Pengaduan
            </CardTitle>
            <CardDescription>Kelompok utama jenis laporan</CardDescription>
            <div className="relative mt-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cari kategori..."
                value={searchCategory}
                onChange={(e) => setSearchCategory(e.target.value)}
                className="pl-9"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {filteredCategories.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="p-4 rounded-full bg-muted mb-4">
                  <FolderOpen className="h-8 w-8 text-muted-foreground" />
                </div>
                <p className="text-muted-foreground font-medium">Belum ada kategori</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Klik tombol &quot;Tambah Kategori&quot; untuk memulai
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {filteredCategories.map((category) => {
                  const typeCount = types.filter(t => t.category_id === category.id).length
                  return (
                    <div 
                      key={category.id} 
                      className="p-4 hover:bg-muted/50 transition-colors group"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold truncate">{category.name}</h4>
                            <Badge variant="secondary" className="text-xs">
                              {typeCount} jenis
                            </Badge>
                          </div>
                          {category.description && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {category.description}
                            </p>
                          )}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openCategoryModal(category)}>
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={() => handleDeleteCategory(category.id)}
                              className="text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Hapus
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Types Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" />
              Jenis Pengaduan
            </CardTitle>
            <CardDescription>Detail jenis laporan per kategori</CardDescription>
            <div className="relative mt-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cari jenis pengaduan..."
                value={searchType}
                onChange={(e) => setSearchType(e.target.value)}
                className="pl-9"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0 max-h-[600px] overflow-y-auto">
            {filteredTypes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="p-4 rounded-full bg-muted mb-4">
                  <FileWarning className="h-8 w-8 text-muted-foreground" />
                </div>
                <p className="text-muted-foreground font-medium">Belum ada jenis pengaduan</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Buat kategori terlebih dahulu, lalu tambah jenis
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {Object.entries(typesByCategory).map(([catName, catTypes]) => (
                  <div key={catName}>
                    <div className="px-4 py-2 bg-white sticky top-0 z-10">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {catName}
                      </span>
                    </div>
                    {catTypes.map((type) => (
                      <div 
                        key={type.id} 
                        className="p-4 hover:bg-muted/50 transition-colors group"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-semibold">{type.name}</h4>
                              {type.is_urgent && (
                                <Badge variant="destructive" className="text-xs gap-1">
                                  <Siren className="h-3 w-3" />
                                  URGENT
                                </Badge>
                              )}
                            </div>
                            {type.description && (
                              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                                {type.description}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-2 mt-2">
                              {type.require_address && (
                                <Badge variant="outline" className="text-xs gap-1">
                                  <MapPin className="h-3 w-3" />
                                  Wajib Alamat
                                </Badge>
                              )}
                              {type.send_important_contacts && (
                                <Badge variant="outline" className="text-xs gap-1">
                                  <Phone className="h-3 w-3" />
                                  Kirim Kontak
                                </Badge>
                              )}
                            </div>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openTypeModal(type)}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => handleDeleteType(type.id)}
                                className="text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Hapus
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Category Modal */}
      <Dialog open={categoryModalOpen} onOpenChange={setCategoryModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" />
              {editingCategory ? "Edit Kategori" : "Tambah Kategori"}
            </DialogTitle>
            <DialogDescription>
              {editingCategory 
                ? "Perbarui informasi kategori pengaduan"
                : "Buat kategori baru untuk mengelompokkan jenis pengaduan"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="cat-name">Nama Kategori <span className="text-destructive">*</span></Label>
              <Input
                id="cat-name"
                value={categoryForm.name}
                onChange={(e) => setCategoryForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Contoh: Bencana, Infrastruktur, Sosial"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-desc">Deskripsi</Label>
              <Textarea
                id="cat-desc"
                value={categoryForm.description}
                onChange={(e) => setCategoryForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Deskripsi singkat kategori ini"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoryModalOpen(false)}>
              <X className="h-4 w-4 mr-2" />
              Tutup
            </Button>
            <Button onClick={handleSaveCategory} disabled={saving || !categoryForm.name.trim()}>
              {saving ? "Menyimpan..." : editingCategory ? "Simpan Perubahan" : "Tambah Kategori"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Type Modal */}
      <Dialog open={typeModalOpen} onOpenChange={setTypeModalOpen}>
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" />
              {editingType ? "Edit Jenis Pengaduan" : "Tambah Jenis Pengaduan"}
            </DialogTitle>
            <DialogDescription>
              {editingType 
                ? "Perbarui informasi jenis pengaduan"
                : "Buat jenis pengaduan baru dengan aturan khusus"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Kategori <span className="text-destructive">*</span></Label>
              <Select
                value={typeForm.category_id}
                onValueChange={(value) => setTypeForm(prev => ({ ...prev, category_id: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pilih kategori" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="type-name">Nama Jenis <span className="text-destructive">*</span></Label>
              <Input
                id="type-name"
                value={typeForm.name}
                onChange={(e) => setTypeForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Contoh: Banjir, Kebakaran, Jalan Rusak"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="type-desc">Deskripsi</Label>
              <Textarea
                id="type-desc"
                value={typeForm.description}
                onChange={(e) => setTypeForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Deskripsi singkat jenis pengaduan"
                rows={2}
              />
            </div>

            <div className="space-y-3 pt-2">
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">Pengaturan</Label>
              
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Siren className="h-4 w-4" />
                    <Label className="cursor-pointer">Urgent / Darurat</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">Prioritas tinggi di dashboard</p>
                </div>
                <Switch
                  checked={typeForm.is_urgent}
                  onCheckedChange={(value) => setTypeForm(prev => ({ ...prev, is_urgent: value }))}
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    <Label className="cursor-pointer">Wajib Alamat</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">AI akan meminta alamat lokasi</p>
                </div>
                <Switch
                  checked={typeForm.require_address}
                  onCheckedChange={(value) => setTypeForm(prev => ({ ...prev, require_address: value }))}
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    <Label className="cursor-pointer">Kirim Nomor Penting</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">Sertakan kontak darurat dalam balasan</p>
                </div>
                <Switch
                  checked={typeForm.send_important_contacts}
                  onCheckedChange={(value) => setTypeForm(prev => ({ ...prev, send_important_contacts: value }))}
                />
              </div>

              {typeForm.send_important_contacts && (
                <div className="space-y-2 pl-4 border-l-2 border-muted">
                  <Label>Kategori Nomor Penting</Label>
                  <Select
                    value={typeForm.important_contact_category}
                    onValueChange={(value) => setTypeForm(prev => ({ ...prev, important_contact_category: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih kategori nomor" />
                    </SelectTrigger>
                    <SelectContent>
                      {importantCategories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.name}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTypeModalOpen(false)}>
              <X className="h-4 w-4 mr-2" />
              Tutup
            </Button>
            <Button 
              onClick={handleSaveType} 
              disabled={saving || !typeForm.name.trim() || !typeForm.category_id}
            >
              {saving ? "Menyimpan..." : editingType ? "Simpan Perubahan" : "Tambah Jenis"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
