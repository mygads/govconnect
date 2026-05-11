"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { AlertCircle, AlertTriangle, Eye, Search, ImageIcon, Phone, MessageSquare, Globe, Download, FileSpreadsheet, FileText as FilePdf, CheckSquare, Trash2, Loader2, RotateCcw, Archive } from "lucide-react"
import { laporan } from "@/lib/frontend-api"
import { formatDateTime, formatStatus, getStatusColor } from "@/lib/utils"
import { exportToExcel, exportToPDF } from "@/lib/export-utils"
import { useToast } from "@/hooks/use-toast"
import { useRealtime } from "@/components/dashboard/RealtimeProvider"
import { useAuth } from "@/components/auth/AuthContext"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface Complaint {
  id: string
  complaint_id: string
  wa_user_id: string
  channel?: 'WHATSAPP' | 'WEBCHAT'
  channel_identifier?: string
  kategori: string
  category?: { name?: string | null } | null
  type?: { name?: string | null } | null
  deskripsi: string
  alamat?: string
  status: string
  is_urgent?: boolean
  foto_url?: string
  reporter_name?: string
  reporter_phone?: string
  created_at: string
}

function formatComplaintCategory(complaint: Complaint) {
  const categoryName = complaint.category?.name?.trim()
  const typeName = complaint.type?.name?.trim()
  if (categoryName && typeName) return `${categoryName} / ${typeName}`
  if (typeName) return typeName
  if (categoryName) return categoryName
  return complaint.kategori?.replace(/_/g, " ") || "Belum terkategori"
}

const COMPLAINT_STATUS_OPTIONS = [
  { value: "PROCESS", label: "Tandai Proses" },
  { value: "DONE", label: "Tandai Selesai" },
  { value: "REJECT", label: "Tandai Ditolak" },
  { value: "CANCELED", label: "Tandai Dibatalkan" },
] as const

const VALID_COMPLAINT_TRANSITIONS: Record<string, string[]> = {
  OPEN: ["PROCESS", "DONE", "CANCELED", "REJECT"],
  PROCESS: ["DONE", "CANCELED", "REJECT"],
  DONE: [],
  CANCELED: [],
  REJECT: [],
}

const TERMINAL_COMPLAINT_STATUSES = new Set(["DONE", "CANCELED", "REJECT"])

function isValidComplaintTransition(currentStatus: string, nextStatus: string) {
  const allowed = VALID_COMPLAINT_TRANSITIONS[currentStatus] || []
  return allowed.includes(nextStatus)
}

export default function LaporanListPage() {
  const { user } = useAuth()
  const [complaints, setComplaints] = useState<Complaint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [pagination, setPagination] = useState({ total: 0, limit: 20, offset: 0 })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkUpdating, setBulkUpdating] = useState(false)
  const [pendingBulkStatus, setPendingBulkStatus] = useState<string | null>(null)
  const [bulkAdminNotes, setBulkAdminNotes] = useState("")
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showDeletedModal, setShowDeletedModal] = useState(false)
  const [deletedItems, setDeletedItems] = useState<Complaint[]>([])
  const [loadingDeleted, setLoadingDeleted] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [selectedDeletedItem, setSelectedDeletedItem] = useState<Complaint | null>(null)
  const { toast } = useToast()
  const { refreshData } = useRealtime()

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchComplaints()
    }, 300)
    return () => clearTimeout(timer)
  }, [search, statusFilter, pagination.offset])

  const fetchComplaints = async () => {
    try {
      setLoading(true)
      const params: { status?: string; search?: string; limit: string; offset: string } = {
        limit: String(pagination.limit),
        offset: String(pagination.offset),
      }
      if (statusFilter !== "all") params.status = statusFilter
      if (search.trim()) params.search = search.trim()

      const data = await laporan.getAll(params)
      setComplaints(data.data || [])
      setPagination(prev => ({
        ...prev,
        total: data.pagination?.total ?? 0,
        limit: data.pagination?.limit ?? prev.limit,
        offset: data.pagination?.offset ?? prev.offset,
      }))
      setSelectedIds(new Set())
      setError(null)
    } catch (err: any) {
      setError(err.message || "Gagal memuat pengaduan")
    } finally {
      setLoading(false)
    }
  }

  const filteredComplaints = complaints
  const selectedComplaints = filteredComplaints.filter((complaint) => selectedIds.has(complaint.id))
  const bulkEligibleComplaints = pendingBulkStatus
    ? selectedComplaints.filter((complaint) => isValidComplaintTransition(complaint.status, pendingBulkStatus))
    : []
  const bulkSkippedCount = pendingBulkStatus ? selectedComplaints.length - bulkEligibleComplaints.length : 0
  const bulkRequiresNotes = pendingBulkStatus ? TERMINAL_COMPLAINT_STATUSES.has(pendingBulkStatus) : false

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredComplaints.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredComplaints.map(c => c.id)))
    }
  }

  const startBulkStatusUpdate = (newStatus: string) => {
    setPendingBulkStatus(newStatus)
    setBulkAdminNotes("")
  }

  const handleBulkStatusUpdate = async () => {
    if (!pendingBulkStatus || selectedComplaints.length === 0) return

    const trimmedNotes = bulkAdminNotes.trim()
    if (bulkRequiresNotes && !trimmedNotes) {
      toast({
        title: "Catatan wajib diisi",
        description: `Bulk update ke ${formatStatus(pendingBulkStatus)} wajib menyertakan catatan admin.`,
        variant: "destructive",
      })
      return
    }

    if (bulkEligibleComplaints.length === 0) {
      toast({
        title: "Tidak ada transisi valid",
        description: `Pengaduan terpilih tidak bisa diubah ke ${formatStatus(pendingBulkStatus)}.`,
        variant: "destructive",
      })
      return
    }

    setBulkUpdating(true)
    let success = 0
    let failed = 0

    for (const complaint of bulkEligibleComplaints) {
      try {
        await laporan.updateStatus(complaint.id, {
          status: pendingBulkStatus,
          admin_notes: trimmedNotes || undefined,
        })
        success++
      } catch {
        failed++
      }
    }

    toast({
      title: "Bulk Update Selesai",
      description: `${success} berhasil, ${failed} gagal, ${bulkSkippedCount} dilewati untuk status ${formatStatus(pendingBulkStatus)}.`,
    })
    setSelectedIds(new Set())
    setPendingBulkStatus(null)
    setBulkAdminNotes("")
    setBulkUpdating(false)
    fetchComplaints()
    refreshData()
  }

  const handleExportExcel = () => {
    const dataToExport = selectedIds.size > 0
      ? filteredComplaints.filter(c => selectedIds.has(c.id))
      : filteredComplaints
    exportToExcel(dataToExport, { title: "Laporan Pengaduan Warga" })
    toast({ title: "Export Berhasil", description: `${dataToExport.length} data diekspor ke Excel` })
  }

  const handleExportPDF = () => {
    const dataToExport = selectedIds.size > 0
      ? filteredComplaints.filter(c => selectedIds.has(c.id))
      : filteredComplaints
    exportToPDF(dataToExport, { title: "Laporan Pengaduan Warga" })
    toast({ title: "Export Berhasil", description: `${dataToExport.length} data diekspor ke PDF` })
  }

  const handleSoftDelete = async (id: string) => {
    try {
      setDeletingId(id)
      await laporan.softDelete(id)
      toast({ title: "Berhasil", description: "Pengaduan dipindahkan ke sampah" })
      fetchComplaints()
      refreshData()
    } catch (err: any) {
      toast({ title: "Gagal", description: err.message, variant: "destructive" })
    } finally {
      setDeletingId(null)
    }
  }

  const handleBulkSoftDelete = async () => {
    if (selectedIds.size === 0) return
    setBulkUpdating(true)
    let success = 0, failed = 0
    for (const id of selectedIds) {
      try {
        await laporan.softDelete(id)
        success++
      } catch { failed++ }
    }
    toast({
      title: "Bulk Delete Selesai",
      description: `${success} berhasil dihapus, ${failed} gagal`,
    })
    setSelectedIds(new Set())
    setPendingBulkStatus(null)
    setBulkAdminNotes("")
    setBulkUpdating(false)
    fetchComplaints()
    refreshData()
  }

  const fetchDeletedItems = async () => {
    try {
      setLoadingDeleted(true)
      const data = await laporan.getDeleted()
      setDeletedItems(data.data || [])
    } catch (err: any) {
      toast({ title: "Gagal", description: err.message, variant: "destructive" })
    } finally {
      setLoadingDeleted(false)
    }
  }

  const handleRestore = async (id: string) => {
    try {
      setRestoringId(id)
      await laporan.restore(id)
      toast({ title: "Berhasil", description: "Pengaduan berhasil dipulihkan" })
      setDeletedItems(prev => prev.filter(item => item.id !== id))
      if (selectedDeletedItem?.id === id) setSelectedDeletedItem(null)
      fetchComplaints()
      refreshData()
    } catch (err: any) {
      toast({ title: "Gagal", description: err.message, variant: "destructive" })
    } finally {
      setRestoringId(null)
    }
  }

  const openDeletedModal = () => {
    setShowDeletedModal(true)
    fetchDeletedItems()
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-96" />
          </div>
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-200px)]">
        <Card className="w-full max-w-md border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Gagal Memuat Data
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={fetchComplaints} variant="outline">
              Coba Lagi
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Pengaduan Warga</h1>
          <p className="text-muted-foreground mt-2">
            Kelola semua laporan masuk dari warga
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={openDeletedModal}>
            <Archive className="h-4 w-4 mr-2" /> Lihat yang Dihapus
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Download className="h-4 w-4 mr-2" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={handleExportExcel}>
                <FileSpreadsheet className="h-4 w-4 mr-2" /> Export Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportPDF}>
                <FilePdf className="h-4 w-4 mr-2" /> Export PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={fetchComplaints} variant="outline">
            Muat Ulang
          </Button>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="space-y-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium">
                <CheckSquare className="mr-1 inline h-4 w-4" />
                {selectedIds.size} pengaduan dipilih
              </span>
              <div className="flex flex-wrap gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" disabled={bulkUpdating}>
                      {bulkUpdating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                      Ubah Status
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {COMPLAINT_STATUS_OPTIONS.map((option) => (
                      <DropdownMenuItem key={option.value} onClick={() => startBulkStatusUpdate(option.value)}>
                        {option.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button size="sm" variant="outline" onClick={handleBulkSoftDelete} disabled={bulkUpdating} className="text-destructive hover:text-destructive">
                  {bulkUpdating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1 h-4 w-4" />}
                  Hapus
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSelectedIds(new Set())
                    setPendingBulkStatus(null)
                    setBulkAdminNotes("")
                  }}
                >
                  Batal
                </Button>
              </div>
            </div>

            {pendingBulkStatus && (
              <div className="space-y-3 rounded-lg border bg-background/80 p-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Bulk update ke {formatStatus(pendingBulkStatus)}</p>
                  <p className="text-xs text-muted-foreground">
                    {bulkEligibleComplaints.length} pengaduan siap diperbarui
                    {bulkSkippedCount > 0 ? `, ${bulkSkippedCount} dilewati karena statusnya sudah final atau transisinya tidak valid.` : "."}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bulk-admin-notes">
                    Catatan Admin {bulkRequiresNotes ? "(Wajib)" : "(Opsional)"}
                  </Label>
                  <Textarea
                    id="bulk-admin-notes"
                    placeholder="Tambahkan catatan yang akan dikirim ke warga terpilih..."
                    value={bulkAdminNotes}
                    onChange={(e) => setBulkAdminNotes(e.target.value)}
                    rows={3}
                  />
                  {bulkRequiresNotes && !bulkAdminNotes.trim() && (
                    <p className="text-xs text-destructive">Catatan wajib diisi untuk status selesai, dibatalkan, atau ditolak.</p>
                  )}
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setPendingBulkStatus(null)
                      setBulkAdminNotes("")
                    }}
                  >
                    Batalkan Aksi
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleBulkStatusUpdate}
                    disabled={bulkUpdating || bulkEligibleComplaints.length === 0 || (bulkRequiresNotes && !bulkAdminNotes.trim())}
                  >
                    {bulkUpdating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                    Terapkan Bulk Update
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Filter & Pencarian</CardTitle>
          <div className="flex gap-4 mt-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Cari nomor pengaduan, nama pelapor, No HP, atau kategori..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value)
                    setPagination(prev => ({ ...prev, offset: 0 }))
                  }}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant={statusFilter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                    setPagination(prev => ({ ...prev, offset: 0 }))
                    setStatusFilter("all")
                  }}
              >
                Semua
              </Button>
              <Button
                variant={statusFilter === "OPEN" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                    setPagination(prev => ({ ...prev, offset: 0 }))
                    setStatusFilter("OPEN")
                  }}
              >
                Baru
              </Button>
              <Button
                variant={statusFilter === "PROCESS" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                    setPagination(prev => ({ ...prev, offset: 0 }))
                    setStatusFilter("PROCESS")
                  }}
              >
                Proses
              </Button>
              <Button
                variant={statusFilter === "DONE" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                    setPagination(prev => ({ ...prev, offset: 0 }))
                    setStatusFilter("DONE")
                  }}
              >
                Selesai
              </Button>
              <Button
                variant={statusFilter === "CANCELED" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                    setPagination(prev => ({ ...prev, offset: 0 }))
                    setStatusFilter("CANCELED")
                  }}
              >
                Dibatalkan
              </Button>
              <Button
                variant={statusFilter === "REJECT" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                    setPagination(prev => ({ ...prev, offset: 0 }))
                    setStatusFilter("REJECT")
                  }}
              >
                Ditolak
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredComplaints.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Belum ada pengaduan masuk</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={selectedIds.size === filteredComplaints.length && filteredComplaints.length > 0}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead>No. Pengaduan</TableHead>
                    <TableHead>Pelapor</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Kategori</TableHead>
                    <TableHead>Deskripsi</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredComplaints.map((complaint) => (
                    <TableRow key={complaint.id} className={selectedIds.has(complaint.id) ? "bg-primary/5" : ""}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(complaint.id)}
                          onCheckedChange={() => toggleSelect(complaint.id)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex flex-wrap items-center gap-2">
                          {complaint.foto_url && (
                            <span title="Laporan dengan foto">
                              <ImageIcon className="h-4 w-4 text-blue-500" />
                            </span>
                          )}
                          <span>{complaint.complaint_id}</span>
                          {complaint.is_urgent && (
                            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 gap-1">
                              <AlertTriangle className="h-3 w-3" /> Darurat
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          {complaint.reporter_name ? (
                            <span className="font-medium text-sm">{complaint.reporter_name}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">Belum diketahui</span>
                          )}
                          {complaint.reporter_phone ? (
                            <span className="text-xs text-muted-foreground font-mono">{complaint.reporter_phone}</span>
                          ) : complaint.wa_user_id ? (
                            <span className="text-xs text-muted-foreground font-mono">{complaint.wa_user_id}</span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        {(complaint.channel || (complaint.wa_user_id ? 'WHATSAPP' : 'WEBCHAT')) === 'WHATSAPP' ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 gap-1">
                            <MessageSquare className="h-3 w-3" />
                            WA
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 gap-1">
                            <Globe className="h-3 w-3" />
                            Web
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {formatComplaintCategory(complaint)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xs truncate">
                        {complaint.deskripsi}
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(complaint.status)}>
                          {formatStatus(complaint.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDateTime(complaint.created_at, user?.village_timezone)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link href={`/dashboard/laporan/${complaint.id}`}>
                            <Button variant="ghost" size="sm">
                              <Eye className="h-4 w-4 mr-1" />
                              Detail
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSoftDelete(complaint.id)}
                            disabled={deletingId === complaint.id}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            {deletingId === complaint.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="mt-4 flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              Menampilkan {pagination.offset + (filteredComplaints.length > 0 ? 1 : 0)}-{pagination.offset + filteredComplaints.length} dari {pagination.total} pengaduan
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.offset === 0 || loading}
                onClick={() => setPagination(prev => ({ ...prev, offset: Math.max(0, prev.offset - prev.limit) }))}
              >
                Sebelumnya
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.offset + pagination.limit >= pagination.total || loading}
                onClick={() => setPagination(prev => ({ ...prev, offset: prev.offset + prev.limit }))}
              >
                Berikutnya
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Deleted Items Modal */}
      <Dialog open={showDeletedModal} onOpenChange={setShowDeletedModal}>
        <DialogContent className="w-[96vw] max-w-7xl max-h-[88vh] overflow-hidden p-0">
          <DialogHeader className="border-b bg-muted/30 px-6 py-5">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Archive className="h-5 w-5" /> Pengaduan yang Dihapus
            </DialogTitle>
            <DialogDescription>
              Item yang dihapus akan otomatis terhapus permanen setelah 30 hari.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
            {loadingDeleted ? (
              <div className="flex min-h-56 items-center justify-center rounded-lg border border-dashed bg-muted/20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : deletedItems.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-8 text-center text-muted-foreground">
                <Trash2 className="mb-3 h-10 w-10 opacity-30" />
                <p className="font-medium text-foreground">Tidak ada pengaduan yang dihapus</p>
                <p className="mt-1 max-w-md text-sm">Pengaduan yang dipindahkan ke sampah akan muncul di sini sebelum dihapus permanen.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <Table className="w-full table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[170px]">No. Pengaduan</TableHead>
                      <TableHead>Ringkasan</TableHead>
                      <TableHead className="w-[120px]">Status</TableHead>
                      <TableHead className="w-[180px] text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deletedItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-sm font-semibold">{item.complaint_id}</TableCell>
                        <TableCell className="min-w-0">
                          <div className="min-w-0 space-y-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <p className="truncate text-sm font-medium" title={formatComplaintCategory(item)}>{formatComplaintCategory(item)}</p>
                              {item.is_urgent && (
                                <Badge variant="outline" className="shrink-0 bg-red-50 text-red-700 border-red-200 gap-1">
                                  <AlertTriangle className="h-3 w-3" /> Darurat
                                </Badge>
                              )}
                            </div>
                            <p className="truncate text-sm text-muted-foreground" title={item.deskripsi}>{item.deskripsi}</p>
                          </div>
                        </TableCell>
                        <TableCell><Badge className={getStatusColor(item.status)}>{formatStatus(item.status)}</Badge></TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => setSelectedDeletedItem(item)}>
                              <Eye className="h-4 w-4 mr-1" /> Detail
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRestore(item.id)}
                              disabled={restoringId === item.id}
                            >
                              {restoringId === item.id ? (
                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                              ) : (
                                <RotateCcw className="h-4 w-4 mr-1" />
                              )}
                              Pulihkan
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedDeletedItem} onOpenChange={(open) => !open && setSelectedDeletedItem(null)}>
        <DialogContent className="w-[94vw] max-w-3xl max-h-[86vh] overflow-y-auto">
          {selectedDeletedItem && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedDeletedItem.complaint_id}</DialogTitle>
                <DialogDescription>Detail pengaduan yang sedang berada di sampah.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge className={getStatusColor(selectedDeletedItem.status)}>{formatStatus(selectedDeletedItem.status)}</Badge>
                  <Badge variant="outline">{formatComplaintCategory(selectedDeletedItem)}</Badge>
                </div>
                <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-muted-foreground">Pelapor</p>
                    <p className="font-medium">{selectedDeletedItem.reporter_name || '-'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Kontak</p>
                    <p className="font-mono">{selectedDeletedItem.reporter_phone || selectedDeletedItem.wa_user_id || '-'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Tanggal</p>
                    <p>{formatDateTime(selectedDeletedItem.created_at, user?.village_timezone)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Channel</p>
                    <p>{(selectedDeletedItem.channel || (selectedDeletedItem.wa_user_id ? 'WHATSAPP' : 'WEBCHAT')) === 'WHATSAPP' ? 'WhatsApp' : 'Webchat'}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Deskripsi</p>
                  <p className="whitespace-pre-wrap rounded-lg border p-4 text-sm leading-6 text-foreground">{selectedDeletedItem.deskripsi}</p>
                </div>
                {selectedDeletedItem.alamat && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Alamat</p>
                    <p className="rounded-lg border p-4 text-sm text-foreground">{selectedDeletedItem.alamat}</p>
                  </div>
                )}
                <div className="flex justify-end">
                  <Button onClick={() => handleRestore(selectedDeletedItem.id)} disabled={restoringId === selectedDeletedItem.id}>
                    {restoringId === selectedDeletedItem.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-1" />}
                    Pulihkan
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
