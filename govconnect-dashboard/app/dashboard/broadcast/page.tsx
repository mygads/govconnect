"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Megaphone, RefreshCw, Send, Check, X, Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth/AuthContext"
import { formatDateTime } from "@/lib/utils"

interface Draft {
  id: string
  village_id: string
  message: string
  recipients: string[]
  created_by: string
  created_at: string
  status: "draft" | "approved" | "rejected" | "sent"
  approved_by: string | null
  approved_at: string | null
  reject_note: string | null
  sent_at: string | null
  send_result: any
}

const STATUS_META: Record<Draft["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "Draft", variant: "outline" },
  approved: { label: "Disetujui", variant: "secondary" },
  rejected: { label: "Ditolak", variant: "destructive" },
  sent: { label: "Terkirim", variant: "default" },
}

export default function BroadcastPage() {
  const { toast } = useToast()
  const { user } = useAuth()
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [loading, setLoading] = useState(true)

  const [message, setMessage] = useState("")
  const [recipients, setRecipients] = useState("")
  const [creating, setCreating] = useState(false)

  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectNote, setRejectNote] = useState("")
  const [acting, setActing] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/broadcast/drafts")
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "gagal memuat")
      setDrafts(data.drafts ?? [])
    } catch (err: any) {
      toast({ title: "Gagal memuat draft", description: String(err?.message ?? err), variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const createDraft = async () => {
    setCreating(true)
    try {
      const res = await fetch("/api/broadcast/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          recipients: recipients.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "gagal membuat draft")
      toast({ title: "Draft tersimpan", description: "Draft harus di-approve oleh admin lain sebelum dikirim." })
      setMessage("")
      setRecipients("")
      load()
    } catch (err: any) {
      toast({ title: "Gagal membuat draft", description: String(err?.message ?? err), variant: "destructive" })
    } finally {
      setCreating(false)
    }
  }

  const act = async (id: string, action: "approve" | "reject" | "send", note?: string) => {
    setActing(`${action}:${id}`)
    try {
      const res = await fetch(`/api/broadcast/drafts/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note ?? "" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "gagal")
      toast({ title: action === "approve" ? "Draft disetujui" : action === "reject" ? "Draft ditolak" : "Broadcast terkirim" })
      load()
    } catch (err: any) {
      toast({ title: "Aksi gagal", description: String(err?.message ?? err), variant: "destructive" })
    } finally {
      setActing(null)
      setRejectId(null)
      setRejectNote("")
    }
  }

  const me = user?.username ?? ""

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Megaphone className="h-6 w-6" /> Broadcast WhatsApp
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Alur 2 langkah: draft dibuat satu admin, <strong>harus di-approve admin lain</strong> sebelum dikirim.
          Hanya warga yang sudah opt-in yang menerima (yang lain di-skip dan dicatat).
        </p>
      </div>

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Antrean Draft</TabsTrigger>
          <TabsTrigger value="new">Buat Draft Baru</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Antrean</CardTitle>
                  <CardDescription>Draft → approve (admin lain) → kirim.</CardDescription>
                </div>
                <Button variant="outline" size="icon" onClick={load} title="Muat ulang">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : drafts.length === 0 ? (
                <p className="text-muted-foreground text-sm py-8 text-center">Belum ada draft broadcast.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pesan</TableHead>
                      <TableHead>Penerima</TableHead>
                      <TableHead>Dibuat oleh</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Approve oleh</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drafts.map((d) => {
                      const meta = STATUS_META[d.status]
                      const busy = acting?.endsWith(d.id)
                      const ownDraft = d.created_by === me
                      return (
                        <TableRow key={d.id}>
                          <TableCell className="max-w-70">
                            <div className="truncate text-sm" title={d.message}>{d.message}</div>
                            <div className="text-xs text-muted-foreground">{formatDateTime(d.created_at)}</div>
                          </TableCell>
                          <TableCell>{d.recipients.length} warga</TableCell>
                          <TableCell className="text-sm">{d.created_by}</TableCell>
                          <TableCell><Badge variant={meta.variant}>{meta.label}</Badge></TableCell>
                          <TableCell className="text-sm">{d.approved_by ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              {d.status === "draft" && (
                                <>
                                  <Button
                                    size="sm" variant="outline"
                                    disabled={busy || ownDraft}
                                    title={ownDraft ? "Tidak bisa approve draft sendiri" : "Approve"}
                                    onClick={() => act(d.id, "approve")}
                                  >
                                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                                    Approve
                                  </Button>
                                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRejectId(d.id)}>
                                    <X className="h-3.5 w-3.5 mr-1" /> Tolak
                                  </Button>
                                </>
                              )}
                              {d.status === "approved" && (
                                <Button size="sm" disabled={busy} onClick={() => act(d.id, "send")}>
                                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                                  Kirim
                                </Button>
                              )}
                              {d.status === "sent" && d.send_result && (
                                <span className="text-xs text-muted-foreground">
                                  terkirim {d.send_result.sent ?? "?"}/{d.send_result.requested ?? "?"}
                                </span>
                              )}
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

        <TabsContent value="new" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Draft broadcast baru</CardTitle>
              <CardDescription>
                Tulis pesan dan daftar user_id warga penerima (satu per baris). Setelah disimpan,
                draft <strong>tidak bisa langsung dikirim</strong> — menunggu approve admin lain.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="msg">Isi pesan</Label>
                <Textarea
                  id="msg"
                  rows={5}
                  maxLength={4000}
                  placeholder="Contoh: Yth. warga, posyandu bulan ini dilaksanakan Sabtu, 4 Oktober 2026 pukul 08.00 di balai desa…"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{message.length}/4000 karakter</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rcp">Penerima (user_id / nomor WA, satu per baris)</Label>
                <Textarea
                  id="rcp"
                  rows={4}
                  placeholder={"6281234567890\n6289876543210"}
                  value={recipients}
                  onChange={(e) => setRecipients(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Hanya warga yang sudah opt-in broadcast yang benar-benar menerima; sisanya di-skip otomatis dan dicatat di audit.
                </p>
              </div>
              <Button onClick={createDraft} disabled={creating || message.trim().length < 5}>
                {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Simpan sebagai draft
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={rejectId !== null} onOpenChange={(o) => !o && setRejectId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tolak draft</DialogTitle>
            <DialogDescription>Berikan alasan penolakan (opsional, tercatat).</DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Alasan penolakan…"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectId(null)}>Batal</Button>
            <Button
              variant="destructive"
              disabled={acting !== null}
              onClick={() => rejectId && act(rejectId, "reject", rejectNote)}
            >
              Tolak draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
