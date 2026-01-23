"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, FileText, Phone, User, CheckCircle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface ServiceRequest {
  id: string
  request_number: string
  wa_user_id: string
  status: string
  admin_notes?: string | null
  created_at: string
  citizen_data_json?: Record<string, any>
  requirement_data_json?: Record<string, any>
  service?: {
    id: string
    name: string
    category?: { name: string } | null
  }
}

const statusOptions = [
  { value: "baru", label: "Baru" },
  { value: "proses", label: "Proses" },
  { value: "selesai", label: "Selesai" },
  { value: "ditolak", label: "Ditolak" },
  { value: "dibatalkan", label: "Dibatalkan" },
]

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

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (error || !request) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">Gagal memuat data</CardTitle>
          <CardDescription>{error || "Data tidak ditemukan"}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => router.push("/dashboard/pelayanan")} variant="outline">
            Kembali
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={() => router.push("/dashboard/pelayanan")}
          className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Kembali
        </Button>
        <div>
          <h1 className="text-3xl font-bold text-foreground">Detail Permohonan</h1>
          <p className="text-muted-foreground">Nomor: {request.request_number}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Data Warga
            </CardTitle>
            <CardDescription>Informasi pemohon layanan.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">Nama:</span> {request.citizen_data_json?.nama_lengkap || "-"}</div>
            <div><span className="text-muted-foreground">NIK:</span> {request.citizen_data_json?.nik || "-"}</div>
            <div><span className="text-muted-foreground">Alamat:</span> {request.citizen_data_json?.alamat || "-"}</div>
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{request.wa_user_id}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Informasi Layanan
            </CardTitle>
            <CardDescription>Detail layanan yang diajukan.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">Layanan:</span> {request.service?.name}</div>
            <div><span className="text-muted-foreground">Kategori:</span> {request.service?.category?.name || "-"}</div>
            <div className="flex items-center gap-2">
              <Badge>{request.status}</Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(request.created_at).toLocaleString("id-ID")}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Data Persyaratan</CardTitle>
          <CardDescription>Isian data sesuai kebutuhan layanan.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 text-sm">
          {request.requirement_data_json && Object.keys(request.requirement_data_json).length > 0 ? (
            Object.entries(request.requirement_data_json).map(([key, value]) => (
              <div key={key} className="border rounded-lg p-3">
                <p className="text-xs text-muted-foreground">{key}</p>
                <p className="font-medium break-words">{String(value)}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Tidak ada data persyaratan.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5" />
            Perbarui Status
          </CardTitle>
          <CardDescription>Perbarui status dan catatan admin.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <LabelStatus />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih status" />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <LabelNotes />
            <Textarea
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              placeholder="Catatan untuk warga (opsional)"
              rows={4}
            />
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Menyimpan..." : "Simpan Perubahan"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function LabelStatus() {
  return <p className="text-sm font-medium">Status</p>
}

function LabelNotes() {
  return <p className="text-sm font-medium">Catatan Admin</p>
}
