"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select"
import { 
  ArrowLeft, 
  FileText, 
  Phone, 
  User, 
  CheckCircle2, 
  Clock,
  XCircle,
  AlertCircle,
  MapPin,
  CreditCard,
  CalendarDays,
  Send,
  Inbox,
  ClipboardList,
  MessageSquare,
  Loader2
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Separator } from "@/components/ui/separator"

interface ServiceRequest {
  id: string
  request_number: string
  wa_user_id: string
  status: string
  admin_notes?: string | null
  created_at: string
  updated_at?: string
  citizen_data_json?: Record<string, any>
  requirement_data_json?: Record<string, any>
  service?: {
    id: string
    name: string
    category?: { name: string } | null
  }
}

const statusConfig: Record<string, { 
  label: string
  color: string
  bgColor: string
  icon: React.ElementType
  description: string
}> = {
  baru: { 
    label: "Baru", 
    color: "text-blue-700 dark:text-blue-400", 
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
    icon: Inbox,
    description: "Permohonan baru masuk"
  },
  proses: { 
    label: "Proses", 
    color: "text-amber-700 dark:text-amber-400", 
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
    icon: Clock,
    description: "Sedang dalam proses verifikasi"
  },
  selesai: { 
    label: "Selesai", 
    color: "text-green-700 dark:text-green-400", 
    bgColor: "bg-green-100 dark:bg-green-900/30",
    icon: CheckCircle2,
    description: "Permohonan telah selesai"
  },
  ditolak: { 
    label: "Ditolak", 
    color: "text-red-700 dark:text-red-400", 
    bgColor: "bg-red-100 dark:bg-red-900/30",
    icon: XCircle,
    description: "Permohonan ditolak"
  },
  dibatalkan: { 
    label: "Dibatalkan", 
    color: "text-gray-700 dark:text-gray-400", 
    bgColor: "bg-gray-100 dark:bg-gray-800",
    icon: AlertCircle,
    description: "Permohonan dibatalkan"
  },
}

const statusOptions = [
  { value: "baru", label: "Baru" },
  { value: "proses", label: "Proses" },
  { value: "selesai", label: "Selesai" },
  { value: "ditolak", label: "Ditolak" },
  { value: "dibatalkan", label: "Dibatalkan" },
]

const citizenFieldLabels: Record<string, { label: string; icon: React.ElementType }> = {
  nama_lengkap: { label: "Nama Lengkap", icon: User },
  nik: { label: "NIK", icon: CreditCard },
  alamat: { label: "Alamat", icon: MapPin },
  no_hp: { label: "Nomor HP", icon: Phone },
  wa_user_id: { label: "WhatsApp", icon: Phone },
  tempat_lahir: { label: "Tempat Lahir", icon: MapPin },
  tanggal_lahir: { label: "Tanggal Lahir", icon: CalendarDays },
  jenis_kelamin: { label: "Jenis Kelamin", icon: User },
  pekerjaan: { label: "Pekerjaan", icon: User },
  agama: { label: "Agama", icon: User },
  kewarganegaraan: { label: "Kewarganegaraan", icon: User },
  status_perkawinan: { label: "Status Perkawinan", icon: User },
}

export default function ServiceRequestDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { toast } = useToast()

  const [request, setRequest] = useState<ServiceRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState("")
  const [adminNotes, setAdminNotes] = useState("")
  const [saving, setSaving] = useState(false)

  const fetchRequest = async (id: string) => {
    try {
      setLoading(true)
      const response = await fetch(`/api/service-requests/${id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || "Permohonan tidak ditemukan")
      }
      const data = await response.json()
      const payload = data.data || data
      setRequest(payload)
      setStatus(payload.status || "baru")
      setAdminNotes(payload.admin_notes || "")
      setError(null)
    } catch (err: any) {
      setError(err.message || "Gagal memuat permohonan")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (params?.id) {
      fetchRequest(params.id as string)
    }
  }, [params])

  const handleSave = async () => {
    if (!request) return
    setSaving(true)
    try {
      const response = await fetch(`/api/service-requests/${request.id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ status, admin_notes: adminNotes }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || "Gagal menyimpan status")
      }

      toast({
        title: "Status diperbarui",
        description: "Status permohonan layanan berhasil disimpan.",
      })
      await fetchRequest(request.id)
    } catch (err: any) {
      toast({
        title: "Gagal",
        description: err.message || "Gagal menyimpan status",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const getStatusBadge = (statusKey: string) => {
    const config = statusConfig[statusKey] || statusConfig.baru
    const Icon = config.icon
    return (
      <Badge className={`${config.bgColor} ${config.color} border-0 gap-1.5 px-3 py-1`}>
        <Icon className="h-3.5 w-3.5" />
        {config.label}
      </Badge>
    )
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    })
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    )
  }

  if (error || !request) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Gagal memuat data
          </CardTitle>
          <CardDescription>{error || "Data tidak ditemukan"}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => router.push("/dashboard/pelayanan")} variant="outline" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Kembali
          </Button>
        </CardContent>
      </Card>
    )
  }

  const currentStatusConfig = statusConfig[request.status] || statusConfig.baru
  const StatusIcon = currentStatusConfig.icon

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push("/dashboard/pelayanan")} className="rounded-full">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">{request.request_number}</h1>
              {getStatusBadge(request.status)}
            </div>
            <p className="text-muted-foreground text-sm mt-1">
              {request.service?.name}
              {request.service?.category?.name && ` - ${request.service.category.name}`}
            </p>
          </div>
        </div>
      </div>

      <Card className={`${currentStatusConfig.bgColor} border-0`}>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-background/50">
              <StatusIcon className={`h-5 w-5 ${currentStatusConfig.color}`} />
            </div>
            <div>
              <p className={`font-medium ${currentStatusConfig.color}`}>Status: {currentStatusConfig.label}</p>
              <p className="text-sm text-muted-foreground">{currentStatusConfig.description}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Data Pemohon</CardTitle>
                  <CardDescription>Informasi warga yang mengajukan permohonan</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                {request.citizen_data_json && Object.keys(request.citizen_data_json).length > 0 ? (
                  Object.entries(request.citizen_data_json).map(([key, value]) => {
                    if (!value) return null
                    const fieldConfig = citizenFieldLabels[key] || { label: key, icon: User }
                    const Icon = fieldConfig.icon
                    return (
                      <div key={key} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                        <Icon className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">{fieldConfig.label}</p>
                          <p className="font-medium break-words">{String(value)}</p>
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <p className="text-muted-foreground col-span-2">Tidak ada data pemohon</p>
                )}
                <div className="flex items-start gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/20">
                  <Phone className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">WhatsApp</p>
                    <p className="font-medium text-green-700 dark:text-green-400">{request.wa_user_id}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10">
                  <ClipboardList className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <CardTitle className="text-lg">Data Persyaratan</CardTitle>
                  <CardDescription>Isian data sesuai kebutuhan layanan</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {request.requirement_data_json && Object.keys(request.requirement_data_json).length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {Object.entries(request.requirement_data_json).map(([key, value]) => (
                    <div key={key} className="p-3 rounded-lg border bg-muted/30">
                      <p className="text-xs text-muted-foreground mb-1">{key}</p>
                      <p className="font-medium break-words">{String(value)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <FileText className="h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-muted-foreground">Tidak ada data persyaratan</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <CalendarDays className="h-5 w-5 text-blue-600" />
                </div>
                <CardTitle className="text-lg">Informasi Waktu</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground">Tanggal Pengajuan</p>
                <p className="text-sm font-medium">{formatDate(request.created_at)}</p>
              </div>
              {request.updated_at && request.updated_at !== request.created_at && (
                <div>
                  <p className="text-xs text-muted-foreground">Terakhir Diupdate</p>
                  <p className="text-sm font-medium">{formatDate(request.updated_at)}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Send className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Perbarui Status</CardTitle>
                  <CardDescription>Ubah status dan tambah catatan</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih status" />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((opt) => {
                      const config = statusConfig[opt.value]
                      const Icon = config?.icon || Inbox
                      return (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div className="flex items-center gap-2">
                            <Icon className={`h-4 w-4 ${config?.color}`} />
                            {opt.label}
                          </div>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Catatan Admin
                </Label>
                <Textarea
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  placeholder="Catatan untuk warga (opsional)"
                  rows={4}
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground">Catatan ini akan dikirim ke warga melalui WhatsApp</p>
              </div>
              <Button onClick={handleSave} disabled={saving} className="w-full gap-2">
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Menyimpan...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Simpan Perubahan
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
