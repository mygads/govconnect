"use client"

import { ComponentType, Fragment, useCallback, useEffect, useState } from "react"
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
  Layers,
  Wallet,
  Trash2,
  ChevronDown,
  Server,
  AlertTriangle,
} from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const dynamic = "force-dynamic"

type ChartComponent = ComponentType<{ data: any; options?: any }>

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/components/auth/AuthContext"

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
  rag_expand_cost: number
  rag_rerank_calls: number
  rag_rerank_tokens: number
  rag_rerank_cost: number
  agent_calls: number
  agent_tokens: number
  agent_cost: number
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

interface ProviderModelUsage extends ModelUsage {
  model_config_id: string
  display_name: string
  lane_type: string
  actual_cost_usd: number
  adjusted_cost_usd: number
  margin_usd: number
}

interface ProviderUsage {
  provider_id: string
  provider_name: string
  provider_slug: string
  provider_kind: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number
  actual_cost_usd: number
  adjusted_cost_usd: number
  margin_usd: number
  call_count: number
  avg_duration_ms: number
  models: ProviderModelUsage[]
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

function sumCostUsd<T extends { cost_usd: number }>(rows: T[]): number {
  return rows.reduce((sum, row) => sum + (row.cost_usd || 0), 0)
}

const LAYER_COLORS: Record<string, string> = {
  agent: "#6366f1",
  micro_nlu: "#f59e0b",
  rag_expand: "#10b981",
  rag_rerank: "#0f766e",
  embedding: "#ef4444",
  full_nlu: "#64748b",
}

const LAYER_LABELS: Record<string, string> = {
  agent: "Agent Orchestrator",
  micro_nlu: "Classifier / Utility LLM",
  rag_expand: "RAG Rewrite",
  rag_rerank: "RAG Rerank",
  embedding: "Embedding",
  full_nlu: "Legacy Full NLU",
}

const MODEL_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4",
]

// ==================== Fetcher ====================

async function fetchData<T>(slug: string, params?: Record<string, string>): Promise<T> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : ""
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null
  const res = await fetch(`/api/statistics/token-usage/${slug}${qs}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(payload?.error || `Gagal memuat token usage: ${slug} (${res.status})`)
  }
  return payload as T
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
  const [byProvider, setByProvider] = useState<ProviderUsage[]>([])
  const [expandedProviderIds, setExpandedProviderIds] = useState<Set<string>>(new Set())
  const [avgPerChat, setAvgPerChat] = useState<AvgPerChat | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [usageError, setUsageError] = useState<string | null>(null)

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
  const [charts, setCharts] = useState<{ Bar: ChartComponent; Line: ChartComponent; Doughnut: ChartComponent } | null>(null)

  useEffect(() => {
    Promise.all([import("chart.js"), import("react-chartjs-2")]).then(([chartjs, reactChart]) => {
      const { Chart, CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler } = chartjs
      Chart.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler)
      setCharts({ Bar: reactChart.Bar, Line: reactChart.Line, Doughnut: reactChart.Doughnut })
    })
  }, [])

  useEffect(() => {
    if (user && user.role !== "superadmin") redirect("/dashboard")
  }, [user])

  // Load summary data on mount
  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    setUsageError(null)
    try {
      const [s, bm, bp, apc] = await Promise.all([
        fetchData<TokenSummary>("summary"),
        fetchData<ModelUsage[]>("by-model"),
        fetchData<ProviderUsage[]>("by-provider"),
        fetchData<AvgPerChat>("avg-per-chat"),
      ])
      setSummary(s)
      setByModel(bm)
      setByProvider(bp)
      setAvgPerChat(apc)
    } catch (error: any) {
      setSummary(null)
      setByModel([])
      setByProvider([])
      setAvgPerChat(null)
      setUsageError(error?.message || 'Gagal memuat AI token usage')
    } finally {
      setSummaryLoading(false)
    }
  }, [])

  useEffect(() => { loadSummary() }, [loadSummary])

  // Load periode data on demand
  const loadPeriode = useCallback(async () => {
    setPeriodeLoading(true)
    setUsageError(null)
    try {
      const params = { period }
      const [bp, bpl] = await Promise.all([
        fetchData<PeriodUsage[]>("by-period", params),
        fetchData<PeriodLayerUsage[]>("by-period-layer", params),
      ])
      setByPeriod(bp)
      setByPeriodLayer(bpl)
      setPeriodeLoaded(true)
    } catch (error: any) {
      setByPeriod([])
      setByPeriodLayer([])
      setUsageError(error?.message || 'Gagal memuat data periode')
    } finally {
      setPeriodeLoading(false)
    }
  }, [period])

  // Load village data on demand (4 calls: by-village, responses, ALL model-detail, village names)
  const loadVillage = useCallback(async () => {
    setVillageLoading(true)
    setUsageError(null)
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null
      const [bv, rbv, md, villagesRes] = await Promise.all([
        fetchData<VillageUsage[]>("by-village"),
        fetchData<VillageResponse[]>("responses-by-village"),
        fetchData<VillageModelDetail[]>("village-model-detail"),
        fetch("/api/superadmin/villages", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }).then(async (r) => {
          const payload = await r.json().catch(() => null)
          if (!r.ok) throw new Error(payload?.error || `Gagal memuat daftar desa (${r.status})`)
          return payload
        }),
      ])
      setByVillage(bv)
      setResponsesByVillage(rbv)
      setAllModelDetail(md)
      const nameMap: Record<string, string> = {}
      const villageList = Array.isArray(villagesRes) ? villagesRes : (villagesRes?.data || [])
      villageList.forEach((v: VillageInfo) => { nameMap[v.id] = v.name })
      setVillageNames(nameMap)
      setVillageLoaded(true)
    } catch (error: any) {
      setByVillage([])
      setResponsesByVillage([])
      setAllModelDetail([])
      setVillageNames({})
      setUsageError(error?.message || 'Gagal memuat data per desa')
    } finally {
      setVillageLoading(false)
    }
  }, [])

  // Load layer data on demand
  const loadLayer = useCallback(async () => {
    setLayerLoading(true)
    setUsageError(null)
    try {
      const lb = await fetchData<LayerBreakdown[]>("layer-breakdown")
      setLayerBreakdown(lb)
      setLayerLoaded(true)
    } catch (error: any) {
      setLayerBreakdown([])
      setUsageError(error?.message || 'Gagal memuat layer detail')
    } finally {
      setLayerLoading(false)
    }
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
        setByProvider([])
        setExpandedProviderIds(new Set())
        setAvgPerChat(null)
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

  if (!charts) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    )
  }

  const { Bar, Line, Doughnut } = charts
  const showLegacyFullNlu = (summary?.full_nlu_tokens || 0) > 0 || (summary?.full_nlu_calls || 0) > 0
  const toggleProviderExpanded = (providerId: string) => {
    setExpandedProviderIds((current) => {
      const next = new Set(current)
      if (next.has(providerId)) next.delete(providerId)
      else next.add(providerId)
      return next
    })
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
            Monitoring penggunaan token AI gateway per model. Kurs estimasi: $1 = Rp {USD_TO_IDR.toLocaleString("id-ID")}
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

      {usageError && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30">
          <CardContent className="flex items-start gap-3 pt-6 text-red-700 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium">Data AI usage tidak dapat dimuat.</p>
              <p className="text-sm">{usageError}</p>
            </div>
          </CardContent>
        </Card>
      )}

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
          sub={summaryLoading ? null : `${formatNumber(summary?.agent_calls || 0)} agent / ${formatNumber(summary?.micro_nlu_calls || 0)} classifier`}
          loading={summaryLoading}
        />
        <SummaryCard
          icon={<MessageSquare className="h-5 w-5 text-blue-600" />}
          label="Respons Chat"          value={summaryLoading ? null : formatNumber(summary?.main_chat_calls || 0)}
          sub={summaryLoading ? null : `${formatNumber(summary?.main_chat_tokens || 0)} tokens · ${formatIDR(summary?.main_chat_cost || 0)}`}
          loading={summaryLoading}
        />
        <SummaryCard
          icon={<Layers className="h-5 w-5 text-purple-600" />}
          label="Embedding"          value={summaryLoading ? null : formatNumber(summary?.embedding_tokens || 0)}
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
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-3 w-3 rounded-full bg-indigo-500" />
                <span className="text-xs text-muted-foreground font-medium">Agent Orchestrator</span>
              </div>
              <p className="text-lg font-bold">{summaryLoading ? "..." : formatNumber(summary?.agent_tokens || 0)}</p>
              <p className="text-xs text-muted-foreground">{formatNumber(summary?.agent_calls || 0)} calls · {formatIDR(summary?.agent_cost || 0)}</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-3 w-3 rounded-full bg-amber-500" />
                <span className="text-xs text-muted-foreground font-medium">Classifier / Utility LLM</span>
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
                <span className="text-xs text-muted-foreground font-medium">RAG Rewrite</span>
              </div>
              <p className="text-lg font-bold">{summaryLoading ? "..." : formatNumber(summary?.rag_expand_tokens || 0)}</p>
              <p className="text-xs text-muted-foreground">{formatNumber(summary?.rag_expand_calls || 0)} calls · {formatIDR(summary?.rag_expand_cost || 0)}</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-3 w-3 rounded-full bg-teal-800" />
                <span className="text-xs text-muted-foreground font-medium">RAG Rerank</span>
              </div>
              <p className="text-lg font-bold">{summaryLoading ? "..." : formatNumber(summary?.rag_rerank_tokens || 0)}</p>
              <p className="text-xs text-muted-foreground">{formatNumber(summary?.rag_rerank_calls || 0)} calls · {formatIDR(summary?.rag_rerank_cost || 0)}</p>
            </div>
            {showLegacyFullNlu && (
              <div className="rounded-xl border bg-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-3 w-3 rounded-full bg-slate-500" />
                  <span className="text-xs text-muted-foreground font-medium">Legacy Full NLU</span>
                </div>
                <p className="text-lg font-bold">{summaryLoading ? "..." : formatNumber(summary?.full_nlu_tokens || 0)}</p>
                <p className="text-xs text-muted-foreground">{formatNumber(summary?.full_nlu_calls || 0)} calls · {formatIDR(summary?.full_nlu_cost || 0)}</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Cpu className="h-4 w-4" /> Distribusi Token per Layer
                </CardTitle>
                <CardDescription>Agent, classifier/utility LLM, embedding, RAG rewrite, dan RAG rerank.</CardDescription>
              </CardHeader>
              <CardContent>
                {summaryLoading ? <Skeleton className="h-56" /> : (
                  <>
                    <div className="h-56 flex items-center justify-center">
                      <Doughnut
                        data={{
                          labels: [
                            "Agent Orchestrator",
                            "Classifier / Utility LLM",
                            "Embedding",
                            "RAG Rewrite",
                            "RAG Rerank",
                            ...(showLegacyFullNlu ? ["Legacy Full NLU"] : []),
                          ],
                          datasets: [{
                            data: [
                              summary?.agent_tokens || 0,
                              summary?.micro_nlu_tokens || 0,
                              summary?.embedding_tokens || 0,
                              summary?.rag_expand_tokens || 0,
                              summary?.rag_rerank_tokens || 0,
                              ...(showLegacyFullNlu ? [summary?.full_nlu_tokens || 0] : []),
                            ],
                            backgroundColor: ["#6366f1", "#f59e0b", "#a855f7", "#14b8a6", "#0f766e", "#64748b"],
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
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
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
                <span className="text-xs text-muted-foreground font-medium">Biaya Agent</span>
              </div>
              <p className="text-lg font-bold">{summaryLoading ? "..." : formatIDR(summary?.agent_cost || 0)}</p>
              <p className="text-xs text-muted-foreground">{formatNumber(summary?.agent_calls || 0)} calls</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="rounded-lg bg-amber-100 dark:bg-amber-950 p-2"><Zap className="h-4 w-4 text-amber-600" /></div>
                <span className="text-xs text-muted-foreground font-medium">Biaya Classifier</span>
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
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="rounded-lg bg-teal-100 dark:bg-teal-950 p-2"><Layers className="h-4 w-4 text-teal-600" /></div>
                <span className="text-xs text-muted-foreground font-medium">Biaya RAG Rewrite</span>
              </div>
              <p className="text-lg font-bold">{summaryLoading ? "..." : formatIDR(summary?.rag_expand_cost || 0)}</p>
              <p className="text-xs text-muted-foreground">{formatNumber(summary?.rag_expand_calls || 0)} calls</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="rounded-lg bg-cyan-100 dark:bg-cyan-950 p-2"><Layers className="h-4 w-4 text-cyan-700" /></div>
                <span className="text-xs text-muted-foreground font-medium">Biaya Rerank</span>
              </div>
              <p className="text-lg font-bold">{summaryLoading ? "..." : formatIDR(summary?.rag_rerank_cost || 0)}</p>
              <p className="text-xs text-muted-foreground">{formatNumber(summary?.rag_rerank_calls || 0)} calls</p>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Server className="h-4 w-4" /> Biaya per Provider
              </CardTitle>
              <CardDescription>Klik provider untuk melihat model di dalam provider tersebut.</CardDescription>
            </CardHeader>
            <CardContent>
              {summaryLoading ? <Skeleton className="h-48" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 pr-3">Provider</th>
                        <th className="pb-2 pr-3 text-right">Calls</th>
                        <th className="pb-2 pr-3 text-right">Input</th>
                        <th className="pb-2 pr-3 text-right">Output</th>
                        <th className="pb-2 pr-3 text-right">Actual</th>
                        <th className="pb-2 pr-3 text-right">Charged</th>
                        <th className="pb-2 text-right">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byProvider.map((provider) => {
                        const expanded = expandedProviderIds.has(provider.provider_id)
                        return (
                          <Fragment key={provider.provider_id}>
                            <tr className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => toggleProviderExpanded(provider.provider_id)}>
                              <td className="py-2 pr-3">
                                <div className="flex items-center gap-2 font-medium">
                                  <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
                                  {provider.provider_name}
                                </div>
                                <div className="ml-6 text-xs text-muted-foreground">{provider.provider_slug} · {provider.provider_kind} · {provider.models?.length || 0} model</div>
                              </td>
                              <td className="py-2 pr-3 text-right">{formatNumber(provider.call_count)}</td>
                              <td className="py-2 pr-3 text-right">{formatNumber(provider.input_tokens)}</td>
                              <td className="py-2 pr-3 text-right">{formatNumber(provider.output_tokens)}</td>
                              <td className="py-2 pr-3 text-right text-muted-foreground">{formatIDR(provider.actual_cost_usd || provider.cost_usd)}</td>
                              <td className="py-2 pr-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">{formatIDR(provider.adjusted_cost_usd || provider.cost_usd)}</td>
                              <td className="py-2 text-right text-muted-foreground">{formatIDR(provider.margin_usd || 0)}</td>
                            </tr>
                            {expanded && provider.models?.map((model) => (
                              <tr key={`${provider.provider_id}-${model.model_config_id}-${model.model}`} className="border-b bg-muted/20 text-xs">
                                <td className="py-2 pr-3 pl-10">
                                  <div className="font-medium">{model.display_name}</div>
                                  <div className="font-mono text-muted-foreground">{model.model} · {model.lane_type}</div>
                                </td>
                                <td className="py-2 pr-3 text-right">{formatNumber(model.call_count)}</td>
                                <td className="py-2 pr-3 text-right">{formatNumber(model.input_tokens)}</td>
                                <td className="py-2 pr-3 text-right">{formatNumber(model.output_tokens)}</td>
                                <td className="py-2 pr-3 text-right text-muted-foreground">{formatIDR(model.actual_cost_usd || model.cost_usd)}</td>
                                <td className="py-2 pr-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">{formatIDR(model.adjusted_cost_usd || model.cost_usd)}</td>
                                <td className="py-2 text-right text-muted-foreground">{formatIDR(model.margin_usd || 0)}</td>
                              </tr>
                            ))}
                          </Fragment>
                        )
                      })}
                      {byProvider.length > 0 && (
                        <tr className="border-t-2 font-semibold bg-muted/30">
                          <td className="py-2 pr-3">TOTAL</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(byProvider.reduce((s, p) => s + p.call_count, 0))}</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(byProvider.reduce((s, p) => s + p.input_tokens, 0))}</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(byProvider.reduce((s, p) => s + p.output_tokens, 0))}</td>
                          <td className="py-2 pr-3 text-right text-muted-foreground">{formatIDR(byProvider.reduce((s, p) => s + (p.actual_cost_usd || p.cost_usd), 0))}</td>
                          <td className="py-2 pr-3 text-right text-emerald-600 dark:text-emerald-400">{formatIDR(byProvider.reduce((s, p) => s + (p.adjusted_cost_usd || p.cost_usd), 0))}</td>
                          <td className="py-2 text-right text-muted-foreground">{formatIDR(byProvider.reduce((s, p) => s + (p.margin_usd || 0), 0))}</td>
                        </tr>
                      )}
                      {byProvider.length === 0 && (
                        <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">Belum ada data provider</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Rincian Biaya per Model */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <DollarSign className="h-4 w-4" /> Rincian Biaya per Model
              </CardTitle>
              <CardDescription>Biaya memakai `cost_usd` yang direkam backend, jadi selalu mengikuti provider/model gateway aktif. Kurs: $1 = Rp {USD_TO_IDR.toLocaleString("id-ID")}</CardDescription>
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
                        <th className="pb-2 pr-3 text-right">Total Biaya (IDR)</th>
                        <th className="pb-2 text-right">Biaya (USD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byModel.map((m, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="py-2 pr-3">
                            <span className="font-mono text-xs">{m.model}</span>
                          </td>
                          <td className="py-2 pr-3 text-right">{formatNumber(m.input_tokens)}</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(m.output_tokens)}</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(m.total_tokens)}</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(m.call_count)}</td>
                          <td className="py-2 pr-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">{formatIDR(m.cost_usd)}</td>
                          <td className="py-2 text-right text-muted-foreground">{formatUSD(m.cost_usd)}</td>
                        </tr>
                      ))}
                      {byModel.length > 0 && (
                        <tr className="border-t-2 font-semibold bg-muted/30">
                          <td className="py-2 pr-3">TOTAL</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(byModel.reduce((s, m) => s + m.input_tokens, 0))}</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(byModel.reduce((s, m) => s + m.output_tokens, 0))}</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(byModel.reduce((s, m) => s + m.total_tokens, 0))}</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(byModel.reduce((s, m) => s + m.call_count, 0))}</td>
                          <td className="py-2 pr-3 text-right text-emerald-600 dark:text-emerald-400">{formatIDR(sumCostUsd(byModel))}</td>
                          <td className="py-2 text-right text-muted-foreground">{formatUSD(sumCostUsd(byModel))}</td>
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

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Activity className="h-4 w-4" /> Biaya per Layer
              </CardTitle>
              <CardDescription>Perbandingan biaya antara agent, classifier/utility LLM, embedding, RAG rewrite, dan rerank.</CardDescription>
            </CardHeader>
            <CardContent>
              {summaryLoading ? <Skeleton className="h-56" /> : (
                <div className="h-56 flex items-center justify-center">
                  <Doughnut
                    data={{
                      labels: [
                        "Agent Orchestrator",
                        "Classifier / Utility LLM",
                        "Embedding",
                        "RAG Rewrite",
                        "RAG Rerank",
                        ...(showLegacyFullNlu ? ["Legacy Full NLU"] : []),
                      ],
                      datasets: [{
                        data: [
                          summary?.agent_cost || 0,
                          summary?.micro_nlu_cost || 0,
                          summary?.embedding_cost || 0,
                          summary?.rag_expand_cost || 0,
                          summary?.rag_rerank_cost || 0,
                          ...(showLegacyFullNlu ? [summary?.full_nlu_cost || 0] : []),
                        ],
                        backgroundColor: ["#6366f1", "#f59e0b", "#a855f7", "#14b8a6", "#0f766e", "#64748b"],
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
                const allVillageCost = sumCostUsd(byVillage)

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
                  <CardDescription>Biaya memakai `cost_usd` yang direkam backend. Klik Detail untuk breakdown lengkap per model dan layer.</CardDescription>
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
                          <th className="pb-2 pr-3 text-right">Total Biaya</th>
                          <th className="pb-2 text-center">Aksi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {byVillage.map((v, i) => {
                          const resp = responsesByVillage.find(r => r.village_id === v.village_id)
                          return (
                            <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                              <td className="py-2 pr-3 font-medium text-sm max-w-[160px] truncate">{getVillageName(v.village_id)}</td>
                              <td className="py-2 pr-3 text-right">{formatNumber(v.input_tokens)}</td>
                              <td className="py-2 pr-3 text-right">{formatNumber(v.output_tokens)}</td>
                              <td className="py-2 pr-3 text-right font-semibold">{formatNumber(v.total_tokens)}</td>
                              <td className="py-2 pr-3 text-right">{formatNumber(v.call_count)}</td>
                              <td className="py-2 pr-3 text-right">{resp?.unique_users ?? "-"}</td>
                              <td className="py-2 pr-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">{formatIDR(v.cost_usd)}</td>
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
                          const totalVillageCost = sumCostUsd(byVillage)
                          return (
                            <tr className="border-t-2 font-semibold bg-muted/30">
                              <td className="py-2 pr-3">TOTAL ({byVillage.length} desa)</td>
                              <td className="py-2 pr-3 text-right">{formatNumber(totIn)}</td>
                              <td className="py-2 pr-3 text-right">{formatNumber(totOut)}</td>
                              <td className="py-2 pr-3 text-right">{formatNumber(totTok)}</td>
                              <td className="py-2 pr-3 text-right">{formatNumber(totCall)}</td>
                              <td className="py-2 pr-3 text-right">{totUsers}</td>
                              <td className="py-2 pr-3 text-right text-emerald-600 dark:text-emerald-400">{formatIDR(totalVillageCost)}</td>
                              <td className="py-2"></td>
                            </tr>
                          )
                        })()}
                        {byVillage.length === 0 && (
                          <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">Belum ada data</td></tr>
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
                            const totalCost = vu?.cost_usd || 0
                            const users = r.unique_users || 1
                            return (
                              <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                                <td className="py-2 pr-3 font-medium text-sm">{getVillageName(r.village_id)}</td>
                                <td className="py-2 pr-3 text-right">{r.unique_users}</td>
                                <td className="py-2 pr-3 text-right">{formatNumber(vu?.total_tokens || 0)}</td>
                                <td className="py-2 pr-3 text-right font-semibold">{formatNumber(Math.round((vu?.total_tokens || 0) / users))}</td>
                                <td className="py-2 pr-3 text-right">{formatNumber(Math.round((vu?.input_tokens || 0) / users))}</td>
                                <td className="py-2 pr-3 text-right">{formatNumber(Math.round((vu?.output_tokens || 0) / users))}</td>
                                <td className="py-2 pr-3 text-right text-emerald-600">{formatIDR(totalCost)}</td>
                                <td className="py-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">{formatIDR(totalCost / users)}</td>
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
            const totalCost = sumCostUsd(detail)
            const resp = responsesByVillage.find(r => r.village_id === detailVillageId)
            const users = resp?.unique_users || 0

            // Group by model
            const modelMap = new Map<string, { input: number; output: number; calls: number; cost: number }>()
            detail.forEach(d => {
              const prev = modelMap.get(d.model) || { input: 0, output: 0, calls: 0, cost: 0 }
              modelMap.set(d.model, {
                input: prev.input + d.input_tokens,
                output: prev.output + d.output_tokens,
                calls: prev.calls + d.call_count,
                cost: prev.cost + d.cost_usd,
              })
            })
            // Group by layer
            const layerMap = new Map<string, { input: number; output: number; calls: number; cost: number }>()
            detail.forEach(d => {
              const prev = layerMap.get(d.layer_type) || { input: 0, output: 0, calls: 0, cost: 0 }
              layerMap.set(d.layer_type, {
                input: prev.input + d.input_tokens,
                output: prev.output + d.output_tokens,
                calls: prev.calls + d.call_count,
                cost: prev.cost + d.cost_usd,
              })
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
                            <div className="text-xs text-muted-foreground">Recorded by gateway</div>
                          </div>
                          <div className="rounded-lg bg-muted p-3 text-center">
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Output Tokens</div>
                            <div className="text-lg font-bold">{formatNumber(totalOutput)}</div>
                            <div className="text-xs text-muted-foreground">Recorded by gateway</div>
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
                                  <th className="pb-2 text-right">Total Biaya</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Array.from(modelMap.entries()).map(([model, data], i) => (
                                  <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                                    <td className="py-1.5 pr-3">
                                      <span className="font-mono text-xs">{model}</span>
                                    </td>
                                    <td className="py-1.5 pr-3 text-right">{formatNumber(data.input)}</td>
                                    <td className="py-1.5 pr-3 text-right">{formatNumber(data.output)}</td>
                                    <td className="py-1.5 pr-3 text-right">{data.calls}</td>
                                    <td className="py-1.5 text-right font-semibold text-emerald-600">{formatIDR(data.cost)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Per-Layer Breakdown */}
                        <div>
                          <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><Activity className="h-4 w-4" /> Breakdown per Layer Runtime</h4>
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
                                      <td className="py-1.5 text-right font-semibold text-emerald-600">{formatIDR(data.cost)}</td>
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
                                  <th className="pb-2 text-right">Total Biaya</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.map((d, i) => (
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
                                    <td className="py-1.5 text-right font-semibold text-emerald-600">{formatIDR(d.cost_usd)}</td>
                                  </tr>
                                ))}
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
                <CardDescription>Breakdown lengkap penggunaan token berdasarkan layer dan model aktif di gateway.</CardDescription>
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
                        <th className="pb-2 text-right">Total Biaya</th>
                      </tr>
                    </thead>
                    <tbody>
                      {layerBreakdown.map((r, i) => (
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
                          <td className="py-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">{formatIDR(r.cost_usd)}</td>
                        </tr>
                      ))}
                      {layerBreakdown.length > 0 && (() => {
                        return (
                          <tr className="border-t-2 font-semibold bg-muted/30">
                            <td className="py-2 pr-3" colSpan={3}>TOTAL</td>
                            <td className="py-2 pr-3 text-right">{formatNumber(layerBreakdown.reduce((s, r) => s + r.input_tokens, 0))}</td>
                            <td className="py-2 pr-3 text-right">{formatNumber(layerBreakdown.reduce((s, r) => s + r.output_tokens, 0))}</td>
                            <td className="py-2 pr-3 text-right">{formatNumber(layerBreakdown.reduce((s, r) => s + r.call_count, 0))}</td>
                            <td className="py-2 pr-3 text-right">-</td>
                            <td className="py-2 text-right text-emerald-600 dark:text-emerald-400">{formatIDR(sumCostUsd(layerBreakdown))}</td>
                          </tr>
                        )
                      })()}
                      {layerBreakdown.length === 0 && (
                        <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">Belum ada data</td></tr>
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
