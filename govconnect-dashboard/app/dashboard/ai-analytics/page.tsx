"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Brain,
  Target,
  Coins,
  Clock,
  TrendingUp,
  RefreshCcw,
  MessageSquare,
  CheckCircle,
  XCircle,
  Zap,
  Activity,
  BarChart3,
  Cpu,
  AlertCircle,
  CheckCircle2,
  Info,
  Users,
  DollarSign,
  Calculator,
} from "lucide-react"
import { useAuth } from "@/components/auth/AuthContext"
import { redirect } from "next/navigation"
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Line, Bar, Doughnut } from 'react-chartjs-2'

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

// USD to IDR conversion rate
const USD_TO_IDR = 16700

interface AnalyticsSummary {
  totalRequests: number
  overallAccuracy: number
  totalCostUSD: number
  avgProcessingTimeMs: number
  topIntents: Array<{ intent: string; count: number; successRate: number }>
  topPatterns: Array<{ pattern: string; count: number }>
  tokenUsageLast7Days: Array<{ date: string; tokens: number; cost: number }>
}

// AI Optimization Stats (NEW)
interface OptimizationStats {
  cache: {
    totalHits: number
    totalMisses: number
    hitRate: number
    cacheSize: number
    avgHitCount: number
  }
  topCachedQueries: Array<{ key: string; hitCount: number; intent: string }>
}

// Conversation FSM Stats (NEW)
interface FSMStats {
  activeContexts: number
  stateDistribution: Record<string, number>
  avgMessageCount: number
}

// 2-Layer Architecture Stats (NEW)
interface ArchitectureStats {
  architecture: string
  layer1Stats?: {
    totalCalls: number
    avgConfidence: number
    avgProcessingTimeMs: number
  }
  layer2Stats?: {
    totalCalls: number
    avgProcessingTimeMs: number
  }
}

interface IntentDistribution {
  intents: Record<string, { total: number; success: number; failure: number }>
  total: number
}

interface TokenUsage {
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  estimatedCostUSD: number
  byModel: Record<string, { 
    input: number
    output: number
    cost: number
    calls: number
    pricing?: {
      inputPer1M: number
      outputPer1M: number
    }
  }>
  byDate: Array<{ date: string; tokens: number; inputTokens?: number; outputTokens?: number; cost: number }>
  last30Days?: Array<{ date: string; input: number; output: number; cost: number }>
  modelPricing?: Record<string, { input: number; output: number }>
}

interface ConversationFlow {
  avgMessagesPerSession: number
  avgSessionDurationMs: number
  completionRate: number
  dropoffPoints: Array<{ intent: string; dropoffRate: number }>
  intentTransitions: Array<{ from: string; to: string; count: number }>
}

// Model usage stats (merged from ai-usage page)
interface ModelStats {
  model: string
  successRate: string
  totalCalls: number
  successCalls: number
  failedCalls: number
  avgResponseTimeMs: number
  lastUsed: string
  lastError?: string
}

interface ModelDetailStats {
  model: string
  totalCalls: number
  successCalls: number
  failedCalls: number
  successRate: number
  avgResponseTimeMs: number
  totalResponseTimeMs: number
  lastUsed: string
  lastError?: string
  errorHistory: Array<{
    timestamp: string
    error: string
  }>
}

interface ModelUsageStats {
  summary: {
    totalRequests: number
    lastUpdated: string | null
    totalModels: number
    serviceStatus?: string
  }
  models: ModelStats[]
  error?: string
}

export default function AIAnalyticsPage() {
  const { user } = useAuth()
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [intents, setIntents] = useState<IntentDistribution | null>(null)
  const [tokens, setTokens] = useState<TokenUsage | null>(null)
  const [flow, setFlow] = useState<ConversationFlow | null>(null)
  const [modelUsage, setModelUsage] = useState<ModelUsageStats | null>(null)
  const [selectedModel, setSelectedModel] = useState<ModelDetailStats | null>(null)
  const [optimization, setOptimization] = useState<OptimizationStats | null>(null)
  const [fsmStats, setFsmStats] = useState<FSMStats | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Redirect non-superadmin
  useEffect(() => {
    if (user && user.role !== 'superadmin') {
      redirect('/dashboard')
    }
  }, [user])

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      
      const token = localStorage.getItem('token')
      const headers = { 'Authorization': `Bearer ${token}` }

      const [summaryRes, intentsRes, tokensRes, flowRes, modelUsageRes, optimizationRes] = await Promise.all([
        fetch('/api/statistics/ai-analytics', { headers }),
        fetch('/api/statistics/ai-analytics/intents', { headers }),
        fetch('/api/statistics/ai-analytics/tokens', { headers }),
        fetch('/api/statistics/ai-analytics/flow', { headers }),
        fetch('/api/statistics/ai-usage', { headers }),
        fetch('/api/statistics/ai-optimization', { headers }),
      ])

      if (summaryRes.ok) setSummary(await summaryRes.json())
      if (intentsRes.ok) setIntents(await intentsRes.json())
      if (tokensRes.ok) setTokens(await tokensRes.json())
      if (flowRes.ok) setFlow(await flowRes.json())
      if (modelUsageRes.ok) setModelUsage(await modelUsageRes.json())
      if (optimizationRes.ok) setOptimization(await optimizationRes.json())
    } catch (err: any) {
      setError(err.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Format USD currency
  const formatUSD = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 4,
    }).format(value)
  }

  // Format IDR currency
  const formatIDR = (value: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)
  }

  // Convert USD to IDR
  const usdToIdr = (usd: number) => usd * USD_TO_IDR

  // Format number with Indonesian locale
  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('id-ID').format(value)
  }

  // Calculate cost per message
  const getCostPerMessage = () => {
    if (!summary?.totalRequests || summary.totalRequests === 0) return 0
    return summary.totalCostUSD / summary.totalRequests
  }

  // Calculate cost per user (assuming avg 5 messages per user session)
  const getCostPerUser = () => {
    const avgMessagesPerUser = flow?.avgMessagesPerSession || 5
    return getCostPerMessage() * avgMessagesPerUser
  }

  // Get unique users count (from sessions)
  const getUniqueUsers = () => {
    return flow?.avgMessagesPerSession && summary?.totalRequests
      ? Math.round(summary.totalRequests / flow.avgMessagesPerSession)
      : 0
  }

  const formatIntent = (intent: string) => {
    const map: Record<string, string> = {
      'CREATE_COMPLAINT': 'Buat Laporan',
      'CREATE_RESERVATION': 'Buat Reservasi',
      'CHECK_STATUS': 'Cek Status',
      'CANCEL_COMPLAINT': 'Batalkan Laporan',
      'CANCEL_RESERVATION': 'Batalkan Reservasi',
      'HISTORY': 'Riwayat',
      'KNOWLEDGE_QUERY': 'Tanya Informasi',
      'QUESTION': 'Pertanyaan',
      'UNKNOWN': 'Tidak Dikenal',
    }
    return map[intent] || intent
  }

  // Model usage helper functions
  const getSuccessRateColor = (rate: string) => {
    const numRate = parseInt(rate)
    if (numRate >= 90) return 'text-green-600 dark:text-green-400'
    if (numRate >= 70) return 'text-yellow-600 dark:text-yellow-400'
    return 'text-red-600 dark:text-red-400'
  }

  const getSuccessRateBadge = (rate: string) => {
    const numRate = parseInt(rate)
    if (numRate >= 90) return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
    if (numRate >= 70) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
    return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
  }

  const formatDate = (dateString: string) => {
    if (!dateString) return '-'
    const date = new Date(dateString)
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date)
  }

  const formatRelativeTime = (dateString: string) => {
    if (!dateString) return '-'
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Baru saja'
    if (diffMins < 60) return `${diffMins} menit lalu`
    if (diffHours < 24) return `${diffHours} jam lalu`
    return `${diffDays} hari lalu`
  }

  const fetchModelDetail = async (modelName: string) => {
    try {
      setLoadingDetail(true)
      
      const response = await fetch(`/api/statistics/ai-usage/${encodeURIComponent(modelName)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      })

      if (response.ok) {
        const data = await response.json()
        setSelectedModel(data)
      } else {
        setSelectedModel(null)
      }
    } catch (err) {
      console.error('Failed to fetch model detail:', err)
      setSelectedModel(null)
    } finally {
      setLoadingDetail(false)
    }
  }

  // Token usage chart data
  const tokenChartData = {
    labels: tokens?.byDate?.map(d => {
      const date = new Date(d.date)
      return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
    }) || [],
    datasets: [
      {
        label: 'Token Usage',
        data: tokens?.byDate?.map(d => d.tokens) || [],
        fill: true,
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.4,
      },
    ],
  }

  // Cost chart data (in IDR)
  const costChartData = {
    labels: tokens?.byDate?.map(d => {
      const date = new Date(d.date)
      return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
    }) || [],
    datasets: [
      {
        label: 'Biaya (IDR)',
        data: tokens?.byDate?.map(d => d.cost * USD_TO_IDR) || [],
        fill: true,
        borderColor: 'rgb(16, 185, 129)',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        tension: 0.4,
      },
    ],
  }

  // Intent distribution chart
  const intentChartData = {
    labels: intents?.intents ? Object.keys(intents.intents).map(formatIntent) : [],
    datasets: [
      {
        data: intents?.intents ? Object.values(intents.intents).map(i => i.total) : [],
        backgroundColor: [
          'rgba(59, 130, 246, 0.8)',
          'rgba(16, 185, 129, 0.8)',
          'rgba(245, 158, 11, 0.8)',
          'rgba(239, 68, 68, 0.8)',
          'rgba(139, 92, 246, 0.8)',
          'rgba(236, 72, 153, 0.8)',
          'rgba(14, 165, 233, 0.8)',
          'rgba(168, 162, 158, 0.8)',
        ],
        borderWidth: 0,
      },
    ],
  }

  // Model usage chart
  const modelChartData = {
    labels: tokens?.byModel ? Object.keys(tokens.byModel) : [],
    datasets: [
      {
        label: 'Input Tokens',
        data: tokens?.byModel ? Object.values(tokens.byModel).map(m => m.input) : [],
        backgroundColor: 'rgba(59, 130, 246, 0.8)',
      },
      {
        label: 'Output Tokens',
        data: tokens?.byModel ? Object.values(tokens.byModel).map(m => m.output) : [],
        backgroundColor: 'rgba(16, 185, 129, 0.8)',
      },
    ],
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" />
            AI Analytics
          </h1>
          <p className="text-muted-foreground">
            Monitoring performa dan penggunaan AI chatbot
          </p>
        </div>
        <Button onClick={fetchData} variant="outline" size="sm">
          <RefreshCcw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Summary Cards - Row 1 */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Requests</p>
                <p className="text-3xl font-bold">{formatNumber(summary?.totalRequests || 0)}</p>
                <p className="text-xs text-muted-foreground mt-1">pesan diproses AI</p>
              </div>
              <MessageSquare className="h-10 w-10 text-blue-500 opacity-80" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Estimasi User</p>
                <p className="text-3xl font-bold">{formatNumber(getUniqueUsers())}</p>
                <p className="text-xs text-muted-foreground mt-1">~{flow?.avgMessagesPerSession?.toFixed(1) || 5} pesan/user</p>
              </div>
              <Users className="h-10 w-10 text-indigo-500 opacity-80" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Accuracy Rate</p>
                <div className="flex items-center gap-2">
                  <p className="text-3xl font-bold">{summary?.overallAccuracy || 0}%</p>
                  {(summary?.overallAccuracy || 0) >= 90 ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : (
                    <XCircle className="h-5 w-5 text-yellow-500" />
                  )}
                </div>
              </div>
              <Target className="h-10 w-10 text-green-500 opacity-80" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Avg Response Time</p>
                <p className="text-3xl font-bold">{Math.round(summary?.avgProcessingTimeMs || 0)}ms</p>
                <p className="text-xs text-muted-foreground mt-1">{((summary?.avgProcessingTimeMs || 0) / 1000).toFixed(1)} detik</p>
              </div>
              <Clock className="h-10 w-10 text-purple-500 opacity-80" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cost Analysis Cards - Row 2 */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Biaya (IDR)</p>
                <p className="text-2xl font-bold text-green-700 dark:text-green-400">
                  {formatIDR(usdToIdr(summary?.totalCostUSD || 0))}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatUSD(summary?.totalCostUSD || 0)}
                </p>
              </div>
              <Coins className="h-10 w-10 text-green-600 opacity-80" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Biaya per Pesan</p>
                <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">
                  {formatIDR(usdToIdr(getCostPerMessage()))}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatUSD(getCostPerMessage())}
                </p>
              </div>
              <Calculator className="h-10 w-10 text-blue-600 opacity-80" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-purple-200 dark:border-purple-900 bg-purple-50/50 dark:bg-purple-950/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Biaya per User</p>
                <p className="text-2xl font-bold text-purple-700 dark:text-purple-400">
                  {formatIDR(usdToIdr(getCostPerUser()))}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  ~{flow?.avgMessagesPerSession?.toFixed(1) || 5} pesan/sesi
                </p>
              </div>
              <Users className="h-10 w-10 text-purple-600 opacity-80" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-orange-200 dark:border-orange-900 bg-orange-50/50 dark:bg-orange-950/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Biaya per 1K Pesan</p>
                <p className="text-2xl font-bold text-orange-700 dark:text-orange-400">
                  {formatIDR(usdToIdr(getCostPerMessage() * 1000))}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatUSD(getCostPerMessage() * 1000)}
                </p>
              </div>
              <DollarSign className="h-10 w-10 text-orange-600 opacity-80" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AI Optimization Stats (NEW) */}
      {optimization && (
        <Card className="border-2 border-dashed border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-500" />
              AI Optimization Performance
              <Badge variant="secondary" className="ml-2">NEW</Badge>
            </CardTitle>
            <CardDescription>
              Fast Intent Classification & Response Caching untuk mengurangi latency dan cost
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="p-4 bg-background rounded-lg border">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm font-medium text-muted-foreground">Cache Hit Rate</span>
                </div>
                <p className="text-2xl font-bold text-green-600">
                  {((optimization.cache?.hitRate || 0) * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {optimization.cache?.totalHits || 0} hits / {(optimization.cache?.totalHits || 0) + (optimization.cache?.totalMisses || 0)} total
                </p>
              </div>
              
              <div className="p-4 bg-background rounded-lg border">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-medium text-muted-foreground">Cache Size</span>
                </div>
                <p className="text-2xl font-bold">{optimization.cache?.cacheSize || 0}</p>
                <p className="text-xs text-muted-foreground mt-1">cached responses</p>
              </div>
              
              <div className="p-4 bg-background rounded-lg border">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-4 w-4 text-purple-500" />
                  <span className="text-sm font-medium text-muted-foreground">Avg Hit Count</span>
                </div>
                <p className="text-2xl font-bold">{(optimization.cache?.avgHitCount || 0).toFixed(1)}</p>
                <p className="text-xs text-muted-foreground mt-1">per cached query</p>
              </div>
              
              <div className="p-4 bg-background rounded-lg border">
                <div className="flex items-center gap-2 mb-2">
                  <Coins className="h-4 w-4 text-yellow-500" />
                  <span className="text-sm font-medium text-muted-foreground">Est. Savings</span>
                </div>
                <p className="text-2xl font-bold text-green-600">
                  ~{((optimization.cache?.hitRate || 0) * 30).toFixed(0)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">LLM cost reduction</p>
              </div>
            </div>
            
            {/* Top Cached Queries */}
            {optimization.topCachedQueries && optimization.topCachedQueries.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-medium mb-2">Top Cached Queries</h4>
                <div className="space-y-2">
                  {optimization.topCachedQueries.slice(0, 5).map((q, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 bg-muted rounded text-sm">
                      <span className="truncate flex-1 font-mono text-xs">{q.key}</span>
                      <div className="flex items-center gap-2 ml-2">
                        <Badge variant="outline" className="text-xs">{q.intent}</Badge>
                        <span className="text-muted-foreground">{q.hitCount} hits</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Cost Savings from Cache */}
            <div className="mt-4 p-4 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-900">
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2 text-green-700 dark:text-green-400">
                💰 Estimasi Penghematan dari Cache
              </h4>
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">LLM Calls Dihemat</p>
                  <p className="font-bold text-green-600">{formatNumber(optimization.cache?.totalHits || 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Est. Biaya Dihemat (USD)</p>
                  <p className="font-bold text-green-600">
                    {formatUSD((optimization.cache?.totalHits || 0) * getCostPerMessage())}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Est. Biaya Dihemat (IDR)</p>
                  <p className="font-bold text-green-600">
                    {formatIDR(usdToIdr((optimization.cache?.totalHits || 0) * getCostPerMessage()))}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cost Efficiency Analysis */}
      <Card className="border-2 border-green-200 dark:border-green-900 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-green-600" />
            Analisis Efisiensi Biaya
          </CardTitle>
          <CardDescription>
            Perbandingan biaya AI vs alternatif lain (1 USD = Rp {formatNumber(USD_TO_IDR)})
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* AI Cost */}
            <div className="p-4 bg-white dark:bg-gray-900 rounded-lg border">
              <div className="flex items-center gap-2 mb-2">
                <Brain className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-medium">AI Chatbot</span>
              </div>
              <p className="text-2xl font-bold text-blue-600">{formatIDR(usdToIdr(getCostPerUser()))}</p>
              <p className="text-xs text-muted-foreground">per user/sesi</p>
              <p className="text-xs text-green-600 mt-1">✓ 24/7 Available</p>
            </div>

            {/* Human CS Cost Comparison */}
            <div className="p-4 bg-white dark:bg-gray-900 rounded-lg border">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-orange-500" />
                <span className="text-sm font-medium">CS Manual</span>
              </div>
              <p className="text-2xl font-bold text-orange-600">{formatIDR(15000)}</p>
              <p className="text-xs text-muted-foreground">per user/sesi (est.)</p>
              <p className="text-xs text-muted-foreground mt-1">Jam kerja terbatas</p>
            </div>

            {/* Savings */}
            <div className="p-4 bg-green-100 dark:bg-green-900/50 rounded-lg border border-green-300 dark:border-green-700">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium">Penghematan</span>
              </div>
              <p className="text-2xl font-bold text-green-600">
                {Math.round((1 - usdToIdr(getCostPerUser()) / 15000) * 100)}%
              </p>
              <p className="text-xs text-muted-foreground">vs CS Manual</p>
              <p className="text-xs text-green-600 mt-1">
                {formatIDR(15000 - usdToIdr(getCostPerUser()))}/user
              </p>
            </div>

            {/* Monthly Savings */}
            <div className="p-4 bg-green-100 dark:bg-green-900/50 rounded-lg border border-green-300 dark:border-green-700">
              <div className="flex items-center gap-2 mb-2">
                <Coins className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium">Hemat/Bulan</span>
              </div>
              <p className="text-2xl font-bold text-green-600">
                {formatIDR((15000 - usdToIdr(getCostPerUser())) * getUniqueUsers())}
              </p>
              <p className="text-xs text-muted-foreground">untuk {formatNumber(getUniqueUsers())} user</p>
            </div>
          </div>

          {/* Detailed Breakdown */}
          <div className="mt-4 p-4 bg-white dark:bg-gray-900 rounded-lg border">
            <h4 className="font-medium mb-3">📊 Rincian Biaya Detail</h4>
            <div className="grid gap-2 text-sm">
              <div className="flex justify-between py-1 border-b">
                <span className="text-muted-foreground">Biaya per Token (Input)</span>
                <span>~{formatIDR(usdToIdr(0.10 / 1000000))} / token</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-muted-foreground">Biaya per Token (Output)</span>
                <span>~{formatIDR(usdToIdr(0.40 / 1000000))} / token</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-muted-foreground">Avg Tokens per Pesan</span>
                <span>~{tokens?.totalTokens && summary?.totalRequests ? Math.round(tokens.totalTokens / summary.totalRequests) : 700} tokens</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-muted-foreground">Biaya per Pesan</span>
                <span className="font-medium">{formatIDR(usdToIdr(getCostPerMessage()))}</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-muted-foreground">Avg Pesan per User</span>
                <span>{flow?.avgMessagesPerSession?.toFixed(1) || 5} pesan</span>
              </div>
              <div className="flex justify-between py-1 font-medium">
                <span>Biaya per User Session</span>
                <span className="text-green-600">{formatIDR(usdToIdr(getCostPerUser()))}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Token Usage Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-lg bg-blue-100 dark:bg-blue-900">
                <Zap className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Input Tokens</p>
                <p className="text-2xl font-bold">{formatNumber(tokens?.totalInputTokens || 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-lg bg-green-100 dark:bg-green-900">
                <Activity className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Output Tokens</p>
                <p className="text-2xl font-bold">{formatNumber(tokens?.totalOutputTokens || 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-lg bg-purple-100 dark:bg-purple-900">
                <BarChart3 className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Tokens</p>
                <p className="text-2xl font-bold">{formatNumber(tokens?.totalTokens || 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Token Usage Over Time */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Token Usage (7 Hari Terakhir)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <Line
                data={tokenChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                  },
                  scales: {
                    y: { beginAtZero: true },
                  },
                }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Cost Over Time */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5" />
              Estimasi Biaya dalam Rupiah (7 Hari Terakhir)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <Line
                data={costChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                  },
                  scales: {
                    y: { beginAtZero: true },
                  },
                }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Intent Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Distribusi Intent
            </CardTitle>
            <CardDescription>
              Jenis permintaan yang paling sering diproses
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 flex items-center justify-center">
              <div className="w-64 h-64">
                <Doughnut
                  data={intentChartData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: {
                        position: 'right',
                        labels: { boxWidth: 12, padding: 8 },
                      },
                    },
                  }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Model Usage */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              Penggunaan per Model
            </CardTitle>
            <CardDescription>
              Token usage breakdown per LLM model
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <Bar
                data={modelChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { position: 'top' },
                  },
                  scales: {
                    y: { beginAtZero: true, stacked: false },
                    x: { stacked: false },
                  },
                }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Conversation Flow Stats */}
      {flow && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Conversation Flow Analysis
            </CardTitle>
            <CardDescription>
              Analisis alur percakapan pengguna
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-3">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm font-medium text-muted-foreground mb-1">Avg Messages/Session</p>
                <p className="text-2xl font-bold">{flow.avgMessagesPerSession?.toFixed(1) || '0'}</p>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm font-medium text-muted-foreground mb-1">Completion Rate</p>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-bold">{flow.completionRate?.toFixed(1) || '0'}%</p>
                  <Progress value={flow.completionRate || 0} className="flex-1" />
                </div>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm font-medium text-muted-foreground mb-1">Avg Session Duration</p>
                <p className="text-2xl font-bold">
                  {flow.avgSessionDurationMs ? Math.round(flow.avgSessionDurationMs / 1000) : 0}s
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Weekly & Monthly Summary */}
      {tokens?.last30Days && tokens.last30Days.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Ringkasan Penggunaan & Biaya
            </CardTitle>
            <CardDescription>
              Summary penggunaan token dan biaya per periode (1 USD = Rp {formatNumber(USD_TO_IDR)})
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-2">
              {/* This Week Summary */}
              <div className="p-4 border rounded-lg bg-blue-50/30 dark:bg-blue-950/20">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  📅 Minggu Ini (7 Hari Terakhir)
                </h4>
                {(() => {
                  const last7Days = tokens.last30Days?.slice(-7) || []
                  const weeklyInputTokens = last7Days.reduce((sum, d) => sum + (d.input || 0), 0)
                  const weeklyOutputTokens = last7Days.reduce((sum, d) => sum + (d.output || 0), 0)
                  const weeklyCost = last7Days.reduce((sum, d) => sum + (d.cost || 0), 0)
                  const weeklyMessages = summary?.totalRequests ? Math.round(summary.totalRequests * 7 / 30) : 0
                  
                  return (
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Input Tokens</span>
                        <span className="font-medium">{formatNumber(weeklyInputTokens)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Output Tokens</span>
                        <span className="font-medium">{formatNumber(weeklyOutputTokens)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total Tokens</span>
                        <span className="font-medium">{formatNumber(weeklyInputTokens + weeklyOutputTokens)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Est. Pesan</span>
                        <span className="font-medium">~{formatNumber(weeklyMessages)}</span>
                      </div>
                      <div className="flex justify-between border-t pt-2 mt-2">
                        <span className="text-muted-foreground font-medium">Biaya (USD)</span>
                        <span className="font-medium text-blue-600">{formatUSD(weeklyCost)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground font-medium">Biaya (IDR)</span>
                        <span className="font-bold text-green-600">{formatIDR(usdToIdr(weeklyCost))}</span>
                      </div>
                    </div>
                  )
                })()}
              </div>

              {/* This Month Summary */}
              <div className="p-4 border rounded-lg bg-purple-50/30 dark:bg-purple-950/20">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  📆 Bulan Ini (30 Hari Terakhir)
                </h4>
                {(() => {
                  const monthlyInputTokens = tokens.last30Days?.reduce((sum, d) => sum + (d.input || 0), 0) || 0
                  const monthlyOutputTokens = tokens.last30Days?.reduce((sum, d) => sum + (d.output || 0), 0) || 0
                  const monthlyCost = tokens.last30Days?.reduce((sum, d) => sum + (d.cost || 0), 0) || 0
                  const monthlyMessages = summary?.totalRequests || 0
                  const monthlyUsers = getUniqueUsers()
                  
                  return (
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Input Tokens</span>
                        <span className="font-medium">{formatNumber(monthlyInputTokens)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Output Tokens</span>
                        <span className="font-medium">{formatNumber(monthlyOutputTokens)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total Tokens</span>
                        <span className="font-medium">{formatNumber(monthlyInputTokens + monthlyOutputTokens)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total Pesan</span>
                        <span className="font-medium">{formatNumber(monthlyMessages)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Est. User</span>
                        <span className="font-medium">~{formatNumber(monthlyUsers)}</span>
                      </div>
                      <div className="flex justify-between border-t pt-2 mt-2">
                        <span className="text-muted-foreground font-medium">Biaya (USD)</span>
                        <span className="font-medium text-blue-600">{formatUSD(monthlyCost)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground font-medium">Biaya (IDR)</span>
                        <span className="font-bold text-green-600">{formatIDR(usdToIdr(monthlyCost))}</span>
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>

            {/* Cost Projection */}
            <div className="mt-6 p-4 border rounded-lg bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-950/30 dark:to-blue-950/30">
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                📊 Proyeksi Biaya
              </h4>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="text-center p-3 bg-white/50 dark:bg-gray-900/50 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Per Hari</p>
                  <p className="font-bold text-lg">{formatIDR(usdToIdr((summary?.totalCostUSD || 0) / 30))}</p>
                </div>
                <div className="text-center p-3 bg-white/50 dark:bg-gray-900/50 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Per Minggu</p>
                  <p className="font-bold text-lg">{formatIDR(usdToIdr((summary?.totalCostUSD || 0) / 30 * 7))}</p>
                </div>
                <div className="text-center p-3 bg-white/50 dark:bg-gray-900/50 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Per Bulan</p>
                  <p className="font-bold text-lg">{formatIDR(usdToIdr(summary?.totalCostUSD || 0))}</p>
                </div>
                <div className="text-center p-3 bg-white/50 dark:bg-gray-900/50 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Per Tahun (Est.)</p>
                  <p className="font-bold text-lg">{formatIDR(usdToIdr((summary?.totalCostUSD || 0) * 12))}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Model Pricing & Usage Table */}
      {tokens?.byModel && Object.keys(tokens.byModel).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5" />
              Detail Biaya per Model
            </CardTitle>
            <CardDescription>
              Rincian penggunaan token dan biaya per model AI (1 USD = Rp {formatNumber(USD_TO_IDR)})
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Request</TableHead>
                  <TableHead className="text-right">Input Tokens</TableHead>
                  <TableHead className="text-right">Output Tokens</TableHead>
                  <TableHead className="text-right">Biaya/Pesan</TableHead>
                  <TableHead className="text-right">Total (USD)</TableHead>
                  <TableHead className="text-right">Total (IDR)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(tokens.byModel).map(([model, data]) => {
                  const costPerMessage = data.calls > 0 ? data.cost / data.calls : 0
                  return (
                    <TableRow key={model}>
                      <TableCell className="font-medium">
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">{model}</code>
                      </TableCell>
                      <TableCell className="text-right">{formatNumber(data.calls || 0)}</TableCell>
                      <TableCell className="text-right">{formatNumber(data.input)}</TableCell>
                      <TableCell className="text-right">{formatNumber(data.output)}</TableCell>
                      <TableCell className="text-right text-purple-600">
                        {formatIDR(usdToIdr(costPerMessage))}
                      </TableCell>
                      <TableCell className="text-right text-blue-600">
                        {formatUSD(data.cost)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-green-600">
                        {formatIDR(usdToIdr(data.cost))}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {/* Total Row */}
                <TableRow className="bg-muted/50 font-semibold">
                  <TableCell>TOTAL</TableCell>
                  <TableCell className="text-right">
                    {formatNumber(Object.values(tokens.byModel).reduce((sum, d) => sum + (d.calls || 0), 0))}
                  </TableCell>
                  <TableCell className="text-right">{formatNumber(tokens.totalInputTokens)}</TableCell>
                  <TableCell className="text-right">{formatNumber(tokens.totalOutputTokens)}</TableCell>
                  <TableCell className="text-right text-purple-600">
                    {formatIDR(usdToIdr(getCostPerMessage()))}
                  </TableCell>
                  <TableCell className="text-right text-blue-600">
                    {formatUSD(tokens.estimatedCostUSD)}
                  </TableCell>
                  <TableCell className="text-right font-bold text-green-600">
                    {formatIDR(usdToIdr(tokens.estimatedCostUSD))}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Model Pricing Reference */}
      {tokens?.modelPricing && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              Referensi Harga Model AI (Gemini)
            </CardTitle>
            <CardDescription>
              Harga per 1 juta token berdasarkan dokumentasi Google AI (Desember 2025) - 1 USD = Rp {formatNumber(USD_TO_IDR)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Deskripsi</TableHead>
                  <TableHead className="text-right">Input/1M (USD)</TableHead>
                  <TableHead className="text-right">Output/1M (USD)</TableHead>
                  <TableHead className="text-right">Est. Biaya/1K Pesan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(tokens.modelPricing).map(([model, pricing]) => {
                  const modelDescriptions: Record<string, string> = {
                    'gemini-2.5-flash': 'Hybrid reasoning, 1M context',
                    'gemini-2.5-flash-lite': 'Smallest, cost-efficient',
                    'gemini-2.0-flash': 'Balanced multimodal, 1M context',
                    'gemini-2.0-flash-lite': 'Legacy cost-efficient',
                  }
                  // Estimate ~500 input + ~200 output tokens per request
                  const estCostPer1K = ((500 * pricing.input + 200 * pricing.output) / 1_000_000) * 1000
                  return (
                    <TableRow key={model}>
                      <TableCell className="font-medium">
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">{model}</code>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {modelDescriptions[model] || '-'}
                      </TableCell>
                      <TableCell className="text-right text-blue-600 font-medium">
                        ${pricing.input.toFixed(3)}
                      </TableCell>
                      <TableCell className="text-right text-green-600 font-medium">
                        ${pricing.output.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        <div className="flex flex-col items-end">
                          <span className="text-purple-600">{formatIDR(usdToIdr(estCostPer1K))}</span>
                          <span className="text-xs text-muted-foreground">${estCostPer1K.toFixed(4)}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground mt-4">
              * Estimasi biaya berdasarkan ~500 input tokens dan ~200 output tokens per request (tipikal untuk chatbot).
            </p>
          </CardContent>
        </Card>
      )}

      {/* Intent Success Rate Table */}
      {intents?.intents && Object.keys(intents.intents).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5" />
              Intent Success Rate
            </CardTitle>
            <CardDescription>
              Tingkat keberhasilan per jenis intent
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Intent</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Success</TableHead>
                  <TableHead className="text-right">Failure</TableHead>
                  <TableHead className="text-right">Success Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(intents.intents).map(([intent, data]) => {
                  const successRate = data.total > 0 
                    ? ((data.success / data.total) * 100).toFixed(1) 
                    : '0'
                  return (
                    <TableRow key={intent}>
                      <TableCell className="font-medium">{formatIntent(intent)}</TableCell>
                      <TableCell className="text-right">{formatNumber(data.total)}</TableCell>
                      <TableCell className="text-right text-green-600">{formatNumber(data.success)}</TableCell>
                      <TableCell className="text-right text-red-600">{formatNumber(data.failure)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={parseFloat(successRate) >= 90 ? "default" : parseFloat(successRate) >= 70 ? "secondary" : "destructive"}>
                          {successRate}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Model Performance Stats (merged from AI Usage Log) */}
      {modelUsage?.models && modelUsage.models.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5" />
              Statistik Performa Model AI
            </CardTitle>
            <CardDescription>
              Performa dan success rate untuk setiap model AI yang digunakan
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-center">Success Rate</TableHead>
                  <TableHead className="text-right">Total Calls</TableHead>
                  <TableHead className="text-right">Success</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Avg Response</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead className="text-center">Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modelUsage.models.map((model) => {
                  const successRate = parseInt(model.successRate)
                  return (
                    <TableRow key={model.model}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Cpu className="h-4 w-4 text-muted-foreground" />
                          <span className="font-mono text-sm">{model.model}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          <Badge className={getSuccessRateBadge(model.successRate)}>
                            {model.successRate}
                          </Badge>
                          <Progress 
                            value={successRate} 
                            className="h-1.5 w-16"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {model.totalCalls.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-green-600 dark:text-green-400 font-mono flex items-center justify-end gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          {model.successCalls.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-red-600 dark:text-red-400 font-mono flex items-center justify-end gap-1">
                          <XCircle className="h-3 w-3" />
                          {model.failedCalls.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {model.avgResponseTimeMs.toLocaleString()} ms
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {formatRelativeTime(model.lastUsed)}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => fetchModelDetail(model.model)}
                            >
                              <Info className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                            <DialogHeader>
                              <DialogTitle className="flex items-center gap-2">
                                <Cpu className="h-5 w-5" />
                                Detail Model: {model.model}
                              </DialogTitle>
                              <DialogDescription>
                                Statistik lengkap dan riwayat error untuk model ini
                              </DialogDescription>
                            </DialogHeader>
                            
                            {loadingDetail ? (
                              <div className="space-y-4">
                                <Skeleton className="h-24 w-full" />
                                <Skeleton className="h-48 w-full" />
                              </div>
                            ) : selectedModel ? (
                              <div className="space-y-6 mt-4">
                                {/* Model Stats Summary */}
                                <div className="grid grid-cols-2 gap-4">
                                  <div className="space-y-1">
                                    <p className="text-sm text-muted-foreground">Success Rate</p>
                                    <p className={`text-2xl font-bold ${getSuccessRateColor(selectedModel.successRate.toString() + '%')}`}>
                                      {selectedModel.successRate}%
                                    </p>
                                    <Progress value={selectedModel.successRate} className="h-2" />
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-sm text-muted-foreground">Avg Response Time</p>
                                    <p className="text-2xl font-bold">
                                      {selectedModel.avgResponseTimeMs.toLocaleString()} ms
                                    </p>
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-sm text-muted-foreground">Total Calls</p>
                                    <p className="text-xl font-semibold">{selectedModel.totalCalls.toLocaleString()}</p>
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-sm text-muted-foreground">Last Used</p>
                                    <p className="text-sm">{formatDate(selectedModel.lastUsed)}</p>
                                  </div>
                                </div>

                                {/* Success/Failed Stats */}
                                <div className="flex gap-4">
                                  <div className="flex-1 p-4 bg-green-50 dark:bg-green-950/30 rounded-lg">
                                    <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                                      <CheckCircle2 className="h-5 w-5" />
                                      <span className="font-medium">Success</span>
                                    </div>
                                    <p className="text-2xl font-bold text-green-700 dark:text-green-400 mt-1">
                                      {selectedModel.successCalls.toLocaleString()}
                                    </p>
                                  </div>
                                  <div className="flex-1 p-4 bg-red-50 dark:bg-red-950/30 rounded-lg">
                                    <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                                      <XCircle className="h-5 w-5" />
                                      <span className="font-medium">Failed</span>
                                    </div>
                                    <p className="text-2xl font-bold text-red-700 dark:text-red-400 mt-1">
                                      {selectedModel.failedCalls.toLocaleString()}
                                    </p>
                                  </div>
                                </div>

                                {/* Last Error */}
                                {selectedModel.lastError && (
                                  <div className="p-4 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-900">
                                    <p className="text-sm font-medium text-red-700 dark:text-red-400 mb-1">Last Error</p>
                                    <p className="text-sm text-red-600 dark:text-red-300 font-mono break-all">
                                      {selectedModel.lastError}
                                    </p>
                                  </div>
                                )}

                                {/* Error History */}
                                {selectedModel.errorHistory && selectedModel.errorHistory.length > 0 && (
                                  <div>
                                    <h4 className="font-semibold mb-3 flex items-center gap-2">
                                      <AlertCircle className="h-4 w-4 text-red-500" />
                                      Riwayat Error (10 Terakhir)
                                    </h4>
                                    <div className="space-y-2 max-h-60 overflow-y-auto">
                                      {selectedModel.errorHistory.map((err, idx) => (
                                        <div 
                                          key={idx} 
                                          className="p-3 bg-muted rounded-lg text-sm"
                                        >
                                          <p className="text-xs text-muted-foreground mb-1">
                                            {formatDate(err.timestamp)}
                                          </p>
                                          <p className="font-mono text-xs break-all">{err.error}</p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-center py-8 text-muted-foreground">
                                <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                                <p>Gagal memuat detail model</p>
                              </div>
                            )}
                          </DialogContent>
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
