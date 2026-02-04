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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { 
  AlertCircle, 
  Settings, 
  Clock, 
  PlusCircle, 
  FolderOpen,
  Layers,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  FileText,
  Link as LinkIcon,
  X,
  Copy,
  Check,
  ExternalLink,
  GripVertical
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

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

const fieldTypeLabels: Record<string, string> = {
  text: "Text",
  textarea: "Textarea",
  number: "Number",
  date: "Date",
  select: "Select",
  radio: "Radio",
  file: "File Upload",
}

export default function LayananPage() {
  const { toast } = useToast()
  const [services, setServices] = useState<Service[]>([])
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [villageSlug, setVillageSlug] = useState<string>("")
  const [searchService, setSearchService] = useState("")
  const [searchCategory, setSearchCategory] = useState("")

  // Modal states
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [serviceModalOpen, setServiceModalOpen] = useState(false)
  const [requirementModalOpen, setRequirementModalOpen] = useState(false)
  const [viewCategoriesModalOpen, setViewCategoriesModalOpen] = useState(false)
  
  // Edit states
  const [editingCategory, setEditingCategory] = useState<ServiceCategory | null>(null)
  const [editingService, setEditingService] = useState<Service | null>(null)
  
  // Active service for requirements
  const [activeService, setActiveService] = useState<Service | null>(null)
  const [requirements, setRequirements] = useState<ServiceRequirement[]>([])
  const [reqLoading, setReqLoading] = useState(false)
  const [editingRequirement, setEditingRequirement] = useState<ServiceRequirement | null>(null)
  const [draggingRequirementId, setDraggingRequirementId] = useState<string | null>(null)
  const [dragOverRequirementId, setDragOverRequirementId] = useState<string | null>(null)
  const [isReordering, setIsReordering] = useState(false)

  // Form states
  const [saving, setSaving] = useState(false)
  const [categoryForm, setCategoryForm] = useState({ name: "", description: "" })
  const [serviceForm, setServiceForm] = useState({
    category_id: "",
    name: "",
    description: "",
    slug: "",
    mode: "both",
    is_active: true,
  })
  const [requirementForm, setRequirementForm] = useState({
    label: "",
    field_type: "text",
    is_required: true,
    help_text: "",
    options: "",
    order_index: 1,
  })

  // Copy state
  const [copiedId, setCopiedId] = useState<string | null>(null)

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
      setError(err.message || "Gagal memuat data")
    } finally {
      setLoading(false)
    }
  }

  const fetchRequirements = async (serviceId: string): Promise<ServiceRequirement[]> => {
    try {
      setReqLoading(true)
      const response = await fetch(`/api/layanan/${serviceId}/requirements`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      if (!response.ok) throw new Error("Gagal memuat persyaratan")
      const data = await response.json()
      const list = data.data || []
      setRequirements(list)
      return list
    } catch (err: any) {
      toast({
        title: "Gagal",
        description: err.message,
        variant: "destructive",
      })
      return []
    } finally {
      setReqLoading(false)
    }
  }

  const getNextOrderIndex = (list: ServiceRequirement[]) => {
    const maxOrder = list.reduce((acc, item) => Math.max(acc, item.order_index ?? 0), 0)
    return Math.max(1, maxOrder + 1)
  }

  // Category handlers
  const openCategoryModal = (category?: ServiceCategory) => {
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
    
    try {
      setSaving(true)
      const url = editingCategory 
        ? `/api/layanan/categories/${editingCategory.id}`
        : "/api/layanan/categories"
      
      const response = await fetch(url, {
        method: editingCategory ? "PUT" : "POST",
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
        title: editingCategory ? "Kategori diperbarui" : "Kategori dibuat",
        description: editingCategory 
          ? "Kategori layanan berhasil diperbarui."
          : "Kategori layanan berhasil dibuat.",
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
    if (!confirm("Hapus kategori ini? Layanan dalam kategori ini akan kehilangan kategorinya.")) return
    
    try {
      const response = await fetch(`/api/layanan/categories/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Gagal menghapus kategori")
      }

      toast({
        title: "Kategori dihapus",
        description: "Kategori layanan berhasil dihapus.",
      })
      fetchAll()
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message,
        variant: "destructive",
      })
    }
  }

  // Service handlers
  const openServiceModal = (service?: Service) => {
    if (service) {
      setEditingService(service)
      setServiceForm({
        category_id: service.category ? categories.find(c => c.name === service.category?.name)?.id || "" : "",
        name: service.name,
        description: service.description,
        slug: service.slug,
        mode: service.mode,
        is_active: service.is_active,
      })
    } else {
      setEditingService(null)
      setServiceForm({
        category_id: "",
        name: "",
        description: "",
        slug: "",
        mode: "both",
        is_active: true,
      })
    }
    setServiceModalOpen(true)
  }

  const handleSaveService = async () => {
    if (!serviceForm.name.trim() || !serviceForm.description.trim()) return
    
    try {
      setSaving(true)
      const computedSlug = serviceForm.slug.trim() || slugify(serviceForm.name)
      const url = editingService 
        ? `/api/layanan/${editingService.id}`
        : "/api/layanan"
      
      const response = await fetch(url, {
        method: editingService ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          ...serviceForm,
          slug: computedSlug,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Gagal menyimpan layanan")
      }

      toast({
        title: editingService ? "Layanan diperbarui" : "Layanan dibuat",
        description: editingService 
          ? "Layanan berhasil diperbarui."
          : "Layanan berhasil ditambahkan ke katalog.",
      })
      setServiceModalOpen(false)
      fetchAll()
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal menyimpan layanan",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteService = async (id: string) => {
    if (!confirm("Hapus layanan ini? Semua persyaratan akan ikut terhapus.")) return
    
    try {
      const response = await fetch(`/api/layanan/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Gagal menghapus layanan")
      }

      toast({
        title: "Layanan dihapus",
        description: "Layanan berhasil dihapus.",
      })
      fetchAll()
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message,
        variant: "destructive",
      })
    }
  }

  // Requirement handlers
  const openRequirementModal = async (service: Service) => {
    setActiveService(service)
    setEditingRequirement(null)
    setRequirementModalOpen(true)
    const list = await fetchRequirements(service.id)
    setRequirementForm({
      label: "",
      field_type: "text",
      is_required: true,
      help_text: "",
      options: "",
      order_index: getNextOrderIndex(list),
    })
  }

  const handleSaveRequirement = async () => {
    if (!activeService || !requirementForm.label.trim()) return
    
    try {
      setSaving(true)

      const normalizedOrder = Math.max(1, Number(requirementForm.order_index) || 1)
      const duplicateOrder = requirements.some((req) =>
        (req.order_index ?? 0) === normalizedOrder && req.id !== editingRequirement?.id
      )

      if (duplicateOrder) {
        toast({
          title: "Urutan duplikat",
          description: "Urutan persyaratan sudah dipakai. Pilih angka lain.",
          variant: "destructive",
        })
        return
      }
      
      let options_json = null
      if ((requirementForm.field_type === "select" || requirementForm.field_type === "radio") && requirementForm.options.trim()) {
        options_json = requirementForm.options.split(",").map((o) => o.trim()).filter(Boolean)
      }

      const url = editingRequirement 
        ? `/api/layanan/requirements/${editingRequirement.id}`
        : `/api/layanan/${activeService.id}/requirements`
      
      const response = await fetch(url, {
        method: editingRequirement ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          label: requirementForm.label,
          field_type: requirementForm.field_type,
          is_required: requirementForm.is_required,
          help_text: requirementForm.help_text || null,
          options_json,
          order_index: normalizedOrder,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Gagal menyimpan persyaratan")
      }

      toast({
        title: editingRequirement ? "Persyaratan diperbarui" : "Persyaratan ditambahkan",
        description: editingRequirement 
          ? "Persyaratan berhasil diperbarui."
          : "Persyaratan berhasil ditambahkan.",
      })
      
      // Clear form but keep modal open (don't close modal)
      if (!editingRequirement) {
        const updated = await fetchRequirements(activeService.id)
        setRequirementForm({
          label: "",
          field_type: "text",
          is_required: true,
          help_text: "",
          options: "",
          order_index: getNextOrderIndex(updated),
        })
      } else {
        setEditingRequirement(null)
        const updated = await fetchRequirements(activeService.id)
        setRequirementForm({
          label: "",
          field_type: "text",
          is_required: true,
          help_text: "",
          options: "",
          order_index: getNextOrderIndex(updated),
        })
      }
      
      fetchAll() // Refresh service list to update requirement count
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal menyimpan persyaratan",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const handleEditRequirement = (req: ServiceRequirement) => {
    setEditingRequirement(req)
    setRequirementForm({
      label: req.label,
      field_type: req.field_type,
      is_required: req.is_required,
      help_text: req.help_text || "",
      options: Array.isArray(req.options_json) ? req.options_json.join(", ") : "",
      order_index: req.order_index && req.order_index > 0
        ? req.order_index
        : getNextOrderIndex(requirements),
    })
  }

  const handleDeleteRequirement = async (id: string) => {
    if (!activeService) return
    if (!confirm("Hapus persyaratan ini?")) return
    
    try {
      const response = await fetch(`/api/layanan/requirements/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Gagal menghapus persyaratan")
      }

      toast({
        title: "Persyaratan dihapus",
        description: "Persyaratan berhasil dihapus.",
      })
      await fetchRequirements(activeService.id)
      fetchAll()
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message,
        variant: "destructive",
      })
    }
  }

  const handleReorderRequirements = async (dragId: string, dropId: string) => {
    if (!activeService || dragId === dropId || isReordering) return

    const ordered = [...requirements].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    const fromIndex = ordered.findIndex((req) => req.id === dragId)
    const toIndex = ordered.findIndex((req) => req.id === dropId)

    if (fromIndex < 0 || toIndex < 0) return

    const next = [...ordered]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)

    const normalized = next.map((req, idx) => ({ ...req, order_index: idx + 1 }))
    setRequirements(normalized)
    setIsReordering(true)

    try {
      await Promise.all(
        normalized.map((req) =>
          fetch(`/api/layanan/requirements/${req.id}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
            body: JSON.stringify({ order_index: req.order_index }),
          })
        )
      )

      toast({
        title: "Urutan diperbarui",
        description: "Urutan persyaratan berhasil disimpan.",
      })
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal memperbarui urutan persyaratan",
        variant: "destructive",
      })
      await fetchRequirements(activeService.id)
    } finally {
      setIsReordering(false)
      setDraggingRequirementId(null)
      setDragOverRequirementId(null)
    }
  }

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
      toast({
        title: "Link disalin",
        description: "Link form publik berhasil disalin.",
      })
    } catch {
      toast({
        title: "Gagal",
        description: "Gagal menyalin link",
        variant: "destructive",
      })
    }
  }

  const getPublicLink = (service: Service) => {
    if (!villageSlug) return ""
    return `${typeof window !== 'undefined' ? window.location.origin : ''}/form/${villageSlug}/${service.slug}`
  }

  // Filter data
  const filteredServices = services.filter(s => 
    s.name.toLowerCase().includes(searchService.toLowerCase()) ||
    s.description.toLowerCase().includes(searchService.toLowerCase())
  )

  const filteredCategories = categories.filter(c => 
    c.name.toLowerCase().includes(searchCategory.toLowerCase())
  )

  const orderedRequirements = [...requirements].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))

  // Group services by category
  const groupedServices = filteredServices.reduce((acc, service) => {
    const categoryName = service.category?.name || "Tanpa Kategori"
    if (!acc[categoryName]) acc[categoryName] = []
    acc[categoryName].push(service)
    return acc
  }, {} as Record<string, Service[]>)

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
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
          <Button onClick={fetchAll} variant="outline">Coba Lagi</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Katalog Layanan</h1>
          <p className="text-muted-foreground mt-1">
            Kelola layanan dan persyaratan untuk form publik
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setViewCategoriesModalOpen(true)} variant="outline" className="gap-2">
            <Layers className="h-4 w-4" />
            Lihat Kategori
          </Button>
          <Button onClick={() => openCategoryModal()} variant="outline" className="gap-2">
            <FolderOpen className="h-4 w-4" />
            Tambah Kategori
          </Button>
          <Button onClick={() => openServiceModal()} className="gap-2">
            <PlusCircle className="h-4 w-4" />
            Tambah Layanan
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
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
              <Clock className="h-5 w-5 text-gray-500" />
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
              <FolderOpen className="h-5 w-5 text-gray-500" />
              <div>
                <p className="text-2xl font-bold">{categories.length}</p>
                <p className="text-sm text-muted-foreground">Total Kategori</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Cari layanan..."
          value={searchService}
          onChange={(e) => setSearchService(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Services Grid */}
      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">Semua ({filteredServices.length})</TabsTrigger>
          {Object.entries(groupedServices).map(([category, services]) => (
            <TabsTrigger key={category} value={category}>
              {category} ({services.length})
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="all" className="mt-4">
          {filteredServices.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <div className="p-4 rounded-full bg-muted mb-4">
                  <Settings className="h-8 w-8 text-muted-foreground" />
                </div>
                <p className="text-muted-foreground font-medium">Belum ada layanan</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Klik tombol &quot;Tambah Layanan&quot; untuk memulai
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredServices.map((service) => (
                <ServiceCard 
                  key={service.id} 
                  service={service}
                  publicLink={getPublicLink(service)}
                  copiedId={copiedId}
                  onCopy={copyToClipboard}
                  onEdit={() => openServiceModal(service)}
                  onDelete={() => handleDeleteService(service.id)}
                  onManageRequirements={() => openRequirementModal(service)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {Object.entries(groupedServices).map(([category, categoryServices]) => (
          <TabsContent key={category} value={category} className="mt-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {categoryServices.map((service) => (
                <ServiceCard 
                  key={service.id} 
                  service={service}
                  publicLink={getPublicLink(service)}
                  copiedId={copiedId}
                  onCopy={copyToClipboard}
                  onEdit={() => openServiceModal(service)}
                  onDelete={() => handleDeleteService(service.id)}
                  onManageRequirements={() => openRequirementModal(service)}
                />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>

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
                ? "Perbarui informasi kategori layanan"
                : "Buat kategori baru untuk mengelompokkan layanan"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nama Kategori <span className="text-destructive">*</span></Label>
              <Input
                value={categoryForm.name}
                onChange={(e) => setCategoryForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Contoh: Administrasi, Kependudukan"
              />
            </div>
            <div className="space-y-2">
              <Label>Deskripsi</Label>
              <Textarea
                value={categoryForm.description}
                onChange={(e) => setCategoryForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Deskripsi singkat kategori"
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

      {/* View Categories Modal */}
      <Dialog open={viewCategoriesModalOpen} onOpenChange={setViewCategoriesModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Daftar Kategori Layanan
            </DialogTitle>
            <DialogDescription>
              Kelola kategori untuk mengelompokkan layanan
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cari kategori..."
                value={searchCategory}
                onChange={(e) => setSearchCategory(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              {filteredCategories.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <div className="p-4 rounded-full bg-muted mb-4">
                    <FolderOpen className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <p className="text-muted-foreground font-medium">Belum ada kategori</p>
                </div>
              ) : (
                <div className="divide-y border rounded-lg">
                  {filteredCategories.map((category) => {
                    const serviceCount = services.filter(s => s.category?.name === category.name).length
                    return (
                      <div 
                        key={category.id} 
                        className="p-3 hover:bg-muted/50 transition-colors group"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="font-semibold truncate">{category.name}</h4>
                              <Badge variant="secondary" className="text-xs">
                                {serviceCount} layanan
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
                              <DropdownMenuItem onClick={() => {
                                setViewCategoriesModalOpen(false)
                                openCategoryModal(category)
                              }}>
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
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewCategoriesModalOpen(false)}>
              <X className="h-4 w-4 mr-2" />
              Tutup
            </Button>
            <Button onClick={() => {
              setViewCategoriesModalOpen(false)
              openCategoryModal()
            }}>
              <PlusCircle className="h-4 w-4 mr-2" />
              Tambah Kategori
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Service Modal */}
      <Dialog open={serviceModalOpen} onOpenChange={setServiceModalOpen}>
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              {editingService ? "Edit Layanan" : "Tambah Layanan"}
            </DialogTitle>
            <DialogDescription>
              {editingService 
                ? "Perbarui informasi layanan"
                : "Buat layanan baru untuk form publik"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Kategori</Label>
                <Select
                  value={serviceForm.category_id}
                  onValueChange={(value) => setServiceForm(prev => ({ ...prev, category_id: value }))}
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
                  value={serviceForm.mode}
                  onValueChange={(value) => setServiceForm(prev => ({ ...prev, mode: value }))}
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
              <Label>Nama Layanan <span className="text-destructive">*</span></Label>
              <Input
                value={serviceForm.name}
                onChange={(e) => {
                  const value = e.target.value
                  setServiceForm(prev => ({
                    ...prev,
                    name: value,
                    slug: prev.slug ? prev.slug : slugify(value),
                  }))
                }}
                placeholder="Contoh: Surat Keterangan Domisili"
              />
            </div>

            <div className="space-y-2">
              <Label>Slug</Label>
              <Input
                value={serviceForm.slug}
                onChange={(e) => setServiceForm(prev => ({ ...prev, slug: e.target.value }))}
                placeholder="surat-keterangan-domisili"
              />
              <p className="text-xs text-muted-foreground">
                Slug dipakai untuk URL form publik
              </p>
            </div>

            <div className="space-y-2">
              <Label>Deskripsi <span className="text-destructive">*</span></Label>
              <Textarea
                value={serviceForm.description}
                onChange={(e) => setServiceForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Jelaskan persyaratan umum, estimasi waktu, dll."
                rows={3}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label className="cursor-pointer">Aktifkan Layanan</Label>
                <p className="text-xs text-muted-foreground">
                  Jika nonaktif, layanan tidak muncul di form publik
                </p>
              </div>
              <Switch
                checked={serviceForm.is_active}
                onCheckedChange={(checked) => setServiceForm(prev => ({ ...prev, is_active: checked }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setServiceModalOpen(false)}>
              <X className="h-4 w-4 mr-2" />
              Tutup
            </Button>
            <Button 
              onClick={handleSaveService} 
              disabled={saving || !serviceForm.name.trim() || !serviceForm.description.trim()}
            >
              {saving ? "Menyimpan..." : editingService ? "Simpan Perubahan" : "Tambah Layanan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Requirements Modal */}
      <Dialog open={requirementModalOpen} onOpenChange={setRequirementModalOpen}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Persyaratan Layanan
            </DialogTitle>
            <DialogDescription>
              {activeService && (
                <>Kelola persyaratan untuk layanan: <strong>{activeService.name}</strong></>
              )}
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-6 py-4 lg:grid-cols-2">
            {/* Form Section */}
            <div className="space-y-4">
              <h4 className="font-semibold text-sm">
                {editingRequirement ? "Edit Persyaratan" : "Tambah Persyaratan Baru"}
              </h4>
              
              <div className="space-y-2">
                <Label>Label <span className="text-destructive">*</span></Label>
                <Input
                  value={requirementForm.label}
                  onChange={(e) => setRequirementForm(prev => ({ ...prev, label: e.target.value }))}
                  placeholder="Contoh: Foto KTP"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Tipe Field</Label>
                  <Select
                    value={requirementForm.field_type}
                    onValueChange={(value) => setRequirementForm(prev => ({ ...prev, field_type: value }))}
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
                    min={1}
                    value={requirementForm.order_index}
                    onChange={(e) => setRequirementForm(prev => ({ ...prev, order_index: Number(e.target.value) }))}
                  />
                </div>
              </div>

              {(requirementForm.field_type === "select" || requirementForm.field_type === "radio") && (
                <div className="space-y-2">
                  <Label>Pilihan (pisahkan dengan koma)</Label>
                  <Input
                    value={requirementForm.options}
                    onChange={(e) => setRequirementForm(prev => ({ ...prev, options: e.target.value }))}
                    placeholder="Contoh: Baru, Perpanjang, Hilang"
                  />
                </div>
              )}

              {requirementForm.field_type === "file" && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3">
                  <p className="text-sm text-amber-800 dark:text-amber-200 font-medium">
                    ⚠️ Catatan: File upload hanya mendukung 1 file per persyaratan
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    Jika membutuhkan lebih dari 1 file, buat persyaratan terpisah. Contoh: &quot;Foto KTP Depan&quot; dan &quot;Foto KTP Belakang&quot;.
                    <br />
                    Format yang didukung: PDF, JPG, PNG, DOC, DOCX (maks 5MB)
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label>Help Text (opsional)</Label>
                <Input
                  value={requirementForm.help_text}
                  onChange={(e) => setRequirementForm(prev => ({ ...prev, help_text: e.target.value }))}
                  placeholder="Contoh: Upload foto jelas, max 5MB"
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label className="cursor-pointer">Wajib Diisi</Label>
                  <p className="text-xs text-muted-foreground">
                    Jika aktif, field ini wajib diisi
                  </p>
                </div>
                <Switch
                  checked={requirementForm.is_required}
                  onCheckedChange={(checked) => setRequirementForm(prev => ({ ...prev, is_required: checked }))}
                />
              </div>

              <div className="flex gap-2">
                <Button 
                  onClick={handleSaveRequirement} 
                  disabled={saving || !requirementForm.label.trim()}
                  className="flex-1"
                >
                  {saving ? "Menyimpan..." : editingRequirement ? "Simpan Perubahan" : "Tambah Persyaratan"}
                </Button>
                {editingRequirement && (
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      setEditingRequirement(null)
                      setRequirementForm({
                        label: "",
                        field_type: "text",
                        is_required: true,
                        help_text: "",
                        options: "",
                        order_index: getNextOrderIndex(requirements),
                      })
                    }}
                  >
                    Batal Edit
                  </Button>
                )}
              </div>
            </div>

            {/* List Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm">Daftar Persyaratan</h4>
                <Badge variant="secondary">{requirements.length} item</Badge>
              </div>
              
              {reqLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                </div>
              ) : requirements.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center border rounded-lg">
                  <FileText className="h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">Belum ada persyaratan</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {orderedRequirements.map((req, index) => {
                    const displayOrder = req.order_index && req.order_index > 0 ? req.order_index : index + 1

                    return (
                    <div 
                      key={req.id} 
                      draggable={!isReordering}
                      onDragStart={() => setDraggingRequirementId(req.id)}
                      onDragOver={(e) => {
                        e.preventDefault()
                        setDragOverRequirementId(req.id)
                      }}
                      onDragLeave={() => setDragOverRequirementId(null)}
                      onDrop={(e) => {
                        e.preventDefault()
                        if (draggingRequirementId) {
                          handleReorderRequirements(draggingRequirementId, req.id)
                        }
                      }}
                      onDragEnd={() => {
                        setDraggingRequirementId(null)
                        setDragOverRequirementId(null)
                      }}
                      className={`p-3 border rounded-lg transition-colors ${
                        editingRequirement?.id === req.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                      } ${
                        draggingRequirementId === req.id ? 'opacity-70' : ''
                      } ${
                        dragOverRequirementId === req.id ? 'border-primary/60 bg-primary/10' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 flex-1 min-w-0">
                          <div className="mt-0.5 text-muted-foreground cursor-grab">
                            <GripVertical className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm">{req.label}</span>
                              <Badge variant="outline" className="text-xs">
                                {fieldTypeLabels[req.field_type] || req.field_type}
                              </Badge>
                              {req.is_required && (
                                <Badge variant="secondary" className="text-xs">Wajib</Badge>
                              )}
                              <Badge variant="outline" className="text-xs">Urutan {displayOrder}</Badge>
                            </div>
                            {req.help_text && (
                              <p className="text-xs text-muted-foreground mt-1">{req.help_text}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8"
                            onClick={() => handleEditRequirement(req)}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteRequirement(req.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )})}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRequirementModalOpen(false)}>
              <X className="h-4 w-4 mr-2" />
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface ServiceCardProps {
  service: Service
  publicLink: string
  copiedId: string | null
  onCopy: (text: string, id: string) => void
  onEdit: () => void
  onDelete: () => void
  onManageRequirements: () => void
}

function ServiceCard({ service, publicLink, copiedId, onCopy, onEdit, onDelete, onManageRequirements }: ServiceCardProps) {
  return (
    <Card className="group">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg truncate">{service.name}</CardTitle>
            <CardDescription className="line-clamp-2 mt-1">{service.description}</CardDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit Layanan
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onManageRequirements}>
                <FileText className="h-4 w-4 mr-2" />
                Kelola Persyaratan
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={onDelete}
                className="text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Hapus
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <Badge variant={service.is_active ? "default" : "secondary"}>
            {service.is_active ? "Aktif" : "Nonaktif"}
          </Badge>
          <Badge variant="outline">{modeLabels[service.mode] || service.mode}</Badge>
        </div>
        
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileText className="h-3 w-3" />
          <span>{service.requirements?.length || 0} persyaratan</span>
        </div>

        {publicLink && (
          <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
            <LinkIcon className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-xs truncate flex-1 font-mono">{publicLink}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={() => window.open(publicLink, "_blank")}
              title="Preview"
            >
              <ExternalLink className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={() => onCopy(publicLink, service.id)}
            >
              {copiedId === service.id ? (
                <Check className="h-3 w-3 text-green-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          </div>
        )}

        <Button 
          variant="outline" 
          size="sm" 
          className="w-full gap-2"
          onClick={onManageRequirements}
        >
          <FileText className="h-4 w-4" />
          Kelola Persyaratan
        </Button>
      </CardContent>
    </Card>
  )
}
