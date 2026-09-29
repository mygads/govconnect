"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  ArrowLeft, ZoomIn, ZoomOut, RotateCcw, Check, X, Loader2, ShieldCheck,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { formatDateTime } from "@/lib/utils"

interface KtpDetail {
  id: string
  user_id: string
  status: "pending" | "approved" | "rejected"
  reviewed_by: string
  reviewed_at: string | null
  reject_reason: string
  created_at: string
  has_photo: boolean
  fields: Record<string, string>
}

function validateFields(f: Record<string, string>): Record<string, string> {
  const errs: Record<string, string> = {}
  const nik = (f.nik ?? "").replace(/\D/g, "")
  if (nik.length !== 16) errs.nik = "NIK harus 16 digit angka."
  if ((f.nama ?? "").trim().length < 3) errs.nama = "Nama minimal 3 huruf."
  const ttl = (f.tanggal_lahir ?? "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ttl)) {
    errs.tanggal_lahir = "Format YYYY-MM-DD (contoh: 1990-05-17)."
  } else {
    const d = new Date(ttl + "T00:00:00")
    if (Number.isNaN(d.getTime())) errs.tanggal_lahir = "Tanggal tidak valid."
    else if (d > new Date()) errs.tanggal_lahir = "Tidak boleh di masa depan."
  }
  return errs
}

export default function VerifikasiIdentitasDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { toast } = useToast()
  const id = String(params.id)

  const [item, setItem] = useState<KtpDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [fields, setFields] = useState({ nik: "", nama: "", tempat_lahir: "", tanggal_lahir: "", alamat: "" })
  const [touched, setTouched] = useState(false)
  // Decrypt-on-view for decided rows: NIK is stored as a vault token, resolved here (audited server-side).
  const [viewNik, setViewNik] = useState<string | null>(null)
  const [nikExpired, setNikExpired] = useState(false)
  const [nikLoading, setNikLoading] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState("")
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/ktp-verifications/${encodeURIComponent(id)}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error ?? "gagal memuat")
        setItem(data.item)
        setFields({
          nik: data.item.fields?.nik ?? "",
          nama: data.item.fields?.nama ?? "",
          tempat_lahir: data.item.fields?.tempat_lahir ?? "",
          tanggal_lahir: data.item.fields?.tanggal_lahir ?? "",
          alamat: data.item.fields?.alamat ?? "",
        })
        // Decided rows keep only a vault token: resolve on view (server audits the view).
        const token = (data.item.fields as any)?.nik_token as string | undefined
        const legacyNik = (data.item.fields as any)?.nik as string | undefined
        if (token) {
          setNikLoading(true)
          try {
            const r = await fetch(`/api/ktp-verifications/${encodeURIComponent(id)}/nik`)
            const d = await r.json()
            if (r.ok && d.nik) setViewNik(d.nik)
            else setNikExpired(true)
          } catch {
            setNikExpired(true) // graceful: never break the page on resolve failure
          } finally {
            setNikLoading(false)
          }
        } else if (legacyNik) {
          setViewNik(legacyNik) // pre-vault row
        }
      } catch (err: any) {
        toast({ title: "Gagal memuat", description: String(err?.message ?? err), variant: "destructive" })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  const errors = validateFields(fields)
  const isValid = Object.keys(errors).length === 0
  const isPending = item?.status === "pending"

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setFields((f) => ({ ...f, [k]: e.target.value }))
    setTouched(true)
  }

  const doApprove = async () => {
    setTouched(true)
    if (!isValid) {
      toast({ title: "Periksa isian", description: "Ada field yang belum valid.", variant: "destructive" })
      return
    }
    setSubmitting("approve")
    try {
      const res = await fetch(`/api/ktp-verifications/${encodeURIComponent(id)}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fields }),
      })
      const data = await res.json()
      if (!res.ok) {
        const msg = data?.validationErrors?.join(" ") ?? data?.error ?? "gagal menyetujui"
        throw new Error(msg)
      }
      toast({ title: "Disetujui", description: "Identitas warga terverifikasi (L2). Warga sudah diberi tahu." })
      router.push("/dashboard/verifikasi-identitas")
    } catch (err: any) {
      toast({ title: "Gagal", description: String(err?.message ?? err), variant: "destructive" })
    } finally {
      setSubmitting(null)
    }
  }

  const doReject = async () => {
    if (!rejectReason.trim()) {
      toast({ title: "Alasan wajib diisi", description: "Tulis alasan penolakan untuk warga.", variant: "destructive" })
      return
    }
    setSubmitting("reject")
    try {
      const res = await fetch(`/api/ktp-verifications/${encodeURIComponent(id)}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "gagal menolak")
      toast({ title: "Ditolak", description: "Warga diminta mengirim ulang foto KTP." })
      router.push("/dashboard/verifikasi-identitas")
    } catch (err: any) {
      toast({ title: "Gagal", description: String(err?.message ?? err), variant: "destructive" })
    } finally {
      setSubmitting(null)
      setRejectOpen(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid md:grid-cols-2 gap-4">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    )
  }

  if (!item) {
    return (
      <div className="space-y-4">
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/verifikasi-identitas"><ArrowLeft className="h-4 w-4 mr-1" /> Kembali</Link>
        </Button>
        <p className="text-muted-foreground">Data tidak ditemukan.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/verifikasi-identitas"><ArrowLeft className="h-4 w-4 mr-1" /> Antrean</Link>
        </Button>
        <Badge variant={item.status === "pending" ? "default" : item.status === "approved" ? "secondary" : "destructive"}>
          {item.status === "pending" ? "Menunggu" : item.status === "approved" ? "Disetujui" : "Ditolak"}
        </Badge>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Foto */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" /> Foto KTP
            </CardTitle>
            <CardDescription>
              Dikirim {formatDateTime(item.created_at)} oleh <span className="font-mono text-xs">{item.user_id}</span>.
              Foto dihapus otomatis setelah ada keputusan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))} title="Perbesar">
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} title="Perkecil">
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={() => setZoom(1)} title="Reset">
                <RotateCcw className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground ml-1">{Math.round(zoom * 100)}%</span>
            </div>
            <div className="overflow-auto border rounded-md bg-muted/30 max-h-[70vh] flex items-start justify-center">
              {item.has_photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/ktp-verifications/${encodeURIComponent(id)}/photo`}
                  alt="Foto KTP warga"
                  style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
                  className="max-w-full transition-transform"
                  draggable={false}
                />
              ) : (
                <p className="text-sm text-muted-foreground py-12">
                  Foto sudah dihapus (keputusan telah dibuat).
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Data identitas</CardTitle>
            <CardDescription>
              Salin dari foto KTP di sebelah kiri. Validasi berjalan otomatis saat mengetik.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="nik">NIK (16 digit)</Label>
              {isPending ? (
                <>
                  <Input id="nik" inputMode="numeric" placeholder="3201010101900001"
                    value={fields.nik} onChange={set("nik")} disabled={!isPending} maxLength={16} />
                  {touched && errors.nik && <p className="text-xs text-destructive">{errors.nik}</p>}
                </>
              ) : nikLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : nikExpired ? (
                <p className="text-xs text-muted-foreground border rounded-md px-3 py-2.5">
                  NIK kedaluwarsa di vault — warga perlu verifikasi ulang bila NIK dibutuhkan lagi.
                </p>
              ) : (
                <Input id="nik" value={viewNik ?? ""} disabled readOnly className="font-mono"
                  placeholder="—" title="NIK terverifikasi (tersimpan di vault)" />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nama">Nama lengkap</Label>
              <Input id="nama" placeholder="Sesuai KTP" value={fields.nama} onChange={set("nama")} disabled={!isPending} />
              {touched && errors.nama && <p className="text-xs text-destructive">{errors.nama}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tempat_lahir">Tempat lahir</Label>
                <Input id="tempat_lahir" placeholder="Kota" value={fields.tempat_lahir} onChange={set("tempat_lahir")} disabled={!isPending} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tanggal_lahir">Tanggal lahir</Label>
                <Input id="tanggal_lahir" type="date" value={fields.tanggal_lahir} onChange={set("tanggal_lahir")} disabled={!isPending} />
                {touched && errors.tanggal_lahir && <p className="text-xs text-destructive">{errors.tanggal_lahir}</p>}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="alamat">Alamat</Label>
              <Textarea id="alamat" placeholder="Sesuai KTP" value={fields.alamat} onChange={(e) => { setFields((f) => ({ ...f, alamat: e.target.value })); setTouched(true) }} disabled={!isPending} rows={2} />
            </div>

            {isPending ? (
              <div className="flex gap-2 pt-2">
                <Button onClick={doApprove} disabled={submitting !== null} className="flex-1">
                  {submitting === "approve" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                  Setujui
                </Button>
                <Button variant="destructive" onClick={() => setRejectOpen(true)} disabled={submitting !== null} className="flex-1">
                  <X className="h-4 w-4 mr-1" /> Tolak
                </Button>
              </div>
            ) : (
              <div className="rounded-md border p-3 text-sm space-y-1 bg-muted/40">
                <p><span className="text-muted-foreground">Direview oleh:</span> <span className="font-medium">{item.reviewed_by || "—"}</span></p>
                <p><span className="text-muted-foreground">Waktu review:</span> {item.reviewed_at ? formatDateTime(item.reviewed_at) : "—"}</p>
                {item.status === "rejected" && item.reject_reason && (
                  <p><span className="text-muted-foreground">Alasan:</span> {item.reject_reason}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tolak verifikasi</DialogTitle>
            <DialogDescription>
              Alasan wajib diisi — akan dikirim ke warga agar mereka tahu apa yang perlu diperbaiki.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Contoh: foto blur, KTP terpotong, bukan foto KTP…"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Batal</Button>
            <Button variant="destructive" onClick={doReject} disabled={submitting !== null || !rejectReason.trim()}>
              {submitting === "reject" && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Tolak & beri tahu warga
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
