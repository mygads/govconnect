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

interface AnalyticsSummary {
  totalRequests: number
  overallAccuracy: number
  totalCostUSD: number
  avgProcessingTimeMs: number
  topIntents: Array<{ intent: string; count: number; successRate: number }>
  topPatterns: Array<{ pattern: string; count: number }>
  tokenUsageLast7Days: Array<{ date: string; tokens: number; cost: number }>
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

      const [summaryRes, intentsRes, tokensRes, flowRes, modelUsageRes] = await Promise.all([
        fetch('/api/statistics/ai-analytics', { headers }),
        fetch('/api/statistics/ai-analytics/intents', { headers }),
        fetch('/api/statistics/ai-analytics/tokens', { headers }),
        fetch('/api/statistics/ai-analytics/flow', { headers }),
        fetch('/api/statistics/ai-usage', { headers }),
      ])

      if (summaryRes.ok) setSummary(await summaryRes.json())
      if (intentsRes.ok) setIntents(await intentsRes.json())
      if (tokensRes.ok) setTokens(await tokensRes.json())
      if (flowRes.ok) setFlow(await flowRes.json())
      if (modelUsageRes.ok) setModelUsage(await modelUsageRes.json())
    } catch (err: any) {
      setError(err.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 4,
    }).format(value)
  }

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('id-ID').format(value)
  }

  const formatIntent = (intent: string) => {
    const map: Record<string, string> = {
      'CREATE_COMPLAINT': 'Buat Laporan',
      'CREATE_TICKET': 'Buat Tiket',
      'CHECK_STATUS': 'Cek Status',
      'CANCEL_COMPLAINT': 'Batalkan',
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

  // Cost chart data
  const costChartData = {
    labels: tokens?.byDate?.map(d => {
      const date = new Date(d.date)
      return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
    }) || [],
    datasets: [
      {
        label: 'Cost (USD)',
        data: tokens?.byDate?.map(d => d.cost) || [],
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

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Requests</p>
                <p className="text-3xl font-bold">{formatNumber(summary?.totalRequests || 0)}</p>
              </div>
              <MessageSquare className="h-10 w-10 text-blue-500 opacity-80" />
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
                <p className="text-sm font-medium text-muted-foreground">Total Cost</p>
                <p className="text-3xl font-bold">{formatCurrency(summary?.totalCostUSD || 0)}</p>
              </div>
              <Coins className="h-10 w-10 text-yellow-500 opacity-80" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Avg Response Time</p>
                <p className="text-3xl font-bold">{Math.round(summary?.avgProcessingTimeMs || 0)}ms</p>
              </div>
              <Clock className="h-10 w-10 text-purple-500 opacity-80" />
            </div>
          </CardContent>
        </Card>
      </div>

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
              Estimasi Biaya (7 Hari Terakhir)
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
              Ringkasan Penggunaan
            </CardTitle>
            <CardDescription>
              Summary penggunaan token dan biaya per periode
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-2">
              {/* This Week Summary */}
              <div className="p-4 border rounded-lg">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  📅 Minggu Ini (7 Hari Terakhir)
                </h4>
                {(() => {
                  const last7Days = tokens.last30Days?.slice(-7) || []
                  const weeklyInputTokens = last7Days.reduce((sum, d) => sum + (d.input || 0), 0)
                  const weeklyOutputTokens = last7Days.reduce((sum, d) => sum + (d.output || 0), 0)
                  const weeklyCost = last7Days.reduce((sum, d) => sum + (d.cost || 0), 0)
                  const weeklyRequests = last7Days.length
                  
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
                      <div className="flex justify-between border-t pt-2 mt-2">
                        <span className="text-muted-foreground font-medium">Total Biaya</span>
                        <span className="font-bold text-green-600">{formatCurrency(weeklyCost)}</span>
                      </div>
                    </div>
                  )
                })()}
              </div>

              {/* This Month Summary */}
              <div className="p-4 border rounded-lg">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  📆 Bulan Ini (30 Hari Terakhir)
                </h4>
                {(() => {
                  const monthlyInputTokens = tokens.last30Days?.reduce((sum, d) => sum + (d.input || 0), 0) || 0
                  const monthlyOutputTokens = tokens.last30Days?.reduce((sum, d) => sum + (d.output || 0), 0) || 0
                  const monthlyCost = tokens.last30Days?.reduce((sum, d) => sum + (d.cost || 0), 0) || 0
                  
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
                      <div className="flex justify-between border-t pt-2 mt-2">
                        <span className="text-muted-foreground font-medium">Total Biaya</span>
                        <span className="font-bold text-green-600">{formatCurrency(monthlyCost)}</span>
                      </div>
                    </div>
                  )
                })()}
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
              Rincian penggunaan token dan biaya per model AI
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Jumlah Request</TableHead>
                  <TableHead className="text-right">Input Tokens</TableHead>
                  <TableHead className="text-right">Output Tokens</TableHead>
                  <TableHead className="text-right">Harga Input/1M</TableHead>
                  <TableHead className="text-right">Harga Output/1M</TableHead>
                  <TableHead className="text-right">Total Biaya</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(tokens.byModel).map(([model, data]) => {
                  // Get pricing from data.pricing or fallback to modelPricing
                  const modelPricing = tokens.modelPricing?.[model]
                  const inputPrice = data.pricing?.inputPer1M ?? modelPricing?.input ?? 0.10
                  const outputPrice = data.pricing?.outputPer1M ?? modelPricing?.output ?? 0.40
                  return (
                    <TableRow key={model}>
                      <TableCell className="font-medium">
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">{model}</code>
                      </TableCell>
                      <TableCell className="text-right">{formatNumber(data.calls || 0)}</TableCell>
                      <TableCell className="text-right">{formatNumber(data.input)}</TableCell>
                      <TableCell className="text-right">{formatNumber(data.output)}</TableCell>
                      <TableCell className="text-right text-blue-600">
                        ${inputPrice.toFixed(3)}
                      </TableCell>
                      <TableCell className="text-right text-green-600">
                        ${outputPrice.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(data.cost)}
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
                  <TableCell className="text-right">-</TableCell>
                  <TableCell className="text-right">-</TableCell>
                  <TableCell className="text-right text-green-600">
                    {formatCurrency(tokens.estimatedCostUSD)}
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
              Harga per 1 juta token berdasarkan dokumentasi Google AI (Desember 2025)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Deskripsi</TableHead>
                  <TableHead className="text-right">Input / 1M tokens</TableHead>
                  <TableHead className="text-right">Output / 1M tokens</TableHead>
                  <TableHead className="text-right">Est. Cost / 1K Requests</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(tokens.modelPricing).map(([model, pricing]) => {
                  const modelDescriptions: Record<string, string> = {
                    'gemini-2.5-flash': 'Hybrid reasoning, 1M context, thinking budget',
                    'gemini-2.5-flash-lite': 'Smallest, cost-efficient, high throughput',
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
                      <TableCell className="text-right text-muted-foreground font-mono">
                        ${estCostPer1K.toFixed(4)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground mt-4">
              * Est. Cost assumes ~500 input tokens and ~200 output tokens per request (typical for chatbot responses).
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
