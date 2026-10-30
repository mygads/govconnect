"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Lightbulb, RefreshCw, Check, X, Loader2, Eye } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { formatDateTime } from "@/lib/utils"

interface Proposal {
  id: string
  villageId: string
  type: string
  title: string
  draft: string
  dedupeKey: string
  status: "pending" | "approved" | "rejected" | "published" | "withdrawn"
  source: Record<string, unknown>
  createdBy: string
  createdAt: string
  reviewedBy?: string | null
  reviewedAt?: string | null
  reviewNote?: string | null
}

const TYPE_LABEL: Record<string, string> = {
  content_gap: "Konten kurang",
  data_gap: "Data kurang",
  action_gap: "Aksi kurang",
}

const STATUS_META: Record<Proposal["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Menunggu", variant: "default" },
  approved: { label: "Disetujui", variant: "secondary" },
  rejected: { label: "Ditolak", variant: "destructive" },
  published: { label: "Dipublish", variant: "default" },
  withdrawn: { label: "Ditarik", variant: "outline" },
}

export default function ProposalKbPage() {
  const { toast } = useToast()
  const [items, setItems] = useState<Proposal[]>([])
  const [status, setStatus] = useState("pending")
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<Proposal | null>(null)
  const [note, setNote] = useState("")
  const [acting, setActing] = useState<"approve" | "reject" | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/kb-proposals?status=${status}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "gagal memuat")
      setItems(data.proposals ?? [])
    } catch (err: any) {
      toast({ title: "Gagal memuat proposal", description: String(err?.message ?? err), variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (kind: "approve" | "reject") => {
    if (!detail) return
    setActing(kind)
    try {
      const res = await fetch(`/api/kb-proposals/${encodeURIComponent(detail.id)}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "gagal")
      toast({
        title: kind === "approve" ? "Proposal disetujui" : "Proposal ditolak",
        description: kind === "approve" ? "Disetujui sebagai draft — TIDAK otomatis publish ke KB." : undefined,
      })
      setDetail(null)
      setNote("")
      load()
    } catch (err: any) {
      toast({ title: "Aksi gagal", description: String(err?.message ?? err), variant: "destructive" })
    } finally {
      setActing(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Lightbulb className="h-6 w-6" /> Proposal Knowledge Base
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Saran perbaikan basis pengetahuan dari AI (R5) — setujui atau tolak secara manual.
            Persetujuan <strong>tidak</strong> otomatis mempublish ke KB.
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
              <SelectItem value="published">Dipublish</SelectItem>
              <SelectItem value="withdrawn">Ditarik</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={load} title="Muat ulang">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Antrean proposal</CardTitle>
          <CardDescription>Dibuat otomatis dari event audit 7 hari terakhir — review manusia wajib.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">Tidak ada proposal pada status ini.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dibuat</TableHead>
                  <TableHead>Judul</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Direview oleh</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => {
                  const meta = STATUS_META[p.status]
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap text-sm">{formatDateTime(p.createdAt)}</TableCell>
                      <TableCell className="font-medium max-w-80">
                        <div className="truncate" title={p.title}>{p.title}</div>
                        <div className="text-xs text-muted-foreground font-mono truncate">{p.id}</div>
                      </TableCell>
                      <TableCell><Badge variant="outline">{TYPE_LABEL[p.type] ?? p.type}</Badge></TableCell>
                      <TableCell><Badge variant={meta.variant}>{meta.label}</Badge></TableCell>
                      <TableCell className="text-sm">{p.reviewedBy ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => { setDetail(p); setNote("") }}>
                          <Eye className="h-3.5 w-3.5 mr-1" /> Tinjau
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

      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail?.title}</DialogTitle>
            <DialogDescription>
              {detail && <><Badge variant="outline" className="mr-2">{TYPE_LABEL[detail.type] ?? detail.type}</Badge>
              dibuat {formatDateTime(detail.createdAt)} oleh {detail.createdBy}</>}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground">ISI DRAFT PROPOSAL</Label>
                <pre className="mt-1 whitespace-pre-wrap text-sm bg-muted rounded-md p-3 max-h-80 overflow-y-auto">
                  {detail.draft}
                </pre>
              </div>
              {detail.status === "pending" && (
                <div className="space-y-1">
                  <Label htmlFor="note">Catatan review (opsional)</Label>
                  <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan untuk proposal ini…" />
                </div>
              )}
              {detail.reviewNote && (
                <p className="text-sm text-muted-foreground">Catatan review: {detail.reviewNote}</p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>Tutup</Button>
            {detail?.status === "pending" && (
              <>
                <Button
                  variant="destructive"
                  disabled={acting !== null}
                  onClick={() => act("reject")}
                >
                  {acting === "reject" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <X className="h-4 w-4 mr-2" />}
                  Tolak
                </Button>
                <Button disabled={acting !== null} onClick={() => act("approve")}>
                  {acting === "approve" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                  Setujui
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
