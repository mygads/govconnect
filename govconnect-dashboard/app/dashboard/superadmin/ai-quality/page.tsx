"use client"

import { useEffect, useState } from "react"
import { redirect } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth/AuthContext"
import { AlertTriangle } from "lucide-react"
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend } from "chart.js"
import { Line } from "react-chartjs-2"

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend)

interface GoldenSetItemResult {
  id: string
  query: string
  expected_intent?: string
  predicted_intent: string
  reply_text: string
  intent_match?: boolean
  keyword_match?: boolean
  keyword_score?: number
  score: number
  latency_ms: number
}

interface GoldenSetSummary {
  run_id: string
  total: number
  intent_accuracy: number
  keyword_accuracy: number
  overall_accuracy: number
  thresholds: {
    overall: number
    intent: number
    keyword: number
    regression_delta: number
  }
  status: {
    overall_pass: boolean
    intent_pass: boolean
    keyword_pass: boolean
    regression_detected: boolean
  }
  started_at: string
  completed_at: string
  results: GoldenSetItemResult[]
}

export default function SuperadminAiQualityPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [summary, setSummary] = useState<GoldenSetSummary | null>(null)
  const [history, setHistory] = useState<GoldenSetSummary[]>([])

  useEffect(() => {
    if (user && user.role !== "superadmin") {
      redirect("/dashboard")
    }
  }, [user])

  const fetchSummary = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/statistics/ai-golden-set", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      })

      if (!response.ok) {
        throw new Error("Gagal memuat ringkasan evaluasi")
      }

      const data = await response.json()
      setSummary(data.latest || null)
      setHistory(data.history || [])
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Tidak dapat memuat ringkasan evaluasi",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const runEvaluation = async () => {
    try {
      setRunning(true)
      const response = await fetch("/api/statistics/ai-golden-set/run", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || "Gagal menjalankan evaluasi")
      }

      const data = await response.json()
      setSummary(data)
      setHistory((prev) => [data, ...prev])
      toast({
        title: "Berhasil",
        description: "Evaluasi golden set berhasil dijalankan.",
      })
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Evaluasi golden set gagal",
        variant: "destructive",
      })
    } finally {
      setRunning(false)
    }
  }

  useEffect(() => {
    if (user?.role === "superadmin") {
      fetchSummary()
    }
  }, [user])

  useEffect(() => {
    if (summary?.status?.regression_detected) {
      toast({
        title: "Regresi Terdeteksi",
        description: "Skor golden set turun melewati ambang regresi. Mohon cek perubahan prompt/model.",
        variant: "destructive",
      })
    }
  }, [summary, toast])

  if (user?.role !== "superadmin") {
    return null
  }

  const formatPercent = (value?: number) => {
    if (value === undefined || value === null) return "-"
    return `${(value * 100).toFixed(1)}%`
  }

  const weekKey = (dateString: string) => {
    const date = new Date(dateString)
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
    const diff = (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - yearStart.getTime()) / 86400000
    const week = Math.ceil((diff + yearStart.getUTCDay() + 1) / 7)
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
  }

  const weeklyTrend = history.reduce<Record<string, { total: number; count: number }>>((acc, item) => {
    const key = weekKey(item.completed_at)
    if (!acc[key]) acc[key] = { total: 0, count: 0 }
    acc[key].total += item.overall_accuracy
    acc[key].count += 1
    return acc
  }, {})

  const weeklyLabels = Object.keys(weeklyTrend).sort()
  const weeklyValues = weeklyLabels.map(label => {
    const entry = weeklyTrend[label]
    return entry ? Number((entry.total / entry.count).toFixed(3)) : 0
  })

  const weeklyChartData = {
    labels: weeklyLabels,
    datasets: [
      {
        label: "Akurasi Total",
        data: weeklyValues.map(v => v * 100),
        borderColor: "#2563eb",
        backgroundColor: "rgba(37, 99, 235, 0.2)",
        tension: 0.3,
      },
    ],
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">AI Golden Set</h1>
          <p className="text-muted-foreground mt-2">
            Evaluasi konsistensi jawaban AI menggunakan daftar pertanyaan standar.
          </p>
        </div>
        <Button onClick={runEvaluation} disabled={running}>
          {running ? "Menjalankan..." : "Jalankan Evaluasi"}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Akurasi Total</CardTitle>
            <CardDescription>Skor gabungan intent & keyword</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{summary ? formatPercent(summary.overall_accuracy) : "-"}</div>
            {summary && (
              <div className="mt-2 text-xs text-muted-foreground">
                Threshold: {formatPercent(summary.thresholds.overall)}
                {summary.status.regression_detected && (
                  <Badge className="ml-2" variant="destructive">Regresi</Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Akurasi Intent</CardTitle>
            <CardDescription>Kesesuaian intent LLM1</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{summary ? formatPercent(summary.intent_accuracy) : "-"}</div>
            {summary && (
              <div className="mt-2 text-xs text-muted-foreground">
                Threshold: {formatPercent(summary.thresholds.intent)}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Akurasi Keyword</CardTitle>
            <CardDescription>Kesesuaian kata kunci jawaban</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{summary ? formatPercent(summary.keyword_accuracy) : "-"}</div>
            {summary && (
              <div className="mt-2 text-xs text-muted-foreground">
                Threshold: {formatPercent(summary.thresholds.keyword)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {summary?.status?.regression_detected && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Regresi Akurasi Terdeteksi
            </CardTitle>
            <CardDescription>
              Penurunan akurasi melebihi threshold {summary.thresholds.regression_delta * 100}% dibanding run sebelumnya.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Tren Akurasi Mingguan</CardTitle>
          <CardDescription>Rata-rata akurasi total per minggu</CardDescription>
        </CardHeader>
        <CardContent>
          {weeklyLabels.length === 0 ? (
            <div className="text-sm text-muted-foreground">Belum ada data tren.</div>
          ) : (
            <div className="h-64">
              <Line
                data={weeklyChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: { y: { beginAtZero: true, max: 100 } },
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Detail Evaluasi Terakhir</CardTitle>
          <CardDescription>
            {summary?.completed_at ? `Terakhir dijalankan: ${new Date(summary.completed_at).toLocaleString("id-ID")}` : "Belum ada evaluasi"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Memuat data...</div>
          ) : !summary ? (
            <div className="text-sm text-muted-foreground">Belum ada data evaluasi.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pertanyaan</TableHead>
                  <TableHead>Intent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Skor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.results.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="font-medium">{item.query}</div>
                      <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.reply_text}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{item.predicted_intent}</div>
                      <div className="text-xs text-muted-foreground">Target: {item.expected_intent || "-"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={item.intent_match === false ? "destructive" : "default"}>
                          Intent {item.intent_match === false ? "Tidak Cocok" : "OK"}
                        </Badge>
                        {item.keyword_match !== undefined && (
                          <Badge variant={item.keyword_match ? "secondary" : "destructive"}>
                            Keyword {item.keyword_match ? "OK" : "Kurang"}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{(item.score * 100).toFixed(1)}%</TableCell>
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
