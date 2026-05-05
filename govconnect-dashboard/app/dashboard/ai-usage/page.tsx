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
interface MessageBillingContext { process: string; process_label: string; admin?: { id: string; name: string; username: string } | null; knowledge?: { id: string; title: string; category: string } | null; document?: { id: string; title?: string | null; original_name?: string | null; category?: string | null; status?: string | null } | null; phone_number?: string | null; webchat_session?: string | null; raw_ref?: string | null }
interface MessageBilling { id: string; message_id: string | null; trace_id: string; billing_group_id: string; channel: string | null; wa_user_id: string | null; session_id: string | null; input_tokens: number; output_tokens: number; total_tokens: number; call_count: number; actual_cost_usd: number; adjusted_cost_usd: number; margin_usd: number; status: string; created_at: string; billed_at: string | null; context?: MessageBillingContext | null }
interface MessageResponse { total: number; totals: { messages: number; actual_cost_usd: number; adjusted_cost_usd: number; margin_usd: number; total_tokens: number; call_count: number }; data: MessageBilling[] }
interface TokenUsageRow { id: string; model?: string | null; layer_type: string; call_type: string; input_tokens: number; output_tokens: number; total_tokens: number; actual_cost_usd: number; adjusted_cost_usd: number; margin_usd: number; duration_ms: number | null; success: boolean; billing_status: string; created_at: string }
interface ToolTraceRow { id: string; tool_name: string; sequence: number; success: boolean; duration_ms: number | null; trust_level?: string | null; source_kind?: string | null; error_message?: string | null; created_at: string }
interface MessageDetail { billing: MessageBilling; ledger_entry: any | null; token_usage: TokenUsageRow[]; tool_traces?: ToolTraceRow[] }

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

const TOOL_LABELS: Record<string, { title: string; description: string }> = {
  search_knowledge: { title: "Cari knowledge base", description: "Mencari jawaban dari entri pengetahuan desa." },
  search_documents: { title: "Cari dokumen", description: "Mencari konteks dari dokumen knowledge base." },
  get_service_info: { title: "Ambil info layanan", description: "Membaca detail layanan/form publik yang tersedia." },
  create_complaint: { title: "Buat pengaduan", description: "Mencatat laporan pengaduan warga." },
  update_complaint: { title: "Update pengaduan", description: "Memperbarui data pengaduan warga." },
  create_service_request: { title: "Buat permohonan layanan", description: "Mencatat permohonan layanan warga." },
  get_service_request_edit_link: { title: "Ambil link edit layanan", description: "Membuat/mengambil tautan edit permohonan layanan." },
  check_status: { title: "Cek status", description: "Mengecek status pengaduan atau permohonan layanan." },
  cancel_request: { title: "Batalkan request", description: "Membatalkan pengaduan atau permohonan layanan." },
  get_my_history: { title: "Ambil riwayat", description: "Membaca riwayat pengaduan/layanan milik user." },
  get_village_profile: { title: "Ambil profil desa", description: "Membaca profil, alamat, dan info dasar desa." },
  get_emergency_contacts: { title: "Ambil kontak penting", description: "Membaca nomor penting/darurat desa." },
  search_user_memory: { title: "Cari memori user", description: "Mencari konteks preferensi/riwayat user yang relevan." },
}

function toolLabel(toolName: string) {
  return TOOL_LABELS[toolName] || { title: toolName.replace(/_/g, " "), description: "Tool/action agent." }
}

function callTypeLabel(value: string) {
  return CALL_TYPE_LABELS[value] || value.replace(/_/g, " ")
}

function aiCallPurpose(row: TokenUsageRow) {
  const purposes: Record<string, { title: string; description: string }> = {
    main_chat: {
      title: "Agent LLM menjawab pesan",
      description: "Model utama menyusun jawaban akhir dari konteks percakapan, RAG, dan data desa.",
    },
    agent_orchestrator: {
      title: "Agent / tool orchestration",
      description: "AI menentukan langkah kerja, memilih action/tool, atau mengatur alur sebelum jawaban final.",
    },
    embedding_single: {
      title: "Embedding satu teks",
      description: "Mengubah satu teks, pertanyaan, atau chunk menjadi vector untuk pencarian knowledge base.",
    },
    embedding_batch: {
      title: "Embedding batch",
      description: "Mengubah banyak chunk dokumen/knowledge menjadi vector sekaligus.",
    },
    rag_query_expand: {
      title: "Rewrite query RAG",
      description: "Menulis ulang/memperluas pertanyaan agar retrieval knowledge base lebih akurat.",
    },
    rerank_documents: {
      title: "Reranking hasil RAG",
      description: "Mengurutkan ulang kandidat dokumen/knowledge supaya konteks paling relevan dipakai.",
    },
    unified_classify: {
      title: "Classifier intent/kategori",
      description: "Mengklasifikasi maksud pesan: tanya jawab, pengaduan, layanan, salam, konfirmasi, atau alur lain.",
    },
    confirmation_classify: {
      title: "Classifier konfirmasi",
      description: "Mendeteksi apakah user mengonfirmasi, membatalkan, atau memperbaiki data.",
    },
    greeting_classify: {
      title: "Classifier salam",
      description: "Mendeteksi salam/pembuka agar respons percakapan lebih natural.",
    },
    farewell_classify: {
      title: "Classifier penutup",
      description: "Mendeteksi percakapan selesai, ucapan terima kasih, atau penutup.",
    },
    complaint_type_match: {
      title: "Match kategori/jenis pengaduan",
      description: "Mencocokkan pesan dengan kategori dan jenis pengaduan yang tersedia di desa.",
    },
    service_slug_match: {
      title: "Match layanan/form",
      description: "Mencocokkan permintaan user dengan layanan atau form publik yang tersedia.",
    },
  }

  return purposes[row.call_type] || {
    title: callTypeLabel(row.call_type),
    description: `${LAYER_LABELS[row.layer_type] || row.layer_type} · ${row.call_type || "unknown"}`,
  }
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

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-"
  return new Date(value).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function billingStatusLabel(status: string) {
  const labels: Record<string, string> = {
    billed: "Sudah ditagihkan",
    skipped_zero_cost: "Biaya nol, tidak ditagihkan",
    pending: "Menunggu billing",
    failed: "Billing gagal",
  }
  return labels[status] || status.replace(/_/g, " ")
}

function describeBillingRow(row: MessageBilling) {
  const ctx = row.context
  if (ctx?.process_label) {
    if (ctx.process === "dashboard_knowledge_test") {
      return {
        title: ctx.process_label,
        subtitle: ctx.admin ? `${ctx.admin.name} (@${ctx.admin.username})` : (ctx.webchat_session || ctx.raw_ref || "-"),
      }
    }
    if (ctx.process === "knowledge_embed") {
      return {
        title: ctx.process_label,
        subtitle: ctx.knowledge ? `${ctx.knowledge.title} · ${ctx.knowledge.category}` : (ctx.raw_ref || "-"),
      }
    }
    if (ctx.process === "document_embed" || ctx.process === "document_ocr") {
      return {
        title: ctx.process_label,
        subtitle: ctx.document ? `${ctx.document.title || ctx.document.original_name || ctx.document.id} · ${ctx.document.category || "Tanpa kategori"}` : (ctx.raw_ref || "-"),
      }
    }
    if (ctx.process === "whatsapp_chat") {
      return {
        title: ctx.process_label,
        subtitle: ctx.phone_number || ctx.raw_ref || "-",
      }
    }
    if (ctx.process === "webchat_chat") {
      return {
        title: ctx.process_label,
        subtitle: ctx.webchat_session || ctx.raw_ref || "-",
      }
    }
    return {
      title: ctx.process_label,
      subtitle: ctx.raw_ref || "-",
    }
  }

  const source = row.trace_id?.split(":")[0] || row.channel || "ai"
  const rawRef = row.message_id || row.billing_group_id || row.trace_id || "-"
  return { title: `Proses AI ${source}`, subtitle: rawRef }
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
          <div className="space-y-2 md:col-span-2"><Label>Pengguna</Label><Select value={selectedUser} onValueChange={setSelectedUser}><SelectTrigger><SelectValue placeholder="Semua pengguna" /></SelectTrigger><SelectContent><SelectItem value="all">Semua pengguna</SelectItem>{users.map(u => <SelectItem key={`${u.wa_user_id || ""}|${u.session_id || ""}`} value={`${u.wa_user_id || ""}|${u.session_id || ""}`}>{userLabel(u)} · {u.message_count} pesan · {formatUSD(u.adjusted_cost_usd)}</SelectItem>)}</SelectContent></Select></div>
        </CardContent>
      </Card>

      {loading ? <div className="grid gap-4 md:grid-cols-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-32" />)}</div> : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={Wallet} title="Total Biaya Billed" value={formatIDR(adjustedCost)} detail={formatUSD(adjustedCost)} />
            <MetricCard icon={Users} title="Rata-rata / Pengguna" value={formatIDR(avgCostPerUser)} detail={formatUSD(avgCostPerUser)} />
            <MetricCard icon={MessageSquare} title="Rata-rata / Pesan" value={formatIDR(avgCostPerMessage)} detail={formatUSD(avgCostPerMessage)} />
            <MetricCard icon={Zap} title="Total AI Calls" value={formatNumber(messages?.totals.call_count ?? summary?.total_calls ?? 0)} detail={`${formatNumber(messages?.totals.total_tokens ?? summary?.total_tokens ?? 0)} token`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2"><CardHeader><CardTitle>Tren Biaya & Call</CardTitle><CardDescription>Biaya grafik ini memakai cost per call (`cost_usd`) dalam USD, bukan billed wallet per pesan.</CardDescription></CardHeader><CardContent className="h-80">{charts ? <charts.Line data={lineData} options={{ responsive: true, maintainAspectRatio: false, interaction: { mode: "index" }, scales: { y: { beginAtZero: true }, y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false } } } }} /> : <Skeleton className="h-full" />}</CardContent></Card>
            <Card>
              <CardHeader><CardTitle>Komposisi Layer</CardTitle><CardDescription>Lapisan ini menampilkan biaya per call AI (USD), sedangkan tabel billing di bawah menampilkan biaya billed per pesan.</CardDescription></CardHeader><CardContent className="h-80">{charts && layerTotals.length ? <charts.Doughnut data={doughnutData} options={{ responsive: true, maintainAspectRatio: false }} /> : <EmptyChart />}</CardContent></Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader><CardTitle>Jumlah Pemanggilan AI</CardTitle><CardDescription>LLM, classifier, rewrite, rerank, embed, dan agent berdasarkan call type.</CardDescription></CardHeader><CardContent className="h-80">{charts && callTotals.length ? <charts.Bar data={callBarData} options={{ responsive: true, maintainAspectRatio: false }} /> : <EmptyChart />}</CardContent></Card>
            <Card><CardHeader><CardTitle>Biaya per Layer Harian</CardTitle></CardHeader><CardContent className="h-80">{charts && periodLayer.length ? <charts.Bar data={layerBarData} options={{ responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } } }} /> : <EmptyChart />}</CardContent></Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {layerTotals.slice(0, 5).map(layer => <Card key={layer.layer_type}><CardHeader className="pb-2"><CardTitle className="text-sm">{LAYER_LABELS[layer.layer_type] || layer.layer_type}</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{formatNumber(layer.call_count)} call</div><p className="text-xs text-muted-foreground">{formatUSD(layer.cost_usd)} · {formatNumber(layer.total_tokens)} token</p></CardContent></Card>)}
          </div>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Coins className="h-5 w-5" /> Detail Billing per Pesan</CardTitle><CardDescription>Klik detail untuk melihat breakdown biaya billed dari setiap call AI dalam satu pesan.</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Pesan / Trace</TableHead><TableHead>User</TableHead><TableHead>Waktu</TableHead><TableHead>Call</TableHead><TableHead>Token</TableHead><TableHead>Billed</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Aksi</TableHead></TableRow></TableHeader>
                <TableBody>
                  {!messages?.data.length ? <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Belum ada billing AI pada filter ini.</TableCell></TableRow> : messages.data.map(row => {
                    const described = describeBillingRow(row)
                    return (
                    <TableRow key={row.id}>
                      <TableCell><div className="text-sm font-medium">{described.title}</div><div className="text-xs text-muted-foreground">{described.subtitle}</div><div className="font-mono text-[11px] text-muted-foreground">Trace: {row.trace_id}</div></TableCell>
                      <TableCell><div className="text-sm">{row.context?.admin?.name || row.context?.phone_number || row.wa_user_id || "-"}</div><div className="text-xs text-muted-foreground">{row.context?.admin ? `@${row.context.admin.username}` : (row.context?.webchat_session || row.session_id || "-")}</div></TableCell>
                      <TableCell><div className="text-sm">{formatDateTime(row.created_at)}</div><div className="text-xs text-muted-foreground">Billed: {formatDateTime(row.billed_at)}</div></TableCell>
                      <TableCell>{row.call_count}</TableCell><TableCell>{formatNumber(row.total_tokens)}</TableCell><TableCell className="font-medium">{formatUSD(row.adjusted_cost_usd)}</TableCell><TableCell><Badge variant={row.status === "billed" ? "default" : "secondary"}>{billingStatusLabel(row.status)}</Badge></TableCell>
                      <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => openDetail(row)}><Eye className="mr-1 h-4 w-4" /> Detail</Button></TableCell>
                    </TableRow>
                  )})}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="!w-[calc(100vw-2rem)] !max-w-[calc(100vw-2rem)] max-h-[92vh] overflow-y-auto overflow-x-hidden p-4 lg:!w-[calc(100vw-4rem)] lg:!max-w-[calc(100vw-4rem)] lg:p-5 xl:!w-[1500px] xl:!max-w-[1500px]">
          <DialogHeader><DialogTitle>Detail Biaya per Pesan</DialogTitle><DialogDescription>Breakdown biaya billed dari setiap call AI dalam satu pesan. Lebar modal diperbesar supaya rincian lebih mudah dibaca.</DialogDescription></DialogHeader>
          {detailLoading ? <Skeleton className="h-64" /> : detail && <div className="space-y-4"><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4"><CompactMetricCard icon={Bot} title="Call" value={formatNumber(detail.billing.call_count)} detail={describeBillingRow(detail.billing).title} /><CompactMetricCard icon={MessageSquare} title="Proses" value={describeBillingRow(detail.billing).subtitle} detail={`Trace: ${detail.billing.trace_id}`} /><CompactMetricCard icon={Activity} title="Token" value={formatNumber(detail.billing.total_tokens)} detail={`${formatNumber(detail.billing.input_tokens)} in / ${formatNumber(detail.billing.output_tokens)} out`} /><CompactMetricCard icon={Coins} title="Billed" value={formatUSD(detail.billing.adjusted_cost_usd)} detail="Billed USD" /></div><div className="grid gap-3 md:grid-cols-2"><Card><CardHeader className="pb-2"><CardTitle className="text-sm">Waktu proses</CardTitle></CardHeader><CardContent className="space-y-1 text-sm"><div>Dibuat: {formatDateTime(detail.billing.created_at)}</div><div>Ditagihkan: {formatDateTime(detail.billing.billed_at)}</div><div>Status: {billingStatusLabel(detail.billing.status)}</div></CardContent></Card><Card><CardHeader className="pb-2"><CardTitle className="text-sm">Identitas proses</CardTitle></CardHeader><CardContent className="space-y-1 text-sm"><div>Admin tester: {detail.billing.context?.admin ? `${detail.billing.context.admin.name} (@${detail.billing.context.admin.username})` : "-"}</div><div>No. WA: {detail.billing.context?.phone_number || "-"}</div><div>Session webchat: {detail.billing.context?.webchat_session || "-"}</div><div>Knowledge: {detail.billing.context?.knowledge ? `${detail.billing.context.knowledge.title} · ${detail.billing.context.knowledge.category}` : "-"}</div><div>Dokumen: {detail.billing.context?.document ? `${detail.billing.context.document.title || detail.billing.context.document.original_name || detail.billing.context.document.id} · ${detail.billing.context.document.category || "Tanpa kategori"}` : "-"}</div><div className="break-all">Ref: {detail.billing.context?.raw_ref || detail.billing.message_id || detail.billing.billing_group_id || "-"}</div></CardContent></Card></div><Table><TableHeader><TableRow><TableHead>Layer</TableHead><TableHead>Jenis Panggilan</TableHead><TableHead>Fungsi</TableHead><TableHead>Model</TableHead><TableHead>Waktu</TableHead><TableHead>Token</TableHead><TableHead>Billed</TableHead><TableHead>Durasi</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{detail.token_usage.map(row => { const purpose = aiCallPurpose(row); return <TableRow key={row.id}><TableCell>{LAYER_LABELS[row.layer_type] || row.layer_type}</TableCell><TableCell><Badge variant="outline">{callTypeLabel(row.call_type)}</Badge></TableCell><TableCell><div className="min-w-64 max-w-md"><div className="text-sm font-medium">{purpose.title}</div><div className="text-xs text-muted-foreground">{purpose.description}</div></div></TableCell><TableCell className="font-mono text-xs">{row.model || "-"}</TableCell><TableCell className="text-sm">{formatDateTime(row.created_at)}</TableCell><TableCell>{formatNumber(row.total_tokens)}</TableCell><TableCell className="font-medium">{formatUSD(row.adjusted_cost_usd)}</TableCell><TableCell>{row.duration_ms ? `${row.duration_ms} ms` : "-"}</TableCell><TableCell><Badge variant={row.success ? "default" : "destructive"}>{billingStatusLabel(row.billing_status)}</Badge></TableCell></TableRow> })}</TableBody></Table><ToolTraceTable rows={detail.tool_traces || []} /></div>}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CompactMetricCard({ icon: Icon, title, value, detail }: { icon: ComponentType<{ className?: string }>; title: string; value: string; detail: string }) {
  return <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 px-3 py-2"><CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle><Icon className="h-3.5 w-3.5 text-muted-foreground" /></CardHeader><CardContent className="px-3 pb-3 pt-0"><div className="truncate text-base font-semibold">{value}</div><p className="mt-0.5 truncate text-[11px] text-muted-foreground">{detail}</p></CardContent></Card>
}

function MetricCard({ icon: Icon, title, value, detail }: { icon: ComponentType<{ className?: string }>; title: string; value: string; detail: string }) {
  return <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle><Icon className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{value}</div><p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p></CardContent></Card>
}

function ToolTraceTable({ rows }: { rows: ToolTraceRow[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Tool / Action Calls</CardTitle>
        <CardDescription>Detail action yang dipanggil agent dalam pesan ini.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Urutan</TableHead>
              <TableHead>Tool</TableHead>
              <TableHead>Fungsi</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Durasi</TableHead>
              <TableHead>Trust / Source</TableHead>
              <TableHead>Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!rows.length ? (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">Tidak ada tool/action call pada pesan ini.</TableCell>
              </TableRow>
            ) : rows.map((row) => {
              const label = toolLabel(row.tool_name)
              return (
                <TableRow key={row.id}>
                  <TableCell>{row.sequence}</TableCell>
                  <TableCell><Badge variant="outline">{row.tool_name}</Badge></TableCell>
                  <TableCell><div className="max-w-md"><div className="text-sm font-medium">{label.title}</div><div className="text-xs text-muted-foreground">{label.description}</div></div></TableCell>
                  <TableCell><Badge variant={row.success ? "default" : "destructive"}>{row.success ? "Sukses" : "Gagal"}</Badge></TableCell>
                  <TableCell>{row.duration_ms ? `${row.duration_ms} ms` : "-"}</TableCell>
                  <TableCell><div className="text-xs"><div>{row.trust_level || "-"}</div><div className="text-muted-foreground">{row.source_kind || "-"}</div></div></TableCell>
                  <TableCell className="max-w-xs truncate text-xs text-muted-foreground">{row.error_message || "-"}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function EmptyChart() {
  return <div className="flex h-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground"><BarChart3 className="mr-2 h-4 w-4" /> Tidak ada data</div>
}
