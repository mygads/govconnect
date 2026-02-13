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
import { AlertCircle, Eye, Search, ImageIcon, Phone, MessageSquare, Globe, Download, FileSpreadsheet, FileText as FilePdf, CheckSquare, Trash2, Loader2, RotateCcw, Archive } from "lucide-react"
import { laporan } from "@/lib/frontend-api"
import { formatDate, formatStatus, getStatusColor } from "@/lib/utils"
import { exportToExcel, exportToPDF } from "@/lib/export-utils"
import { useToast } from "@/hooks/use-toast"
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
  deskripsi: string
  alamat?: string
  status: string
  foto_url?: string
  reporter_name?: string
  reporter_phone?: string
  created_at: string
}

export default function LaporanListPage() {
  const [complaints, setComplaints] = useState<Complaint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkUpdating, setBulkUpdating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showDeletedModal, setShowDeletedModal] = useState(false)
  const [deletedItems, setDeletedItems] = useState<Complaint[]>([])
  const [loadingDeleted, setLoadingDeleted] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    fetchComplaints()
  }, [])

  const fetchComplaints = async () => {
    try {
      setLoading(true)
      const data = await laporan.getAll()
      setComplaints(data.data || [])
      setError(null)
    } catch (err: any) {
      setError(err.message || "Gagal memuat pengaduan")
    } finally {
      setLoading(false)
    }
  }

  const filteredComplaints = complaints.filter((complaint) => {
    const searchLower = search.toLowerCase()
    const matchSearch =
      search === "" ||
      complaint.complaint_id.toLowerCase().includes(searchLower) ||
      complaint.wa_user_id?.includes(search) ||
      complaint.kategori.toLowerCase().includes(searchLower) ||
      (complaint.reporter_name || '').toLowerCase().includes(searchLower) ||
      (complaint.reporter_phone || '').includes(search)

    const matchStatus = statusFilter === "all" || complaint.status === statusFilter

    return matchSearch && matchStatus
  })

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

  const handleBulkStatusUpdate = async (newStatus: string) => {
    if (selectedIds.size === 0) return
    setBulkUpdating(true)
    let success = 0, failed = 0
    for (const id of selectedIds) {
      try {
        await laporan.updateStatus(id, { status: newStatus })
        success++
      } catch { failed++ }
    }
    toast({
      title: "Bulk Update Selesai",
      description: `${success} berhasil, ${failed} gagal diperbarui ke ${formatStatus(newStatus)}`,
    })
    setSelectedIds(new Set())
    setBulkUpdating(false)
    fetchComplaints()
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
    setBulkUpdating(false)
    fetchComplaints()
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
      fetchComplaints()
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
          <CardContent className="py-3 flex items-center justify-between">
            <span className="text-sm font-medium">
              <CheckSquare className="h-4 w-4 inline mr-1" />
              {selectedIds.size} pengaduan dipilih
            </span>
            <div className="flex gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={bulkUpdating}>
                    {bulkUpdating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                    Ubah Status
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => handleBulkStatusUpdate("PROCESS")}>Tandai Proses</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkStatusUpdate("DONE")}>Tandai Selesai</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkStatusUpdate("REJECT")}>Tandai Ditolak</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkStatusUpdate("CANCELED")}>Tandai Dibatalkan</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" variant="outline" onClick={handleBulkSoftDelete} disabled={bulkUpdating} className="text-destructive hover:text-destructive">
                {bulkUpdating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
                Hapus
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                Batal
              </Button>
            </div>
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
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant={statusFilter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("all")}
              >
                Semua
              </Button>
              <Button
                variant={statusFilter === "OPEN" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("OPEN")}
              >
                Baru
              </Button>
              <Button
                variant={statusFilter === "PROCESS" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("PROCESS")}
              >
                Proses
              </Button>
              <Button
                variant={statusFilter === "DONE" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("DONE")}
              >
                Selesai
              </Button>
              <Button
                variant={statusFilter === "CANCELED" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("CANCELED")}
              >
                Dibatalkan
              </Button>
              <Button
                variant={statusFilter === "REJECT" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("REJECT")}
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
                        <div className="flex items-center gap-2">
                          {complaint.foto_url && (
                            <span title="Laporan dengan foto">
                              <ImageIcon className="h-4 w-4 text-blue-500" />
                            </span>
                          )}
                          {complaint.complaint_id}
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
                          {complaint.kategori.replace(/_/g, " ")}
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
                      <TableCell>{formatDate(complaint.created_at)}</TableCell>
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
          <div className="mt-4 text-sm text-muted-foreground">
            Menampilkan {filteredComplaints.length} dari {complaints.length} pengaduan
          </div>
        </CardContent>
      </Card>

      {/* Deleted Items Modal */}
      <Dialog open={showDeletedModal} onOpenChange={setShowDeletedModal}>
        <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Archive className="h-5 w-5" /> Pengaduan yang Dihapus
            </DialogTitle>
            <DialogDescription>
              Item yang dihapus akan otomatis terhapus permanen setelah 30 hari.
            </DialogDescription>
          </DialogHeader>
          {loadingDeleted ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : deletedItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Trash2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>Tidak ada pengaduan yang dihapus</p>
            </div>
          ) : (
            <div className="space-y-3">
              {deletedItems.map((item) => (
                <div key={item.id} className="border rounded-lg p-4 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{item.complaint_id}</span>
                      <Badge className={getStatusColor(item.status)} >{formatStatus(item.status)}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{item.deskripsi}</p>
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span>{item.kategori.replace(/_/g, " ")}</span>
                      <span>{formatDate(item.created_at)}</span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRestore(item.id)}
                    disabled={restoringId === item.id}
                    className="shrink-0"
                  >
                    {restoringId === item.id ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4 mr-1" />
                    )}
                    Pulihkan
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
