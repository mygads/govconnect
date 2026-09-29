"use client"

import { useEffect, useState } from "react"
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
import { Badge } from "@/components/ui/badge"
import { FileWarning, RefreshCw } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { formatDateTime } from "@/lib/utils"

interface MediaSignal {
  occurred_at: string
  user_id: string
  trace_id: string
  fraud_signals: string[]
  sha256: string | null
  duplicate: boolean
}

const SIGNAL_LABEL: Record<string, string> = {
  duplicate_image: "Gambar duplikat",
  exif_datetime_suspicious: "Waktu EXIF janggal",
  low_resolution: "Resolusi rendah",
}

export default function SinyalBuktiPage() {
  const { toast } = useToast()
  const [signals, setSignals] = useState<MediaSignal[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/media-signals/recent?limit=50")
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "gagal memuat")
      setSignals(data.signals ?? [])
    } catch (err: any) {
      toast({ title: "Gagal memuat", description: String(err?.message ?? err), variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileWarning className="h-6 w-6" /> Sinyal Bukti
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Foto bukti yang memicu sinyal pemeriksaan otomatis.
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={load} title="Muat ulang">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Antrean review</CardTitle>
          <CardDescription>
            Ini <strong>sinyal heuristik, bukan vonis</strong> — bukti tidak pernah ditolak otomatis.
            Cocokkan dengan laporan terkait (ID warga & waktu) sebelum menindaklanjuti.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : signals.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">
              Tidak ada sinyal bukti. 🎉
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>ID Warga</TableHead>
                  <TableHead>Sinyal</TableHead>
                  <TableHead>Hash (SHA-256)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signals.map((s, i) => (
                  <TableRow key={`${s.trace_id}-${i}`}>
                    <TableCell className="whitespace-nowrap">{formatDateTime(s.occurred_at)}</TableCell>
                    <TableCell className="font-mono text-xs">{s.user_id}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {s.fraud_signals.map((sig) => (
                          <Badge key={sig} variant="outline" className="text-amber-700 border-amber-300">
                            {SIGNAL_LABEL[sig] ?? sig}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.sha256 ? `${s.sha256.slice(0, 16)}…` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
