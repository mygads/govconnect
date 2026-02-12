"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { 
  Plus, 
  Search, 
  Edit, 
  Trash2, 
  BookOpen,
  Save,
  Upload,
  RefreshCw,
  Eye,
  Sparkles,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  File,
  FileText,
  FileSpreadsheet,
  Brain,
  Database,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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

// ==================== INTERFACES ====================

interface Knowledge {
  id: string
  title: string
  content: string
  category: string
  category_id?: string | null
  keywords: string[]
  is_active: boolean
  priority: number
  embedding_model?: string | null
  last_embedded_at?: string | null
  created_at: string
  updated_at: string
}

interface KnowledgeCategory {
  id: string
  name: string
  is_default?: boolean
}

interface KnowledgeDocument {
  id: string
  filename: string
  original_name: string
  mime_type: string
  file_size: number
  file_url: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  error_message: string | null
  title: string | null
  description: string | null
  category: string | null
  category_id?: string | null
  total_chunks: number | null
  created_at: string
  updated_at: string
}

// ==================== CONSTANTS ====================

const STATUS_CONFIG = {
  pending: { label: 'Menunggu', icon: Clock, color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  processing: { label: 'Diproses', icon: Loader2, color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  completed: { label: 'Selesai', icon: CheckCircle, color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  failed: { label: 'Gagal', icon: XCircle, color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
}

// ==================== MAIN COMPONENT ====================

export default function KnowledgePage() {
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState('knowledge-base')

  const [categories, setCategories] = useState<KnowledgeCategory[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  
  // ==================== KNOWLEDGE BASE STATE ====================
  const [knowledge, setKnowledge] = useState<Knowledge[]>([])
  const [knowledgeLoading, setKnowledgeLoading] = useState(true)
  const [knowledgeSearch, setKnowledgeSearch] = useState('')
  const [knowledgeCategory, setKnowledgeCategory] = useState<string>('all')
  
  // Knowledge dialogs
  const [isAddKnowledgeOpen, setIsAddKnowledgeOpen] = useState(false)
  const [isEditKnowledgeOpen, setIsEditKnowledgeOpen] = useState(false)
  const [isDeleteKnowledgeOpen, setIsDeleteKnowledgeOpen] = useState(false)
  const [selectedKnowledge, setSelectedKnowledge] = useState<Knowledge | null>(null)
  
  // Knowledge form
  const [knowledgeForm, setKnowledgeForm] = useState({
    title: '',
    content: '',
    category_id: '',
    keywords: '',
    is_active: true,
    priority: 0,
  })
  const [knowledgeFormLoading, setKnowledgeFormLoading] = useState(false)
  
  // ==================== DOCUMENTS STATE ====================
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(true)
  const [documentsSearch, setDocumentsSearch] = useState('')
  const [documentsStatus, setDocumentsStatus] = useState<string>('all')
  const [documentsCategory, setDocumentsCategory] = useState<string>('all')
  
  // Documents dialogs
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [isEditDocOpen, setIsEditDocOpen] = useState(false)
  const [isDeleteDocOpen, setIsDeleteDocOpen] = useState(false)
  const [selectedDocument, setSelectedDocument] = useState<KnowledgeDocument | null>(null)
  
  // Upload form
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadDescription, setUploadDescription] = useState('')
  const [uploadCategory, setUploadCategory] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  
  // Edit doc form
  const [editDocTitle, setEditDocTitle] = useState('')
  const [editDocDescription, setEditDocDescription] = useState('')
  const [editDocCategory, setEditDocCategory] = useState('')
  const [editDocLoading, setEditDocLoading] = useState(false)
  
  // ==================== EMBEDDING STATE ====================
  const [embeddingLoading, setEmbeddingLoading] = useState(false)

  // ==================== CATEGORY MANAGEMENT STATE ====================
  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [addCategoryLoading, setAddCategoryLoading] = useState(false)

  // ==================== FETCH FUNCTIONS ====================
  const fetchCategories = async () => {
    setCategoriesLoading(true)
    try {
      const response = await fetch('/api/knowledge/categories', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      })

      if (response.ok) {
        const data = await response.json()
        const list = Array.isArray(data.data) ? data.data : []
        setCategories(list)

        if (!knowledgeForm.category_id && list.length > 0) {
          setKnowledgeForm(prev => ({ ...prev, category_id: list[0].id }))
        }
      }
    } catch (error) {
      toast({ title: "Error", description: "Gagal mengambil kategori", variant: "destructive" })
    } finally {
      setCategoriesLoading(false)
    }
  }
  
  const fetchKnowledge = async () => {
    setKnowledgeLoading(true)
    try {
      const params = new URLSearchParams()
      if (knowledgeSearch) params.set('search', knowledgeSearch)
      if (knowledgeCategory && knowledgeCategory !== 'all') params.set('category_id', knowledgeCategory)
      params.set('limit', '100')

      const response = await fetch(`/api/knowledge?${params}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      })

      if (response.ok) {
        const data = await response.json()
        setKnowledge(data.data)
      }
    } catch (error) {
      toast({ title: "Error", description: "Gagal mengambil basis pengetahuan", variant: "destructive" })
    } finally {
      setKnowledgeLoading(false)
    }
  }

  const fetchDocuments = async () => {
    setDocumentsLoading(true)
    try {
      const params = new URLSearchParams()
      if (documentsStatus && documentsStatus !== 'all') params.set('status', documentsStatus)
      if (documentsCategory && documentsCategory !== 'all') params.set('category_id', documentsCategory)
      params.set('limit', '100')

      const response = await fetch(`/api/documents?${params}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      })

      if (response.ok) {
        const data = await response.json()
        setDocuments(data.data)
      }
    } catch (error) {
      toast({ title: "Error", description: "Gagal mengambil dokumen", variant: "destructive" })
    } finally {
      setDocumentsLoading(false)
    }
  }

  // ==================== CATEGORY MANAGEMENT ====================
  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) {
      toast({ title: "Error", description: "Nama kategori tidak boleh kosong", variant: "destructive" })
      return
    }

    // Check for duplicates
    const duplicate = categories.find(c => c.name.toLowerCase() === newCategoryName.trim().toLowerCase())
    if (duplicate) {
      toast({ title: "Error", description: "Kategori dengan nama ini sudah ada", variant: "destructive" })
      return
    }

    setAddCategoryLoading(true)
    try {
      const response = await fetch('/api/knowledge/categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ name: newCategoryName.trim() }),
      })

      if (response.ok) {
        toast({ title: "Berhasil", description: `Kategori "${newCategoryName.trim()}" berhasil ditambahkan` })
        setNewCategoryName('')
        setIsAddCategoryOpen(false)
        await fetchCategories()
      } else {
        const err = await response.json().catch(() => ({}))
        toast({ title: "Error", description: err.error || "Gagal menambahkan kategori", variant: "destructive" })
      }
    } catch (error) {
      toast({ title: "Error", description: "Gagal menambahkan kategori", variant: "destructive" })
    } finally {
      setAddCategoryLoading(false)
    }
  }

  useEffect(() => {
    fetchCategories()
    fetchKnowledge()
    fetchDocuments()
  }, [])

  useEffect(() => {
    if (activeTab === 'knowledge-base') fetchKnowledge()
  }, [knowledgeCategory])

  useEffect(() => {
    if (activeTab === 'documents') fetchDocuments()
  }, [documentsStatus, documentsCategory])

  // Auto-refresh for processing documents
  useEffect(() => {
    const hasProcessing = documents.some(d => d.status === 'processing')
    if (hasProcessing) {
      const interval = setInterval(fetchDocuments, 5000)
      return () => clearInterval(interval)
    }
  }, [documents])

  // ==================== EMBEDDING HANDLERS ====================
  
  const handleGenerateAllEmbeddings = async () => {
    setEmbeddingLoading(true)
    try {
      // Generate for knowledge base
      const kbResponse = await fetch('/api/knowledge/embed-all', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      })
      
      const kbResult = kbResponse.ok ? await kbResponse.json() : null

      toast({
        title: "Embedding Berhasil Dibuat",
        description: kbResult 
          ? `Basis Pengetahuan: ${kbResult.processed}/${kbResult.total} diproses` 
          : "Periksa console untuk detail",
      })
      
      // Refresh data
      fetchKnowledge()
      fetchDocuments()
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Gagal membuat embedding", variant: "destructive" })
    } finally {
      setEmbeddingLoading(false)
    }
  }

  // ==================== KNOWLEDGE BASE HANDLERS ====================
  
  const handleKnowledgeSearch = (e: React.FormEvent) => {
    e.preventDefault()
    fetchKnowledge()
  }

  const handleAddKnowledge = async (e: React.FormEvent) => {
    e.preventDefault()
    setKnowledgeFormLoading(true)

    try {
      if (!knowledgeForm.category_id) {
        toast({ title: "Error", description: "Category wajib dipilih", variant: "destructive" })
        return
      }

      const keywords = knowledgeForm.keywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 0)

      const response = await fetch('/api/knowledge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ ...knowledgeForm, keywords }),
      })

      if (!response.ok) throw new Error((await response.json()).error || 'Gagal membuat data')

      toast({ title: "Berhasil", description: "Entri pengetahuan berhasil dibuat" })
      setIsAddKnowledgeOpen(false)
      resetKnowledgeForm()
      fetchKnowledge()
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
    } finally {
      setKnowledgeFormLoading(false)
    }
  }

  const handleEditKnowledge = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedKnowledge) return
    setKnowledgeFormLoading(true)

    try {
      if (!knowledgeForm.category_id) {
        toast({ title: "Error", description: "Category wajib dipilih", variant: "destructive" })
        return
      }

      const keywords = knowledgeForm.keywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 0)

      const response = await fetch(`/api/knowledge/${selectedKnowledge.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ ...knowledgeForm, keywords }),
      })

      if (!response.ok) throw new Error((await response.json()).error || 'Gagal memperbarui data')

      toast({ title: "Berhasil", description: "Entri pengetahuan berhasil diperbarui" })
      setIsEditKnowledgeOpen(false)
      resetKnowledgeForm()
      fetchKnowledge()
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
    } finally {
      setKnowledgeFormLoading(false)
    }
  }

  const handleDeleteKnowledge = async () => {
    if (!selectedKnowledge) return
    setKnowledgeFormLoading(true)

    try {
      const response = await fetch(`/api/knowledge/${selectedKnowledge.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      })

      if (!response.ok) throw new Error((await response.json()).error || 'Gagal menghapus data')

      toast({ title: "Berhasil", description: "Entri pengetahuan berhasil dihapus" })
      setIsDeleteKnowledgeOpen(false)
      setSelectedKnowledge(null)
      fetchKnowledge()
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
    } finally {
      setKnowledgeFormLoading(false)
    }
  }

  const openEditKnowledge = (item: Knowledge) => {
    const resolvedCategoryId = item.category_id
      || categories.find(c => c.name === item.category)?.id
      || ''

    setSelectedKnowledge(item)
    setKnowledgeForm({
      title: item.title,
      content: item.content,
      category_id: resolvedCategoryId,
      keywords: item.keywords.join(', '),
      is_active: item.is_active,
      priority: item.priority,
    })
    setIsEditKnowledgeOpen(true)
  }

  const resetKnowledgeForm = () => {
    setKnowledgeForm({ title: '', content: '', category_id: '', keywords: '', is_active: true, priority: 0 })
    setSelectedKnowledge(null)
  }

  // ==================== DOCUMENTS HANDLERS ====================

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setUploadFile(file)
      if (!uploadTitle) setUploadTitle(file.name.replace(/\.[^/.]+$/, ''))
    }
  }

  const handleUpload = async () => {
    if (!uploadFile) {
      toast({ title: "Error", description: "Silakan pilih file", variant: "destructive" })
      return
    }

    setUploading(true)
    setUploadProgress(10)

    try {
      const formData = new FormData()
      formData.append('file', uploadFile)
      if (uploadTitle) formData.append('title', uploadTitle)
      if (uploadDescription) formData.append('description', uploadDescription)
      if (uploadCategory) formData.append('category_id', uploadCategory)

      setUploadProgress(30)

      const response = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: formData,
      })

      setUploadProgress(70)

      if (!response.ok) throw new Error((await response.json()).error || 'Gagal mengunggah')

      const result = await response.json()
      setUploadProgress(100)

      toast({ title: "Berhasil", description: "Dokumen berhasil diunggah dan mulai diproses" })
      setIsUploadOpen(false)
      resetUploadForm()
      fetchDocuments()
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  const triggerProcessing = async (documentId: string) => {
    try {
      toast({ title: "Diproses", description: "Memulai pemrosesan dokumen..." })
      
      const response = await fetch(`/api/documents/${documentId}/process`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      })
      
      const result = await response.json()
      
      if (!response.ok) {
        toast({ 
          title: "Pemrosesan Gagal", 
          description: result.error || result.details || 'Kesalahan tidak diketahui',
          variant: "destructive" 
        })
      } else {
        toast({ 
          title: "Berhasil", 
          description: `Dokumen diproses: ${result.chunksCount || 0} chunk dibuat` 
        })
      }
      
      fetchDocuments()
    } catch (error: any) {
      console.error('Processing failed:', error)
      toast({ 
        title: "Error", 
        description: error.message || 'Pemrosesan gagal',
        variant: "destructive" 
      })
    }
  }

  const handleEditDoc = async () => {
    if (!selectedDocument) return
    setEditDocLoading(true)

    try {
      const response = await fetch(`/api/documents/${selectedDocument.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          title: editDocTitle,
          description: editDocDescription,
          category_id: editDocCategory || null,
        }),
      })

      if (!response.ok) throw new Error((await response.json()).error || 'Gagal memperbarui data')

      toast({ title: "Berhasil", description: "Dokumen berhasil diperbarui" })
      setIsEditDocOpen(false)
      fetchDocuments()
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
    } finally {
      setEditDocLoading(false)
    }
  }

  const handleDeleteDoc = async () => {
    if (!selectedDocument) return

    try {
      const response = await fetch(`/api/documents/${selectedDocument.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      })

      if (!response.ok) throw new Error((await response.json()).error || 'Gagal menghapus data')

      toast({ title: "Berhasil", description: "Dokumen berhasil dihapus" })
      setIsDeleteDocOpen(false)
      setSelectedDocument(null)
      fetchDocuments()
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
    }
  }

  const openEditDoc = (doc: KnowledgeDocument) => {
    setSelectedDocument(doc)
    setEditDocTitle(doc.title || '')
    setEditDocDescription(doc.description || '')
    setEditDocCategory(
      doc.category_id || categories.find(c => c.name === doc.category)?.id || ''
    )
    setIsEditDocOpen(true)
  }

  const resetUploadForm = () => {
    setUploadFile(null)
    setUploadTitle('')
    setUploadDescription('')
    setUploadCategory('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ==================== HELPERS ====================
  
  const getCategoryLabel = (categoryId?: string | null, fallback?: string | null) => {
    if (categoryId) {
      const found = categories.find(c => c.id === categoryId)
      if (found) return found.name
    }
    if (fallback) return fallback
    return '-'
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const getFileIcon = (mimeType: string) => {
    if (mimeType === 'application/pdf') return <File className="h-4 w-4 text-red-500" />
    if (mimeType.includes('word')) return <FileText className="h-4 w-4 text-blue-500" />
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return <FileText className="h-4 w-4 text-orange-500" />
    if (mimeType === 'text/csv') return <FileSpreadsheet className="h-4 w-4 text-green-500" />
    return <FileText className="h-4 w-4 text-gray-500" />
  }

  // Filter documents by search
  const filteredDocuments = documents.filter(doc => {
    if (!documentsSearch) return true
    const search = documentsSearch.toLowerCase()
    return (
      doc.title?.toLowerCase().includes(search) ||
      doc.original_name.toLowerCase().includes(search) ||
      doc.description?.toLowerCase().includes(search)
    )
  })

  // Stats
  const knowledgeWithEmbedding = knowledge.filter(k => k.last_embedded_at).length
  const totalChunks = documents.reduce((sum, d) => sum + (d.total_chunks || 0), 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <Brain className="h-8 w-8" />
            Basis Pengetahuan & RAG
          </h1>
          <p className="text-muted-foreground mt-2">
            Kelola entri basis pengetahuan dan dokumen untuk respons AI
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Entri Pengetahuan</p>
                <p className="text-2xl font-bold">{knowledge.length}</p>
                <p className="text-xs text-muted-foreground">{knowledgeWithEmbedding} sudah di-embed</p>
              </div>
              <BookOpen className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Dokumen</p>
                <p className="text-2xl font-bold">{documents.length}</p>
                <p className="text-xs text-muted-foreground">{documents.filter(d => d.status === 'completed').length} selesai diproses</p>
              </div>
              <FileText className="h-8 w-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Chunk</p>
                <p className="text-2xl font-bold">{totalChunks}</p>
                <p className="text-xs text-muted-foreground">Dari dokumen</p>
              </div>
              <Database className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Diproses</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {documents.filter(d => d.status === 'processing').length}
                </p>
                <p className="text-xs text-muted-foreground">Sedang berjalan</p>
              </div>
              <Loader2 className={`h-8 w-8 text-yellow-500 ${documents.some(d => d.status === 'processing') ? 'animate-spin' : ''}`} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="knowledge-base" className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            Basis Pengetahuan
          </TabsTrigger>
          <TabsTrigger value="documents" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Dokumen
          </TabsTrigger>
        </TabsList>

        {/* ==================== KNOWLEDGE BASE TAB ==================== */}
        <TabsContent value="knowledge-base" className="space-y-4">
          {/* Search & Add */}
          <Card>
            <CardContent className="pt-6">
              <form onSubmit={handleKnowledgeSearch} className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                  <Input
                    placeholder="Cari berdasarkan judul, konten, atau kata kunci..."
                    value={knowledgeSearch}
                    onChange={(e) => setKnowledgeSearch(e.target.value)}
                  />
                </div>
                <Select value={knowledgeCategory} onValueChange={setKnowledgeCategory} disabled={categoriesLoading}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue placeholder="Semua Kategori" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Kategori</SelectItem>
                    {categories.map(cat => (
                      <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="icon" onClick={() => setIsAddCategoryOpen(true)} title="Tambah Kategori">
                  <Plus className="h-4 w-4" />
                </Button>
                <Button type="submit" variant="secondary">
                  <Search className="h-4 w-4 mr-2" />
                  Cari
                </Button>
                <Button type="button" onClick={() => { resetKnowledgeForm(); setIsAddKnowledgeOpen(true) }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Tambah
                </Button>
                <Button
                  type="button"
                  onClick={handleGenerateAllEmbeddings}
                  disabled={embeddingLoading}
                  className="bg-linear-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                >
                  {embeddingLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Memproses...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Generate Semua Embedding
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Knowledge Table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Entri Pengetahuan ({knowledge.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {knowledgeLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : knowledge.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Belum ada entri pengetahuan. Klik "Tambah" untuk membuat.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Judul</TableHead>
                      <TableHead>Kategori</TableHead>
                      <TableHead>Kata Kunci</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Embedding</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {knowledge.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.title}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{getCategoryLabel(item.category_id, item.category)}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {item.keywords.slice(0, 3).map((keyword, idx) => (
                              <Badge key={idx} variant="secondary" className="text-xs">{keyword}</Badge>
                            ))}
                            {item.keywords.length > 3 && (
                              <Badge variant="secondary" className="text-xs">+{item.keywords.length - 3}</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={item.is_active ? "default" : "secondary"}>
                            {item.is_active ? 'Aktif' : 'Nonaktif'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {item.last_embedded_at ? (
                            <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Ya
                            </Badge>
                          ) : (
                            <Badge variant="outline">Tidak</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => openEditKnowledge(item)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => { setSelectedKnowledge(item); setIsDeleteKnowledgeOpen(true) }}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== DOCUMENTS TAB ==================== */}
        <TabsContent value="documents" className="space-y-4">
          {/* Search & Upload */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                  <Input
                    placeholder="Cari berdasarkan judul, nama file, atau deskripsi..."
                    value={documentsSearch}
                    onChange={(e) => setDocumentsSearch(e.target.value)}
                  />
                </div>
                <Select value={documentsStatus} onValueChange={setDocumentsStatus}>
                  <SelectTrigger className="w-full sm:w-[150px]">
                    <SelectValue placeholder="Semua Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Status</SelectItem>
                    <SelectItem value="pending">Menunggu</SelectItem>
                    <SelectItem value="processing">Diproses</SelectItem>
                    <SelectItem value="completed">Selesai</SelectItem>
                    <SelectItem value="failed">Gagal</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={documentsCategory} onValueChange={setDocumentsCategory} disabled={categoriesLoading}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue placeholder="Semua Kategori" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Kategori</SelectItem>
                    {categories.map(cat => (
                      <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={fetchDocuments}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button onClick={() => { resetUploadForm(); setIsUploadOpen(true) }}>
                  <Upload className="h-4 w-4 mr-2" />
                  Unggah
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Documents Table */}
          <Card>
            <CardHeader>
              <CardTitle>Dokumen ({filteredDocuments.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {documentsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : filteredDocuments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Belum ada dokumen. Unggah dokumen untuk memulai.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dokumen</TableHead>
                      <TableHead>Kategori</TableHead>
                      <TableHead>Ukuran</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Chunk</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDocuments.map((doc) => {
                      const StatusIcon = STATUS_CONFIG[doc.status]?.icon || Clock
                      const statusColor = STATUS_CONFIG[doc.status]?.color || ''
                      
                      return (
                        <TableRow key={doc.id}>
                          <TableCell>
                            <div className="flex items-start gap-3">
                              {getFileIcon(doc.mime_type)}
                              <div>
                                <p className="font-medium">{doc.title || doc.original_name}</p>
                                <p className="text-xs text-muted-foreground">{doc.original_name}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {(doc.category_id || doc.category) && (
                              <Badge variant="outline">{getCategoryLabel(doc.category_id, doc.category)}</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{formatFileSize(doc.file_size)}</TableCell>
                          <TableCell>
                            <Badge className={statusColor}>
                              <StatusIcon className={`h-3 w-3 mr-1 ${doc.status === 'processing' ? 'animate-spin' : ''}`} />
                              {STATUS_CONFIG[doc.status]?.label}
                            </Badge>
                            {doc.error_message && (
                              <p className="text-xs text-red-500 mt-1" title={doc.error_message}>
                                {doc.error_message.substring(0, 30)}...
                              </p>
                            )}
                          </TableCell>
                          <TableCell>{doc.total_chunks ?? '-'}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="sm" onClick={() => window.location.href = `/api/documents/${doc.id}/download`} title="Download">
                                <Eye className="h-4 w-4" />
                              </Button>
                              {(doc.status === 'pending' || doc.status === 'failed') && (
                                <Button variant="ghost" size="sm" onClick={() => triggerProcessing(doc.id)} title="Process">
                                  <Sparkles className="h-4 w-4 text-purple-500" />
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" onClick={() => openEditDoc(doc)} title="Ubah">
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => { setSelectedDocument(doc); setIsDeleteDocOpen(true) }} title="Hapus">
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ==================== DIALOGS ==================== */}
      
      {/* Add Knowledge Dialog */}
      <Dialog open={isAddKnowledgeOpen} onOpenChange={setIsAddKnowledgeOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tambah Entri Pengetahuan</DialogTitle>
            <DialogDescription>Tambahkan informasi baru ke basis pengetahuan untuk digunakan AI.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddKnowledge}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="title">Judul *</Label>
                <Input id="title" value={knowledgeForm.title} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, title: e.target.value })} placeholder="contoh: Jam Operasional Kantor" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Kategori *</Label>
                <Select value={knowledgeForm.category_id} onValueChange={(value: string) => setKnowledgeForm({ ...knowledgeForm, category_id: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categories.map(cat => <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="content">Konten *</Label>
                <Textarea id="content" value={knowledgeForm.content} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, content: e.target.value })} placeholder="Masukkan informasi detail..." rows={6} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="keywords">Kata kunci (pisahkan dengan koma)</Label>
                <Input id="keywords" value={knowledgeForm.keywords} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, keywords: e.target.value })} placeholder="contoh: jam, buka, operasional" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="priority">Prioritas</Label>
                  <Input id="priority" type="number" value={knowledgeForm.priority} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, priority: parseInt(e.target.value) || 0 })} min={0} max={100} />
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <div className="flex items-center space-x-2 pt-2">
                    <Switch checked={knowledgeForm.is_active} onCheckedChange={(checked: boolean) => setKnowledgeForm({ ...knowledgeForm, is_active: checked })} />
                    <Label>{knowledgeForm.is_active ? 'Aktif' : 'Nonaktif'}</Label>
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddKnowledgeOpen(false)}>Batal</Button>
              <Button type="submit" disabled={knowledgeFormLoading}>
                <Save className="h-4 w-4 mr-2" />{knowledgeFormLoading ? 'Menyimpan...' : 'Simpan'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Knowledge Dialog */}
      <Dialog open={isEditKnowledgeOpen} onOpenChange={setIsEditKnowledgeOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ubah Entri Pengetahuan</DialogTitle>
            <DialogDescription>Perbarui informasi entri pengetahuan.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditKnowledge}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-title">Judul *</Label>
                <Input id="edit-title" value={knowledgeForm.title} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, title: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-category">Kategori *</Label>
                <Select value={knowledgeForm.category_id} onValueChange={(value: string) => setKnowledgeForm({ ...knowledgeForm, category_id: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categories.map(cat => <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-content">Konten *</Label>
                <Textarea id="edit-content" value={knowledgeForm.content} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, content: e.target.value })} rows={6} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-keywords">Kata kunci</Label>
                <Input id="edit-keywords" value={knowledgeForm.keywords} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, keywords: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-priority">Prioritas</Label>
                  <Input id="edit-priority" type="number" value={knowledgeForm.priority} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, priority: parseInt(e.target.value) || 0 })} />
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <div className="flex items-center space-x-2 pt-2">
                    <Switch checked={knowledgeForm.is_active} onCheckedChange={(checked: boolean) => setKnowledgeForm({ ...knowledgeForm, is_active: checked })} />
                    <Label>{knowledgeForm.is_active ? 'Aktif' : 'Nonaktif'}</Label>
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditKnowledgeOpen(false)}>Batal</Button>
              <Button type="submit" disabled={knowledgeFormLoading}>
                <Save className="h-4 w-4 mr-2" />{knowledgeFormLoading ? 'Menyimpan...' : 'Perbarui'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Knowledge Dialog */}
      <Dialog open={isDeleteKnowledgeOpen} onOpenChange={setIsDeleteKnowledgeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus Entri Pengetahuan</DialogTitle>
            <DialogDescription>Apakah Anda yakin ingin menghapus "{selectedKnowledge?.title}"? Tindakan ini tidak dapat dibatalkan.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsDeleteKnowledgeOpen(false)}>Batal</Button>
            <Button type="button" variant="destructive" onClick={handleDeleteKnowledge} disabled={knowledgeFormLoading}>
              <Trash2 className="h-4 w-4 mr-2" />{knowledgeFormLoading ? 'Menghapus...' : 'Hapus'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Document Dialog */}
      <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Unggah Dokumen</DialogTitle>
            <DialogDescription>Unggah dokumen untuk menambah basis pengetahuan AI. Didukung: PDF, DOC/DOCX, PPT/PPTX, TXT, MD, CSV</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="file">File *</Label>
              <Input id="file" type="file" ref={fileInputRef} onChange={handleFileChange} accept=".pdf,.docx,.doc,.ppt,.pptx,.txt,.md,.csv" />
              {uploadFile && <p className="text-sm text-muted-foreground">Dipilih: {uploadFile.name} ({formatFileSize(uploadFile.size)})</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="upload-title">Judul</Label>
              <Input id="upload-title" value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} placeholder="Judul dokumen" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="upload-category">Kategori</Label>
              <Select value={uploadCategory} onValueChange={setUploadCategory} disabled={categoriesLoading}>
                <SelectTrigger><SelectValue placeholder="Pilih kategori" /></SelectTrigger>
                <SelectContent>
                  {categories.map(cat => <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="upload-description">Deskripsi</Label>
              <Textarea id="upload-description" value={uploadDescription} onChange={(e) => setUploadDescription(e.target.value)} placeholder="Deskripsi singkat" rows={3} />
            </div>
            {uploading && (
              <div className="space-y-2">
                <Progress value={uploadProgress} />
                <p className="text-sm text-center text-muted-foreground">
                  {uploadProgress < 30 ? 'Menyiapkan...' : uploadProgress < 70 ? 'Mengunggah...' : uploadProgress < 100 ? 'Memproses...' : 'Selesai!'}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsUploadOpen(false)} disabled={uploading}>Batal</Button>
            <Button onClick={handleUpload} disabled={uploading || !uploadFile}>
              {uploading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Mengunggah...</> : <><Upload className="h-4 w-4 mr-2" />Unggah</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Document Dialog */}
      <Dialog open={isEditDocOpen} onOpenChange={setIsEditDocOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ubah Dokumen</DialogTitle>
            <DialogDescription>Perbarui metadata dokumen</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-doc-title">Judul</Label>
              <Input id="edit-doc-title" value={editDocTitle} onChange={(e) => setEditDocTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-doc-category">Kategori</Label>
              <Select value={editDocCategory} onValueChange={setEditDocCategory} disabled={categoriesLoading}>
                <SelectTrigger><SelectValue placeholder="Pilih kategori" /></SelectTrigger>
                <SelectContent>
                  {categories.map(cat => <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-doc-description">Deskripsi</Label>
              <Textarea id="edit-doc-description" value={editDocDescription} onChange={(e) => setEditDocDescription(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDocOpen(false)}>Batal</Button>
            <Button onClick={handleEditDoc} disabled={editDocLoading}>{editDocLoading ? 'Menyimpan...' : 'Simpan Perubahan'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Document Dialog */}
      <AlertDialog open={isDeleteDocOpen} onOpenChange={setIsDeleteDocOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Dokumen</AlertDialogTitle>
            <AlertDialogDescription>
              Apakah Anda yakin ingin menghapus "{selectedDocument?.title || selectedDocument?.original_name}"?
              Ini juga akan menghapus semua chunk dan embedding. Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteDoc} className="bg-destructive text-destructive-foreground">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ==================== ADD CATEGORY DIALOG ==================== */}
      <Dialog open={isAddCategoryOpen} onOpenChange={setIsAddCategoryOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Tambah Kategori Baru</DialogTitle>
            <DialogDescription>
              Tambahkan kategori kustom untuk mengorganisir basis pengetahuan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="category-name">Nama Kategori</Label>
              <Input
                id="category-name"
                placeholder="Masukkan nama kategori..."
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddCategory()
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setNewCategoryName(''); setIsAddCategoryOpen(false) }}>
              Batal
            </Button>
            <Button onClick={handleAddCategory} disabled={addCategoryLoading || !newCategoryName.trim()}>
              {addCategoryLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Menyimpan...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Simpan
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
