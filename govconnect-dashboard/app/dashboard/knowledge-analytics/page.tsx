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
  CheckCircle, XCircle, HelpCircle, BarChart3, Target
} from "lucide-react"
import { useAuth } from "@/components/auth/AuthContext"

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

interface AnalyticsData {
  overview: OverviewStats
  intents: IntentItem[]
  flow: Record<string, any>
  rawAnalytics: any
}

export default function KnowledgeAnalyticsPage() {
  const { user } = useAuth()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
    </div>
  )
}
