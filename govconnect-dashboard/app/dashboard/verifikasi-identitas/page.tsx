"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
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
import { Badge } from "@/components/ui/badge"
import { Eye, ShieldCheck, RefreshCw } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { formatDateTime } from "@/lib/utils"

interface KtpItem {
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

const STATUS_META: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Menunggu", variant: "default" },
  approved: { label: "Disetujui", variant: "secondary" },
  rejected: { label: "Ditolak", variant: "destructive" },
}

export default function VerifikasiIdentitasPage() {
  const { toast } = useToast()
  const [items, setItems] = useState<KtpItem[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [status, setStatus] = useState("pending")
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/ktp-verifications?status=${status}&limit=50`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "gagal memuat")
      setItems(data.items ?? [])
      setPendingCount(data.pendingCount ?? 0)
    } catch (err: any) {
      toast({ title: "Gagal memuat antrean", description: String(err?.message ?? err), variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [status])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6" /> Verifikasi Identitas
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Tinjau foto KTP yang dikirim warga — setujui atau tolak secara manual.
            {pendingCount > 0 && (
              <> <span className="font-semibold text-amber-600">{pendingCount} menunggu</span> keputusan.</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Menunggu</SelectItem>
              <SelectItem value="approved">Disetujui</SelectItem>
              <SelectItem value="rejected">Ditolak</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={load} title="Muat ulang">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Antrean verifikasi</CardTitle>
          <CardDescription>
            Foto hanya tersimpan sampai ada keputusan — setelah disetujui/ditolak, foto dihapus otomatis.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">
              {status === "pending"
                ? "Tidak ada permintaan verifikasi yang menunggu. 🎉"
                : "Belum ada data pada status ini."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu kirim</TableHead>
                  <TableHead>ID Warga</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Direview oleh</TableHead>
                  <TableHead>Waktu review</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => {
                  const meta = STATUS_META[it.status]
                  return (
                    <TableRow key={it.id}>
                      <TableCell className="whitespace-nowrap">{formatDateTime(it.created_at)}</TableCell>
                      <TableCell className="font-mono text-xs">{it.user_id}</TableCell>
                      <TableCell><Badge variant={meta.variant}>{meta.label}</Badge></TableCell>
                      <TableCell>{it.reviewed_by || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {it.reviewed_at ? formatDateTime(it.reviewed_at) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/dashboard/verifikasi-identitas/${it.id}`}>
                            <Eye className="h-3.5 w-3.5 mr-1" /> Tinjau
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
