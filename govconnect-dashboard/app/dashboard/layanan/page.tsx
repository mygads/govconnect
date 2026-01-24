"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { AlertCircle, Settings, Clock, PlusCircle } from "lucide-react"

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
}

interface Service {
  id: string
  name: string
  description: string
  slug: string
  mode: string
  is_active: boolean
  category?: { name: string } | null
  requirements?: ServiceRequirement[]
}

interface ServiceCategory {
  id: string
  name: string
  description?: string | null
}

interface ServiceRequirement {
  id: string
  label: string
  field_type: "file" | "text" | "textarea" | "select" | "radio" | "date" | "number" | string
  is_required: boolean
  options_json?: any
  help_text?: string | null
  order_index?: number
}

const modeLabels: Record<string, string> = {
  online: "Online",
  offline: "Offline",
  both: "Online & Offline",
}

export default function LayananPage() {
  const { toast } = useToast()
  const [services, setServices] = useState<Service[]>([])
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [villageSlug, setVillageSlug] = useState<string>("")

  const [activeServiceId, setActiveServiceId] = useState<string>("")
  const [requirements, setRequirements] = useState<ServiceRequirement[]>([])
  const [reqLoading, setReqLoading] = useState(false)
  const [reqError, setReqError] = useState<string | null>(null)
  const [newRequirement, setNewRequirement] = useState({
    label: "",
    field_type: "text",
    is_required: true,
    help_text: "",
    options: "",
    order_index: 0,
  })
  const [editingRequirementId, setEditingRequirementId] = useState<string | null>(null)
  const [editingRequirement, setEditingRequirement] = useState({
    label: "",
    field_type: "text",
    is_required: true,
    help_text: "",
    options: "",
    order_index: 0,
  })

  const [creating, setCreating] = useState(false)
  const [newCategory, setNewCategory] = useState({ name: "", description: "" })
  const [newService, setNewService] = useState({
    category_id: "",
    name: "",
    description: "",
    slug: "",
    mode: "both",
    is_active: true,
  })

  useEffect(() => {
    fetchAll()
  }, [])

  useEffect(() => {
    const loadVillage = async () => {
      try {
        const response = await fetch("/api/villages/me", {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        })
        if (!response.ok) return
        const json = await response.json()
        setVillageSlug(json?.data?.slug || "")
      } catch {
        // ignore
      }
    }
    loadVillage()
  }, [])

  const fetchAll = async () => {
    try {
      setLoading(true)
      const [servicesRes, categoriesRes] = await Promise.all([
        fetch("/api/layanan", {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }),
        fetch("/api/layanan/categories", {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }),
      ])

      if (!servicesRes.ok) {
        const err = await servicesRes.json()
        throw new Error(err.error || "Gagal memuat layanan")
      }
      const servicesData = await servicesRes.json()
      setServices(servicesData.data || [])

      if (categoriesRes.ok) {
        const categoriesData = await categoriesRes.json()
        setCategories(categoriesData.data || [])
      } else {
        setCategories([])
      }

      setError(null)
    } catch (err: any) {
      setError(err.message || "Gagal memuat layanan")
    } finally {
      setLoading(false)
    }
  }

  const fetchRequirements = async (serviceId: string) => {
    if (!serviceId) return
    try {
      setReqLoading(true)
      setReqError(null)
      const response = await fetch(`/api/layanan/${serviceId}/requirements`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.error || "Gagal memuat persyaratan")
      }
      setRequirements(Array.isArray(data?.data) ? data.data : [])
    } catch (err: any) {
      setRequirements([])
      setReqError(err.message || "Gagal memuat persyaratan")
    } finally {
      setReqLoading(false)
    }
  }

  const normalizeOptions = (value: string): string[] | undefined => {
    const options = value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
    return options.length > 0 ? options : undefined
  }

  const handleCreateRequirement = async () => {
    if (!activeServiceId || !newRequirement.label.trim()) return
    try {
      setReqLoading(true)
      const payload: any = {
        label: newRequirement.label.trim(),
        field_type: newRequirement.field_type,
        is_required: Boolean(newRequirement.is_required),
        help_text: newRequirement.help_text?.trim() || undefined,
        order_index: Number(newRequirement.order_index) || 0,
      }

      if (newRequirement.field_type === "select" || newRequirement.field_type === "radio") {
        payload.options_json = normalizeOptions(newRequirement.options)
      }

      const response = await fetch(`/api/layanan/${activeServiceId}/requirements`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify(payload),
      })

      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.error || "Gagal menambah persyaratan")
      }

      toast({
        title: "Persyaratan ditambahkan",
        description: "Persyaratan layanan berhasil dibuat.",
      })
      setNewRequirement({
        label: "",
        field_type: "text",
        is_required: true,
        help_text: "",
        options: "",
        order_index: 0,
      })
      await fetchRequirements(activeServiceId)
    } catch (err: any) {
      toast({
        title: "Gagal",
        description: err.message || "Gagal menambah persyaratan",
        variant: "destructive",
      })
    } finally {
      setReqLoading(false)
    }
  }

  const handleStartEditRequirement = (r: ServiceRequirement) => {
    setEditingRequirementId(r.id)
    setEditingRequirement({
      label: r.label || "",
      field_type: r.field_type || "text",
      is_required: Boolean(r.is_required),
      help_text: r.help_text || "",
      options: Array.isArray(r.options_json)
        ? r.options_json.join(", ")
        : typeof r.options_json === "string"
          ? r.options_json
          : "",
      order_index: Number(r.order_index || 0),
    })
  }

  const handleUpdateRequirement = async () => {
    if (!editingRequirementId) return
    try {
      setReqLoading(true)
      const payload: any = {
        label: editingRequirement.label.trim() || undefined,
        field_type: editingRequirement.field_type,
        is_required: Boolean(editingRequirement.is_required),
        help_text: editingRequirement.help_text?.trim() || undefined,
        order_index: Number(editingRequirement.order_index) || 0,
      }
      if (editingRequirement.field_type === "select" || editingRequirement.field_type === "radio") {
        payload.options_json = normalizeOptions(editingRequirement.options)
      } else {
        payload.options_json = undefined
      }

      const response = await fetch(`/api/layanan/requirements/${editingRequirementId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Gagal update persyaratan")

      toast({
        title: "Tersimpan",
        description: "Perubahan persyaratan berhasil disimpan.",
      })
      setEditingRequirementId(null)
      await fetchRequirements(activeServiceId)
    } catch (err: any) {
      toast({
        title: "Gagal",
        description: err.message || "Gagal update persyaratan",
        variant: "destructive",
      })
    } finally {
      setReqLoading(false)
    }
  }

  const handleDeleteRequirement = async (id: string) => {
    if (!id) return
    try {
      setReqLoading(true)
      const response = await fetch(`/api/layanan/requirements/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Gagal hapus persyaratan")

      toast({
        title: "Dihapus",
        description: "Persyaratan berhasil dihapus.",
      })
      await fetchRequirements(activeServiceId)
    } catch (err: any) {
      toast({
        title: "Gagal",
        description: err.message || "Gagal hapus persyaratan",
        variant: "destructive",
      })
    } finally {
      setReqLoading(false)
    }
  }

  const fetchServices = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/layanan", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || "Gagal memuat layanan")
      }
      const data = await response.json()
      setServices(data.data || [])
      setError(null)
    } catch (err: any) {
      setError(err.message || "Gagal memuat layanan")
    } finally {
      setLoading(false)
    }
  }

  const handleCreateCategory = async () => {
    if (!newCategory.name.trim()) return
    try {
      setCreating(true)
      const response = await fetch("/api/layanan/categories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          name: newCategory.name,
          description: newCategory.description,
        }),
      })

      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.error || "Gagal membuat kategori")
      }

      toast({
        title: "Kategori dibuat",
        description: "Kategori layanan berhasil dibuat.",
      })
      setNewCategory({ name: "", description: "" })
      await fetchAll()
    } catch (err: any) {
      toast({
        title: "Gagal",
        description: err.message || "Gagal membuat kategori",
        variant: "destructive",
      })
    } finally {
      setCreating(false)
    }
  }

  const handleCreateService = async () => {
    if (!newService.category_id || !newService.name.trim() || !newService.description.trim()) return
    try {
      setCreating(true)
      const computedSlug = newService.slug.trim() || slugify(newService.name)
      const response = await fetch("/api/layanan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          category_id: newService.category_id,
          name: newService.name,
          description: newService.description,
          slug: computedSlug,
          mode: newService.mode,
          is_active: newService.is_active,
        }),
      })

      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.error || "Gagal membuat layanan")
      }

      toast({
        title: "Layanan dibuat",
        description: "Layanan berhasil ditambahkan ke katalog.",
      })
      setNewService({
        category_id: "",
        name: "",
        description: "",
        slug: "",
        mode: "both",
        is_active: true,
      })
      await fetchAll()
    } catch (err: any) {
      toast({
        title: "Gagal",
        description: err.message || "Gagal membuat layanan",
        variant: "destructive",
      })
    } finally {
      setCreating(false)
    }
  }

  const groupedServices = services.reduce((acc, service) => {
    const categoryName = service.category?.name || "Layanan Administrasi"
    if (!acc[categoryName]) acc[categoryName] = []
    acc[categoryName].push(service)
    return acc
  }, {} as Record<string, Service[]>)

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Gagal Memuat Layanan
          </CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={fetchServices} variant="outline">Coba Lagi</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Katalog Layanan</h1>
          <p className="text-muted-foreground mt-2">
            Daftar layanan yang tersedia untuk form publik dan WhatsApp.
          </p>
        </div>
        <Button onClick={fetchAll} variant="outline">Muat Ulang</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlusCircle className="h-5 w-5" />
              Tambah Kategori Layanan
            </CardTitle>
            <CardDescription>
              Buat kategori untuk mengelompokkan layanan (mis. Administrasi, Kependudukan).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Nama Kategori</Label>
              <Input
                value={newCategory.name}
                onChange={(e) => setNewCategory((p) => ({ ...p, name: e.target.value }))}
                placeholder="Contoh: Administrasi"
              />
            </div>
            <div className="space-y-2">
              <Label>Deskripsi (Opsional)</Label>
              <Textarea
                value={newCategory.description}
                onChange={(e) => setNewCategory((p) => ({ ...p, description: e.target.value }))}
                placeholder="Deskripsi singkat kategori"
              />
            </div>
            <Button onClick={handleCreateCategory} disabled={creating || !newCategory.name.trim()}>
              {creating ? "Menyimpan..." : "Simpan Kategori"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlusCircle className="h-5 w-5" />
              Tambah Layanan
            </CardTitle>
            <CardDescription>
              Tambahkan layanan baru yang akan muncul di form publik.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Kategori</Label>
                <Select
                  value={newService.category_id}
                  onValueChange={(value) => setNewService((p) => ({ ...p, category_id: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih kategori" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Mode</Label>
                <Select
                  value={newService.mode}
                  onValueChange={(value) => setNewService((p) => ({ ...p, mode: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="online">Online</SelectItem>
                    <SelectItem value="offline">Offline</SelectItem>
                    <SelectItem value="both">Online & Offline</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Nama Layanan</Label>
              <Input
                value={newService.name}
                onChange={(e) => {
                  const value = e.target.value
                  setNewService((p) => ({
                    ...p,
                    name: value,
                    slug: p.slug ? p.slug : slugify(value),
                  }))
                }}
                placeholder="Contoh: Surat Keterangan Domisili"
              />
            </div>

            <div className="space-y-2">
              <Label>Slug</Label>
              <Input
                value={newService.slug}
                onChange={(e) => setNewService((p) => ({ ...p, slug: e.target.value }))}
                placeholder="surat-keterangan-domisili"
              />
              <p className="text-xs text-muted-foreground">
                Slug dipakai untuk URL form publik. Unik per layanan.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Deskripsi</Label>
              <Textarea
                value={newService.description}
                onChange={(e) => setNewService((p) => ({ ...p, description: e.target.value }))}
                placeholder="Jelaskan persyaratan umum, estimasi waktu, dll."
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Aktifkan Layanan</p>
                <p className="text-xs text-muted-foreground">
                  Jika nonaktif, layanan tidak muncul di form publik.
                </p>
              </div>
              <Switch
                checked={newService.is_active}
                onCheckedChange={(checked) =>
                  setNewService((p) => ({ ...p, is_active: checked }))
                }
              />
            </div>

            <Button
              onClick={handleCreateService}
              disabled={
                creating ||
                !newService.category_id ||
                !newService.name.trim() ||
                !newService.description.trim()
              }
            >
              {creating ? "Menyimpan..." : "Simpan Layanan"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-gray-500" />
              <div>
                <p className="text-2xl font-bold">{services.length}</p>
                <p className="text-sm text-muted-foreground">Total Layanan</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">
                  {services.filter((s) => s.mode === "online" || s.mode === "both").length}
                </p>
                <p className="text-sm text-muted-foreground">Layanan Online</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-2xl font-bold">{services.filter((s) => s.is_active).length}</p>
                <p className="text-sm text-muted-foreground">Layanan Aktif</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Persyaratan Layanan (Builder)</CardTitle>
          <CardDescription>
            Atur field seperti Google Form: text/textarea/select/radio/date/number/file.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Pilih Layanan</Label>
              <Select
                value={activeServiceId}
                onValueChange={(value) => {
                  setActiveServiceId(value)
                  setEditingRequirementId(null)
                  fetchRequirements(value)
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pilih layanan" />
                </SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Link Form Publik</Label>
              <Input
                readOnly
                className="bg-muted"
                value={
                  activeServiceId && villageSlug
                    ? `${window.location.origin}/form/${villageSlug}/${services.find((s) => s.id === activeServiceId)?.slug || ""}`
                    : "Pilih layanan terlebih dulu"
                }
              />
              <p className="text-xs text-muted-foreground">
                Ini link yang akan diisi masyarakat.
              </p>
            </div>
          </div>

          {reqError && (
            <p className="text-sm text-destructive">{reqError}</p>
          )}

          {activeServiceId && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <p className="text-sm font-medium">Tambah Persyaratan</p>
                <div className="space-y-2">
                  <Label>Label</Label>
                  <Input
                    value={newRequirement.label}
                    onChange={(e) => setNewRequirement((p) => ({ ...p, label: e.target.value }))}
                    placeholder="Contoh: Foto KTP"
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Tipe Field</Label>
                    <Select
                      value={newRequirement.field_type}
                      onValueChange={(value) => setNewRequirement((p) => ({ ...p, field_type: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Pilih tipe" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">Text</SelectItem>
                        <SelectItem value="textarea">Textarea</SelectItem>
                        <SelectItem value="number">Number</SelectItem>
                        <SelectItem value="date">Date</SelectItem>
                        <SelectItem value="select">Select</SelectItem>
                        <SelectItem value="radio">Radio</SelectItem>
                        <SelectItem value="file">File Upload</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Urutan</Label>
                    <Input
                      type="number"
                      value={newRequirement.order_index}
                      onChange={(e) => setNewRequirement((p) => ({ ...p, order_index: Number(e.target.value) }))}
                    />
                  </div>
                </div>

                {(newRequirement.field_type === "select" || newRequirement.field_type === "radio") && (
                  <div className="space-y-2">
                    <Label>Options (pisahkan dengan koma)</Label>
                    <Input
                      value={newRequirement.options}
                      onChange={(e) => setNewRequirement((p) => ({ ...p, options: e.target.value }))}
                      placeholder="Contoh: Baru, Perpanjang, Hilang"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Help Text (opsional)</Label>
                  <Input
                    value={newRequirement.help_text}
                    onChange={(e) => setNewRequirement((p) => ({ ...p, help_text: e.target.value }))}
                    placeholder="Contoh: Upload foto jelas, max 5MB"
                  />
                </div>

                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">Wajib Diisi</p>
                    <p className="text-xs text-muted-foreground">Jika aktif, masyarakat wajib mengisi field ini.</p>
                  </div>
                  <Switch
                    checked={newRequirement.is_required}
                    onCheckedChange={(checked) => setNewRequirement((p) => ({ ...p, is_required: checked }))}
                  />
                </div>

                <Button onClick={handleCreateRequirement} disabled={reqLoading || !newRequirement.label.trim()}>
                  {reqLoading ? "Menyimpan..." : "Tambah Persyaratan"}
                </Button>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Daftar Persyaratan</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fetchRequirements(activeServiceId)}
                    disabled={reqLoading}
                  >
                    Muat Ulang
                  </Button>
                </div>

                {requirements.length === 0 && !reqLoading ? (
                  <p className="text-sm text-muted-foreground">Belum ada persyaratan.</p>
                ) : (
                  <div className="space-y-2">
                    {requirements.map((r) => (
                      <Card key={r.id} className="border-dashed">
                        <CardContent className="pt-4 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium">{r.label}</p>
                              <p className="text-xs text-muted-foreground">
                                {r.field_type} • {r.is_required ? "wajib" : "opsional"} • urutan {r.order_index ?? 0}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <Button type="button" size="sm" variant="outline" onClick={() => handleStartEditRequirement(r)}>
                                Edit
                              </Button>
                              <Button type="button" size="sm" variant="destructive" onClick={() => handleDeleteRequirement(r.id)}>
                                Hapus
                              </Button>
                            </div>
                          </div>

                          {editingRequirementId === r.id && (
                            <div className="grid gap-3 rounded-lg border p-3">
                              <div className="space-y-2">
                                <Label>Label</Label>
                                <Input
                                  value={editingRequirement.label}
                                  onChange={(e) => setEditingRequirement((p) => ({ ...p, label: e.target.value }))}
                                />
                              </div>
                              <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                  <Label>Tipe</Label>
                                  <Select
                                    value={editingRequirement.field_type}
                                    onValueChange={(value) => setEditingRequirement((p) => ({ ...p, field_type: value }))}
                                  >
                                    <SelectTrigger>
                                      <SelectValue placeholder="Pilih tipe" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="text">Text</SelectItem>
                                      <SelectItem value="textarea">Textarea</SelectItem>
                                      <SelectItem value="number">Number</SelectItem>
                                      <SelectItem value="date">Date</SelectItem>
                                      <SelectItem value="select">Select</SelectItem>
                                      <SelectItem value="radio">Radio</SelectItem>
                                      <SelectItem value="file">File Upload</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-2">
                                  <Label>Urutan</Label>
                                  <Input
                                    type="number"
                                    value={editingRequirement.order_index}
                                    onChange={(e) => setEditingRequirement((p) => ({ ...p, order_index: Number(e.target.value) }))}
                                  />
                                </div>
                              </div>

                              {(editingRequirement.field_type === "select" || editingRequirement.field_type === "radio") && (
                                <div className="space-y-2">
                                  <Label>Options (koma)</Label>
                                  <Input
                                    value={editingRequirement.options}
                                    onChange={(e) => setEditingRequirement((p) => ({ ...p, options: e.target.value }))}
                                  />
                                </div>
                              )}

                              <div className="space-y-2">
                                <Label>Help Text</Label>
                                <Input
                                  value={editingRequirement.help_text}
                                  onChange={(e) => setEditingRequirement((p) => ({ ...p, help_text: e.target.value }))}
                                />
                              </div>

                              <div className="flex items-center justify-between rounded-lg border p-3">
                                <div>
                                  <p className="text-sm font-medium">Wajib</p>
                                </div>
                                <Switch
                                  checked={editingRequirement.is_required}
                                  onCheckedChange={(checked) => setEditingRequirement((p) => ({ ...p, is_required: checked }))}
                                />
                              </div>

                              <div className="flex gap-2">
                                <Button type="button" onClick={handleUpdateRequirement} disabled={reqLoading}>
                                  Simpan
                                </Button>
                                <Button type="button" variant="outline" onClick={() => setEditingRequirementId(null)}>
                                  Batal
                                </Button>
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">Semua</TabsTrigger>
          {Object.keys(groupedServices).map((category) => (
            <TabsTrigger key={category} value={category}>{category}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {services.map((service) => (
              <ServiceCard key={service.id} service={service} />
            ))}
          </div>
        </TabsContent>

        {Object.entries(groupedServices).map(([category, categoryServices]) => (
          <TabsContent key={category} value={category} className="mt-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {categoryServices.map((service) => (
                <ServiceCard key={service.id} service={service} />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

function ServiceCard({ service }: { service: Service }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{service.name}</CardTitle>
        <CardDescription>{service.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <Badge variant={service.is_active ? "default" : "secondary"}>
            {service.is_active ? "Aktif" : "Nonaktif"}
          </Badge>
          <Badge variant="outline">{modeLabels[service.mode] || service.mode}</Badge>
        </div>
        <div className="text-xs text-muted-foreground">Slug: {service.slug}</div>
        {Array.isArray(service.requirements) && (
          <div className="text-xs text-muted-foreground">
            Persyaratan: {service.requirements.length}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
