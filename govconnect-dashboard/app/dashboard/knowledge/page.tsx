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
  keywords: string[]
  is_active: boolean
  priority: number
  embedding_model?: string | null
  last_embedded_at?: string | null
  created_at: string
  updated_at: string
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
  total_chunks: number | null
  created_at: string
  updated_at: string
}

// ==================== CONSTANTS ====================

const CATEGORIES = [
  { value: 'informasi_umum', label: 'Informasi Umum' },
  { value: 'layanan', label: 'Layanan' },
  { value: 'prosedur', label: 'Prosedur' },
  { value: 'jadwal', label: 'Jadwal' },
  { value: 'kontak', label: 'Kontak' },
  { value: 'faq', label: 'FAQ' },
  { value: 'regulasi', label: 'Regulasi' },
  { value: 'panduan', label: 'Panduan' },
]

const STATUS_CONFIG = {
  pending: { label: 'Pending', icon: Clock, color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  processing: { label: 'Processing', icon: Loader2, color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  completed: { label: 'Completed', icon: CheckCircle, color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  failed: { label: 'Failed', icon: XCircle, color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
}

// ==================== MAIN COMPONENT ====================

export default function KnowledgePage() {
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState('knowledge-base')
  
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
    category: 'informasi_umum',
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

  // ==================== FETCH FUNCTIONS ====================
  
  const fetchKnowledge = async () => {
    setKnowledgeLoading(true)
    try {
      const params = new URLSearchParams()
      if (knowledgeSearch) params.set('search', knowledgeSearch)
      if (knowledgeCategory && knowledgeCategory !== 'all') params.set('category', knowledgeCategory)
      params.set('limit', '100')

      const response = await fetch(`/api/knowledge?${params}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      })

      if (response.ok) {
        const data = await response.json()
        setKnowledge(data.data)
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to fetch knowledge base", variant: "destructive" })
    } finally {
      setKnowledgeLoading(false)
    }
  }

  const fetchDocuments = async () => {
    setDocumentsLoading(true)
    try {
      const params = new URLSearchParams()
      if (documentsStatus && documentsStatus !== 'all') params.set('status', documentsStatus)
      if (documentsCategory && documentsCategory !== 'all') params.set('category', documentsCategory)
      params.set('limit', '100')

      const response = await fetch(`/api/documents?${params}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      })

      if (response.ok) {
        const data = await response.json()
        setDocuments(data.data)
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to fetch documents", variant: "destructive" })
    } finally {
      setDocumentsLoading(false)
    }
  }

  useEffect(() => {
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
        title: "Embeddings Generated",
        description: kbResult 
          ? `Knowledge Base: ${kbResult.processed}/${kbResult.total} processed` 
          : "Check console for details",
      })
      
      // Refresh data
      fetchKnowledge()
      fetchDocuments()
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to generate embeddings", variant: "destructive" })
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
      const keywords = knowledgeForm.keywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 0)

      const response = await fetch('/api/knowledge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ ...knowledgeForm, keywords }),
      })

      if (!response.ok) throw new Error((await response.json()).error || 'Failed to create')

      toast({ title: "Success", description: "Knowledge entry created" })
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
      const keywords = knowledgeForm.keywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 0)

      const response = await fetch(`/api/knowledge/${selectedKnowledge.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ ...knowledgeForm, keywords }),
      })

      if (!response.ok) throw new Error((await response.json()).error || 'Failed to update')

      toast({ title: "Success", description: "Knowledge entry updated" })
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

      if (!response.ok) throw new Error((await response.json()).error || 'Failed to delete')

      toast({ title: "Success", description: "Knowledge entry deleted" })
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
    setSelectedKnowledge(item)
    setKnowledgeForm({
      title: item.title,
      content: item.content,
      category: item.category,
      keywords: item.keywords.join(', '),
      is_active: item.is_active,
      priority: item.priority,
    })
    setIsEditKnowledgeOpen(true)
  }

  const resetKnowledgeForm = () => {
    setKnowledgeForm({ title: '', content: '', category: 'informasi_umum', keywords: '', is_active: true, priority: 0 })
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
      toast({ title: "Error", description: "Please select a file", variant: "destructive" })
      return
    }

    setUploading(true)
    setUploadProgress(10)

    try {
      const formData = new FormData()
      formData.append('file', uploadFile)
      if (uploadTitle) formData.append('title', uploadTitle)
      if (uploadDescription) formData.append('description', uploadDescription)
      if (uploadCategory) formData.append('category', uploadCategory)

      setUploadProgress(30)

      const response = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: formData,
      })

      setUploadProgress(70)

      if (!response.ok) throw new Error((await response.json()).error || 'Upload failed')

      const result = await response.json()
      setUploadProgress(100)

      toast({ title: "Success", description: "Document uploaded and processing started" })
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
      toast({ title: "Processing", description: "Starting document processing..." })
      
      const response = await fetch(`/api/documents/${documentId}/process`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      })
      
      const result = await response.json()
      
      if (!response.ok) {
        toast({ 
          title: "Processing Failed", 
          description: result.error || result.details || 'Unknown error',
          variant: "destructive" 
        })
      } else {
        toast({ 
          title: "Success", 
          description: `Document processed: ${result.chunksCount || 0} chunks created` 
        })
      }
      
      fetchDocuments()
    } catch (error: any) {
      console.error('Processing failed:', error)
      toast({ 
        title: "Error", 
        description: error.message || 'Processing failed',
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
          category: editDocCategory || null,
        }),
      })

      if (!response.ok) throw new Error((await response.json()).error || 'Update failed')

      toast({ title: "Success", description: "Document updated" })
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

      if (!response.ok) throw new Error((await response.json()).error || 'Delete failed')

      toast({ title: "Success", description: "Document deleted" })
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
    setEditDocCategory(doc.category || '')
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
  
  const getCategoryLabel = (value: string | null) => {
    if (!value) return '-'
    return CATEGORIES.find(c => c.value === value)?.label || value
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const getFileIcon = (mimeType: string) => {
    if (mimeType === 'application/pdf') return <File className="h-4 w-4 text-red-500" />
    if (mimeType.includes('word')) return <FileText className="h-4 w-4 text-blue-500" />
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
            Knowledge & RAG
          </h1>
          <p className="text-muted-foreground mt-2">
            Manage knowledge base entries and documents for AI-powered responses
          </p>
        </div>
        <Button 
          onClick={handleGenerateAllEmbeddings}
          disabled={embeddingLoading}
          className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
        >
          {embeddingLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Generate All Embeddings
            </>
          )}
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Knowledge Entries</p>
                <p className="text-2xl font-bold">{knowledge.length}</p>
                <p className="text-xs text-muted-foreground">{knowledgeWithEmbedding} embedded</p>
              </div>
              <BookOpen className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Documents</p>
                <p className="text-2xl font-bold">{documents.length}</p>
                <p className="text-xs text-muted-foreground">{documents.filter(d => d.status === 'completed').length} processed</p>
              </div>
              <FileText className="h-8 w-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Chunks</p>
                <p className="text-2xl font-bold">{totalChunks}</p>
                <p className="text-xs text-muted-foreground">From documents</p>
              </div>
              <Database className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Processing</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {documents.filter(d => d.status === 'processing').length}
                </p>
                <p className="text-xs text-muted-foreground">In progress</p>
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
            Knowledge Base
          </TabsTrigger>
          <TabsTrigger value="documents" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Documents
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
                    placeholder="Search by title, content, or keywords..."
                    value={knowledgeSearch}
                    onChange={(e) => setKnowledgeSearch(e.target.value)}
                  />
                </div>
                <Select value={knowledgeCategory} onValueChange={setKnowledgeCategory}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {CATEGORIES.map(cat => (
                      <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="submit" variant="secondary">
                  <Search className="h-4 w-4 mr-2" />
                  Search
                </Button>
                <Button type="button" onClick={() => { resetKnowledgeForm(); setIsAddKnowledgeOpen(true) }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Knowledge Table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Knowledge Entries ({knowledge.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {knowledgeLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : knowledge.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No knowledge entries found. Click "Add" to create one.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Keywords</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Embedded</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {knowledge.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.title}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{getCategoryLabel(item.category)}</Badge>
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
                            {item.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {item.last_embedded_at ? (
                            <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Yes
                            </Badge>
                          ) : (
                            <Badge variant="outline">No</Badge>
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
                    placeholder="Search by title, filename, or description..."
                    value={documentsSearch}
                    onChange={(e) => setDocumentsSearch(e.target.value)}
                  />
                </div>
                <Select value={documentsStatus} onValueChange={setDocumentsStatus}>
                  <SelectTrigger className="w-full sm:w-[150px]">
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="processing">Processing</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={documentsCategory} onValueChange={setDocumentsCategory}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {CATEGORIES.map(cat => (
                      <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={fetchDocuments}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button onClick={() => { resetUploadForm(); setIsUploadOpen(true) }}>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Documents Table */}
          <Card>
            <CardHeader>
              <CardTitle>Documents ({filteredDocuments.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {documentsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : filteredDocuments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No documents found. Upload a document to get started.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Document</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Chunks</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
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
                            {doc.category && <Badge variant="outline">{getCategoryLabel(doc.category)}</Badge>}
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
                              <Button variant="ghost" size="sm" onClick={() => window.open(doc.file_url, '_blank')} title="View">
                                <Eye className="h-4 w-4" />
                              </Button>
                              {(doc.status === 'pending' || doc.status === 'failed') && (
                                <Button variant="ghost" size="sm" onClick={() => triggerProcessing(doc.id)} title="Process">
                                  <Sparkles className="h-4 w-4 text-purple-500" />
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" onClick={() => openEditDoc(doc)} title="Edit">
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => { setSelectedDocument(doc); setIsDeleteDocOpen(true) }} title="Delete">
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
            <DialogTitle>Add Knowledge Entry</DialogTitle>
            <DialogDescription>Add new information to the knowledge base for AI to use.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddKnowledge}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title *</Label>
                <Input id="title" value={knowledgeForm.title} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, title: e.target.value })} placeholder="e.g., Jam Operasional Kantor" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Category *</Label>
                <Select value={knowledgeForm.category} onValueChange={(value) => setKnowledgeForm({ ...knowledgeForm, category: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(cat => <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="content">Content *</Label>
                <Textarea id="content" value={knowledgeForm.content} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, content: e.target.value })} placeholder="Enter detailed information..." rows={6} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="keywords">Keywords (comma-separated)</Label>
                <Input id="keywords" value={knowledgeForm.keywords} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, keywords: e.target.value })} placeholder="e.g., jam, buka, operasional" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="priority">Priority</Label>
                  <Input id="priority" type="number" value={knowledgeForm.priority} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, priority: parseInt(e.target.value) || 0 })} min={0} max={100} />
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <div className="flex items-center space-x-2 pt-2">
                    <Switch checked={knowledgeForm.is_active} onCheckedChange={(checked) => setKnowledgeForm({ ...knowledgeForm, is_active: checked })} />
                    <Label>{knowledgeForm.is_active ? 'Active' : 'Inactive'}</Label>
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddKnowledgeOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={knowledgeFormLoading}>
                <Save className="h-4 w-4 mr-2" />{knowledgeFormLoading ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Knowledge Dialog */}
      <Dialog open={isEditKnowledgeOpen} onOpenChange={setIsEditKnowledgeOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Knowledge Entry</DialogTitle>
            <DialogDescription>Update the knowledge entry information.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditKnowledge}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-title">Title *</Label>
                <Input id="edit-title" value={knowledgeForm.title} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, title: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-category">Category *</Label>
                <Select value={knowledgeForm.category} onValueChange={(value) => setKnowledgeForm({ ...knowledgeForm, category: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(cat => <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-content">Content *</Label>
                <Textarea id="edit-content" value={knowledgeForm.content} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, content: e.target.value })} rows={6} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-keywords">Keywords</Label>
                <Input id="edit-keywords" value={knowledgeForm.keywords} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, keywords: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-priority">Priority</Label>
                  <Input id="edit-priority" type="number" value={knowledgeForm.priority} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, priority: parseInt(e.target.value) || 0 })} />
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <div className="flex items-center space-x-2 pt-2">
                    <Switch checked={knowledgeForm.is_active} onCheckedChange={(checked) => setKnowledgeForm({ ...knowledgeForm, is_active: checked })} />
                    <Label>{knowledgeForm.is_active ? 'Active' : 'Inactive'}</Label>
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditKnowledgeOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={knowledgeFormLoading}>
                <Save className="h-4 w-4 mr-2" />{knowledgeFormLoading ? 'Saving...' : 'Update'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Knowledge Dialog */}
      <Dialog open={isDeleteKnowledgeOpen} onOpenChange={setIsDeleteKnowledgeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Knowledge Entry</DialogTitle>
            <DialogDescription>Are you sure you want to delete "{selectedKnowledge?.title}"? This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsDeleteKnowledgeOpen(false)}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={handleDeleteKnowledge} disabled={knowledgeFormLoading}>
              <Trash2 className="h-4 w-4 mr-2" />{knowledgeFormLoading ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Document Dialog */}
      <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
            <DialogDescription>Upload a document to add to the AI knowledge base. Supported: PDF, DOCX, TXT, MD, CSV</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="file">File *</Label>
              <Input id="file" type="file" ref={fileInputRef} onChange={handleFileChange} accept=".pdf,.docx,.doc,.txt,.md,.csv" />
              {uploadFile && <p className="text-sm text-muted-foreground">Selected: {uploadFile.name} ({formatFileSize(uploadFile.size)})</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="upload-title">Title</Label>
              <Input id="upload-title" value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} placeholder="Document title" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="upload-category">Category</Label>
              <Select value={uploadCategory} onValueChange={setUploadCategory}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(cat => <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="upload-description">Description</Label>
              <Textarea id="upload-description" value={uploadDescription} onChange={(e) => setUploadDescription(e.target.value)} placeholder="Brief description" rows={3} />
            </div>
            {uploading && (
              <div className="space-y-2">
                <Progress value={uploadProgress} />
                <p className="text-sm text-center text-muted-foreground">
                  {uploadProgress < 30 ? 'Preparing...' : uploadProgress < 70 ? 'Uploading...' : uploadProgress < 100 ? 'Processing...' : 'Complete!'}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsUploadOpen(false)} disabled={uploading}>Cancel</Button>
            <Button onClick={handleUpload} disabled={uploading || !uploadFile}>
              {uploading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading...</> : <><Upload className="h-4 w-4 mr-2" />Upload</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Document Dialog */}
      <Dialog open={isEditDocOpen} onOpenChange={setIsEditDocOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Document</DialogTitle>
            <DialogDescription>Update document metadata</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-doc-title">Title</Label>
              <Input id="edit-doc-title" value={editDocTitle} onChange={(e) => setEditDocTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-doc-category">Category</Label>
              <Select value={editDocCategory} onValueChange={setEditDocCategory}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(cat => <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-doc-description">Description</Label>
              <Textarea id="edit-doc-description" value={editDocDescription} onChange={(e) => setEditDocDescription(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDocOpen(false)}>Cancel</Button>
            <Button onClick={handleEditDoc} disabled={editDocLoading}>{editDocLoading ? 'Saving...' : 'Save Changes'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Document Dialog */}
      <AlertDialog open={isDeleteDocOpen} onOpenChange={setIsDeleteDocOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedDocument?.title || selectedDocument?.original_name}"? 
              This will also delete all chunks and embeddings. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteDoc} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
