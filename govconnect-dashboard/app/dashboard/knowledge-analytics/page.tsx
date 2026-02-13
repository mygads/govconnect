"use client"

import { useEffect, useState, useCallback } from "react"
import { redirect } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Brain, RefreshCcw, TrendingUp, TrendingDown, AlertTriangle,
  CheckCircle, XCircle, HelpCircle, BarChart3, Target, MessageSquareWarning, Trash2, Loader2
} from "lucide-react"
import { useAuth } from "@/components/auth/AuthContext"
import { useToast } from "@/hooks/use-toast"

/** Format a date into a simple relative time string (no external deps). */
function formatRelativeTime(date: Date): string {
  const now = Date.now()
  const diffMs = now - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return "baru saja"
  if (diffMins < 60) return `${diffMins} menit lalu`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours} jam lalu`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays} hari lalu`
  const diffMonths = Math.floor(diffDays / 30)
  return `${diffMonths} bulan lalu`
}

interface OverviewStats {
  totalQueries: number
  knowledgeHits: number
  knowledgeMisses: number
  fallbackCount: number
  hitRate: string | number
  missRate: string | number
}

interface IntentItem {
  intent: string
  count: number
  avgConfidence: number
}

interface KnowledgeGapItem {
  id: string
  query: string
  intent: string
  confidence: string
  hitCount: number
  firstSeen: string
  lastSeen: string
  channel: string
}

interface KnowledgeGapsData {
  topGaps: KnowledgeGapItem[]
  statusCounts: Record<string, number>
  totalOpen: number
}

interface KnowledgeConflictItem {
  id: string
  source1: string
  source2: string
  summary: string
  similarity: number
  hitCount: number
  status: string
  autoResolved: boolean
  firstSeen: string
  lastSeen: string
  query: string | null
}

interface KnowledgeConflictsData {
  topConflicts: KnowledgeConflictItem[]
  statusCounts: Record<string, number>
  totalOpen: number
  totalAutoResolved: number
}

interface AnalyticsData {
  overview: OverviewStats
  intents: IntentItem[]
  flow: Record<string, any>
  knowledgeGaps?: KnowledgeGapsData
  knowledgeConflicts?: KnowledgeConflictsData
  rawAnalytics: any
}

export default function KnowledgeAnalyticsPage() {
  const { user } = useAuth()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingGapId, setDeletingGapId] = useState<string | null>(null)
  const [deletingAllGaps, setDeletingAllGaps] = useState(false)
  const [deletingAllConflicts, setDeletingAllConflicts] = useState(false)
  const { toast } = useToast()

  // Only village admin can access this page
  useEffect(() => {
    if (user && user.role === "superadmin") redirect("/dashboard")
  }, [user])

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch("/api/statistics/knowledge-analytics", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      if (!res.ok) throw new Error("Gagal memuat data analytics")
      setData(await res.json())
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const handleDeleteGap = async (id: string) => {
    try {
      setDeletingGapId(id)
      const res = await fetch(`/api/knowledge-gaps/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      if (!res.ok) throw new Error("Gagal menghapus")
      toast({ title: "Berhasil", description: "Pertanyaan berhasil dihapus" })
      fetchData()
    } catch (err: any) {
      toast({ title: "Gagal", description: err.message, variant: "destructive" })
    } finally {
      setDeletingGapId(null)
    }
  }

  const handleDeleteAllGaps = async () => {
    if (!confirm('Hapus semua pertanyaan belum terjawab? Data analytics akan di-reset.')) return
    try {
      setDeletingAllGaps(true)
      const res = await fetch('/api/knowledge-gaps/batch', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      if (!res.ok) throw new Error("Gagal menghapus")
      const data = await res.json()
      toast({ title: "Berhasil", description: `${data.deleted} pertanyaan berhasil dihapus` })
      fetchData()
    } catch (err: any) {
      toast({ title: "Gagal", description: err.message, variant: "destructive" })
    } finally {
      setDeletingAllGaps(false)
    }
  }

  const handleDeleteAllConflicts = async () => {
    if (!confirm('Hapus semua data konflik? Data analytics akan di-reset.')) return
    try {
      setDeletingAllConflicts(true)
      const res = await fetch('/api/knowledge-conflicts/batch', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      if (!res.ok) throw new Error("Gagal menghapus")
      const data = await res.json()
      toast({ title: "Berhasil", description: `${data.deleted} konflik berhasil dihapus` })
      fetchData()
    } catch (err: any) {
      toast({ title: "Gagal", description: err.message, variant: "destructive" })
    } finally {
      setDeletingAllConflicts(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Analitik Knowledge Base</h1>
          <p className="text-muted-foreground mt-2">Pantau performa AI dan cakupan knowledge</p>
        </div>
        <Card className="border-destructive">
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto text-destructive mb-4" />
            <p className="text-destructive font-medium">{error}</p>
            <p className="text-sm text-muted-foreground mt-2">
              Pastikan AI Service sedang berjalan dan terhubung.
            </p>
            <Button onClick={fetchData} variant="outline" className="mt-4">
              <RefreshCcw className="h-4 w-4 mr-2" /> Coba Lagi
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const overview = data?.overview || {
    totalQueries: 0, knowledgeHits: 0, knowledgeMisses: 0,
    fallbackCount: 0, hitRate: 0, missRate: 0,
  }
  const intents = data?.intents || []
  const knowledgeGaps = data?.knowledgeGaps
  const topGaps = knowledgeGaps?.topGaps || []
  const gapStatusCounts = knowledgeGaps?.statusCounts || { open: 0, resolved: 0, ignored: 0 }
  const knowledgeConflicts = data?.knowledgeConflicts
  const topConflicts = knowledgeConflicts?.topConflicts || []
  const conflictStatusCounts = knowledgeConflicts?.statusCounts || { open: 0, resolved: 0, auto_resolved: 0, ignored: 0 }
  const hitRateNum = typeof overview.hitRate === "string" ? parseFloat(overview.hitRate) : overview.hitRate

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Analitik Knowledge Base</h1>
          <p className="text-muted-foreground mt-2">
            Pantau efektivitas knowledge base dan identifikasi pertanyaan yang belum terjawab
          </p>
        </div>
        <Button onClick={fetchData} variant="outline">
          <RefreshCcw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Conflict Alert Banner */}
      {conflictStatusCounts.open > 0 && (
        <Card className="border-orange-400 bg-orange-50 dark:bg-orange-950/20">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-6 w-6 text-orange-600 shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-orange-800 dark:text-orange-300">
                  Ada {conflictStatusCounts.open} data berkonflik di knowledge base
                </p>
                <p className="text-sm text-orange-700 dark:text-orange-400 mt-0.5">
                  AI mendeteksi informasi yang saling bertentangan dari sumber berbeda. Periksa dan selesaikan di tabel konflik di bawah.
                </p>
              </div>
              <Badge className="bg-orange-200 text-orange-800 shrink-0">
                {conflictStatusCounts.open} Konflik
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Overview Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Total Pertanyaan
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{overview.totalQueries}</div>
            <p className="text-xs text-muted-foreground mt-1">Semua pertanyaan masuk ke AI</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" /> Knowledge Hit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{overview.knowledgeHits}</div>
            <p className="text-xs text-muted-foreground mt-1">Berhasil dijawab dari knowledge</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-600" /> Knowledge Miss
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">{overview.knowledgeMisses}</div>
            <p className="text-xs text-muted-foreground mt-1">Tidak ditemukan di knowledge</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-yellow-600" /> Fallback
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-yellow-600">{overview.fallbackCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Dijawab dengan fallback</p>
          </CardContent>
        </Card>
      </div>

      {/* Hit Rate Bar */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" /> Coverage Rate
          </CardTitle>
          <CardDescription>
            Persentase pertanyaan yang berhasil dijawab dari knowledge base
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Knowledge Hit Rate</span>
              <span className="text-2xl font-bold">
                {hitRateNum > 0 ? (
                  <span className={hitRateNum >= 70 ? "text-green-600" : hitRateNum >= 40 ? "text-yellow-600" : "text-red-600"}>
                    {overview.hitRate}%
                  </span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </span>
            </div>
            <Progress value={hitRateNum || 0} className="h-3" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0%</span>
              <span className="flex items-center gap-1">
                {hitRateNum >= 70 ? (
                  <><TrendingUp className="h-3 w-3 text-green-600" /> Baik</>
                ) : hitRateNum >= 40 ? (
                  <><AlertTriangle className="h-3 w-3 text-yellow-600" /> Perlu ditingkatkan</>
                ) : hitRateNum > 0 ? (
                  <><TrendingDown className="h-3 w-3 text-red-600" /> Perlu banyak perbaikan</>
                ) : (
                  <>Belum ada data</>
                )}
              </span>
              <span>100%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Intents Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" /> Top Intent / Pertanyaan
          </CardTitle>
          <CardDescription>
            Jenis pertanyaan yang paling sering ditanyakan warga — intent dengan confidence rendah
            menandakan AI kurang yakin menjawab, perlu tambah knowledge.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {intents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Brain className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>Belum ada data intent tersedia</p>
              <p className="text-xs mt-1">Data akan muncul setelah ada percakapan dengan AI</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Intent</TableHead>
                  <TableHead>Jumlah</TableHead>
                  <TableHead>Avg Confidence</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {intents.map((item, idx) => {
                  const conf = typeof item.avgConfidence === 'number' ? item.avgConfidence : 0
                  const confPct = conf > 1 ? conf : conf * 100
                  return (
                    <TableRow key={idx}>
                      <TableCell className="font-mono text-sm">{idx + 1}</TableCell>
                      <TableCell className="font-medium">{item.intent}</TableCell>
                      <TableCell>{item.count}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={confPct} className="h-2 w-20" />
                          <span className="text-sm">{confPct.toFixed(0)}%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {confPct >= 70 ? (
                          <Badge className="bg-green-100 text-green-800">Baik</Badge>
                        ) : confPct >= 40 ? (
                          <Badge className="bg-yellow-100 text-yellow-800">Perlu Perbaikan</Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-800">Coverage Rendah</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600" /> Rekomendasi
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {hitRateNum < 50 && hitRateNum > 0 && (
              <li className="flex items-start gap-2">
                <XCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Coverage Rate rendah ({overview.hitRate}%)</p>
                  <p className="text-xs text-muted-foreground">
                    Tambahkan lebih banyak artikel ke knowledge base, terutama untuk pertanyaan yang sering ditanyakan.
                  </p>
                </div>
              </li>
            )}
            {overview.fallbackCount > overview.knowledgeHits && (
              <li className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Banyak pertanyaan dijawab fallback</p>
                  <p className="text-xs text-muted-foreground">
                    {overview.fallbackCount} pertanyaan dijawab dengan fallback. Periksa log pertanyaan dan tambah knowledge yang relevan.
                  </p>
                </div>
              </li>
            )}
            {intents.some(i => (typeof i.avgConfidence === 'number' ? (i.avgConfidence > 1 ? i.avgConfidence : i.avgConfidence * 100) : 0) < 40) && (
              <li className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Ada intent dengan confidence rendah</p>
                  <p className="text-xs text-muted-foreground">
                    Beberapa jenis pertanyaan memiliki confidence di bawah 40%. Tambahkan knowledge atau perbaiki existing knowledge untuk intent tersebut.
                  </p>
                </div>
              </li>
            )}
            {hitRateNum >= 70 && (
              <li className="flex items-start gap-2">
                <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Knowledge base dalam kondisi baik!</p>
                  <p className="text-xs text-muted-foreground">
                    Coverage rate sudah {overview.hitRate}%. Tetap pantau secara berkala dan tambahkan knowledge baru jika ada layanan baru.
                  </p>
                </div>
              </li>
            )}
            {conflictStatusCounts.open > 0 && (
              <li className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-500 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Ada {conflictStatusCounts.open} data berkonflik di knowledge base</p>
                  <p className="text-xs text-muted-foreground">
                    AI mendeteksi informasi yang saling bertentangan dari sumber berbeda. Periksa tabel &quot;Data Berkonflik&quot; di bawah dan perbaiki knowledge yang tidak akurat.
                    {conflictStatusCounts.auto_resolved > 0 && ` (${conflictStatusCounts.auto_resolved} konflik sudah otomatis di-resolve karena ada data resmi di database)`}
                  </p>
                </div>
              </li>
            )}
            {overview.totalQueries === 0 && (
              <li className="flex items-start gap-2">
                <HelpCircle className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Belum ada data percakapan</p>
                  <p className="text-xs text-muted-foreground">
                    Data analytics akan tersedia setelah ada warga yang bertanya melalui WhatsApp atau Webchat.
                  </p>
                </div>
              </li>
            )}
          </ul>
        </CardContent>
      </Card>

      {/* Knowledge Conflicts Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-600" /> Data Berkonflik
              </CardTitle>
              <CardDescription className="mt-1.5">
                AI mendeteksi informasi yang saling bertentangan dari sumber knowledge yang berbeda.
                Periksa dan perbaiki knowledge yang tidak akurat agar AI memberikan jawaban konsisten.
              </CardDescription>
            </div>
            {topConflicts.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteAllConflicts}
                disabled={deletingAllConflicts}
              >
                {deletingAllConflicts ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Hapus Semua
              </Button>
            )}
          </div>
          {(conflictStatusCounts.open > 0 || conflictStatusCounts.resolved > 0 || conflictStatusCounts.auto_resolved > 0) && (
            <div className="flex gap-2 mt-2 flex-wrap">
              <Badge className="bg-orange-100 text-orange-800">{conflictStatusCounts.open} Belum Ditangani</Badge>
              <Badge className="bg-blue-100 text-blue-800">{conflictStatusCounts.auto_resolved} Auto-Resolved</Badge>
              <Badge className="bg-green-100 text-green-800">{conflictStatusCounts.resolved} Sudah Diperbaiki</Badge>
              {conflictStatusCounts.ignored > 0 && (
                <Badge className="bg-gray-100 text-gray-600">{conflictStatusCounts.ignored} Diabaikan</Badge>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {topConflicts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>Tidak ada konflik data yang terdeteksi</p>
              <p className="text-xs mt-1">Semua knowledge base konsisten dan tidak saling bertentangan</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Sumber 1</TableHead>
                  <TableHead>Sumber 2</TableHead>
                  <TableHead>Deskripsi Konflik</TableHead>
                  <TableHead>Frekuensi</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Terakhir</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topConflicts.map((conflict, idx) => {
                  const lastSeen = conflict.lastSeen ? new Date(conflict.lastSeen) : null
                  const relativeTime = lastSeen ? formatRelativeTime(lastSeen) : "-"
                  return (
                    <TableRow key={conflict.id}>
                      <TableCell className="font-mono text-sm">{idx + 1}</TableCell>
                      <TableCell className="max-w-[120px] truncate text-xs" title={conflict.source1}>
                        {conflict.source1}
                      </TableCell>
                      <TableCell className="max-w-[120px] truncate text-xs" title={conflict.source2}>
                        {conflict.source2}
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <p className="text-xs text-muted-foreground truncate" title={conflict.summary}>
                          {conflict.summary.length > 100 ? conflict.summary.substring(0, 100) + '...' : conflict.summary}
                        </p>
                      </TableCell>
                      <TableCell>
                        <span className={`font-medium ${conflict.hitCount >= 5 ? "text-red-600" : conflict.hitCount >= 3 ? "text-yellow-600" : ""}`}>
                          {conflict.hitCount}×
                        </span>
                      </TableCell>
                      <TableCell>
                        {conflict.status === 'open' ? (
                          <Badge className="bg-orange-100 text-orange-800 text-xs">Belum Ditangani</Badge>
                        ) : conflict.status === 'auto_resolved' ? (
                          <Badge className="bg-blue-100 text-blue-800 text-xs">Auto-Resolved</Badge>
                        ) : conflict.status === 'resolved' ? (
                          <Badge className="bg-green-100 text-green-800 text-xs">Diperbaiki</Badge>
                        ) : (
                          <Badge className="bg-gray-100 text-gray-600 text-xs">Diabaikan</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{relativeTime}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Knowledge Gaps Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageSquareWarning className="h-5 w-5 text-orange-600" /> Pertanyaan Belum Terjawab
              </CardTitle>
              <CardDescription className="mt-1.5">
                Pertanyaan warga yang tidak ditemukan jawabannya di knowledge base — tambahkan
                knowledge untuk topik ini agar AI dapat menjawab dengan lebih baik.
              </CardDescription>
            </div>
            {topGaps.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteAllGaps}
                disabled={deletingAllGaps}
              >
                {deletingAllGaps ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Hapus Semua
              </Button>
            )}
          </div>
          {(gapStatusCounts.open > 0 || gapStatusCounts.resolved > 0) && (
            <div className="flex gap-2 mt-2">
              <Badge className="bg-orange-100 text-orange-800">{gapStatusCounts.open} Belum Ditangani</Badge>
              <Badge className="bg-green-100 text-green-800">{gapStatusCounts.resolved} Sudah Dijawab</Badge>
              {gapStatusCounts.ignored > 0 && (
                <Badge className="bg-gray-100 text-gray-600">{gapStatusCounts.ignored} Diabaikan</Badge>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {topGaps.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>Tidak ada knowledge gap yang terdeteksi</p>
              <p className="text-xs mt-1">Semua pertanyaan warga sudah terjawab oleh knowledge base</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Pertanyaan</TableHead>
                  <TableHead>Frekuensi</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Terakhir</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topGaps.map((gap, idx) => {
                  const lastSeen = gap.lastSeen ? new Date(gap.lastSeen) : null
                  const relativeTime = lastSeen
                    ? formatRelativeTime(lastSeen)
                    : "-"
                  return (
                    <TableRow key={gap.id}>
                      <TableCell className="font-mono text-sm">{idx + 1}</TableCell>
                      <TableCell className="max-w-xs truncate" title={gap.query}>
                        {gap.query}
                      </TableCell>
                      <TableCell>
                        <span className={`font-medium ${gap.hitCount >= 5 ? "text-red-600" : gap.hitCount >= 3 ? "text-yellow-600" : ""}`}>
                          {gap.hitCount}×
                        </span>
                      </TableCell>
                      <TableCell className="capitalize text-xs">{gap.channel}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{relativeTime}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteGap(gap.id)}
                          disabled={deletingGapId === gap.id}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          {deletingGapId === gap.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
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
