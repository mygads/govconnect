"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Search, RefreshCw, FileText, User, Phone, CreditCard, ChevronRight, Trash2, Loader2, RotateCcw, Archive, Eye } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"

interface ServiceRequest {
  id: string
  request_number: string
  wa_user_id: string
  status: string
  created_at: string
  citizen_data_json?: Record<string, any>
  service: {
    id: string
    name: string
    category?: { name: string } | null
  }
}

const statusOptions = [
  { value: "all", label: "Semua" },
  { value: "OPEN", label: "Baru" },
  { value: "PROCESS", label: "Proses" },
  { value: "DONE", label: "Selesai" },
  { value: "CANCELED", label: "Dibatalkan" },
  { value: "REJECT", label: "Ditolak" },
]

export default function ServiceRequestsPage() {
  const [requests, setRequests] = useState<ServiceRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showDeletedModal, setShowDeletedModal] = useState(false)
  const [deletedItems, setDeletedItems] = useState<ServiceRequest[]>([])
  const [loadingDeleted, setLoadingDeleted] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [selectedDeletedItem, setSelectedDeletedItem] = useState<ServiceRequest | null>(null)
  const { toast } = useToast()

  const fetchRequests = async () => {
    try {
      setLoading(true)
      const query = statusFilter !== "all" ? `?status=${statusFilter}` : ""
      const response = await fetch(`/api/service-requests${query}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || "Gagal memuat permohonan layanan")
      }
      const data = await response.json()
      setRequests(data.data || [])
      setError(null)
    } catch (err: any) {
      setError(err.message || "Gagal memuat permohonan layanan")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRequests()
  }, [statusFilter])

  const filteredRequests = useMemo(() => {
    if (!search) return requests
    const keyword = search.toLowerCase()
    return requests.filter((item) => {
      const citizenName = (item.citizen_data_json?.nama_lengkap || '').toLowerCase()
      const citizenNik = (item.citizen_data_json?.nik || '').toLowerCase()
      const citizenPhone = (item.citizen_data_json?.no_hp || '').toLowerCase()
      return (
        item.request_number.toLowerCase().includes(keyword) ||
        item.wa_user_id.includes(search) ||
        item.service?.name?.toLowerCase().includes(keyword) ||
        citizenName.includes(keyword) ||
        citizenNik.includes(keyword) ||
        citizenPhone.includes(keyword)
      )
    })
  }, [requests, search])

  const getStatusBadge = (status: string) => {
    const map: Record<string, string> = {
      OPEN: "bg-blue-100 text-blue-700",
      PROCESS: "bg-yellow-100 text-yellow-700",
      DONE: "bg-green-100 text-green-700",
      CANCELED: "bg-gray-100 text-gray-700",
      REJECT: "bg-red-100 text-red-700",
      baru: "bg-blue-100 text-blue-700",
      proses: "bg-yellow-100 text-yellow-700",
      selesai: "bg-green-100 text-green-700",
      dibatalkan: "bg-gray-100 text-gray-700",
      ditolak: "bg-red-100 text-red-700",
    }
    return map[status] || "bg-gray-100 text-gray-700"
  }

  const handleSoftDelete = async (id: string) => {
    try {
      setDeletingId(id)
      const res = await fetch(`/api/service-requests/${id}/soft-delete`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      if (!res.ok) throw new Error("Gagal menghapus")
      toast({ title: "Berhasil", description: "Permohonan dipindahkan ke sampah" })
      fetchRequests()
    } catch (err: any) {
      toast({ title: "Gagal", description: err.message, variant: "destructive" })
    } finally {
      setDeletingId(null)
    }
  }

  const fetchDeletedItems = async () => {
    try {
      setLoadingDeleted(true)
      const res = await fetch('/api/service-requests/deleted', {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      if (!res.ok) throw new Error("Gagal memuat data")
      const data = await res.json()
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
      const res = await fetch(`/api/service-requests/${id}/restore`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      if (!res.ok) throw new Error("Gagal memulihkan")
      toast({ title: "Berhasil", description: "Permohonan berhasil dipulihkan" })
      setDeletedItems(prev => prev.filter(item => item.id !== id))
      if (selectedDeletedItem?.id === id) setSelectedDeletedItem(null)
      fetchRequests()
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
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">Gagal memuat data</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={fetchRequests} variant="outline">Coba Lagi</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Permohonan Layanan</h1>
          <p className="text-muted-foreground mt-2">Daftar permohonan layanan dari form publik.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={openDeletedModal}>
            <Archive className="h-4 w-4 mr-2" /> Lihat yang Dihapus
          </Button>
          <Button variant="outline" onClick={fetchRequests} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Muat Ulang
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter & Pencarian</CardTitle>
          <div className="flex flex-wrap gap-3 mt-4">
            <div className="relative flex-1 min-w-60">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nomor, nama layanan, atau WA"
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {statusOptions.map((opt) => (
                <Button
                  key={opt.value}
                  variant={statusFilter === opt.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setStatusFilter(opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {filteredRequests.length === 0 ? (
            <div className="text-center text-muted-foreground py-10">
              <FileText className="h-8 w-8 mx-auto mb-2" />
              Belum ada permohonan layanan.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredRequests.map((item) => {
                const nama = item.citizen_data_json?.nama_lengkap || '-'
                const nik = item.citizen_data_json?.nik || ''
                const noHp = item.citizen_data_json?.no_hp || item.wa_user_id
                return (
                  <div
                    key={item.id}
                    className="border rounded-lg p-4 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-foreground">{item.request_number}</p>
                          <Badge className={getStatusBadge(item.status)}>{item.status}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{item.service?.name}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                          <span className="inline-flex items-center gap-1.5 text-foreground">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            {nama}
                          </span>
                          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                            <Phone className="h-3.5 w-3.5" />
                            {noHp}
                          </span>
                          {nik && (
                            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                              <CreditCard className="h-3.5 w-3.5" />
                              {nik}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {new Date(item.created_at).toLocaleString("id-ID")}
                        </p>
                      </div>
                      <div className="flex flex-col gap-2 shrink-0">
                        <Link href={`/dashboard/pelayanan/${item.id}`}>
                          <Button variant="outline" size="sm" className="gap-1.5 w-full">
                            Lihat Detail
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSoftDelete(item.id)}
                          disabled={deletingId === item.id}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5 w-full"
                        >
                          {deletingId === item.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                          Hapus
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deleted Items Modal */}
      <Dialog open={showDeletedModal} onOpenChange={setShowDeletedModal}>
        <DialogContent className="w-[96vw] max-w-7xl max-h-[88vh] overflow-hidden p-0">
          <DialogHeader className="border-b bg-muted/30 px-6 py-5">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Archive className="h-5 w-5" /> Permohonan yang Dihapus
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
                <p className="font-medium text-foreground">Tidak ada permohonan yang dihapus</p>
                <p className="mt-1 max-w-md text-sm">Permohonan yang dipindahkan ke sampah akan muncul di sini sebelum dihapus permanen.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <Table className="w-full table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[180px]">No. Permohonan</TableHead>
                      <TableHead>Ringkasan</TableHead>
                      <TableHead className="w-[120px]">Status</TableHead>
                      <TableHead className="w-[180px] text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deletedItems.map((item) => {
                      const nama = item.citizen_data_json?.nama_lengkap || '-'
                      const noHp = item.citizen_data_json?.no_hp || item.wa_user_id
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono text-sm font-semibold">{item.request_number}</TableCell>
                          <TableCell className="min-w-0">
                            <div className="min-w-0 space-y-1">
                              <p className="truncate text-sm font-medium" title={item.service?.name || undefined}>{item.service?.name || '-'}</p>
                              <p className="truncate text-sm text-muted-foreground" title={`${nama} • ${noHp}`}>{nama} • {noHp}</p>
                            </div>
                          </TableCell>
                          <TableCell><Badge className={getStatusBadge(item.status)}>{item.status}</Badge></TableCell>
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
                      )
                    })}
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
                <DialogTitle>{selectedDeletedItem.request_number}</DialogTitle>
                <DialogDescription>Detail permohonan yang sedang berada di sampah.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge className={getStatusBadge(selectedDeletedItem.status)}>{selectedDeletedItem.status}</Badge>
                  <Badge variant="outline">{selectedDeletedItem.service?.name || '-'}</Badge>
                </div>
                <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-muted-foreground">Nama Pemohon</p>
                    <p className="font-medium">{selectedDeletedItem.citizen_data_json?.nama_lengkap || '-'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">No. HP</p>
                    <p className="font-mono">{selectedDeletedItem.citizen_data_json?.no_hp || selectedDeletedItem.wa_user_id || '-'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">NIK</p>
                    <p className="font-mono">{selectedDeletedItem.citizen_data_json?.nik || '-'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Tanggal</p>
                    <p>{new Date(selectedDeletedItem.created_at).toLocaleString("id-ID")}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Data Pemohon</p>
                  <div className="rounded-lg border p-4 text-sm">
                    <pre className="whitespace-pre-wrap wrap-break-word font-sans text-sm leading-6 text-foreground">
                      {JSON.stringify(selectedDeletedItem.citizen_data_json || {}, null, 2)}
                    </pre>
                  </div>
                </div>
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
