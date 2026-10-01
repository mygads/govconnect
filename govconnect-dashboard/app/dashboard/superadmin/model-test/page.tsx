"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Brain,
  CheckCircle2,
  History,
  Loader2,
  Play,
  Sparkles,
  Trash2,
  XCircle,
  MinusCircle,
} from "lucide-react"

import { useAuth } from "@/components/auth/AuthContext"
import { fetchApi } from "@/lib/frontend-api"
import { isSuperadmin } from "@/lib/rbac"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface ModelRow {
  id: string
  lane_type: string
  display_name: string
  upstream_model_name: string
  is_active: boolean
  provider_id: string
  provider?: { id: string; name: string; slug: string }
}

interface CompatTestResult {
  test_id: string
  test_name: string
  status: "PASS" | "FAIL" | "SKIP"
  latency_ms: number
  input_tokens: number
  output_tokens: number
  reason: string
  raw_preview?: string
  weight: number
  is_smartness: boolean
}

interface CompatReport {
  model: string
  provider: string
  provider_slug: string
  tested_at: string
  results: CompatTestResult[]
  passed: number
  failed: number
  skipped: number
  total: number
  score: string
  smartness_failed: number
  smartness_total: number
  recommendation: "KOMPATIBEL" | "SEBAGIAN" | "TIDAK KOMPATIBEL"
  total_latency_ms: number
  total_input_tokens: number
  total_output_tokens: number
}

interface HistoryEntry {
  id: string
  tested_at: string
  label: string
  source: "registered" | "manual"
  report: CompatReport
}

const HISTORY_KEY = "gc-model-compat-history"

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function statusBadge(status: CompatTestResult["status"]) {
  if (status === "PASS") return <Badge className="border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300">PASS</Badge>
  if (status === "FAIL") return <Badge className="border-red-200 bg-red-500/10 text-red-700 dark:border-red-900 dark:text-red-300">FAIL</Badge>
  return <Badge variant="secondary">SKIP</Badge>
}

function statusIcon(status: CompatTestResult["status"]) {
  if (status === "PASS") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
  if (status === "FAIL") return <XCircle className="h-4 w-4 text-red-500" />
  return <MinusCircle className="h-4 w-4 text-muted-foreground" />
}

function recommendationBadge(rec: CompatReport["recommendation"]) {
  if (rec === "KOMPATIBEL") return <Badge className="border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300">KOMPATIBEL</Badge>
  if (rec === "SEBAGIAN") return <Badge className="border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-900 dark:text-amber-300">SEBAGIAN KOMPATIBEL</Badge>
  return <Badge className="border-red-200 bg-red-500/10 text-red-700 dark:border-red-900 dark:text-red-300">TIDAK KOMPATIBEL</Badge>
}

function ResultTable({ report }: { report: CompatReport }) {
  const smartness = report.results.filter((r) => r.is_smartness)
  const basic = report.results.filter((r) => !r.is_smartness)
  return (
    <div className="space-y-6">
      <div>
        <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-violet-500" />
          GovConnect Smartness Tests (bobot 2x) — {report.smartness_failed}/{report.smartness_total} gagal
        </h4>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Test</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Latency</th>
                <th className="px-3 py-2 text-left font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {smartness.map((r) => (
                <tr key={r.test_id} className="border-t">
                  <td className="px-3 py-2 font-medium">{r.test_name} <span className="text-xs text-muted-foreground">2x</span></td>
                  <td className="px-3 py-2"><span className="flex items-center gap-1.5">{statusIcon(r.status)}{statusBadge(r.status)}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.latency_ms}ms</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h4 className="mb-2 text-sm font-semibold">Basic Tests (bobot 1x)</h4>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Test</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Latency</th>
                <th className="px-3 py-2 text-left font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {basic.map((r) => (
                <tr key={r.test_id} className="border-t">
                  <td className="px-3 py-2 font-medium">{r.test_name}</td>
                  <td className="px-3 py-2"><span className="flex items-center gap-1.5">{statusIcon(r.status)}{statusBadge(r.status)}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.latency_ms}ms</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default function ModelTestPage() {
  const { user } = useAuth()
  const router = useRouter()

  const [models, setModels] = useState<ModelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState("registered")
  const [selectedModelId, setSelectedModelId] = useState("")
  const [manualBaseUrl, setManualBaseUrl] = useState("")
  const [manualApiKey, setManualApiKey] = useState("")
  const [manualModelName, setManualModelName] = useState("")
  const [running, setRunning] = useState(false)
  const [currentReport, setCurrentReport] = useState<CompatReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [compareIds, setCompareIds] = useState<string[]>([])

  useEffect(() => {
    if (user && !isSuperadmin(user.role)) router.replace("/dashboard")
  }, [user, router])

  useEffect(() => {
    setHistory(loadHistory())
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        const payload = await fetchApi<any>("/api/superadmin/ai-models")
        const rows: ModelRow[] = Array.isArray(payload?.data) ? payload.data : []
        setModels(rows.filter((m) => m.is_active && m.lane_type === "llm"))
      } catch {
        // biarkan kosong
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    setSelectedModelId((cur) => models.some((m) => m.id === cur) ? cur : models[0]?.id || "")
  }, [models])

  const saveToHistory = useCallback((entry: HistoryEntry) => {
    setHistory((cur) => {
      const next = [entry, ...cur].slice(0, 20)
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch { /* abaikan */ }
      return next
    })
  }, [])

  const runTest = useCallback(async () => {
    setRunning(true)
    setError(null)
    setCurrentReport(null)
    try {
      let payload: any
      let label: string
      let source: "registered" | "manual"
      if (tab === "registered") {
        if (!selectedModelId) throw new Error("Pilih model dulu")
        const m = models.find((x) => x.id === selectedModelId)
        label = m ? `${m.display_name || m.upstream_model_name} (${m.provider?.name || "?"})` : selectedModelId
        source = "registered"
        payload = { model_id: selectedModelId }
      } else {
        if (!manualBaseUrl.trim() || !manualApiKey.trim() || !manualModelName.trim()) {
          throw new Error("base_url, api_key, dan model_name wajib diisi")
        }
        label = `${manualModelName.trim()} (manual)`
        source = "manual"
        payload = { manual: { base_url: manualBaseUrl.trim(), api_key: manualApiKey.trim(), model_name: manualModelName.trim() } }
      }

      const res = await fetchApi<any>("/api/superadmin/ai-models/test-compatibility", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      if (!res?.success) throw new Error(res?.error || "Compatibility test gagal")
      const report: CompatReport = res.data
      setCurrentReport(report)
      saveToHistory({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        tested_at: report.tested_at,
        label,
        source,
        report,
      })
      // API key manual tidak pernah disimpan — kosongkan setelah test
      if (source === "manual") setManualApiKey("")
    } catch (e: any) {
      setError(e?.message || "Compatibility test gagal")
    } finally {
      setRunning(false)
    }
  }, [tab, selectedModelId, models, manualBaseUrl, manualApiKey, manualModelName, saveToHistory])

  const clearHistory = useCallback(() => {
    setHistory([])
    setCompareIds([])
    try { localStorage.removeItem(HISTORY_KEY) } catch { /* abaikan */ }
  }, [])

  const toggleCompare = useCallback((id: string) => {
    setCompareIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-2))
  }, [])

  const compareEntries = useMemo(
    () => compareIds.map((id) => history.find((h) => h.id === id)).filter(Boolean) as HistoryEntry[],
    [compareIds, history]
  )

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Brain className="h-6 w-6" />
          Test Kompatibilitas Model
        </h1>
        <p className="text-muted-foreground">
          Uji 11 kemampuan model (5 basic + 6 GovConnect smartness) sebelum menjadikannya model utama.
          Model yang gagal &gt;2 smartness test otomatis <strong>TIDAK KOMPATIBEL</strong>.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Jalankan Test</CardTitle>
          <CardDescription>Pilih model terdaftar atau test model manual via base URL + API key (key tidak disimpan).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="registered">Model Terdaftar</TabsTrigger>
              <TabsTrigger value="manual">Manual</TabsTrigger>
            </TabsList>
            <TabsContent value="registered" className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Model LLM</Label>
                <Select value={selectedModelId} onValueChange={setSelectedModelId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih model" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.display_name || m.upstream_model_name} · {m.provider?.name || "?"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>
            <TabsContent value="manual" className="space-y-4 pt-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Base URL</Label>
                  <Input placeholder="https://ai.sumopod.com/v1" value={manualBaseUrl} onChange={(e) => setManualBaseUrl(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Model Name</Label>
                  <Input placeholder="glm-5.3-flash" value={manualModelName} onChange={(e) => setManualModelName(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>API Key (transient — tidak disimpan)</Label>
                <Input type="password" placeholder="sk-..." value={manualApiKey} onChange={(e) => setManualApiKey(e.target.value)} autoComplete="off" />
              </div>
            </TabsContent>
          </Tabs>

          <Button onClick={runTest} disabled={running}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            {running ? "Menjalankan 11 test..." : "Jalankan Compatibility Test"}
          </Button>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Test gagal</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {currentReport && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Hasil: {currentReport.model}
              {recommendationBadge(currentReport.recommendation)}
            </CardTitle>
            <CardDescription>
              Skor berbobot {currentReport.score} · {currentReport.passed} pass / {currentReport.failed} fail / {currentReport.skipped} skip ·
              Smartness gagal {currentReport.smartness_failed}/{currentReport.smartness_total} ·
              {` ${new Date(currentReport.tested_at).toLocaleString("id-ID")}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResultTable report={currentReport} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Riwayat Test
              </CardTitle>
              <CardDescription>
                Tersimpan lokal di browser. Pilih hingga 2 hasil untuk dibandingkan side-by-side.
              </CardDescription>
            </div>
            {history.length > 0 && (
              <Button variant="outline" size="sm" onClick={clearHistory}>
                <Trash2 className="mr-1 h-4 w-4" /> Hapus
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada riwayat test.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Bandingkan</th>
                    <th className="px-3 py-2 text-left font-medium">Model</th>
                    <th className="px-3 py-2 text-left font-medium">Waktu</th>
                    <th className="px-3 py-2 text-left font-medium">Skor</th>
                    <th className="px-3 py-2 text-left font-medium">Rekomendasi</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-t">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={compareIds.includes(h.id)}
                          onChange={() => toggleCompare(h.id)}
                          className="h-4 w-4"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium">{h.label}</td>
                      <td className="px-3 py-2 text-muted-foreground">{new Date(h.tested_at).toLocaleString("id-ID")}</td>
                      <td className="px-3 py-2 tabular-nums">{h.report.score}</td>
                      <td className="px-3 py-2">{recommendationBadge(h.report.recommendation)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {compareEntries.length === 2 && (
            <div className="grid gap-4 md:grid-cols-2">
              {compareEntries.map((h) => (
                <Card key={h.id}>
                  <CardHeader>
                    <CardTitle className="text-base">{h.label}</CardTitle>
                    <CardDescription>
                      {new Date(h.tested_at).toLocaleString("id-ID")} · Skor {h.report.score}
                      {" "}{recommendationBadge(h.report.recommendation)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">Test</th>
                            <th className="px-3 py-2 text-left font-medium">Status</th>
                            <th className="px-3 py-2 text-right font-medium">ms</th>
                          </tr>
                        </thead>
                        <tbody>
                          {h.report.results.map((r) => (
                            <tr key={r.test_id} className="border-t">
                              <td className="px-3 py-2">
                                {r.test_name}
                                {r.is_smartness && <span className="ml-1 text-xs text-violet-500">2x</span>}
                              </td>
                              <td className="px-3 py-2"><span className="flex items-center gap-1.5">{statusIcon(r.status)}{statusBadge(r.status)}</span></td>
                              <td className="px-3 py-2 text-right tabular-nums">{r.latency_ms}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
