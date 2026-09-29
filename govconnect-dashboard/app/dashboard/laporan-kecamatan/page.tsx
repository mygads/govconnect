"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { BarChart3, RefreshCw, FileText, ClipboardList, CheckCircle2, Clock } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth/AuthContext"

interface VillageSummary {
  village_id: string
  village_name: string
  data_available: boolean
  tickets_total: number
  by_status: Record<string, number>
  by_category: Array<{ kategori: string; count: number }>
  services_total: number
  resolved_count: number
  avg_resolution_hours: number | null
}

interface Rollup {
  scope: string
  period: { year: number; month: number; label: string }
  generated_at: string
  village_count: number
  villages_with_data: number
  villages: VillageSummary[]
  totals: {
    tickets: number
    services: number
    resolved: number
    by_status: Record<string, number>
    by_category: Array<{ kategori: string; count: number }>
  }
  avg_resolution_hours: number | null
  notes: string[]
}

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
]

/**
 * R11 — Heatmap volume tiket per desa.
 * Intensitas warna merah sebanding dengan jumlah tiket (max-normalized).
 */
function VillageHeatmap({ villages }: { villages: VillageSummary[] }) {
  const withData = villages.filter((v) => v.data_available)
  if (withData.length === 0) return null
  const max = Math.max(...withData.map((v) => v.tickets_total), 1)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Heatmap volume tiket per desa</CardTitle>
        <CardDescription>Intensitas warna = jumlah tiket bulan ini (maks {max}).</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {withData.map((v) => {
            const intensity = v.tickets_total / max
            return (
              <div
                key={v.village_id}
                className="rounded-md p-3 border"
                style={{ backgroundColor: `rgba(220, 38, 38, ${0.06 + intensity * 0.5})` }}
                title={`${v.village_name}: ${v.tickets_total} tiket`}
              >
                <div className="text-sm font-medium truncate">{v.village_name}</div>
                <div className="text-2xl font-bold">{v.tickets_total}</div>
                <div className="text-xs text-muted-foreground">tiket</div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * R11 — Perbandingan SLA antar desa.
 * Bar horizontal rata-rata jam penyelesaian per desa; garis acuan SLA P3
 * (2 jam jam kerja, arsitektur-final §11). Hijau ≤ SLA, kuning ≤ 2×, merah > 2×.
 */
const SLA_TARGET_HOURS = 2

function SlaComparison({ villages }: { villages: VillageSummary[] }) {
  const rows = villages
    .filter((v) => v.data_available && v.avg_resolution_hours != null)
    .sort((a, b) => (a.avg_resolution_hours ?? 0) - (b.avg_resolution_hours ?? 0))
  if (rows.length === 0) return null
  const max = Math.max(...rows.map((v) => v.avg_resolution_hours ?? 0), SLA_TARGET_HOURS)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Perbandingan SLA antar desa</CardTitle>
        <CardDescription>
          Rata-rata jam penyelesaian vs target SLA {SLA_TARGET_HOURS} jam (P3, arsitektur-final §11).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((v) => {
          const h = v.avg_resolution_hours ?? 0
          const pct = Math.min(100, (h / max) * 100)
          const color =
            h <= SLA_TARGET_HOURS ? "bg-green-500"
            : h <= SLA_TARGET_HOURS * 2 ? "bg-yellow-500"
            : "bg-red-500"
          return (
            <div key={v.village_id}>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium truncate">{v.village_name}</span>
                <span className="text-muted-foreground tabular-nums">{h.toFixed(1)} jam</span>
              </div>
              <div className="h-2.5 rounded-full bg-muted relative">
                <div className={`h-2.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
                <div
                  className="absolute top-0 h-2.5 w-0.5 bg-foreground/60"
                  style={{ left: `${(SLA_TARGET_HOURS / max) * 100}%` }}
                  title={`Target SLA ${SLA_TARGET_HOURS} jam`}
                />
              </div>
            </div>
          )
        })}
        <div className="flex gap-4 text-xs text-muted-foreground pt-1">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> ≤ {SLA_TARGET_HOURS} jam</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /> ≤ {SLA_TARGET_HOURS * 2} jam</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> &gt; {SLA_TARGET_HOURS * 2} jam</span>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * R11 — Tren kategori pengaduan agregat tingkat kecamatan.
 */
function CategoryTrend({ byCategory }: { byCategory: Array<{ kategori: string; count: number }> }) {
  if (!byCategory || byCategory.length === 0) return null
  const max = Math.max(...byCategory.map((c) => c.count), 1)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tren kategori pengaduan</CardTitle>
        <CardDescription>Agregat seluruh desa pada periode ini.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {byCategory.slice(0, 10).map((c) => (
          <div key={c.kategori}>
            <div className="flex justify-between text-sm mb-1">
              <span className="font-medium truncate">{c.kategori}</span>
              <span className="text-muted-foreground tabular-nums">{c.count}</span>
            </div>
            <div className="h-2.5 rounded-full bg-muted">
              <div
                className="h-2.5 rounded-full bg-blue-500"
                style={{ width: `${(c.count / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export default function LaporanKecamatanPage() {
  const { toast } = useToast()
  const { user } = useAuth()
  const now = new Date()
  const [year, setYear] = useState(String(now.getFullYear()))
  const [month, setMonth] = useState(String(now.getMonth() + 1))
  const [villageIds, setVillageIds] = useState("")
  const [rollup, setRollup] = useState<Rollup | null>(null)
  const [loading, setLoading] = useState(false)

  const isSuperadmin = user?.role === "superadmin"

  const load = async () => {
    if (isSuperadmin && !villageIds.trim()) {
      toast({ title: "village_ids wajib diisi", description: "Superadmin harus menentukan daftar desa (pisahkan dengan koma).", variant: "destructive" })
      return
    }
    setLoading(true)
    try {
      const q = new URLSearchParams({ year, month })
      if (isSuperadmin) q.set("village_ids", villageIds)
      const res = await fetch(`/api/reports/district?${q.toString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "gagal memuat")
      setRollup(data.rollup)
    } catch (err: any) {
      toast({ title: "Gagal memuat laporan", description: String(err?.message ?? err), variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = [
    { label: "Total Tiket", value: rollup?.totals.tickets ?? 0, icon: FileText },
    { label: "Total Layanan", value: rollup?.totals.services ?? 0, icon: ClipboardList },
    { label: "Terselesaikan", value: rollup?.totals.resolved ?? 0, icon: CheckCircle2 },
    {
      label: "Rata-rata Penyelesaian",
      value: rollup?.avg_resolution_hours != null ? `${rollup.avg_resolution_hours.toFixed(1)} jam` : "—",
      icon: Clock,
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="h-6 w-6" /> Laporan Kecamatan
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Agregasi laporan bulanan per desa — rollup tingkat kecamatan/kabupaten (R11).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Periode laporan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>Bulan</Label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Tahun</Label>
              <Input
                className="w-28"
                value={year}
                onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
              />
            </div>
            {isSuperadmin && (
              <div className="space-y-1 flex-1 min-w-60">
                <Label>village_ids (koma)</Label>
                <Input
                  placeholder="desa-a,desa-b"
                  value={villageIds}
                  onChange={(e) => setVillageIds(e.target.value)}
                />
              </div>
            )}
            <Button onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Tampilkan
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : rollup ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {stats.map((s) => (
              <Card key={s.label}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <s.icon className="h-4 w-4" /> {s.label}
                  </div>
                  <div className="text-2xl font-bold mt-1">{s.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <VillageHeatmap villages={rollup.villages} />
          <SlaComparison villages={rollup.villages} />
          <CategoryTrend byCategory={rollup.totals.by_category} />

          <Card>
            <CardHeader>
              <CardTitle>
                Per desa — {rollup.period.label}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({rollup.villages_with_data}/{rollup.village_count} desa ada data)
                </span>
              </CardTitle>
              <CardDescription>Desa tanpa data dikecualikan dari total, bukan diestimasi.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Desa</TableHead>
                    <TableHead className="text-right">Tiket</TableHead>
                    <TableHead className="text-right">Layanan</TableHead>
                    <TableHead className="text-right">Selesai</TableHead>
                    <TableHead className="text-right">Rata-rata (jam)</TableHead>
                    <TableHead>Status data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rollup.villages.map((v) => (
                    <TableRow key={v.village_id}>
                      <TableCell className="font-medium">
                        {v.village_name}
                        <div className="text-xs text-muted-foreground font-mono">{v.village_id}</div>
                      </TableCell>
                      <TableCell className="text-right">{v.tickets_total}</TableCell>
                      <TableCell className="text-right">{v.services_total}</TableCell>
                      <TableCell className="text-right">{v.resolved_count}</TableCell>
                      <TableCell className="text-right">
                        {v.avg_resolution_hours != null ? v.avg_resolution_hours.toFixed(1) : "—"}
                      </TableCell>
                      <TableCell>
                        {v.data_available
                          ? <Badge variant="secondary">Ada data</Badge>
                          : <Badge variant="outline">Tidak ada data</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {rollup.notes.length > 0 && (
                <ul className="mt-4 space-y-1 text-xs text-muted-foreground list-disc pl-5">
                  {rollup.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            Pilih periode lalu klik “Tampilkan”.
          </CardContent>
        </Card>
      )}
    </div>
  )
}
