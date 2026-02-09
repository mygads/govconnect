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

// ==================== Helpers ====================

const USD_TO_IDR = 16000

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return n.toLocaleString("id-ID")
}

function formatCost(usd: number): string {
  const idr = usd * USD_TO_IDR
  if (idr >= 1_000_000) return "Rp " + (idr / 1_000_000).toFixed(2) + " jt"
  if (idr >= 1_000) return "Rp " + (idr / 1_000).toFixed(1) + " rb"
  return "Rp " + idr.toFixed(0)
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
  const [summaryLoading, setSummaryLoading] = useState(true)

  // Periode tab data (loaded on demand)
  const [byPeriod, setByPeriod] = useState<PeriodUsage[]>([])
  const [byPeriodLayer, setByPeriodLayer] = useState<PeriodLayerUsage[]>([])
  const [periodeLoading, setPeriodeLoading] = useState(false)
  const [periodeLoaded, setPeriodeLoaded] = useState(false)

  // Village tab data (loaded on demand)
  const [byVillage, setByVillage] = useState<VillageUsage[]>([])
  const [responsesByVillage, setResponsesByVillage] = useState<VillageResponse[]>([])
  const [villageNames, setVillageNames] = useState<Record<string, string>>({})
  const [villageLoading, setVillageLoading] = useState(false)
  const [villageLoaded, setVillageLoaded] = useState(false)

  // Village detail modal
  const [detailVillageId, setDetailVillageId] = useState<string | null>(null)
  const [detailData, setDetailData] = useState<VillageModelDetail[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  // Layer tab data (loaded on demand)
  const [layerBreakdown, setLayerBreakdown] = useState<LayerBreakdown[]>([])
  const [layerLoading, setLayerLoading] = useState(false)
  const [layerLoaded, setLayerLoaded] = useState(false)

  useEffect(() => {
    if (user && user.role !== "superadmin") redirect("/dashboard")
  }, [user])

  // Load summary data on mount (3 calls only)
  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    const [s, bm, apc] = await Promise.all([
      fetchData<TokenSummary>("summary"),
      fetchData<ModelUsage[]>("by-model"),
      fetchData<AvgPerChat>("avg-per-chat"),
    ])
    setSummary(s)
    setByModel(bm || [])
    setAvgPerChat(apc)
    setSummaryLoading(false)
  }, [])

  useEffect(() => { loadSummary() }, [loadSummary])

  // Load periode data on demand (2 calls)
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

  // Load village data on demand (3 calls: by-village, responses-by-village, village names)
  const loadVillage = useCallback(async () => {
    setVillageLoading(true)
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null
    const [bv, rbv, villagesRes] = await Promise.all([
      fetchData<VillageUsage[]>("by-village"),
      fetchData<VillageResponse[]>("responses-by-village"),
      fetch("/api/superadmin/villages", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).then(r => r.ok ? r.json() : []).catch(() => []),
    ])
    setByVillage(bv || [])
    setResponsesByVillage(rbv || [])
    // Build village name map
    const nameMap: Record<string, string> = {}
    if (Array.isArray(villagesRes)) {
      villagesRes.forEach((v: VillageInfo) => { nameMap[v.id] = v.name })
    }
    setVillageNames(nameMap)
    setVillageLoading(false)
    setVillageLoaded(true)
  }, [])

  // Load layer data on demand (1 call)
  const loadLayer = useCallback(async () => {
    setLayerLoading(true)
    const lb = await fetchData<LayerBreakdown[]>("layer-breakdown")
    setLayerBreakdown(lb || [])
    setLayerLoading(false)
    setLayerLoaded(true)
  }, [])

  // Open village detail modal
  const openVillageDetail = useCallback(async (villageId: string) => {
    setDetailVillageId(villageId)
    setDetailLoading(true)
    const params: Record<string, string> = {}
    // Use __null__ for superadmin testing (village_id IS NULL in DB)
    if (villageId === "__superadmin__") {
      params.village_id = "__null__"
    } else {
      params.village_id = villageId
    }
    const data = await fetchData<VillageModelDetail[]>("village-model-detail", params)
    setDetailData(data || [])
    setDetailLoading(false)
  }, [])

  // Helper to resolve village name
  const getVillageName = useCallback((villageId: string | null | undefined): string => {
    if (!villageId || villageId === "" || villageId === "null" || villageId === "undefined") return "Superadmin (Testing)"
    return villageNames[villageId] || villageId
  }, [villageNames])

  // Handle tab change - load data on demand
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
            Monitoring penggunaan token AI dari Gemini API (data real dari usageMetadata)
          </p>
        </div>
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

      {/* Summary Cards - Always visible */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
          value={summaryLoading ? null : formatCost(summary?.total_cost_usd || 0)}
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
          label="Rata-rata / Chat"
          value={summaryLoading ? null : formatNumber(avgPerChat?.avg_total || 0)}
          sub={summaryLoading ? null : `${formatNumber(avgPerChat?.avg_input || 0)} in / ${formatNumber(avgPerChat?.avg_output || 0)} out · ${formatNumber(avgPerChat?.total_chats || 0)} chats`}
          loading={summaryLoading}
        />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="ringkasan">Ringkasan</TabsTrigger>
          <TabsTrigger value="periode">Per Periode</TabsTrigger>
          <TabsTrigger value="village">Per Desa</TabsTrigger>
          <TabsTrigger value="layer">Layer Detail</TabsTrigger>
        </TabsList>

        {/* ====== RINGKASAN TAB ====== */}
        <TabsContent value="ringkasan" className="space-y-6 mt-4">
          {/* Micro vs Full Doughnut + Model Doughnut */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Cpu className="h-4 w-4" /> Micro NLU vs Full NLU
                </CardTitle>
              </CardHeader>
              <CardContent>
                {summaryLoading ? <Skeleton className="h-56" /> : (
                  <>
                    <div className="h-56 flex items-center justify-center">
                      <Doughnut
                        data={{
                          labels: ["Full NLU", "Micro NLU"],
                          datasets: [{
                            data: [summary?.full_nlu_tokens || 0, summary?.micro_nlu_tokens || 0],
                            backgroundColor: ["#6366f1", "#f59e0b"],
                            borderWidth: 2,
                            borderColor: "#fff",
                          }],
                        }}
                        options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }}
                      />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950 p-2 text-center">
                        <div className="font-bold text-indigo-700 dark:text-indigo-300">{formatNumber(summary?.full_nlu_tokens || 0)}</div>
                        <div className="text-muted-foreground">Full NLU ({formatNumber(summary?.full_nlu_calls || 0)} calls)</div>
                      </div>
                      <div className="rounded-lg bg-amber-50 dark:bg-amber-950 p-2 text-center">
                        <div className="font-bold text-amber-700 dark:text-amber-300">{formatNumber(summary?.micro_nlu_tokens || 0)}</div>
                        <div className="text-muted-foreground">Micro NLU ({formatNumber(summary?.micro_nlu_calls || 0)} calls)</div>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" /> Distribusi per Model
                </CardTitle>
              </CardHeader>
              <CardContent>
                {summaryLoading ? <Skeleton className="h-56" /> : (
                  <div className="h-72 flex items-center justify-center">
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

          {/* Model Detail Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Cpu className="h-4 w-4" /> Detail Penggunaan per Model
              </CardTitle>
              <CardDescription>Data biaya dihitung dari cost real Gemini API (usageMetadata). Kurs: $1 = Rp {USD_TO_IDR.toLocaleString("id-ID")}</CardDescription>
            </CardHeader>
            <CardContent>
              {summaryLoading ? <Skeleton className="h-48" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 pr-4">Model</th>
                        <th className="pb-2 pr-4 text-right">Input Tokens</th>
                        <th className="pb-2 pr-4 text-right">Output Tokens</th>
                        <th className="pb-2 pr-4 text-right">Total Tokens</th>
                        <th className="pb-2 pr-4 text-right">API Calls</th>
                        <th className="pb-2 pr-4 text-right">Avg Latency</th>
                        <th className="pb-2 pr-4 text-right">Biaya (USD)</th>
                        <th className="pb-2 text-right">Biaya (IDR)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byModel.map((m, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="py-2 pr-4 font-mono text-xs">{m.model}</td>
                          <td className="py-2 pr-4 text-right">{formatNumber(m.input_tokens)}</td>
                          <td className="py-2 pr-4 text-right">{formatNumber(m.output_tokens)}</td>
                          <td className="py-2 pr-4 text-right font-semibold">{formatNumber(m.total_tokens)}</td>
                          <td className="py-2 pr-4 text-right">{formatNumber(m.call_count)}</td>
                          <td className="py-2 pr-4 text-right">{m.avg_duration_ms ? m.avg_duration_ms + "ms" : "-"}</td>
                          <td className="py-2 pr-4 text-right text-blue-600">{formatUSD(m.cost_usd)}</td>
                          <td className="py-2 text-right text-emerald-600 dark:text-emerald-400">{formatCost(m.cost_usd)}</td>
                        </tr>
                      ))}
                      {byModel.length === 0 && (
                        <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">Belum ada data</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ====== PERIODE TAB ====== */}
        <TabsContent value="periode" className="space-y-6 mt-4">
          {/* Period selector */}
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
                {/* Token Usage Over Time */}
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

                {/* Cost Over Time */}
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

              {/* Layer Stacked Bar */}
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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Skeleton className="h-80" />
              <Skeleton className="h-80" />
              <Skeleton className="h-80 lg:col-span-2" />
            </div>
          ) : (
            <>
              {/* Superadmin vs Village Summary */}
              {(() => {
                // by-village only returns non-null village_ids (real villages)
                // superadmin testing = total (from summary) - sum(village usage)
                const villageTotalTokens = byVillage.reduce((s, v) => s + v.total_tokens, 0)
                const villageTotalCost = byVillage.reduce((s, v) => s + v.cost_usd, 0)
                const villageTotalCalls = byVillage.reduce((s, v) => s + v.call_count, 0)
                const superadminTokens = Math.max(0, (summary?.total_tokens || 0) - villageTotalTokens)
                const superadminCost = Math.max(0, (summary?.total_cost_usd || 0) - villageTotalCost)
                const superadminCalls = Math.max(0, (summary?.total_calls || 0) - villageTotalCalls)
                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-xl border bg-card p-4 flex items-start gap-3">
                      <div className="rounded-lg bg-purple-100 dark:bg-purple-950 p-2.5">
                        <Shield className="h-5 w-5 text-purple-600" />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs text-muted-foreground">Superadmin (Testing)</p>
                        <p className="text-xl font-bold mt-0.5">{formatNumber(superadminTokens)} tokens</p>
                        <p className="text-xs text-muted-foreground">{formatCost(superadminCost)} · {superadminCalls} calls</p>
                      </div>
                      {superadminTokens > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openVillageDetail("__superadmin__")}
                          className="h-7 px-2 text-xs shrink-0"
                        >
                          <Eye className="h-3 w-3 mr-1" /> Detail
                        </Button>
                      )}
                    </div>
                    <div className="rounded-xl border bg-card p-4 flex items-start gap-3">
                      <div className="rounded-lg bg-blue-100 dark:bg-blue-950 p-2.5">
                        <Users className="h-5 w-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Desa (Produksi)</p>
                        <p className="text-xl font-bold mt-0.5">{formatNumber(villageTotalTokens)} tokens</p>
                        <p className="text-xs text-muted-foreground">{formatCost(villageTotalCost)} · {villageTotalCalls} calls · {byVillage.length} desa</p>
                      </div>
                    </div>
                  </div>
                )
              })()}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* AI Responses per Village Chart */}
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

                {/* Village Token Usage Doughnut */}
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

              {/* Village Token Usage Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Building2 className="h-4 w-4" /> Token Usage per Desa
                  </CardTitle>
                  <CardDescription>Klik &quot;Lihat Detail&quot; untuk melihat breakdown per model dan layer</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-2 pr-4">Desa</th>
                          <th className="pb-2 pr-4 text-right">Total Tokens</th>
                          <th className="pb-2 pr-4 text-right">Calls</th>
                          <th className="pb-2 pr-4 text-right">Biaya</th>
                          <th className="pb-2 text-right">Aksi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {byVillage.map((v, i) => (
                          <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="py-2 pr-4">
                              <span className="font-medium text-sm">{getVillageName(v.village_id)}</span>
                            </td>
                            <td className="py-2 pr-4 text-right">{formatNumber(v.total_tokens)}</td>
                            <td className="py-2 pr-4 text-right">{formatNumber(v.call_count)}</td>
                            <td className="py-2 pr-4 text-right text-emerald-600 dark:text-emerald-400">{formatCost(v.cost_usd)}</td>
                            <td className="py-2 text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openVillageDetail(v.village_id)}
                                className="h-7 px-2 text-xs"
                              >
                                <Eye className="h-3 w-3 mr-1" />
                                Lihat Detail
                              </Button>
                            </td>
                          </tr>
                        ))}
                        {byVillage.length === 0 && (
                          <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">Belum ada data</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* AI Responses Detail Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" /> Detail AI Response per Desa
                  </CardTitle>
                  <CardDescription>
                    Hanya menghitung pesan yang dikirimkan balik ke masyarakat (main_chat). Micro LLM internal calls tidak dihitung.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-2 pr-4">Desa</th>
                          <th className="pb-2 pr-4 text-right">Total Responses</th>
                          <th className="pb-2 text-right">Unique Users</th>
                        </tr>
                      </thead>
                      <tbody>
                        {responsesByVillage.map((v, i) => (
                          <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="py-2 pr-4">
                              <span className="text-sm font-medium">{getVillageName(v.village_id)}</span>
                            </td>
                            <td className="py-2 pr-4 text-right font-semibold">{formatNumber(v.response_count)}</td>
                            <td className="py-2 text-right">{formatNumber(v.unique_users)}</td>
                          </tr>
                        ))}
                        {responsesByVillage.length === 0 && (
                          <tr><td colSpan={3} className="py-8 text-center text-muted-foreground">Belum ada data</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {/* Village Detail Modal */}
          {detailVillageId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDetailVillageId(null)}>
              <div className="bg-background rounded-xl shadow-xl border max-w-2xl w-full max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b">
                  <div>
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                      {detailVillageId === "__superadmin__" ? (
                        <>
                          <Shield className="h-5 w-5 text-purple-600" />
                          Superadmin (Testing)
                        </>
                      ) : (
                        <>
                          <Building2 className="h-5 w-5 text-blue-600" />
                          {getVillageName(detailVillageId)}
                        </>
                      )}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Detail penggunaan per model dan layer</p>
                  </div>
                  <button onClick={() => setDetailVillageId(null)} className="rounded-lg p-1.5 hover:bg-muted transition-colors">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="p-4 overflow-y-auto max-h-[calc(80vh-80px)]">
                  {detailLoading ? (
                    <div className="space-y-3">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                    </div>
                  ) : detailData.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">Belum ada data detail</p>
                  ) : (
                    <>
                      {/* Summary for this village */}
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="rounded-lg bg-muted p-3 text-center">
                          <div className="text-xs text-muted-foreground">Total Tokens</div>
                          <div className="text-lg font-bold">{formatNumber(detailData.reduce((s, d) => s + d.total_tokens, 0))}</div>
                        </div>
                        <div className="rounded-lg bg-muted p-3 text-center">
                          <div className="text-xs text-muted-foreground">Total Calls</div>
                          <div className="text-lg font-bold">{formatNumber(detailData.reduce((s, d) => s + d.call_count, 0))}</div>
                        </div>
                        <div className="rounded-lg bg-muted p-3 text-center">
                          <div className="text-xs text-muted-foreground">Total Biaya</div>
                          <div className="text-lg font-bold text-emerald-600">{formatCost(detailData.reduce((s, d) => s + d.cost_usd, 0))}</div>
                        </div>
                      </div>

                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="pb-2 pr-3">Layer</th>
                            <th className="pb-2 pr-3">Model</th>
                            <th className="pb-2 pr-3 text-right">Input</th>
                            <th className="pb-2 pr-3 text-right">Output</th>
                            <th className="pb-2 pr-3 text-right">Total</th>
                            <th className="pb-2 pr-3 text-right">Calls</th>
                            <th className="pb-2 text-right">Biaya</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailData.map((d, i) => (
                            <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                              <td className="py-2 pr-3">
                                <span
                                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                                  style={{
                                    backgroundColor: (LAYER_COLORS[d.layer_type] || "#94a3b8") + "20",
                                    color: LAYER_COLORS[d.layer_type] || "#94a3b8",
                                  }}
                                >
                                  {LAYER_LABELS[d.layer_type] || d.layer_type}
                                </span>
                              </td>
                              <td className="py-2 pr-3 font-mono text-xs">{d.model}</td>
                              <td className="py-2 pr-3 text-right">{formatNumber(d.input_tokens)}</td>
                              <td className="py-2 pr-3 text-right">{formatNumber(d.output_tokens)}</td>
                              <td className="py-2 pr-3 text-right font-semibold">{formatNumber(d.total_tokens)}</td>
                              <td className="py-2 pr-3 text-right">{formatNumber(d.call_count)}</td>
                              <td className="py-2 text-right text-emerald-600 dark:text-emerald-400">{formatCost(d.cost_usd)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ====== LAYER DETAIL TAB ====== */}
        <TabsContent value="layer" className="space-y-6 mt-4">
          {layerLoading ? (
            <Skeleton className="h-80" />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Zap className="h-4 w-4" /> Detail Micro NLU vs Full NLU per Layer
                </CardTitle>
                <CardDescription>Breakdown penggunaan token berdasarkan layer dan model</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 pr-4">Layer</th>
                        <th className="pb-2 pr-4">Call Type</th>
                        <th className="pb-2 pr-4">Model</th>
                        <th className="pb-2 pr-4 text-right">Tokens</th>
                        <th className="pb-2 pr-4 text-right">Calls</th>
                        <th className="pb-2 pr-4 text-right">Avg Latency</th>
                        <th className="pb-2 text-right">Biaya</th>
                      </tr>
                    </thead>
                    <tbody>
                      {layerBreakdown.map((r, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="py-2 pr-4">
                            <span
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                              style={{
                                backgroundColor: (LAYER_COLORS[r.layer_type] || "#94a3b8") + "20",
                                color: LAYER_COLORS[r.layer_type] || "#94a3b8",
                              }}
                            >
                              {LAYER_LABELS[r.layer_type] || r.layer_type}
                            </span>
                          </td>
                          <td className="py-2 pr-4 font-mono text-xs">{r.call_type}</td>
                          <td className="py-2 pr-4 font-mono text-xs">{r.model}</td>
                          <td className="py-2 pr-4 text-right">{formatNumber(r.total_tokens)}</td>
                          <td className="py-2 pr-4 text-right">{formatNumber(r.call_count)}</td>
                          <td className="py-2 pr-4 text-right">{r.avg_duration_ms ? r.avg_duration_ms + "ms" : "-"}</td>
                          <td className="py-2 text-right text-emerald-600 dark:text-emerald-400">{formatCost(r.cost_usd)}</td>
                        </tr>
                      ))}
                      {layerBreakdown.length === 0 && (
                        <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">Belum ada data</td></tr>
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
