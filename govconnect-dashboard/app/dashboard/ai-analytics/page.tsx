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
  byModel: Record<string, { input: number; output: number; cost: number }>
  byDate: Array<{ date: string; tokens: number; cost: number }>
}

interface ConversationFlow {
  avgMessagesPerSession: number
  avgSessionDurationMs: number
  completionRate: number
  dropoffPoints: Array<{ intent: string; dropoffRate: number }>
  intentTransitions: Array<{ from: string; to: string; count: number }>
}

export default function AIAnalyticsPage() {
  const { user } = useAuth()
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [intents, setIntents] = useState<IntentDistribution | null>(null)
  const [tokens, setTokens] = useState<TokenUsage | null>(null)
  const [flow, setFlow] = useState<ConversationFlow | null>(null)
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

      const [summaryRes, intentsRes, tokensRes, flowRes] = await Promise.all([
        fetch('/api/statistics/ai-analytics', { headers }),
        fetch('/api/statistics/ai-analytics/intents', { headers }),
        fetch('/api/statistics/ai-analytics/tokens', { headers }),
        fetch('/api/statistics/ai-analytics/flow', { headers }),
      ])

      if (summaryRes.ok) setSummary(await summaryRes.json())
      if (intentsRes.ok) setIntents(await intentsRes.json())
      if (tokensRes.ok) setTokens(await tokensRes.json())
      if (flowRes.ok) setFlow(await flowRes.json())
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
    </div>
  )
}
