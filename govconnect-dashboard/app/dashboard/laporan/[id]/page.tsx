"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { AlertCircle, ArrowLeft, CheckCircle, Loader2, MapPin, MessageSquare, Phone, Calendar, Image, Printer, Globe, User } from "lucide-react"
import { laporan } from "@/lib/frontend-api"
import { formatDate, formatStatus, getStatusColor } from "@/lib/utils"
import { printReceipt } from "@/lib/export-utils"

interface ComplaintUpdate {
  id: string
  note_text: string
  image_url?: string | null
  created_at: string
}

interface Complaint {
  id: string
  complaint_id: string
  wa_user_id: string
  channel?: 'WHATSAPP' | 'WEBCHAT'
  channel_identifier?: string
  kategori: string
  deskripsi: string
  alamat?: string
  rt_rw?: string
  foto_url?: string
  status: string
  reporter_name?: string
  reporter_phone?: string
  created_at: string
  updated_at: string
  updates?: ComplaintUpdate[]
}

export default function LaporanDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [complaint, setComplaint] = useState<Complaint | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const [newStatus, setNewStatus] = useState("")
  const [adminNotes, setAdminNotes] = useState("")
  const [updateNote, setUpdateNote] = useState("")
  const [updateImageUrl, setUpdateImageUrl] = useState("")
  const [savingUpdate, setSavingUpdate] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)

  useEffect(() => {
    if (params.id) {
      fetchComplaintDetail(params.id as string)
    }
  }, [params.id])

  const fetchComplaintDetail = async (id: string) => {
    try {
      setLoading(true)
      const data = await laporan.getById(id)
      setComplaint(data)
      setNewStatus(data.status)
      setError(null)
    } catch (err: any) {
      setError(err.message || "Gagal memuat detail pengaduan")
    } finally {
      setLoading(false)
    }
  }

  const uploadAdminImage = async (file: File) => {
    const formData = new FormData()
    formData.append("file", file)

    const response = await fetch("/api/uploads", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
      body: formData,
    })

    if (!response.ok) {
      const err = await response.json().catch(() => null)
      throw new Error(err?.error || "Gagal mengunggah foto")
    }

    const data = await response.json()
    const url = data?.data?.url
    if (!url) throw new Error("Gagal mengunggah foto")
    return url as string
  }

  const handleUpdateStatus = async () => {
    if (!complaint || !newStatus) return

    try {
      setUpdating(true)
      await laporan.updateStatus(complaint.id, {
        status: newStatus,
        admin_notes: adminNotes || undefined,
      })
      
      // Refresh data
      await fetchComplaintDetail(complaint.id)
      setAdminNotes("")
      setError(null)
    } catch (err: any) {
      setError(err.message || "Gagal memperbarui status")
    } finally {
      setUpdating(false)
    }
  }

  const handleCreateUpdate = async () => {
    if (!complaint || !updateNote.trim()) return

    try {
      setSavingUpdate(true)
      const response = await fetch(`/api/laporan/${complaint.id}/updates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          note_text: updateNote.trim(),
          image_url: updateImageUrl.trim() || null,
        }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || "Gagal menambahkan update")
      }

      await fetchComplaintDetail(complaint.id)
      setUpdateNote("")
      setUpdateImageUrl("")
      setError(null)
    } catch (err: any) {
      setError(err.message || "Gagal menambahkan update")
    } finally {
      setSavingUpdate(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error || !complaint) {
    return (
      <div className="space-y-6">
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Kembali
        </Button>
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Gagal Memuat Data
            </CardTitle>
            <CardDescription>{error || "Pengaduan tidak ditemukan"}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => fetchComplaintDetail(params.id as string)} variant="outline">
              Coba Lagi
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Kembali
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{complaint.complaint_id}</h1>
            <p className="text-sm text-muted-foreground">Detail Pengaduan Warga</p>
          </div>
        </div>
        <Button variant="outline" onClick={() => printReceipt(complaint)}>
          <Printer className="mr-2 h-4 w-4" />
          Cetak Bukti
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Informasi Pengaduan</CardTitle>
              <CardDescription>Detail lengkap pengaduan dari warga</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Nomor Pengaduan</Label>
                  <p className="font-mono font-semibold text-foreground">{complaint.complaint_id}</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground flex items-center gap-2">
                    {(complaint.channel || 'WHATSAPP') === 'WHATSAPP' ? (
                      <><Phone className="h-4 w-4" /> WhatsApp</>
                    ) : (
                      <><Globe className="h-4 w-4" /> Webchat</>
                    )}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={(complaint.channel || 'WHATSAPP') === 'WHATSAPP' 
                      ? 'bg-green-50 text-green-700 border-green-200' 
                      : 'bg-blue-50 text-blue-700 border-blue-200'
                    }>
                      {(complaint.channel || 'WHATSAPP') === 'WHATSAPP' ? 'WhatsApp' : 'Webchat'}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Reporter info */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-muted-foreground flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Nama Pelapor
                  </Label>
                  <p className="text-foreground">
                    {complaint.reporter_name || <span className="text-muted-foreground italic">Belum diketahui</span>}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    No. Telepon Pelapor
                  </Label>
                  <p className="font-mono text-foreground">
                    {complaint.reporter_phone || complaint.wa_user_id || <span className="text-muted-foreground italic">Belum diketahui</span>}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">Kategori</Label>
                <Badge variant="outline" className="capitalize text-base px-3 py-1">
                  {complaint.kategori.replace(/_/g, " ")}
                </Badge>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Deskripsi
                </Label>
                <p className="text-foreground bg-muted p-4 rounded-md">{complaint.deskripsi}</p>
              </div>

              {complaint.foto_url && (() => {
                // Parse foto_url: single URL string or JSON array of URLs
                let fotoUrls: string[] = [];
                try {
                  if (complaint.foto_url!.startsWith('[')) {
                    fotoUrls = JSON.parse(complaint.foto_url!);
                  } else {
                    fotoUrls = [complaint.foto_url!];
                  }
                } catch {
                  fotoUrls = [complaint.foto_url!];
                }
                return (
                <div className="space-y-2">
                  <Label className="text-muted-foreground flex items-center gap-2">
                    <Image className="h-4 w-4" />
                    Foto Pengaduan {fotoUrls.length > 1 && `(${fotoUrls.length} foto)`}
                  </Label>
                  <div className={`grid gap-2 ${fotoUrls.length > 1 ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-1'}`}>
                    {fotoUrls.map((url, idx) => (
                      <div key={idx} className="relative rounded-lg overflow-hidden border bg-muted">
                        <img 
                          src={url} 
                          alt={`Foto pengaduan ${fotoUrls.length > 1 ? idx + 1 : ''}`}
                          className="w-full max-h-96 object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                            (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                          }}
                        />
                        <div className="hidden p-4 text-center text-muted-foreground">
                          <Image className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p>Foto tidak dapat dimuat</p>
                        </div>
                        <a 
                          href={url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="absolute bottom-1 right-1 text-xs bg-black/50 text-white px-2 py-1 rounded hover:bg-black/70"
                        >
                          Buka
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
                );
              })()}

              {complaint.alamat && (
                <div className="space-y-2">
                  <Label className="text-muted-foreground flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Alamat
                  </Label>
                  <p className="text-foreground">{complaint.alamat}</p>
                  {complaint.rt_rw && (
                    <p className="text-sm text-muted-foreground">{complaint.rt_rw}</p>
                  )}
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2 pt-4 border-t">
                <div className="space-y-2">
                  <Label className="text-muted-foreground flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Dibuat
                  </Label>
                  <p className="text-sm text-foreground">{formatDate(complaint.created_at)}</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Diupdate
                  </Label>
                  <p className="text-sm text-foreground">{formatDate(complaint.updated_at)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Status Pengaduan</CardTitle>
              <CardDescription>Update status penanganan</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Status Saat Ini</Label>
                <Badge className={`${getStatusColor(complaint.status)} text-base px-3 py-1 w-full justify-center`}>
                  {formatStatus(complaint.status)}
                </Badge>
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">Ubah Status</Label>
                <Select value={newStatus} onValueChange={setNewStatus}>
                  <SelectTrigger id="status">
                    <SelectValue placeholder="Pilih status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OPEN">Baru</SelectItem>
                    <SelectItem value="PROCESS">Proses</SelectItem>
                    <SelectItem value="DONE">Selesai</SelectItem>
                    <SelectItem value="CANCELED">Dibatalkan</SelectItem>
                    <SelectItem value="REJECT">Ditolak</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Catatan Admin (Opsional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Tambahkan catatan untuk warga..."
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  rows={4}
                />
              </div>

              <Button
                onClick={handleUpdateStatus}
                disabled={updating || newStatus === complaint.status}
                className="w-full"
              >
                {updating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Memperbarui...
                  </>
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Perbarui Status
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Update Penanganan</CardTitle>
              <CardDescription>Catatan perkembangan dan dokumentasi penanganan.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="updateNote">Catatan Penanganan</Label>
                <Textarea
                  id="updateNote"
                  placeholder="Tulis progres penanganan atau hasil tindak lanjut..."
                  value={updateNote}
                  onChange={(e) => setUpdateNote(e.target.value)}
                  rows={4}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="updateImage">Foto Penanganan (Opsional)</Label>
                <Input
                  id="updateImage"
                  type="file"
                  accept="image/jpeg,image/png"
                  disabled={uploadingImage}
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return

                    try {
                      setUploadingImage(true)
                      const url = await uploadAdminImage(file)
                      setUpdateImageUrl(url)
                      setError(null)
                    } catch (err: any) {
                      setUpdateImageUrl("")
                      setError(err.message || "Gagal mengunggah foto")
                    } finally {
                      setUploadingImage(false)
                      e.target.value = ""
                    }
                  }}
                />
                {updateImageUrl ? (
                  <p className="text-xs text-muted-foreground">Foto berhasil diunggah.</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Format: JPG/PNG, maks 5MB.</p>
                )}
              </div>
              <Button onClick={handleCreateUpdate} disabled={savingUpdate || uploadingImage || !updateNote.trim()}>
                {savingUpdate ? "Menyimpan..." : uploadingImage ? "Mengunggah foto..." : "Simpan Update"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat Update Penanganan</CardTitle>
          <CardDescription>Daftar update yang sudah dikirim ke warga.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {complaint.updates && complaint.updates.length > 0 ? (
            complaint.updates.map((update) => (
              <div key={update.id} className="border rounded-lg p-4 space-y-2">
                <p className="text-sm text-muted-foreground">
                  {formatDate(update.created_at)}
                </p>
                <p className="text-sm text-foreground whitespace-pre-line">{update.note_text}</p>
                {update.image_url && (
                  <a
                    href={update.image_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-secondary hover:underline"
                  >
                    Lihat Foto Penanganan
                  </a>
                )}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Belum ada update penanganan.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
