"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Search, RefreshCw, FileText, User, Phone, CreditCard, ChevronRight, Trash2, Loader2, RotateCcw, Archive } from "lucide-react"
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
        <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Archive className="h-5 w-5" /> Permohonan yang Dihapus
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
              <p>Tidak ada permohonan yang dihapus</p>
            </div>
          ) : (
            <div className="space-y-3">
              {deletedItems.map((item) => (
                <div key={item.id} className="border rounded-lg p-4 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{item.request_number}</span>
                      <Badge className={getStatusBadge(item.status)}>{item.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{item.service?.name || '-'}</p>
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span>{item.citizen_data_json?.nama_lengkap || '-'}</span>
                      <span>{new Date(item.created_at).toLocaleString("id-ID")}</span>
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
