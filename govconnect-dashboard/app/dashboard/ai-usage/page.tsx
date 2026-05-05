"use client"

import { ComponentType, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Activity, BarChart3, Bot, CalendarDays, Coins, Eye, Loader2, MessageSquare, RefreshCw, Users, Wallet, Zap } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAuth } from "@/components/auth/AuthContext"

export const dynamic = "force-dynamic"

type ChartComponent = ComponentType<{ data: any; options?: any }>

interface TokenSummary {
  total_input_tokens: number
  total_output_tokens: number
  total_tokens: number
  total_cost_usd: number
  total_calls: number
  embedding_cost: number
  rag_expand_cost: number
  rag_rerank_cost: number
  agent_cost: number
  main_chat_calls: number
  main_chat_cost: number
  full_nlu_cost: number
  micro_nlu_cost: number
}

interface PeriodUsage { period_start: string; total_tokens: number; cost_usd: number; call_count: number }
interface PeriodLayerUsage extends PeriodUsage { layer_type: string }
interface LayerBreakdown { layer_type: string; call_type: string; total_tokens: number; cost_usd: number; call_count: number; avg_duration_ms: number }
interface UsageUser { wa_user_id: string | null; session_id: string | null; message_count: number; call_count: number; total_tokens: number; actual_cost_usd: number; adjusted_cost_usd: number; margin_usd: number }
interface MessageBilling { id: string; message_id: string | null; trace_id: string; billing_group_id: string; channel: string | null; wa_user_id: string | null; session_id: string | null; input_tokens: number; output_tokens: number; total_tokens: number; call_count: number; actual_cost_usd: number; adjusted_cost_usd: number; margin_usd: number; status: string; created_at: string; billed_at: string | null }
interface MessageResponse { total: number; totals: { messages: number; actual_cost_usd: number; adjusted_cost_usd: number; margin_usd: number; total_tokens: number; call_count: number }; data: MessageBilling[] }
interface TokenUsageRow { id: string; layer_type: string; call_type: string; input_tokens: number; output_tokens: number; total_tokens: number; actual_cost_usd: number; adjusted_cost_usd: number; margin_usd: number; duration_ms: number | null; success: boolean; billing_status: string; created_at: string }
interface MessageDetail { billing: MessageBilling; ledger_entry: any | null; token_usage: TokenUsageRow[] }

const USD_TO_IDR = 18_000
const LAYER_COLORS: Record<string, string> = { agent: "#6366f1", micro_nlu: "#f59e0b", rag_expand: "#10b981", rag_rerank: "#0f766e", embedding: "#ef4444", full_nlu: "#64748b" }
const LAYER_LABELS: Record<string, string> = { agent: "LLM / Agent", micro_nlu: "Classifier", rag_expand: "Rewrite", rag_rerank: "Rerank", embedding: "Embed", full_nlu: "LLM" }
const CALL_TYPE_LABELS: Record<string, string> = {
  main_chat: "LLM utama",
  agent_orchestrator: "Agent",
  embedding_single: "Embed single",
  embedding_batch: "Embed batch",
  rag_query_expand: "Rewrite RAG",
  rerank_documents: "Rerank dokumen",
  unified_classify: "Classifier",
  confirmation_classify: "Classifier konfirmasi",
  greeting_classify: "Classifier salam",
  farewell_classify: "Classifier selesai",
  complaint_type_match: "Match pengaduan",
  service_slug_match: "Match layanan",
}

function callTypeLabel(value: string) {
  return CALL_TYPE_LABELS[value] || value.replace(/_/g, " ")
}

function defaultStart() {
  const date = new Date()
  date.setDate(date.getDate() - 30)
  return date.toISOString().slice(0, 10)
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function formatNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString("id-ID")
}

function formatIDR(usd: number) {
  const idr = (usd || 0) * USD_TO_IDR
  if (idr > 0 && idr < 0.01) return `Rp ${idr.toFixed(8)}`
  if (idr >= 1_000_000) return `Rp ${(idr / 1_000_000).toFixed(2)} jt`
  if (idr >= 1_000) return `Rp ${(idr / 1_000).toFixed(1)} rb`
  return `Rp ${idr.toFixed(idr >= 1 ? 0 : 2)}`
}

function formatUSD(usd: number) {
  const amount = usd || 0
  if (amount > 0 && amount < 0.000001) return `$${amount.toFixed(8)}`
  return `$${amount.toFixed(6)}`
}

function userLabel(user: UsageUser) {
  return user.wa_user_id || user.session_id || "Unknown user"
}

function endOfDay(value: string) {
  return `${value}T23:59:59.999`
}

async function fetchJson<T>(path: string, params?: Record<string, string>) {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : ""
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null
  const res = await fetch(`${path}${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  const payload = await res.json().catch(() => null)
  if (!res.ok) throw new Error(payload?.error || "Gagal memuat statistik AI")
  return payload as T
}


export default function VillageAIUsagePage() {
    const { user } = useAuth()

    const router = useRouter()
  const [charts, setCharts] = useState<{ Line: ChartComponent; Bar: ChartComponent; Doughnut: ChartComponent } | null>(null)
  const [start, setStart] = useState(defaultStart())
  const [end, setEnd] = useState(today())
  const [selectedUser, setSelectedUser] = useState("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<TokenSummary | null>(null)
  const [period, setPeriod] = useState<PeriodUsage[]>([])
  const [periodLayer, setPeriodLayer] = useState<PeriodLayerUsage[]>([])
  const [layers, setLayers] = useState<LayerBreakdown[]>([])
  const [users, setUsers] = useState<UsageUser[]>([])
  const [messages, setMessages] = useState<MessageResponse | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detail, setDetail] = useState<MessageDetail | null>(null)

  useEffect(() => {
    if (user && user.role === "superadmin") router.replace("/dashboard/superadmin/ai-usage")
  }, [user, router])

  useEffect(() => {
    Promise.all([import("chart.js"), import("react-chartjs-2")]).then(([chartjs, reactChart]) => {
      const { Chart, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, PointElement, LineElement, Filler } = chartjs
      Chart.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, PointElement, LineElement, Filler)
      setCharts({ Line: reactChart.Line, Bar: reactChart.Bar, Doughnut: reactChart.Doughnut })
    })
  }, [])

  const selectedUserParams = useMemo(() => {
    if (selectedUser === "all") return {}
    const [waUserId, sessionId] = selectedUser.split("|")
    return {
      ...(waUserId ? { wa_user_id: waUserId } : {}),
      ...(sessionId ? { session_id: sessionId } : {}),
    }
  }, [selectedUser])

  const params = useMemo(() => ({ start, end: endOfDay(end), ...selectedUserParams }), [start, end, selectedUserParams])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const results = await Promise.allSettled([
        fetchJson<TokenSummary>("/api/ai-usage/summary", params),
        fetchJson<PeriodUsage[]>("/api/ai-usage/by-period", { ...params, period: "day" }),
        fetchJson<PeriodLayerUsage[]>("/api/ai-usage/by-period-layer", { ...params, period: "day" }),
        fetchJson<LayerBreakdown[]>("/api/ai-usage/layer-breakdown", params),
        fetchJson<UsageUser[]>("/api/ai-usage/users", { start, end }),
        fetchJson<MessageResponse>("/api/ai-usage/messages", { ...params, limit: "50" }),
      ])
      const [summaryResult, periodResult, periodLayerResult, layerResult, userResult, messageResult] = results
      if (summaryResult.status === "fulfilled") setSummary(summaryResult.value)
      if (periodResult.status === "fulfilled") setPeriod(periodResult.value)
      if (periodLayerResult.status === "fulfilled") setPeriodLayer(periodLayerResult.value)
      if (layerResult.status === "fulfilled") setLayers(layerResult.value)
      if (userResult.status === "fulfilled") {
        setUsers(userResult.value)
        if (selectedUser !== "all" && !userResult.value.some(item => `${item.wa_user_id || ""}|${item.session_id || ""}` === selectedUser)) {
          setSelectedUser("all")
        }
      }
      if (messageResult.status === "fulfilled") setMessages(messageResult.value)
      const firstError = results.find(result => result.status === "rejected") as PromiseRejectedResult | undefined
      if (firstError) setError(firstError.reason?.message || "Sebagian data statistik AI gagal dimuat")
    } catch (err: any) {
      setError(err?.message || "Gagal memuat statistik AI")
    } finally {
      setLoading(false)
    }
  }, [params, selectedUser, start, end])

  useEffect(() => {
    if (user && user.role !== "superadmin") loadData()
  }, [user, loadData])

  const openDetail = async (billing: MessageBilling) => {
    try {
      setDetailOpen(true)
      setDetailLoading(true)
      setDetail(null)
      setDetail(await fetchJson<MessageDetail>(`/api/ai-usage/messages/${billing.id}`))
    } catch (err: any) {
      setError(err?.message || "Gagal memuat detail billing")
    } finally {
      setDetailLoading(false)
    }
  }

  const layerTotals = useMemo(() => {
    const grouped = new Map<string, LayerBreakdown>()
    layers.forEach(row => {
      const current = grouped.get(row.layer_type) || { ...row, call_type: row.layer_type, total_tokens: 0, cost_usd: 0, call_count: 0, avg_duration_ms: 0 }
      current.total_tokens += row.total_tokens || 0
      current.cost_usd += row.cost_usd || 0
      current.call_count += row.call_count || 0
      grouped.set(row.layer_type, current)
    })
    return Array.from(grouped.values()).sort((a, b) => b.cost_usd - a.cost_usd)
  }, [layers])

  const callTotals = useMemo(() => {
    const grouped = new Map<string, LayerBreakdown>()
    layers.forEach(row => {
      const current = grouped.get(row.call_type) || { ...row, layer_type: row.layer_type, total_tokens: 0, cost_usd: 0, call_count: 0, avg_duration_ms: 0 }
      current.total_tokens += row.total_tokens || 0
      current.cost_usd += row.cost_usd || 0
      current.call_count += row.call_count || 0
      grouped.set(row.call_type, current)
    })
    return Array.from(grouped.values()).sort((a, b) => b.call_count - a.call_count)
  }, [layers])

  const totalMessages = messages?.totals.messages || 0
  const totalUsers = users.length
  const adjustedCost = messages?.totals.adjusted_cost_usd ?? summary?.total_cost_usd ?? 0
  const actualCost = messages?.totals.actual_cost_usd ?? 0
  const avgCostPerUser = totalUsers ? adjustedCost / totalUsers : 0
  const avgCostPerMessage = totalMessages ? adjustedCost / totalMessages : 0

  const lineData = { labels: period.map(p => new Date(p.period_start).toLocaleDateString("id-ID", { day: "numeric", month: "short" })), datasets: [{ label: "Biaya AI", data: period.map(p => p.cost_usd), borderColor: "#2563eb", backgroundColor: "rgba(37,99,235,.15)", fill: true, tension: .35 }, { label: "Call", data: period.map(p => p.call_count), borderColor: "#10b981", backgroundColor: "rgba(16,185,129,.12)", yAxisID: "y1", tension: .35 }] }
  const doughnutData = { labels: layerTotals.map(l => LAYER_LABELS[l.layer_type] || l.layer_type), datasets: [{ data: layerTotals.map(l => l.cost_usd), backgroundColor: layerTotals.map(l => LAYER_COLORS[l.layer_type] || "#94a3b8") }] }
  const callBarData = { labels: callTotals.slice(0, 10).map(c => callTypeLabel(c.call_type)), datasets: [{ label: "Jumlah panggilan", data: callTotals.slice(0, 10).map(c => c.call_count), backgroundColor: "#8b5cf6" }, { label: "Token", data: callTotals.slice(0, 10).map(c => c.total_tokens), backgroundColor: "#06b6d4" }] }
  const layerBarData = { labels: [...new Set(periodLayer.map(p => new Date(p.period_start).toLocaleDateString("id-ID", { day: "numeric", month: "short" })))], datasets: layerTotals.slice(0, 5).map(layer => ({ label: LAYER_LABELS[layer.layer_type] || layer.layer_type, data: [...new Set(periodLayer.map(p => new Date(p.period_start).toLocaleDateString("id-ID", { day: "numeric", month: "short" })))].map(label => periodLayer.filter(p => p.layer_type === layer.layer_type && new Date(p.period_start).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) === label).reduce((sum, row) => sum + row.cost_usd, 0)), backgroundColor: LAYER_COLORS[layer.layer_type] || "#94a3b8" })) }

  if (user?.role === "superadmin") return null

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-3xl bg-gradient-to-br from-blue-600 via-indigo-600 to-slate-900 p-6 text-white shadow-xl md:flex-row md:items-end md:justify-between">
        <div>
          <Badge className="mb-3 bg-white/15 text-white hover:bg-white/20">AI Usage Analytics</Badge>
          <h1 className="text-3xl font-bold tracking-tight">Statistik Penggunaan AI</h1>
          <p className="mt-2 max-w-2xl text-sm text-blue-100">Pantau biaya AI desa, rata-rata per pengguna/pesan, dan detail billing LLM, rerank, embedding, RAG, serta agent.</p>
        </div>
        <Button onClick={loadData} disabled={loading} className="bg-white text-blue-700 hover:bg-blue-50">
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Refresh
        </Button>
      </div>

      {error && <Alert variant="destructive"><AlertTitle>Terjadi kesalahan</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" /> Filter Analitik</CardTitle>
          <CardDescription>Pilih rentang tanggal dan pengguna WhatsApp/session tertentu.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2"><Label>Dari</Label><Input type="date" value={start} onChange={e => setStart(e.target.value)} /></div>
          <div className="space-y-2"><Label>Sampai</Label><Input type="date" value={end} onChange={e => setEnd(e.target.value)} /></div>
          <div className="space-y-2 md:col-span-2"><Label>Pengguna</Label><Select value={selectedUser} onValueChange={setSelectedUser}><SelectTrigger><SelectValue placeholder="Semua pengguna" /></SelectTrigger><SelectContent><SelectItem value="all">Semua pengguna</SelectItem>{users.map(u => <SelectItem key={`${u.wa_user_id || ""}|${u.session_id || ""}`} value={`${u.wa_user_id || ""}|${u.session_id || ""}`}>{userLabel(u)} · {u.message_count} pesan · {formatIDR(u.adjusted_cost_usd)}</SelectItem>)}</SelectContent></Select></div>
        </CardContent>
      </Card>

      {loading ? <div className="grid gap-4 md:grid-cols-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-32" />)}</div> : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={Wallet} title="Total Biaya Billed" value={formatIDR(adjustedCost)} detail={formatUSD(adjustedCost)} />
            <MetricCard icon={Users} title="Rata-rata / Pengguna" value={formatIDR(avgCostPerUser)} detail={`${totalUsers} pengguna`} />
            <MetricCard icon={MessageSquare} title="Rata-rata / Pesan" value={formatIDR(avgCostPerMessage)} detail={`${totalMessages} pesan billed`} />
            <MetricCard icon={Zap} title="Total AI Calls" value={formatNumber(messages?.totals.call_count ?? summary?.total_calls ?? 0)} detail={`${formatNumber(messages?.totals.total_tokens ?? summary?.total_tokens ?? 0)} token`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2"><CardHeader><CardTitle>Tren Biaya & Call</CardTitle></CardHeader><CardContent className="h-80">{charts ? <charts.Line data={lineData} options={{ responsive: true, maintainAspectRatio: false, interaction: { mode: "index" }, scales: { y: { beginAtZero: true }, y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false } } } }} /> : <Skeleton className="h-full" />}</CardContent></Card>
            <Card><CardHeader><CardTitle>Komposisi Layer</CardTitle></CardHeader><CardContent className="h-80">{charts && layerTotals.length ? <charts.Doughnut data={doughnutData} options={{ responsive: true, maintainAspectRatio: false }} /> : <EmptyChart />}</CardContent></Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader><CardTitle>Jumlah Pemanggilan AI</CardTitle><CardDescription>LLM, classifier, rewrite, rerank, embed, dan agent berdasarkan call type.</CardDescription></CardHeader><CardContent className="h-80">{charts && callTotals.length ? <charts.Bar data={callBarData} options={{ responsive: true, maintainAspectRatio: false }} /> : <EmptyChart />}</CardContent></Card>
            <Card><CardHeader><CardTitle>Biaya per Layer Harian</CardTitle></CardHeader><CardContent className="h-80">{charts && periodLayer.length ? <charts.Bar data={layerBarData} options={{ responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } } }} /> : <EmptyChart />}</CardContent></Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {layerTotals.slice(0, 5).map(layer => <Card key={layer.layer_type}><CardHeader className="pb-2"><CardTitle className="text-sm">{LAYER_LABELS[layer.layer_type] || layer.layer_type}</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{formatNumber(layer.call_count)} call</div><p className="text-xs text-muted-foreground">{formatIDR(layer.cost_usd)} · {formatNumber(layer.total_tokens)} token</p></CardContent></Card>)}
          </div>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Coins className="h-5 w-5" /> Detail Billing per Pesan</CardTitle><CardDescription>Klik detail untuk melihat breakdown biaya LLM, rerank, embed, classifier, dan layer lain.</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Pesan / Trace</TableHead><TableHead>User</TableHead><TableHead>Call</TableHead><TableHead>Token</TableHead><TableHead>Actual</TableHead><TableHead>Billed</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Aksi</TableHead></TableRow></TableHeader>
                <TableBody>
                  {!messages?.data.length ? <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Belum ada billing AI pada filter ini.</TableCell></TableRow> : messages.data.map(row => (
                    <TableRow key={row.id}>
                      <TableCell><div className="font-mono text-xs">{row.message_id || row.billing_group_id}</div><div className="text-xs text-muted-foreground">{row.trace_id}</div></TableCell>
                      <TableCell><div className="text-sm">{row.wa_user_id || "-"}</div><div className="text-xs text-muted-foreground">{row.session_id || "-"}</div></TableCell>
                      <TableCell>{row.call_count}</TableCell><TableCell>{formatNumber(row.total_tokens)}</TableCell><TableCell>{formatIDR(row.actual_cost_usd)}</TableCell><TableCell className="font-medium">{formatIDR(row.adjusted_cost_usd)}</TableCell><TableCell><Badge variant={row.status === "billed" ? "default" : "secondary"}>{row.status}</Badge></TableCell>
                      <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => openDetail(row)}><Eye className="mr-1 h-4 w-4" /> Detail</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[85vh] max-w-5xl overflow-y-auto">
          <DialogHeader><DialogTitle>Detail Biaya per Pesan</DialogTitle><DialogDescription>Breakdown biaya aktual dan billed dari setiap call AI dalam satu pesan.</DialogDescription></DialogHeader>
          {detailLoading ? <Skeleton className="h-64" /> : detail && <div className="space-y-4"><div className="grid gap-3 md:grid-cols-4"><MetricCard icon={Bot} title="Call" value={formatNumber(detail.billing.call_count)} detail={detail.billing.billing_group_id} /><MetricCard icon={Activity} title="Token" value={formatNumber(detail.billing.total_tokens)} detail={`${formatNumber(detail.billing.input_tokens)} in / ${formatNumber(detail.billing.output_tokens)} out`} /><MetricCard icon={Wallet} title="Actual" value={formatIDR(detail.billing.actual_cost_usd)} detail={formatUSD(detail.billing.actual_cost_usd)} /><MetricCard icon={Coins} title="Billed" value={formatIDR(detail.billing.adjusted_cost_usd)} detail={formatUSD(detail.billing.adjusted_cost_usd)} /></div><Table><TableHeader><TableRow><TableHead>Layer</TableHead><TableHead>Jenis Panggilan</TableHead><TableHead>Token</TableHead><TableHead>Actual</TableHead><TableHead>Billed</TableHead><TableHead>Durasi</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{detail.token_usage.map(row => <TableRow key={row.id}><TableCell>{LAYER_LABELS[row.layer_type] || row.layer_type}</TableCell><TableCell><Badge variant="outline">{callTypeLabel(row.call_type)}</Badge></TableCell><TableCell>{formatNumber(row.total_tokens)}</TableCell><TableCell>{formatIDR(row.actual_cost_usd)}</TableCell><TableCell className="font-medium">{formatIDR(row.adjusted_cost_usd)}</TableCell><TableCell>{row.duration_ms ? `${row.duration_ms} ms` : "-"}</TableCell><TableCell><Badge variant={row.success ? "default" : "destructive"}>{row.billing_status}</Badge></TableCell></TableRow>)}</TableBody></Table></div>}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MetricCard({ icon: Icon, title, value, detail }: { icon: ComponentType<{ className?: string }>; title: string; value: string; detail: string }) {
  return <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle><Icon className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{value}</div><p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p></CardContent></Card>
}

function EmptyChart() {
  return <div className="flex h-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground"><BarChart3 className="mr-2 h-4 w-4" /> Tidak ada data</div>
}
