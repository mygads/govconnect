"use client"

import { useCallback, useEffect, useState } from "react"
import { redirect } from "next/navigation"
import {
  BarChart3,
  Activity,
  Cpu,
  MessageSquare,
  TrendingUp,
  Building2,
  Zap,
  DollarSign,
  RefreshCw,
  Eye,
  X,
  Shield,
  Users,
  Calculator,
  Info,
  Layers,
  Wallet,
  Trash2,
} from "lucide-react"
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js"
import { Bar, Line, Doughnut } from "react-chartjs-2"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/components/auth/AuthContext"

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
)

// ==================== Types ====================

interface TokenSummary {
  total_input_tokens: number
  total_output_tokens: number
  total_tokens: number
  total_cost_usd: number
  total_calls: number
  micro_nlu_calls: number
  full_nlu_calls: number
  micro_nlu_tokens: number
  full_nlu_tokens: number
  embedding_calls: number
  embedding_tokens: number
  embedding_cost: number
  rag_expand_calls: number
  rag_expand_tokens: number
  main_chat_calls: number
  main_chat_tokens: number
  main_chat_cost: number
  full_nlu_cost: number
  micro_nlu_cost: number
}

interface PeriodUsage {
  period_start: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number
  call_count: number
}

interface PeriodLayerUsage extends PeriodUsage {
  layer_type: string
}

interface ModelUsage {
  model: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number
  call_count: number
  avg_duration_ms: number
}

interface VillageUsage {
  village_id: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number
  call_count: number
}

interface LayerBreakdown {
  layer_type: string
  call_type: string
  model: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number
  call_count: number
  avg_duration_ms: number
}

interface AvgPerChat {
  avg_input: number
  avg_output: number
  avg_total: number
  total_chats: number
}

interface VillageResponse {
  village_id: string
  response_count: number
  unique_users: number
}

interface VillageModelDetail {
  village_id: string
  model: string
  layer_type: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number
  call_count: number
}

interface VillageInfo {
  id: string
  name: string
  slug: string
}

// ==================== Gemini Pricing (per 1M tokens, USD, paid tier <=200k context) ====================

const GEMINI_PRICING: Record<string, { input: number; output: number }> = {
  // Gemini 3
  "gemini-3-pro-preview": { input: 2.00, output: 12.00 },
  "gemini-3-flash-preview": { input: 0.50, output: 3.00 },
  // Gemini 2.5
  "gemini-2.5-pro": { input: 1.25, output: 10.00 },
  "gemini-2.5-pro-preview": { input: 1.25, output: 10.00 },
  "gemini-2.5-flash": { input: 0.30, output: 2.50 },
  "gemini-2.5-flash-preview": { input: 0.30, output: 2.50 },
  "gemini-2.5-flash-lite": { input: 0.10, output: 0.40 },
  "gemini-2.5-flash-lite-preview": { input: 0.10, output: 0.40 },
  // Gemini 2.0
  "gemini-2.0-flash": { input: 0.10, output: 0.40 },
  "gemini-2.0-flash-exp": { input: 0.10, output: 0.40 },
  "gemini-2.0-flash-lite": { input: 0.075, output: 0.30 },
  // Gemini 1.5 (legacy)
  "gemini-1.5-pro": { input: 1.25, output: 5.00 },
  "gemini-1.5-flash": { input: 0.075, output: 0.30 },
  "gemini-1.5-flash-8b": { input: 0.0375, output: 0.15 },
}

/** Find pricing for a model name (supports partial match for date-suffixed names like gemini-2.5-flash-preview-05-20) */
function findModelPricing(model: string): { input: number; output: number } {
  if (GEMINI_PRICING[model]) return GEMINI_PRICING[model]
  // Try prefix match (longest first)
  const keys = Object.keys(GEMINI_PRICING).sort((a, b) => b.length - a.length)
  for (const key of keys) {
    if (model.startsWith(key)) return GEMINI_PRICING[key]
  }
  // Fallback by family
  if (model.includes("flash-lite")) return { input: 0.10, output: 0.40 }
  if (model.includes("flash")) return { input: 0.30, output: 2.50 }
  if (model.includes("pro")) return { input: 1.25, output: 10.00 }
  return { input: 0.30, output: 2.50 } // default flash pricing
}

function calcModelCost(model: string, inputTokens: number, outputTokens: number) {
  const p = findModelPricing(model)
  const inputCost = (inputTokens / 1_000_000) * p.input
  const outputCost = (outputTokens / 1_000_000) * p.output
  return { inputCost, outputCost, totalCost: inputCost + outputCost, pricing: p }
}

// ==================== Helpers ====================

const USD_TO_IDR = 17_000

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return n.toLocaleString("id-ID")
}

function formatIDR(usd: number): string {
  const idr = usd * USD_TO_IDR
  if (idr >= 1_000_000) return "Rp " + (idr / 1_000_000).toFixed(2) + " jt"
  if (idr >= 1_000) return "Rp " + (idr / 1_000).toFixed(1) + " rb"
  if (idr >= 1) return "Rp " + idr.toFixed(0)
  if (idr >= 0.01) return "Rp " + idr.toFixed(2)
  return "Rp 0"
}

function formatUSD(usd: number): string {
  return "$" + usd.toFixed(4)
}

function formatDate(iso: string, period: string): string {
  const d = new Date(iso)
  if (period === "month") return d.toLocaleDateString("id-ID", { month: "short", year: "numeric" })
  if (period === "week") return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" })
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" })
}

const LAYER_COLORS: Record<string, string> = {
  full_nlu: "#6366f1",
  micro_nlu: "#f59e0b",
  rag_expand: "#10b981",
  embedding: "#ef4444",
}

const LAYER_LABELS: Record<string, string> = {
  full_nlu: "Full NLU",
  micro_nlu: "Micro NLU",
  rag_expand: "RAG Expand",
  embedding: "Embedding",
}

const MODEL_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4",
]

// ==================== Fetcher ====================

async function fetchData<T>(slug: string, params?: Record<string, string>): Promise<T | null> {
  try {
    const qs = params ? "?" + new URLSearchParams(params).toString() : ""
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null
    const res = await fetch(`/api/statistics/token-usage/${slug}${qs}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: "top" as const } },
}

const stackedOptions = {
  ...chartOptions,
  scales: {
    x: { stacked: true },
    y: { stacked: true },
  },
}

// ==================== Component ====================

export default function AITokenUsagePage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState("ringkasan")
  const [period, setPeriod] = useState<"day" | "week" | "month">("day")

  // Ringkasan tab data (loaded on mount)
  const [summary, setSummary] = useState<TokenSummary | null>(null)
  const [byModel, setByModel] = useState<ModelUsage[]>([])
  const [avgPerChat, setAvgPerChat] = useState<AvgPerChat | null>(null)
  const [bySource, setBySource] = useState<{ source: string; total_calls: number; total_tokens: number; input_tokens: number; output_tokens: number; total_cost_usd: number }[]>([])
  const [summaryLoading, setSummaryLoading] = useState(true)

  // Periode tab data (loaded on demand)
  const [byPeriod, setByPeriod] = useState<PeriodUsage[]>([])
  const [byPeriodLayer, setByPeriodLayer] = useState<PeriodLayerUsage[]>([])
  const [periodeLoading, setPeriodeLoading] = useState(false)
  const [periodeLoaded, setPeriodeLoaded] = useState(false)

  // Village tab data (loaded on demand — includes all model detail preloaded)
  const [byVillage, setByVillage] = useState<VillageUsage[]>([])
  const [responsesByVillage, setResponsesByVillage] = useState<VillageResponse[]>([])
  const [allModelDetail, setAllModelDetail] = useState<VillageModelDetail[]>([])
  const [villageNames, setVillageNames] = useState<Record<string, string>>({})
  const [villageLoading, setVillageLoading] = useState(false)
  const [villageLoaded, setVillageLoaded] = useState(false)

  // Village detail modal (data from preloaded allModelDetail, no extra API call)
  const [detailVillageId, setDetailVillageId] = useState<string | null>(null)

  // Layer tab data (loaded on demand)
  const [layerBreakdown, setLayerBreakdown] = useState<LayerBreakdown[]>([])
  const [layerLoading, setLayerLoading] = useState(false)
  const [layerLoaded, setLayerLoaded] = useState(false)

  // Reset database
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    if (user && user.role !== "superadmin") redirect("/dashboard")
  }, [user])

  // Load summary data on mount (4 calls)
  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    const [s, bm, apc, bs] = await Promise.all([
      fetchData<TokenSummary>("summary"),
      fetchData<ModelUsage[]>("by-model"),
      fetchData<AvgPerChat>("avg-per-chat"),
      fetchData<{ source: string; total_calls: number; total_tokens: number; input_tokens: number; output_tokens: number; total_cost_usd: number }[]>("by-source"),
    ])
    setSummary(s)
    setByModel(bm || [])
    setAvgPerChat(apc)
    setBySource(bs || [])
    setSummaryLoading(false)
  }, [])

  useEffect(() => { loadSummary() }, [loadSummary])

  // Load periode data on demand
  const loadPeriode = useCallback(async () => {
    setPeriodeLoading(true)
    const params = { period }
    const [bp, bpl] = await Promise.all([
      fetchData<PeriodUsage[]>("by-period", params),
      fetchData<PeriodLayerUsage[]>("by-period-layer", params),
    ])
    setByPeriod(bp || [])
    setByPeriodLayer(bpl || [])
    setPeriodeLoading(false)
    setPeriodeLoaded(true)
  }, [period])

  // Load village data on demand (4 calls: by-village, responses, ALL model-detail, village names)
  const loadVillage = useCallback(async () => {
    setVillageLoading(true)
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null
    const [bv, rbv, md, villagesRes] = await Promise.all([
      fetchData<VillageUsage[]>("by-village"),
      fetchData<VillageResponse[]>("responses-by-village"),
      fetchData<VillageModelDetail[]>("village-model-detail"),
      fetch("/api/superadmin/villages", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })),
    ])
    setByVillage(bv || [])
    setResponsesByVillage(rbv || [])
    setAllModelDetail(md || [])
    // Build village name map — API returns { data: [...] } not plain array
    const nameMap: Record<string, string> = {}
    const villageList = Array.isArray(villagesRes) ? villagesRes : (villagesRes?.data || [])
    villageList.forEach((v: VillageInfo) => { nameMap[v.id] = v.name })
    setVillageNames(nameMap)
    setVillageLoading(false)
    setVillageLoaded(true)
  }, [])

  // Load layer data on demand
  const loadLayer = useCallback(async () => {
    setLayerLoading(true)
    const lb = await fetchData<LayerBreakdown[]>("layer-breakdown")
    setLayerBreakdown(lb || [])
    setLayerLoading(false)
    setLayerLoaded(true)
  }, [])

  // Helper: resolve village name
  const getVillageName = useCallback((villageId: string | null | undefined): string => {
    if (!villageId || villageId === "" || villageId === "null" || villageId === "undefined") return "Superadmin (Testing)"
    return villageNames[villageId] || villageId
  }, [villageNames])

  // Helper: get model detail rows for a specific village (from preloaded data)
  const getVillageModelData = useCallback((villageId: string): VillageModelDetail[] => {
    return allModelDetail.filter(d => d.village_id === villageId)
  }, [allModelDetail])

  // Helper: compute calculated cost for a village using Gemini pricing
  const calcVillageCost = useCallback((villageId: string) => {
    const details = getVillageModelData(villageId)
    let totalInputCost = 0, totalOutputCost = 0
    for (const d of details) {
      const c = calcModelCost(d.model, d.input_tokens, d.output_tokens)
      totalInputCost += c.inputCost
      totalOutputCost += c.outputCost
    }
    return { inputCost: totalInputCost, outputCost: totalOutputCost, totalCost: totalInputCost + totalOutputCost }
  }, [getVillageModelData])

  // Handle tab change — load data on demand
  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    if (tab === "periode" && !periodeLoaded) loadPeriode()
    if (tab === "village" && !villageLoaded) loadVillage()
    if (tab === "layer" && !layerLoaded) loadLayer()
  }

  // Reload periode when period selector changes
  useEffect(() => {
    if (activeTab === "periode") {
      setPeriodeLoaded(false)
      loadPeriode()
    }
  }, [period]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset all token usage data
  const handleResetDatabase = async () => {
    try {
      setResetting(true)
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null
      const res = await fetch("/api/superadmin/reset-token-usage", {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        // Clear all local state and reload
        setSummary(null)
        setByModel([])
        setAvgPerChat(null)
        setBySource([])
        setByPeriod([])
        setByPeriodLayer([])
        setByVillage([])
        setResponsesByVillage([])
        setAllModelDetail([])
        setLayerBreakdown([])
        setPeriodeLoaded(false)
        setVillageLoaded(false)
        setLayerLoaded(false)
        // Reload summary
        loadSummary()
      }
    } catch (e) {
      console.error("Reset failed:", e)
    } finally {
      setResetting(false)
      setShowResetConfirm(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cpu className="h-6 w-6 text-indigo-600" />
            AI Token Usage
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitoring penggunaan token AI — Harga dari pricing resmi Gemini API (Kurs: $1 = Rp {USD_TO_IDR.toLocaleString("id-ID")})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowResetConfirm(true)}
            disabled={resetting || summaryLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950 transition-colors disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            Reset Data
          </button>
          <button
            onClick={() => {
              loadSummary()
              if (periodeLoaded) { setPeriodeLoaded(false); loadPeriode() }
              if (villageLoaded) { setVillageLoaded(false); loadVillage() }
              if (layerLoaded) { setLayerLoaded(false); loadLayer() }
            }}
            disabled={summaryLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${summaryLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Reset Confirmation Dialog */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl p-6 max-w-md mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-red-100 dark:bg-red-900 p-2">
                <Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Reset Semua Data AI Usage?</h3>
                <p className="text-sm text-muted-foreground">Tindakan ini tidak dapat dibatalkan</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Semua data penggunaan token AI (termasuk statistik per desa, model, dan periode) akan dihapus secara permanen.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                disabled={resetting}
                className="px-4 py-2 text-sm font-medium rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Batal
              </button>
              <button
                onClick={handleResetDatabase}
                disabled={resetting}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {resetting ? "Menghapus..." : "Ya, Reset Semua"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards — Informasi Umum */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <SummaryCard
          icon={<Zap className="h-5 w-5 text-indigo-600" />}
          label="Total Token"
          value={summaryLoading ? null : formatNumber(summary?.total_tokens || 0)}
          sub={summaryLoading ? null : `${formatNumber(summary?.total_input_tokens || 0)} in / ${formatNumber(summary?.total_output_tokens || 0)} out`}
          loading={summaryLoading}
        />
        <SummaryCard
          icon={<DollarSign className="h-5 w-5 text-emerald-600" />}
          label="Total Biaya"
          value={summaryLoading ? null : formatIDR(summary?.total_cost_usd || 0)}
          sub={summaryLoading ? null : formatUSD(summary?.total_cost_usd || 0)}
          loading={summaryLoading}
        />
        <SummaryCard
          icon={<Activity className="h-5 w-5 text-amber-600" />}
          label="Total API Calls"
          value={summaryLoading ? null : formatNumber(summary?.total_calls || 0)}
          sub={summaryLoading ? null : `${formatNumber(summary?.full_nlu_calls || 0)} full / ${formatNumber(summary?.micro_nlu_calls || 0)} micro`}
          loading={summaryLoading}
        />
        <SummaryCard
          icon={<MessageSquare className="h-5 w-5 text-blue-600" />}
          label="Sesi Chat (main_chat)"
          value={summaryLoading ? null : formatNumber(summary?.main_chat_calls || 0)}
          sub={summaryLoading ? null : `${formatNumber(summary?.main_chat_tokens || 0)} tokens · ${formatIDR(summary?.main_chat_cost || 0)}`}
          loading={summaryLoading}
        />
        <SummaryCard
          icon={<Layers className="h-5 w-5 text-purple-600" />}
          label="Embedding"
          value={summaryLoading ? null : formatNumber(summary?.embedding_tokens || 0)}
          sub={summaryLoading ? null : `${formatNumber(summary?.embedding_calls || 0)} calls · ${formatIDR(summary?.embedding_cost || 0)}`}
          loading={summaryLoading}
        />
      </div>

      {/* Tabs — Informasi Detail */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="ringkasan">Ikhtisar Token</TabsTrigger>
          <TabsTrigger value="biaya">Biaya</TabsTrigger>
          <TabsTrigger value="periode">Per Periode</TabsTrigger>
          <TabsTrigger value="village">Per Desa</TabsTrigger>
          <TabsTrigger value="layer">Layer Detail</TabsTrigger>
        </TabsList>

        {/* ====== IKHTISAR TOKEN TAB ====== */}
        <TabsContent value="ringkasan" className="space-y-6 mt-4">
          {/* Token distribution cards — Full NLU / Micro NLU / Embedding / RAG */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-3 w-3 rounded-full bg-indigo-500" />
                <span className="text-xs text-muted-foreground font-medium">Full NLU</span>
              </div>
              <p className="text-lg font-bold">{summaryLoading ? "..." : formatNumber(summary?.full_nlu_tokens || 0)}</p>
              <p className="text-xs text-muted-foreground">{formatNumber(summary?.full_nlu_calls || 0)} calls · {formatIDR(summary?.full_nlu_cost || 0)}</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-3 w-3 rounded-full bg-amber-500" />
                <span className="text-xs text-muted-foreground font-medium">Micro NLU</span>
              </div>
              <p className="text-lg font-bold">{summaryLoading ? "..." : formatNumber(summary?.micro_nlu_tokens || 0)}</p>
              <p className="text-xs text-muted-foreground">{formatNumber(summary?.micro_nlu_calls || 0)} calls · {formatIDR(summary?.micro_nlu_cost || 0)}</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-3 w-3 rounded-full bg-purple-500" />
                <span className="text-xs text-muted-foreground font-medium">Embedding</span>
              </div>
              <p className="text-lg font-bold">{summaryLoading ? "..." : formatNumber(summary?.embedding_tokens || 0)}</p>
              <p className="text-xs text-muted-foreground">{formatNumber(summary?.embedding_calls || 0)} calls · {formatIDR(summary?.embedding_cost || 0)}</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-3 w-3 rounded-full bg-teal-500" />
                <span className="text-xs text-muted-foreground font-medium">RAG Expand</span>
              </div>
              <p className="text-lg font-bold">{summaryLoading ? "..." : formatNumber(summary?.rag_expand_tokens || 0)}</p>
              <p className="text-xs text-muted-foreground">{formatNumber(summary?.rag_expand_calls || 0)} calls</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Layer Distribution Doughnut (Full NLU / Micro NLU / Embedding / RAG) */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Cpu className="h-4 w-4" /> Distribusi Token per Layer
                </CardTitle>
                <CardDescription>Full NLU (chat utama), Micro NLU (klasifier), Embedding, RAG Expand</CardDescription>
              </CardHeader>
              <CardContent>
                {summaryLoading ? <Skeleton className="h-56" /> : (
                  <>
                    <div className="h-56 flex items-center justify-center">
                      <Doughnut
                        data={{
                          labels: ["Full NLU", "Micro NLU", "Embedding", "RAG Expand"],
                          datasets: [{
                            data: [
                              summary?.full_nlu_tokens || 0,
                              summary?.micro_nlu_tokens || 0,
                              summary?.embedding_tokens || 0,
                              summary?.rag_expand_tokens || 0,
                            ],
                            backgroundColor: ["#6366f1", "#f59e0b", "#a855f7", "#14b8a6"],
                            borderWidth: 2,
                            borderColor: "#fff",
                          }],
                        }}
                        options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }}
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Model Distribution Doughnut */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" /> Distribusi Token per Model
                </CardTitle>
              </CardHeader>
              <CardContent>
                {summaryLoading ? <Skeleton className="h-56" /> : (
                  <div className="h-56 flex items-center justify-center">
                    <Doughnut
                      data={{
                        labels: byModel.map((m) => m.model),
                        datasets: [{
                          data: byModel.map((m) => m.total_tokens),
                          backgroundColor: byModel.map((_, i) => MODEL_COLORS[i % MODEL_COLORS.length]),
                          borderWidth: 2,
                          borderColor: "#fff",
                        }],
                      }}
                      options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Token Detail Table per Model — token-focused (tanpa harga, harga ada di tab Biaya) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Cpu className="h-4 w-4" /> Detail Token per Model
              </CardTitle>
              <CardDescription>Jumlah token input &amp; output per model. Lihat tab &quot;Biaya&quot; untuk rincian harga.</CardDescription>
            </CardHeader>
            <CardContent>
              {summaryLoading ? <Skeleton className="h-48" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 pr-3">Model</th>
                        <th className="pb-2 pr-3 text-right">Input Tokens</th>
                        <th className="pb-2 pr-3 text-right">Output Tokens</th>
                        <th className="pb-2 pr-3 text-right">Total Tokens</th>
                        <th className="pb-2 pr-3 text-right">API Calls</th>
                        <th className="pb-2 text-right">Avg Latency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byModel.map((m, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="py-2 pr-3"><span className="font-mono text-xs">{m.model}</span></td>
                          <td className="py-2 pr-3 text-right">{formatNumber(m.input_tokens)}</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(m.output_tokens)}</td>
                          <td className="py-2 pr-3 text-right font-semibold">{formatNumber(m.total_tokens)}</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(m.call_count)}</td>
                          <td className="py-2 text-right">{m.avg_duration_ms ? m.avg_duration_ms + "ms" : "-"}</td>
                        </tr>
                      ))}
                      {byModel.length > 0 && (
                        <tr className="border-t-2 font-semibold bg-muted/30">
                          <td className="py-2 pr-3">TOTAL</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(byModel.reduce((s, m) => s + m.input_tokens, 0))}</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(byModel.reduce((s, m) => s + m.output_tokens, 0))}</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(byModel.reduce((s, m) => s + m.total_tokens, 0))}</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(byModel.reduce((s, m) => s + m.call_count, 0))}</td>
                          <td className="py-2 text-right">-</td>
                        </tr>
                      )}
                      {byModel.length === 0 && (
                        <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Belum ada data</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ====== BIAYA (COST) TAB ====== */}
        <TabsContent value="biaya" className="space-y-6 mt-4">
          {/* Cost Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="rounded-lg bg-emerald-100 dark:bg-emerald-950 p-2"><Wallet className="h-4 w-4 text-emerald-600" /></div>
                <span className="text-xs text-muted-foreground font-medium">Total Biaya</span>
              </div>
              <p className="text-lg font-bold text-emerald-600">{summaryLoading ? "..." : formatIDR(summary?.total_cost_usd || 0)}</p>
              <p className="text-xs text-muted-foreground">{formatUSD(summary?.total_cost_usd || 0)}</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="rounded-lg bg-indigo-100 dark:bg-indigo-950 p-2"><Cpu className="h-4 w-4 text-indigo-600" /></div>
                <span className="text-xs text-muted-foreground font-medium">Biaya Full NLU</span>
              </div>
              <p className="text-lg font-bold">{summaryLoading ? "..." : formatIDR(summary?.full_nlu_cost || 0)}</p>
              <p className="text-xs text-muted-foreground">{formatNumber(summary?.full_nlu_calls || 0)} calls</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="rounded-lg bg-amber-100 dark:bg-amber-950 p-2"><Zap className="h-4 w-4 text-amber-600" /></div>
                <span className="text-xs text-muted-foreground font-medium">Biaya Micro NLU</span>
              </div>
              <p className="text-lg font-bold">{summaryLoading ? "..." : formatIDR(summary?.micro_nlu_cost || 0)}</p>
              <p className="text-xs text-muted-foreground">{formatNumber(summary?.micro_nlu_calls || 0)} calls</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="rounded-lg bg-purple-100 dark:bg-purple-950 p-2"><Layers className="h-4 w-4 text-purple-600" /></div>
                <span className="text-xs text-muted-foreground font-medium">Biaya Embedding</span>
              </div>
              <p className="text-lg font-bold">{summaryLoading ? "..." : formatIDR(summary?.embedding_cost || 0)}</p>
              <p className="text-xs text-muted-foreground">{formatNumber(summary?.embedding_calls || 0)} calls</p>
            </div>
          </div>

          {/* Rincian Biaya per Model */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <DollarSign className="h-4 w-4" /> Rincian Biaya per Model
              </CardTitle>
              <CardDescription>Biaya dihitung berdasarkan harga resmi Gemini API (input &amp; output berbeda per model). Kurs: $1 = Rp {USD_TO_IDR.toLocaleString("id-ID")}</CardDescription>
            </CardHeader>
            <CardContent>
              {summaryLoading ? <Skeleton className="h-48" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 pr-3">Model</th>
                        <th className="pb-2 pr-3 text-right">Input Tokens</th>
                        <th className="pb-2 pr-3 text-right">Output Tokens</th>
                        <th className="pb-2 pr-3 text-right">Harga Input (IDR)</th>
                        <th className="pb-2 pr-3 text-right">Harga Output (IDR)</th>
                        <th className="pb-2 pr-3 text-right">Total Biaya (IDR)</th>
                        <th className="pb-2 text-right">Biaya (USD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byModel.map((m, i) => {
                        const c = calcModelCost(m.model, m.input_tokens, m.output_tokens)
                        return (
                          <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="py-2 pr-3">
                              <span className="font-mono text-xs">{m.model}</span>
                              <div className="text-[10px] text-muted-foreground">
                                ${c.pricing.input}/M in · ${c.pricing.output}/M out
                              </div>
                            </td>
                            <td className="py-2 pr-3 text-right">{formatNumber(m.input_tokens)}</td>
                            <td className="py-2 pr-3 text-right">{formatNumber(m.output_tokens)}</td>
                            <td className="py-2 pr-3 text-right text-blue-600">{formatIDR(c.inputCost)}</td>
                            <td className="py-2 pr-3 text-right text-orange-600">{formatIDR(c.outputCost)}</td>
                            <td className="py-2 pr-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">{formatIDR(c.totalCost)}</td>
                            <td className="py-2 text-right text-muted-foreground">{formatUSD(c.totalCost)}</td>
                          </tr>
                        )
                      })}
                      {byModel.length > 0 && (
                        <tr className="border-t-2 font-semibold bg-muted/30">
                          <td className="py-2 pr-3">TOTAL</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(byModel.reduce((s, m) => s + m.input_tokens, 0))}</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(byModel.reduce((s, m) => s + m.output_tokens, 0))}</td>
                          <td className="py-2 pr-3 text-right text-blue-600">{formatIDR(byModel.reduce((s, m) => s + calcModelCost(m.model, m.input_tokens, m.output_tokens).inputCost, 0))}</td>
                          <td className="py-2 pr-3 text-right text-orange-600">{formatIDR(byModel.reduce((s, m) => s + calcModelCost(m.model, m.input_tokens, m.output_tokens).outputCost, 0))}</td>
                          <td className="py-2 pr-3 text-right text-emerald-600 dark:text-emerald-400">{formatIDR(byModel.reduce((s, m) => s + calcModelCost(m.model, m.input_tokens, m.output_tokens).totalCost, 0))}</td>
                          <td className="py-2 text-right text-muted-foreground">{formatUSD(byModel.reduce((s, m) => s + calcModelCost(m.model, m.input_tokens, m.output_tokens).totalCost, 0))}</td>
                        </tr>
                      )}
                      {byModel.length === 0 && (
                        <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">Belum ada data</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Biaya per Layer / Call Type */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="h-4 w-4" /> Biaya per Layer
                </CardTitle>
                <CardDescription>Perbandingan biaya antara Full NLU, Micro NLU, dan Embedding</CardDescription>
              </CardHeader>
              <CardContent>
                {summaryLoading ? <Skeleton className="h-56" /> : (
                  <div className="h-56 flex items-center justify-center">
                    <Doughnut
                      data={{
                        labels: ["Full NLU", "Micro NLU", "Embedding"],
                        datasets: [{
                          data: [
                            summary?.full_nlu_cost || 0,
                            summary?.micro_nlu_cost || 0,
                            summary?.embedding_cost || 0,
                          ],
                          backgroundColor: ["#6366f1", "#f59e0b", "#a855f7"],
                          borderWidth: 2,
                          borderColor: "#fff",
                        }],
                      }}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                          legend: { position: "bottom" },
                          tooltip: {
                            callbacks: {
                              label: (ctx: any) => `${ctx.label}: ${formatIDR(ctx.raw)} (${formatUSD(ctx.raw)})`,
                            },
                          },
                        },
                      }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Sumber API Key — BYOK vs ENV */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Shield className="h-4 w-4" /> Sumber API Key
                </CardTitle>
                <CardDescription>Rincian penggunaan dari BYOK keys vs .env API key utama</CardDescription>
              </CardHeader>
              <CardContent>
                {summaryLoading ? <Skeleton className="h-24" /> : bySource.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Info className="h-4 w-4 text-amber-600" />
                      <span className="text-sm font-medium text-amber-800 dark:text-amber-200">Belum Ada Data</span>
                    </div>
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Data sumber API key akan muncul setelah ada percakapan baru yang terekam dengan tracking key source.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left border-b">
                            <th className="py-2 pr-3 font-medium text-muted-foreground">Sumber</th>
                            <th className="py-2 pr-3 font-medium text-muted-foreground text-right">API Calls</th>
                            <th className="py-2 pr-3 font-medium text-muted-foreground text-right">Token</th>
                            <th className="py-2 pr-3 font-medium text-muted-foreground text-right">Biaya (IDR)</th>
                            <th className="py-2 font-medium text-muted-foreground text-right">Biaya (USD)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bySource.map((s) => (
                            <tr key={s.source} className="border-b last:border-0">
                              <td className="py-2 pr-3 font-medium text-sm">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                                  s.source === 'byok' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' :
                                  s.source === 'env' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                                  'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300'
                                }`}>
                                  {s.source === 'byok' ? 'BYOK Keys' : s.source === 'env' ? '.env Fallback' : s.source}
                                </span>
                              </td>
                              <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(s.total_calls)}</td>
                              <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(s.total_tokens)}</td>
                              <td className="py-2 pr-3 text-right tabular-nums text-green-600">{formatIDR(s.total_cost_usd)}</td>
                              <td className="py-2 text-right tabular-nums text-blue-600">{formatUSD(s.total_cost_usd)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Estimasi Biaya per Pesan */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Calculator className="h-4 w-4" /> Estimasi Biaya per Sesi Chat
              </CardTitle>
              <CardDescription>Rata-rata biaya dan token per sesi chat (hanya main_chat yang dihitung)</CardDescription>
            </CardHeader>
            <CardContent>
              {summaryLoading ? <Skeleton className="h-24" /> : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="rounded-lg bg-muted p-3 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Chat Sesi</div>
                    <div className="text-xl font-bold">{formatNumber(summary?.main_chat_calls || 0)}</div>
                  </div>
                  <div className="rounded-lg bg-muted p-3 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg Token / Chat</div>
                    <div className="text-xl font-bold">{formatNumber(avgPerChat?.avg_total || 0)}</div>
                    <div className="text-xs text-muted-foreground">{formatNumber(avgPerChat?.avg_input || 0)} in / {formatNumber(avgPerChat?.avg_output || 0)} out</div>
                  </div>
                  <div className="rounded-lg bg-muted p-3 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Biaya Main Chat</div>
                    <div className="text-xl font-bold text-emerald-600">{formatIDR(summary?.main_chat_cost || 0)}</div>
                    <div className="text-xs text-muted-foreground">{formatUSD(summary?.main_chat_cost || 0)}</div>
                  </div>
                  <div className="rounded-lg bg-muted p-3 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg Biaya / Chat</div>
                    <div className="text-xl font-bold text-emerald-600">
                      {(summary?.main_chat_calls || 0) > 0
                        ? formatIDR((summary?.main_chat_cost || 0) / (summary?.main_chat_calls || 1))
                        : "Rp 0"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {(summary?.main_chat_calls || 0) > 0
                        ? formatUSD((summary?.main_chat_cost || 0) / (summary?.main_chat_calls || 1))
                        : "$0.00"}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ====== PERIODE TAB ====== */}
        <TabsContent value="periode" className="space-y-6 mt-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Periode:</span>
            <div className="flex rounded-lg border overflow-hidden">
              {(["day", "week", "month"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    period === p
                      ? "bg-indigo-600 text-white"
                      : "bg-white dark:bg-gray-900 text-muted-foreground hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  {p === "day" ? "Harian" : p === "week" ? "Mingguan" : "Bulanan"}
                </button>
              ))}
            </div>
          </div>

          {periodeLoading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Skeleton className="h-80" />
              <Skeleton className="h-80" />
              <Skeleton className="h-80 lg:col-span-2" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" /> Token Usage Over Time
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="h-64">
                    <Line
                      data={{
                        labels: byPeriod.map((r) => formatDate(r.period_start, period)),
                        datasets: [
                          {
                            label: "Input Tokens",
                            data: byPeriod.map((r) => r.input_tokens),
                            borderColor: "#6366f1",
                            backgroundColor: "rgba(99, 102, 241, 0.1)",
                            fill: true,
                            tension: 0.3,
                          },
                          {
                            label: "Output Tokens",
                            data: byPeriod.map((r) => r.output_tokens),
                            borderColor: "#f59e0b",
                            backgroundColor: "rgba(245, 158, 11, 0.1)",
                            fill: true,
                            tension: 0.3,
                          },
                        ],
                      }}
                      options={chartOptions}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <DollarSign className="h-4 w-4" /> Biaya per Periode (IDR)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="h-64">
                    <Bar
                      data={{
                        labels: byPeriod.map((r) => formatDate(r.period_start, period)),
                        datasets: [{
                          label: "Biaya (IDR)",
                          data: byPeriod.map((r) => r.cost_usd * USD_TO_IDR),
                          backgroundColor: "rgba(16, 185, 129, 0.7)",
                          borderRadius: 4,
                        }],
                      }}
                      options={chartOptions}
                    />
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Activity className="h-4 w-4" /> Token per Layer (Stacked)
                  </CardTitle>
                </CardHeader>
                <CardContent className="h-72">
                  {(() => {
                    const layerTypes = [...new Set(byPeriodLayer.map((r) => r.layer_type))]
                    const layerPeriods = [...new Set(byPeriodLayer.map((r) => r.period_start))]
                    return (
                      <Bar
                        data={{
                          labels: layerPeriods.map((p) => formatDate(p, period)),
                          datasets: layerTypes.map((lt) => ({
                            label: LAYER_LABELS[lt] || lt,
                            data: layerPeriods.map((p) => {
                              const match = byPeriodLayer.find((r) => r.period_start === p && r.layer_type === lt)
                              return match?.total_tokens || 0
                            }),
                            backgroundColor: LAYER_COLORS[lt] || "#94a3b8",
                          })),
                        }}
                        options={stackedOptions}
                      />
                    )
                  })()}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ====== VILLAGE TAB ====== */}
        <TabsContent value="village" className="space-y-6 mt-4">
          {villageLoading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" />
              </div>
              <Skeleton className="h-80" />
              <Skeleton className="h-80" />
            </div>
          ) : (
            <>
              {/* Summary Cards: Superadmin / Village / Avg per Desa / Avg per User */}
              {(() => {
                const villageTotalTokens = byVillage.reduce((s, v) => s + v.total_tokens, 0)
                const villageTotalInput = byVillage.reduce((s, v) => s + v.input_tokens, 0)
                const villageTotalOutput = byVillage.reduce((s, v) => s + v.output_tokens, 0)
                const villageTotalCalls = byVillage.reduce((s, v) => s + v.call_count, 0)
                const superadminInput = Math.max(0, (summary?.total_input_tokens || 0) - villageTotalInput)
                const superadminOutput = Math.max(0, (summary?.total_output_tokens || 0) - villageTotalOutput)
                const superadminTokens = superadminInput + superadminOutput
                const superadminCalls = Math.max(0, (summary?.total_calls || 0) - villageTotalCalls)
                const totalUsers = responsesByVillage.reduce((s, v) => s + v.unique_users, 0)
                const allVillageCost = byVillage.reduce((s, v) => s + calcVillageCost(v.village_id).totalCost, 0)

                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="rounded-xl border bg-card p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="rounded-lg bg-purple-100 dark:bg-purple-950 p-2"><Shield className="h-4 w-4 text-purple-600" /></div>
                        <span className="text-xs text-muted-foreground font-medium">Superadmin (Testing)</span>
                      </div>
                      <p className="text-lg font-bold">{formatNumber(superadminTokens)} <span className="text-xs font-normal text-muted-foreground">tokens</span></p>
                      <p className="text-xs text-muted-foreground">{formatNumber(superadminInput)} in · {formatNumber(superadminOutput)} out · {superadminCalls} calls</p>
                    </div>
                    <div className="rounded-xl border bg-card p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="rounded-lg bg-blue-100 dark:bg-blue-950 p-2"><Users className="h-4 w-4 text-blue-600" /></div>
                        <span className="text-xs text-muted-foreground font-medium">Semua Desa ({byVillage.length})</span>
                      </div>
                      <p className="text-lg font-bold">{formatNumber(villageTotalTokens)} <span className="text-xs font-normal text-muted-foreground">tokens</span></p>
                      <p className="text-xs text-muted-foreground">{formatNumber(villageTotalInput)} in · {formatNumber(villageTotalOutput)} out · {formatIDR(allVillageCost)}</p>
                    </div>
                    <div className="rounded-xl border bg-card p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="rounded-lg bg-emerald-100 dark:bg-emerald-950 p-2"><Calculator className="h-4 w-4 text-emerald-600" /></div>
                        <span className="text-xs text-muted-foreground font-medium">Rata-rata / Desa</span>
                      </div>
                      <p className="text-lg font-bold">{byVillage.length > 0 ? formatNumber(Math.round(villageTotalTokens / byVillage.length)) : "0"} <span className="text-xs font-normal text-muted-foreground">tokens</span></p>
                      <p className="text-xs text-muted-foreground">
                        {byVillage.length > 0 ? formatNumber(Math.round(villageTotalInput / byVillage.length)) : "0"} in · {byVillage.length > 0 ? formatNumber(Math.round(villageTotalOutput / byVillage.length)) : "0"} out · {byVillage.length > 0 ? formatIDR(allVillageCost / byVillage.length) : "Rp 0"}
                      </p>
                    </div>
                    <div className="rounded-xl border bg-card p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="rounded-lg bg-amber-100 dark:bg-amber-950 p-2"><MessageSquare className="h-4 w-4 text-amber-600" /></div>
                        <span className="text-xs text-muted-foreground font-medium">Rata-rata / User</span>
                      </div>
                      <p className="text-lg font-bold">{totalUsers > 0 ? formatNumber(Math.round(villageTotalTokens / totalUsers)) : "0"} <span className="text-xs font-normal text-muted-foreground">tokens</span></p>
                      <p className="text-xs text-muted-foreground">
                        {totalUsers > 0 ? formatNumber(Math.round(villageTotalInput / totalUsers)) : "0"} in · {totalUsers > 0 ? formatNumber(Math.round(villageTotalOutput / totalUsers)) : "0"} out · {totalUsers > 0 ? formatIDR(allVillageCost / totalUsers) : "Rp 0"} · {totalUsers} users
                      </p>
                    </div>
                  </div>
                )
              })()}

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Building2 className="h-4 w-4" /> AI Response per Desa
                    </CardTitle>
                    <CardDescription>Hanya pesan yang dikirimkan ke masyarakat (main_chat)</CardDescription>
                  </CardHeader>
                  <CardContent className="h-64">
                    <Bar
                      data={{
                        labels: responsesByVillage.slice(0, 10).map((r) => getVillageName(r.village_id)),
                        datasets: [
                          {
                            label: "AI Responses",
                            data: responsesByVillage.slice(0, 10).map((r) => r.response_count),
                            backgroundColor: "rgba(99, 102, 241, 0.7)",
                            borderRadius: 4,
                          },
                          {
                            label: "Unique Users",
                            data: responsesByVillage.slice(0, 10).map((r) => r.unique_users),
                            backgroundColor: "rgba(245, 158, 11, 0.7)",
                            borderRadius: 4,
                          },
                        ],
                      }}
                      options={chartOptions}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" /> Distribusi Token per Desa
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="h-64 flex items-center justify-center">
                    <Doughnut
                      data={{
                        labels: byVillage.slice(0, 8).map((v) => getVillageName(v.village_id)),
                        datasets: [{
                          data: byVillage.slice(0, 8).map((v) => v.total_tokens),
                          backgroundColor: byVillage.slice(0, 8).map((_, i) => MODEL_COLORS[i % MODEL_COLORS.length]),
                          borderWidth: 2,
                          borderColor: "#fff",
                        }],
                      }}
                      options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }}
                    />
                  </CardContent>
                </Card>
              </div>

              {/* Comprehensive Village Token Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Building2 className="h-4 w-4" /> Analisis Token per Desa (Semua Model Digabung)
                  </CardTitle>
                  <CardDescription>Biaya dihitung dari harga resmi Gemini (input &amp; output berbeda per model). Klik Detail untuk breakdown lengkap per model &amp; layer.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-2 pr-3">Desa</th>
                          <th className="pb-2 pr-3 text-right">Input</th>
                          <th className="pb-2 pr-3 text-right">Output</th>
                          <th className="pb-2 pr-3 text-right">Total</th>
                          <th className="pb-2 pr-3 text-right">Calls</th>
                          <th className="pb-2 pr-3 text-right">Users</th>
                          <th className="pb-2 pr-3 text-right">Harga Input</th>
                          <th className="pb-2 pr-3 text-right">Harga Output</th>
                          <th className="pb-2 pr-3 text-right">Total Biaya</th>
                          <th className="pb-2 text-center">Aksi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {byVillage.map((v, i) => {
                          const vc = calcVillageCost(v.village_id)
                          const resp = responsesByVillage.find(r => r.village_id === v.village_id)
                          return (
                            <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                              <td className="py-2 pr-3 font-medium text-sm max-w-[160px] truncate">{getVillageName(v.village_id)}</td>
                              <td className="py-2 pr-3 text-right">{formatNumber(v.input_tokens)}</td>
                              <td className="py-2 pr-3 text-right">{formatNumber(v.output_tokens)}</td>
                              <td className="py-2 pr-3 text-right font-semibold">{formatNumber(v.total_tokens)}</td>
                              <td className="py-2 pr-3 text-right">{formatNumber(v.call_count)}</td>
                              <td className="py-2 pr-3 text-right">{resp?.unique_users ?? "-"}</td>
                              <td className="py-2 pr-3 text-right text-blue-600">{formatIDR(vc.inputCost)}</td>
                              <td className="py-2 pr-3 text-right text-orange-600">{formatIDR(vc.outputCost)}</td>
                              <td className="py-2 pr-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">{formatIDR(vc.totalCost)}</td>
                              <td className="py-2 text-center">
                                <Button variant="ghost" size="sm" onClick={() => setDetailVillageId(v.village_id)} className="h-7 px-2 text-xs">
                                  <Eye className="h-3 w-3 mr-1" /> Detail
                                </Button>
                              </td>
                            </tr>
                          )
                        })}
                        {byVillage.length > 0 && (() => {
                          const totIn = byVillage.reduce((s, v) => s + v.input_tokens, 0)
                          const totOut = byVillage.reduce((s, v) => s + v.output_tokens, 0)
                          const totTok = byVillage.reduce((s, v) => s + v.total_tokens, 0)
                          const totCall = byVillage.reduce((s, v) => s + v.call_count, 0)
                          const totUsers = responsesByVillage.reduce((s, v) => s + v.unique_users, 0)
                          const totIC = byVillage.reduce((s, v) => s + calcVillageCost(v.village_id).inputCost, 0)
                          const totOC = byVillage.reduce((s, v) => s + calcVillageCost(v.village_id).outputCost, 0)
                          return (
                            <tr className="border-t-2 font-semibold bg-muted/30">
                              <td className="py-2 pr-3">TOTAL ({byVillage.length} desa)</td>
                              <td className="py-2 pr-3 text-right">{formatNumber(totIn)}</td>
                              <td className="py-2 pr-3 text-right">{formatNumber(totOut)}</td>
                              <td className="py-2 pr-3 text-right">{formatNumber(totTok)}</td>
                              <td className="py-2 pr-3 text-right">{formatNumber(totCall)}</td>
                              <td className="py-2 pr-3 text-right">{totUsers}</td>
                              <td className="py-2 pr-3 text-right text-blue-600">{formatIDR(totIC)}</td>
                              <td className="py-2 pr-3 text-right text-orange-600">{formatIDR(totOC)}</td>
                              <td className="py-2 pr-3 text-right text-emerald-600 dark:text-emerald-400">{formatIDR(totIC + totOC)}</td>
                              <td className="py-2"></td>
                            </tr>
                          )
                        })()}
                        {byVillage.length === 0 && (
                          <tr><td colSpan={10} className="py-8 text-center text-muted-foreground">Belum ada data</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Per-User Average Table */}
              {responsesByVillage.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Users className="h-4 w-4" /> Rata-rata Penggunaan per User per Desa
                    </CardTitle>
                    <CardDescription>Rata-rata token dan biaya per unique user di masing-masing desa</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="pb-2 pr-3">Desa</th>
                            <th className="pb-2 pr-3 text-right">Users</th>
                            <th className="pb-2 pr-3 text-right">Total Tokens</th>
                            <th className="pb-2 pr-3 text-right">Avg Token/User</th>
                            <th className="pb-2 pr-3 text-right">Avg Input/User</th>
                            <th className="pb-2 pr-3 text-right">Avg Output/User</th>
                            <th className="pb-2 pr-3 text-right">Total Biaya</th>
                            <th className="pb-2 text-right">Avg Biaya/User</th>
                          </tr>
                        </thead>
                        <tbody>
                          {responsesByVillage.map((r, i) => {
                            const vu = byVillage.find(v => v.village_id === r.village_id)
                            const vc = vu ? calcVillageCost(vu.village_id) : { totalCost: 0 }
                            const users = r.unique_users || 1
                            return (
                              <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                                <td className="py-2 pr-3 font-medium text-sm">{getVillageName(r.village_id)}</td>
                                <td className="py-2 pr-3 text-right">{r.unique_users}</td>
                                <td className="py-2 pr-3 text-right">{formatNumber(vu?.total_tokens || 0)}</td>
                                <td className="py-2 pr-3 text-right font-semibold">{formatNumber(Math.round((vu?.total_tokens || 0) / users))}</td>
                                <td className="py-2 pr-3 text-right">{formatNumber(Math.round((vu?.input_tokens || 0) / users))}</td>
                                <td className="py-2 pr-3 text-right">{formatNumber(Math.round((vu?.output_tokens || 0) / users))}</td>
                                <td className="py-2 pr-3 text-right text-emerald-600">{formatIDR(vc.totalCost)}</td>
                                <td className="py-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">{formatIDR(vc.totalCost / users)}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* Village Detail Modal — uses preloaded allModelDetail */}
          {detailVillageId && (() => {
            const detail = getVillageModelData(detailVillageId)
            const totalInput = detail.reduce((s, d) => s + d.input_tokens, 0)
            const totalOutput = detail.reduce((s, d) => s + d.output_tokens, 0)
            const totalCalls = detail.reduce((s, d) => s + d.call_count, 0)
            let totalInputCost = 0, totalOutputCost = 0
            detail.forEach(d => {
              const c = calcModelCost(d.model, d.input_tokens, d.output_tokens)
              totalInputCost += c.inputCost
              totalOutputCost += c.outputCost
            })
            const totalCost = totalInputCost + totalOutputCost
            const resp = responsesByVillage.find(r => r.village_id === detailVillageId)
            const users = resp?.unique_users || 0

            // Group by model
            const modelMap = new Map<string, { input: number; output: number; calls: number }>()
            detail.forEach(d => {
              const prev = modelMap.get(d.model) || { input: 0, output: 0, calls: 0 }
              modelMap.set(d.model, { input: prev.input + d.input_tokens, output: prev.output + d.output_tokens, calls: prev.calls + d.call_count })
            })
            // Group by layer
            const layerMap = new Map<string, { input: number; output: number; calls: number }>()
            detail.forEach(d => {
              const prev = layerMap.get(d.layer_type) || { input: 0, output: 0, calls: 0 }
              layerMap.set(d.layer_type, { input: prev.input + d.input_tokens, output: prev.output + d.output_tokens, calls: prev.calls + d.call_count })
            })

            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDetailVillageId(null)}>
                <div className="bg-background rounded-xl shadow-xl border max-w-4xl w-full max-h-[85vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between p-4 border-b">
                    <div>
                      <h3 className="font-semibold text-lg flex items-center gap-2">
                        <Building2 className="h-5 w-5 text-blue-600" />
                        {getVillageName(detailVillageId)}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Analisis lengkap penggunaan token &amp; biaya per model dan layer</p>
                    </div>
                    <button onClick={() => setDetailVillageId(null)} className="rounded-lg p-1.5 hover:bg-muted transition-colors"><X className="h-5 w-5" /></button>
                  </div>
                  <div className="p-4 overflow-y-auto max-h-[calc(85vh-80px)] space-y-4">
                    {detail.length === 0 ? (
                      <p className="text-center text-muted-foreground py-8">Belum ada data detail untuk desa ini</p>
                    ) : (
                      <>
                        {/* Grand Summary Cards */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="rounded-lg bg-muted p-3 text-center">
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Input Tokens</div>
                            <div className="text-lg font-bold">{formatNumber(totalInput)}</div>
                            <div className="text-xs text-blue-600">{formatIDR(totalInputCost)}</div>
                          </div>
                          <div className="rounded-lg bg-muted p-3 text-center">
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Output Tokens</div>
                            <div className="text-lg font-bold">{formatNumber(totalOutput)}</div>
                            <div className="text-xs text-orange-600">{formatIDR(totalOutputCost)}</div>
                          </div>
                          <div className="rounded-lg bg-muted p-3 text-center">
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Biaya</div>
                            <div className="text-lg font-bold text-emerald-600">{formatIDR(totalCost)}</div>
                            <div className="text-xs text-muted-foreground">{formatUSD(totalCost)}</div>
                          </div>
                          <div className="rounded-lg bg-muted p-3 text-center">
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Calls / Users</div>
                            <div className="text-lg font-bold">{totalCalls}</div>
                            <div className="text-xs text-muted-foreground">{users > 0 ? `${users} users · ${formatIDR(totalCost / users)}/user` : "—"}</div>
                          </div>
                        </div>

                        {/* Per-Model Breakdown */}
                        <div>
                          <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><Cpu className="h-4 w-4" /> Breakdown per Model</h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b text-left text-muted-foreground">
                                  <th className="pb-2 pr-3">Model</th>
                                  <th className="pb-2 pr-3 text-right">Input</th>
                                  <th className="pb-2 pr-3 text-right">Output</th>
                                  <th className="pb-2 pr-3 text-right">Calls</th>
                                  <th className="pb-2 pr-3 text-right">Harga Input</th>
                                  <th className="pb-2 pr-3 text-right">Harga Output</th>
                                  <th className="pb-2 text-right">Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Array.from(modelMap.entries()).map(([model, data], i) => {
                                  const mc = calcModelCost(model, data.input, data.output)
                                  return (
                                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                                      <td className="py-1.5 pr-3">
                                        <span className="font-mono text-xs">{model}</span>
                                        <div className="text-[10px] text-muted-foreground">${mc.pricing.input}/M in · ${mc.pricing.output}/M out</div>
                                      </td>
                                      <td className="py-1.5 pr-3 text-right">{formatNumber(data.input)}</td>
                                      <td className="py-1.5 pr-3 text-right">{formatNumber(data.output)}</td>
                                      <td className="py-1.5 pr-3 text-right">{data.calls}</td>
                                      <td className="py-1.5 pr-3 text-right text-blue-600">{formatIDR(mc.inputCost)}</td>
                                      <td className="py-1.5 pr-3 text-right text-orange-600">{formatIDR(mc.outputCost)}</td>
                                      <td className="py-1.5 text-right font-semibold text-emerald-600">{formatIDR(mc.totalCost)}</td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Per-Layer Breakdown */}
                        <div>
                          <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><Activity className="h-4 w-4" /> Breakdown per Layer (NLU / RAG / Micro NLU)</h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b text-left text-muted-foreground">
                                  <th className="pb-2 pr-3">Layer</th>
                                  <th className="pb-2 pr-3 text-right">Input</th>
                                  <th className="pb-2 pr-3 text-right">Output</th>
                                  <th className="pb-2 pr-3 text-right">Calls</th>
                                  <th className="pb-2 text-right">Biaya</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Array.from(layerMap.entries()).map(([layer, data], i) => {
                                  const layerRows = detail.filter(d => d.layer_type === layer)
                                  const layerCost = layerRows.reduce((s, d) => s + calcModelCost(d.model, d.input_tokens, d.output_tokens).totalCost, 0)
                                  return (
                                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                                      <td className="py-1.5 pr-3">
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: (LAYER_COLORS[layer] || "#94a3b8") + "20", color: LAYER_COLORS[layer] || "#94a3b8" }}>
                                          {LAYER_LABELS[layer] || layer}
                                        </span>
                                      </td>
                                      <td className="py-1.5 pr-3 text-right">{formatNumber(data.input)}</td>
                                      <td className="py-1.5 pr-3 text-right">{formatNumber(data.output)}</td>
                                      <td className="py-1.5 pr-3 text-right">{data.calls}</td>
                                      <td className="py-1.5 text-right font-semibold text-emerald-600">{formatIDR(layerCost)}</td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Full Detail: Layer x Model */}
                        <div>
                          <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><Zap className="h-4 w-4" /> Detail per Layer × Model</h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b text-left text-muted-foreground">
                                  <th className="pb-2 pr-3">Layer</th>
                                  <th className="pb-2 pr-3">Model</th>
                                  <th className="pb-2 pr-3 text-right">Input</th>
                                  <th className="pb-2 pr-3 text-right">Output</th>
                                  <th className="pb-2 pr-3 text-right">Calls</th>
                                  <th className="pb-2 pr-3 text-right">Harga Input</th>
                                  <th className="pb-2 pr-3 text-right">Harga Output</th>
                                  <th className="pb-2 text-right">Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.map((d, i) => {
                                  const c = calcModelCost(d.model, d.input_tokens, d.output_tokens)
                                  return (
                                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                                      <td className="py-1.5 pr-3">
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: (LAYER_COLORS[d.layer_type] || "#94a3b8") + "20", color: LAYER_COLORS[d.layer_type] || "#94a3b8" }}>
                                          {LAYER_LABELS[d.layer_type] || d.layer_type}
                                        </span>
                                      </td>
                                      <td className="py-1.5 pr-3 font-mono text-xs">{d.model}</td>
                                      <td className="py-1.5 pr-3 text-right">{formatNumber(d.input_tokens)}</td>
                                      <td className="py-1.5 pr-3 text-right">{formatNumber(d.output_tokens)}</td>
                                      <td className="py-1.5 pr-3 text-right">{d.call_count}</td>
                                      <td className="py-1.5 pr-3 text-right text-blue-600">{formatIDR(c.inputCost)}</td>
                                      <td className="py-1.5 pr-3 text-right text-orange-600">{formatIDR(c.outputCost)}</td>
                                      <td className="py-1.5 text-right font-semibold text-emerald-600">{formatIDR(c.totalCost)}</td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Per-User Average */}
                        {users > 0 && (
                          <div className="rounded-lg border p-3 bg-muted/30">
                            <h4 className="text-sm font-semibold mb-1 flex items-center gap-2"><Users className="h-4 w-4" /> Rata-rata per User ({users} users)</h4>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center text-xs">
                              <div><span className="text-muted-foreground">Avg Input/User</span><div className="font-bold">{formatNumber(Math.round(totalInput / users))}</div></div>
                              <div><span className="text-muted-foreground">Avg Output/User</span><div className="font-bold">{formatNumber(Math.round(totalOutput / users))}</div></div>
                              <div><span className="text-muted-foreground">Avg Token/User</span><div className="font-bold">{formatNumber(Math.round((totalInput + totalOutput) / users))}</div></div>
                              <div><span className="text-muted-foreground">Avg Biaya/User</span><div className="font-bold text-emerald-600">{formatIDR(totalCost / users)}</div></div>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })()}
        </TabsContent>

        {/* ====== LAYER DETAIL TAB ====== */}
        <TabsContent value="layer" className="space-y-6 mt-4">
          {layerLoading ? (
            <Skeleton className="h-80" />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Zap className="h-4 w-4" /> Detail per Layer, Call Type &amp; Model
                </CardTitle>
                <CardDescription>Breakdown lengkap penggunaan token berdasarkan layer dan model — biaya dari pricing resmi Gemini</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 pr-3">Layer</th>
                        <th className="pb-2 pr-3">Call Type</th>
                        <th className="pb-2 pr-3">Model</th>
                        <th className="pb-2 pr-3 text-right">Input</th>
                        <th className="pb-2 pr-3 text-right">Output</th>
                        <th className="pb-2 pr-3 text-right">Calls</th>
                        <th className="pb-2 pr-3 text-right">Latency</th>
                        <th className="pb-2 pr-3 text-right">Harga Input</th>
                        <th className="pb-2 pr-3 text-right">Harga Output</th>
                        <th className="pb-2 text-right">Total Biaya</th>
                      </tr>
                    </thead>
                    <tbody>
                      {layerBreakdown.map((r, i) => {
                        const c = calcModelCost(r.model, r.input_tokens, r.output_tokens)
                        return (
                          <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="py-2 pr-3">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: (LAYER_COLORS[r.layer_type] || "#94a3b8") + "20", color: LAYER_COLORS[r.layer_type] || "#94a3b8" }}>
                                {LAYER_LABELS[r.layer_type] || r.layer_type}
                              </span>
                            </td>
                            <td className="py-2 pr-3 font-mono text-xs">{r.call_type}</td>
                            <td className="py-2 pr-3 font-mono text-xs">{r.model}</td>
                            <td className="py-2 pr-3 text-right">{formatNumber(r.input_tokens)}</td>
                            <td className="py-2 pr-3 text-right">{formatNumber(r.output_tokens)}</td>
                            <td className="py-2 pr-3 text-right">{formatNumber(r.call_count)}</td>
                            <td className="py-2 pr-3 text-right">{r.avg_duration_ms ? r.avg_duration_ms + "ms" : "-"}</td>
                            <td className="py-2 pr-3 text-right text-blue-600">{formatIDR(c.inputCost)}</td>
                            <td className="py-2 pr-3 text-right text-orange-600">{formatIDR(c.outputCost)}</td>
                            <td className="py-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">{formatIDR(c.totalCost)}</td>
                          </tr>
                        )
                      })}
                      {layerBreakdown.length > 0 && (() => {
                        const totIC = layerBreakdown.reduce((s, r) => s + calcModelCost(r.model, r.input_tokens, r.output_tokens).inputCost, 0)
                        const totOC = layerBreakdown.reduce((s, r) => s + calcModelCost(r.model, r.input_tokens, r.output_tokens).outputCost, 0)
                        return (
                          <tr className="border-t-2 font-semibold bg-muted/30">
                            <td className="py-2 pr-3" colSpan={3}>TOTAL</td>
                            <td className="py-2 pr-3 text-right">{formatNumber(layerBreakdown.reduce((s, r) => s + r.input_tokens, 0))}</td>
                            <td className="py-2 pr-3 text-right">{formatNumber(layerBreakdown.reduce((s, r) => s + r.output_tokens, 0))}</td>
                            <td className="py-2 pr-3 text-right">{formatNumber(layerBreakdown.reduce((s, r) => s + r.call_count, 0))}</td>
                            <td className="py-2 pr-3 text-right">-</td>
                            <td className="py-2 pr-3 text-right text-blue-600">{formatIDR(totIC)}</td>
                            <td className="py-2 pr-3 text-right text-orange-600">{formatIDR(totOC)}</td>
                            <td className="py-2 text-right text-emerald-600 dark:text-emerald-400">{formatIDR(totIC + totOC)}</td>
                          </tr>
                        )
                      })()}
                      {layerBreakdown.length === 0 && (
                        <tr><td colSpan={10} className="py-8 text-center text-muted-foreground">Belum ada data</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ==================== Sub Components ====================

function SummaryCard({
  icon,
  label,
  value,
  sub,
  loading,
}: {
  icon: React.ReactNode
  label: string
  value: string | null
  sub?: string | null
  loading?: boolean
}) {
  return (
    <div className="rounded-xl border bg-card p-4 flex items-start gap-3">
      <div className="rounded-lg bg-muted p-2.5">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        {loading ? (
          <>
            <Skeleton className="h-6 w-20 mt-1" />
            <Skeleton className="h-3 w-28 mt-1" />
          </>
        ) : (
          <>
            <p className="text-xl font-bold mt-0.5">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</p>}
          </>
        )}
      </div>
    </div>
  )
}
