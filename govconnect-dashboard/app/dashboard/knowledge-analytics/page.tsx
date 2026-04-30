"use client"

import { useEffect, useState, useCallback } from "react"
import { redirect } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Brain, RefreshCcw, TrendingUp, TrendingDown, AlertTriangle,
  CheckCircle, XCircle, HelpCircle, BarChart3, Target, MessageSquareWarning, Trash2, Loader2,
  Shield, Download, GitBranch
} from "lucide-react"
import { useAuth } from "@/components/auth/AuthContext"
import { useToast } from "@/hooks/use-toast"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

/** Format a date into a simple relative time string (no external deps). */
function formatRelativeTime(date: Date): string {
  const now = Date.now()
  const diffMs = now - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return "baru saja"
  if (diffMins < 60) return `${diffMins} menit lalu`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours} jam lalu`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays} hari lalu`
  const diffMonths = Math.floor(diffDays / 30)
  return `${diffMonths} bulan lalu`
}

type ConfirmAction = {
  title: string
  description: string
  actionLabel: string
  onConfirm: () => Promise<void> | void
}

interface OverviewStats {
  totalQueries: number
  knowledgeHits: number
  knowledgeMisses: number
  fallbackCount: number
  hitRate: string | number | null
  missRate: string | number | null
  source?: "runtime" | "persistent_gap_fallback" | "unavailable"
  isPartial?: boolean
  caveat?: string | null
}

interface IntentItem {
  intent: string
  count: number
  avgConfidence: number
}

interface KnowledgeGapItem {
  id: string
  query: string
  intent: string
  confidence: string
  hitCount: number
  firstSeen: string
  lastSeen: string
  channel: string
}

interface KnowledgeGapsData {
  topGaps: KnowledgeGapItem[]
  statusCounts: Record<string, number>
  totalOpen: number
}

interface KnowledgeConflictItem {
  id: string
  source1: string
  source2: string
  summary: string
  similarity: number
  hitCount: number
  status: string
  autoResolved: boolean
  firstSeen: string
  lastSeen: string
  query: string | null
}

interface KnowledgeConflictsData {
  topConflicts: KnowledgeConflictItem[]
  statusCounts: Record<string, number>
  totalOpen: number
  totalAutoResolved: number
}

interface RetrievalModeItem {
  mode: string
  count: number
  hitRate: number
  avgLatencyMs: number
  avgResultCount: number
}

interface RetrievalConfidenceItem {
  confidence: string
  count: number
  percentage: number
}

interface RetrievalTraceItem {
  candidateDebug?: RetrievalCandidateDebug[]
  query: string
  retrievalMode: "rag" | "keyword" | "document_rag"
  confidence: "none" | "low" | "medium" | "high"
  hasKnowledge: boolean
  resultCount: number
  searchTimeMs: number
  topScore: number | null
  avgTopScore: number | null
  sourceTitles: string[]
  channel: string
  villageId?: string
  timestamp: string
}

interface RetrievalCandidateDebug {
  id: string
  title: string
  sourceType: "knowledge" | "document"
  finalScore: number
  vectorScore?: number | null
  keywordScore?: number | null
  vectorRank?: number | null
  keywordRank?: number | null
  rrfScore?: number | null
  rerankScore?: number | null
  matchType?: "vector" | "keyword" | "both" | null
  selected?: boolean
}

interface RetrievalObservabilityData {
  summary: {
    totalTraces: number
    hitRate: number
    avgLatencyMs: number
    p95LatencyMs: number
    avgResultCount: number
    avgTopScore: number | null
  }
  byMode: RetrievalModeItem[]
  byConfidence: RetrievalConfidenceItem[]
  recentTraces: RetrievalTraceItem[]
}

interface MemoryTraceCandidate {
  id: string
  memoryType: string
  content: string
  relevanceScore: number
  lexicalScore: number
  semanticScore: number
  recencyScore: number
  importanceScore: number
  typeBoost: number
  createdAt: string
}

interface MemoryTraceItem {
  traceId?: string
  waUserId: string
  source: string
  query: string
  channel?: string
  villageId?: string
  resultCount: number
  topScore: number | null
  avgScore: number | null
  summaryText?: string
  createdAt: string
  candidates: MemoryTraceCandidate[]
}

interface MemoryObservabilityData {
  summary: {
    totalTraces: number
    avgResultCount: number
    avgTopScore: number | null
  }
  bySource: Array<{
    source: string
    count: number
    avgResultCount: number
  }>
  byMemoryType: Array<{
    memoryType: string
    count: number
  }>
  recentTraces: MemoryTraceItem[]
}

interface GuardrailEventItem {
  traceId?: string
  waUserId?: string
  guardStage: string
  guardType: string
  action: string
  reason?: string
  messagePreview?: string
  createdAt: string
}

interface GuardrailObservabilityData {
  summary: {
    totalEvents: number
    blockedCount: number
    handledCount: number
  }
  byType: Array<{
    guardType: string
    count: number
  }>
  byStage: Array<{
    guardStage: string
    count: number
  }>
  recentEvents: GuardrailEventItem[]
}

interface ToolPolicyDefinition {
  policyKey: string
  source: string
  matchTerms: string[]
  allowedTools: string[]
  confidence: number
  evaluationCount: number
  successCount: number
  lastSeenAt: string
}

interface ToolPolicyEventItem {
  traceId?: string
  query: string
  policyKey?: string
  policySource?: string
  heuristicTools: string[]
  learnedTools: string[]
  allowedTools: string[]
  actualTools: string[]
  success: boolean
  createdAt: string
}

interface ToolPolicyObservabilityData {
  summary: {
    totalPolicies: number
    totalEvents: number
    policyHitRate: number
  }
  policies: ToolPolicyDefinition[]
  recentEvents: ToolPolicyEventItem[]
}

interface EvaluationItem {
  id: string
  query: string
  expectedIntent?: string | null
  expectedTools?: unknown
  actualTools?: unknown
  predictedIntent: string
  replyText: string
  intentMatch?: boolean | null
  toolMatch?: boolean | null
  toolScore?: number | null
  keywordMatch?: boolean | null
  keywordScore?: number | null
  score: number
  traceScore?: number | null
  traceGrade?: string | null
  latencyMs: number
  scenario?: string | null
  traceId?: string | null
}

interface EvaluationRunData {
  runId: string
  total: number
  overallAccuracy: number
  intentAccuracy: number
  toolAccuracy: number
  keywordAccuracy: number
  regressionDetected: boolean
  releaseGatePass: boolean
  thresholds: Record<string, unknown>
  status: Record<string, unknown>
  startedAt: string
  completedAt: string
  items: EvaluationItem[]
}

interface AnalyticsData {
  overview: OverviewStats
  intents: IntentItem[]
  flow: Record<string, any>
  knowledgeGaps?: KnowledgeGapsData
  knowledgeConflicts?: KnowledgeConflictsData
  retrievalObservability?: RetrievalObservabilityData | null
  memoryObservability?: MemoryObservabilityData | null
  guardrailObservability?: GuardrailObservabilityData | null
  toolPolicyObservability?: ToolPolicyObservabilityData | null
  evaluation?: EvaluationRunData | null
  metricSources?: Record<string, string>
  dataFreshness?: {
    generatedAt: string
    runtimeStatsAvailable: boolean
    persistentGapsAvailable: boolean
    persistentConflictsAvailable: boolean
    latestEvalAvailable: boolean
  }
  rawAnalytics: any
}

function formatRetrievalMode(mode: string): string {
  switch (mode) {
    case "rag":
      return "Hybrid RAG"
    case "keyword":
      return "Keyword"
    case "document_rag":
      return "Document RAG"
    default:
      return mode
  }
}

function retrievalModeBadgeClass(mode: string): string {
  switch (mode) {
    case "rag":
      return "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
    case "keyword":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
    case "document_rag":
      return "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300"
    default:
      return "bg-muted text-muted-foreground"
  }
}

function confidenceBadgeClass(confidence: string): string {
  switch (confidence) {
    case "high":
      return "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300"
    case "medium":
      return "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
    case "low":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300"
    case "none":
      return "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"
    default:
      return "bg-muted text-muted-foreground"
  }
}

export default function KnowledgeAnalyticsPage() {
  const { user } = useAuth()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [selectedTraceIndex, setSelectedTraceIndex] = useState(0)
  const [selectedMemoryTraceIndex, setSelectedMemoryTraceIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingGapId, setDeletingGapId] = useState<string | null>(null)
  const [deletingAllGaps, setDeletingAllGaps] = useState(false)
  const [deletingAllConflicts, setDeletingAllConflicts] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmAction | null>(null)
  const { toast } = useToast()

  // Only village admin can access this page
  useEffect(() => {
    if (user && user.role === "superadmin") redirect("/dashboard")
  }, [user])

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem("token")
    return token ? { Authorization: `Bearer ${token}` } : {}
  }, [])

  const fetchDashboardJson = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers)
    const authHeaders = getAuthHeaders()
    Object.entries(authHeaders).forEach(([key, value]) => headers.set(key, value))

    const res = await fetch(url, {
      ...init,
      headers,
    })

    if (!res.ok) {
      throw new Error("Request dashboard gagal")
    }

    return res.json() as Promise<T>
  }, [getAuthHeaders])

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const analytics = await fetchDashboardJson<AnalyticsData>("/api/statistics/knowledge-analytics")
      setData(analytics)
    } catch (err: any) {
      setError(err.message === "Request dashboard gagal" ? "Gagal memuat data analytics" : err.message)
    } finally {
      setLoading(false)
    }
  }, [fetchDashboardJson])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => {
    setSelectedTraceIndex(0)
  }, [data?.retrievalObservability?.recentTraces?.length])
  useEffect(() => {
    setSelectedMemoryTraceIndex(0)
  }, [data?.memoryObservability?.recentTraces?.length])

  const handleExport = (format: "json" | "ndjson") => {
    window.open(`/api/statistics/knowledge-analytics/export?kind=all&format=${format}`, "_blank")
  }

  const requestDeleteGap = (id: string) => {
    setPendingConfirm({
      title: "Hapus pertanyaan belum terjawab?",
      description: "Data pertanyaan ini akan dihapus dari analytics.",
      actionLabel: "Hapus",
      onConfirm: () => handleDeleteGap(id),
    })
  }

  const handleDeleteGap = async (id: string) => {
    try {
      setDeletingGapId(id)
      await fetchDashboardJson(`/api/knowledge-gaps/${id}`, {
        method: 'DELETE',
      })
      toast({ title: "Berhasil", description: "Pertanyaan berhasil dihapus" })
      fetchData()
    } catch (err: any) {
      toast({
        title: "Gagal",
        description: err.message === "Request dashboard gagal" ? "Gagal menghapus" : err.message,
        variant: "destructive",
      })
    } finally {
      setDeletingGapId(null)
    }
  }

  const requestDeleteAllGaps = () => {
    setPendingConfirm({
      title: "Hapus semua pertanyaan belum terjawab?",
      description: "Data analytics pertanyaan belum terjawab akan di-reset.",
      actionLabel: "Hapus Semua",
      onConfirm: handleDeleteAllGaps,
    })
  }

  const handleDeleteAllGaps = async () => {
    try {
      setDeletingAllGaps(true)
      const response = await fetchDashboardJson<{ deleted: number }>('/api/knowledge-gaps/batch', {
        method: 'DELETE',
      })
      toast({ title: "Berhasil", description: `${response.deleted} pertanyaan berhasil dihapus` })
      fetchData()
    } catch (err: any) {
      toast({
        title: "Gagal",
        description: err.message === "Request dashboard gagal" ? "Gagal menghapus" : err.message,
        variant: "destructive",
      })
    } finally {
      setDeletingAllGaps(false)
    }
  }

  const requestDeleteAllConflicts = () => {
    setPendingConfirm({
      title: "Hapus semua data konflik?",
      description: "Data analytics konflik knowledge akan di-reset.",
      actionLabel: "Hapus Semua",
      onConfirm: handleDeleteAllConflicts,
    })
  }

  const handleDeleteAllConflicts = async () => {
    try {
      setDeletingAllConflicts(true)
      const response = await fetchDashboardJson<{ deleted: number }>('/api/knowledge-conflicts/batch', {
        method: 'DELETE',
      })
      toast({ title: "Berhasil", description: `${response.deleted} konflik berhasil dihapus` })
      fetchData()
    } catch (err: any) {
      toast({
        title: "Gagal",
        description: err.message === "Request dashboard gagal" ? "Gagal menghapus" : err.message,
        variant: "destructive",
      })
    } finally {
      setDeletingAllConflicts(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Analitik Knowledge Base</h1>
          <p className="text-muted-foreground mt-2">Pantau performa AI dan cakupan knowledge</p>
        </div>
        <Card className="border-destructive">
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto text-destructive mb-4" />
            <p className="text-destructive font-medium">{error}</p>
            <p className="text-sm text-muted-foreground mt-2">
              Pastikan AI Service sedang berjalan dan terhubung.
            </p>
            <Button onClick={fetchData} variant="outline" className="mt-4">
              <RefreshCcw className="h-4 w-4 mr-2" /> Coba Lagi
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const overview = data?.overview || {
    totalQueries: 0, knowledgeHits: 0, knowledgeMisses: 0,
    fallbackCount: 0, hitRate: null, missRate: null, source: "unavailable" as const, isPartial: true,
  }
  const intents = data?.intents || []
  const knowledgeGaps = data?.knowledgeGaps
  const topGaps = knowledgeGaps?.topGaps || []
  const gapStatusCounts = knowledgeGaps?.statusCounts || { open: 0, resolved: 0, ignored: 0 }
  const knowledgeConflicts = data?.knowledgeConflicts
  const topConflicts = knowledgeConflicts?.topConflicts || []
  const conflictStatusCounts = knowledgeConflicts?.statusCounts || { open: 0, resolved: 0, auto_resolved: 0, ignored: 0 }
  const retrievalObservability = data?.retrievalObservability
  const retrievalSummary = retrievalObservability?.summary
  const retrievalModes = retrievalObservability?.byMode || []
  const retrievalConfidence = retrievalObservability?.byConfidence || []
  const retrievalTraces = retrievalObservability?.recentTraces || []
  const selectedTrace = retrievalTraces[selectedTraceIndex] || retrievalTraces[0] || null
  const memoryObservability = data?.memoryObservability
  const memorySummary = memoryObservability?.summary
  const memorySources = memoryObservability?.bySource || []
  const memoryTypes = memoryObservability?.byMemoryType || []
  const memoryTraces = memoryObservability?.recentTraces || []
  const selectedMemoryTrace = memoryTraces[selectedMemoryTraceIndex] || memoryTraces[0] || null
  const guardrailObservability = data?.guardrailObservability
  const toolPolicyObservability = data?.toolPolicyObservability
  const evaluation = data?.evaluation
  const failedEvalItems = (evaluation?.items || []).filter((item) => item.traceGrade !== "A" || item.score < 1).slice(0, 10)
  const hitRateNum = typeof overview.hitRate === "string" ? parseFloat(overview.hitRate) : overview.hitRate
  const hasRuntimeOverview = overview.source === "runtime" && typeof hitRateNum === "number"

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Analitik Knowledge Base</h1>
          <p className="text-muted-foreground mt-2">
            Pantau knowledge gaps, konflik data, observability RAG, guardrail, tool policy, dan evaluasi kualitas. Halaman ini bukan training otomatis.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => handleExport("json")} variant="outline">
            <Download className="h-4 w-4 mr-2" /> Export JSON
          </Button>
          <Button onClick={() => handleExport("ndjson")} variant="outline">
            <Download className="h-4 w-4 mr-2" /> Export NDJSON
          </Button>
          <Button onClick={fetchData} variant="outline">
            <RefreshCcw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>
      </div>

      <AlertDialog open={!!pendingConfirm} onOpenChange={(open) => !open && setPendingConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingConfirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{pendingConfirm?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                const action = pendingConfirm
                setPendingConfirm(null)
                await action?.onConfirm()
              }}
            >
              {pendingConfirm?.actionLabel || "Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {overview.isPartial && (
        <Card className="border-blue-300 bg-blue-50 dark:bg-blue-950/20">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <HelpCircle className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-blue-800 dark:text-blue-300">Metrik ringkasan bersifat parsial</p>
                <p className="text-sm text-blue-700 dark:text-blue-400 mt-0.5">
                  {overview.caveat || "Runtime analytics belum tersedia. Gap, konflik, retrieval trace, guardrail, dan evaluation tetap dibaca dari sumbernya masing-masing jika tersedia."}
                </p>
                <p className="text-xs text-blue-700/80 dark:text-blue-400/80 mt-1">
                  Halaman ini adalah analytics, observability, dan evaluasi kualitas; bukan training otomatis. Training dilakukan lewat perbaikan knowledge, embedding, dan golden-set evaluation.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Conflict Alert Banner */}
      {conflictStatusCounts.open > 0 && (
        <Card className="border-orange-400 bg-orange-50 dark:bg-orange-950/20">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-6 w-6 text-orange-600 shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-orange-800 dark:text-orange-300">
                  Ada {conflictStatusCounts.open} data berkonflik di knowledge base
                </p>
                <p className="text-sm text-orange-700 dark:text-orange-400 mt-0.5">
                  AI mendeteksi informasi yang saling bertentangan dari sumber berbeda. Periksa dan selesaikan di tabel konflik di bawah.
                </p>
              </div>
              <Badge className="bg-orange-200 text-orange-800 shrink-0">
                {conflictStatusCounts.open} Konflik
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Overview Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> {overview.source === "runtime" ? "Interaksi AI Tercatat" : "Gap Tersimpan"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{overview.totalQueries}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {overview.source === "runtime" ? "Dari runtime AI service" : "Fallback dari gap database"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" /> Knowledge Hit Tercatat
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{overview.knowledgeHits}</div>
            <p className="text-xs text-muted-foreground mt-1">Berhasil dijawab dari knowledge</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-600" /> Knowledge Miss Tercatat
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">{overview.knowledgeMisses}</div>
            <p className="text-xs text-muted-foreground mt-1">Tidak ditemukan di knowledge</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-yellow-600" /> Fallback
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-yellow-600">{overview.fallbackCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Dijawab dengan fallback</p>
          </CardContent>
        </Card>
      </div>

      {/* Hit Rate Bar */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" /> Coverage Rate
          </CardTitle>
          <CardDescription>
            Persentase interaksi runtime yang tercatat berhasil dijawab dari knowledge base. Jika runtime stats belum ada, rate tidak dihitung.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Knowledge Hit Rate</span>
              <span className="text-2xl font-bold">
                {hasRuntimeOverview && hitRateNum > 0 ? (
                  <span className={hitRateNum >= 70 ? "text-green-600" : hitRateNum >= 40 ? "text-yellow-600" : "text-red-600"}>
                    {overview.hitRate}%
                  </span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </span>
            </div>
            <Progress value={hasRuntimeOverview ? hitRateNum || 0 : 0} className="h-3" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0%</span>
              <span className="flex items-center gap-1">
                {hasRuntimeOverview && hitRateNum >= 70 ? (
                  <><TrendingUp className="h-3 w-3 text-green-600" /> Baik</>
                ) : hasRuntimeOverview && hitRateNum >= 40 ? (
                  <><AlertTriangle className="h-3 w-3 text-yellow-600" /> Perlu ditingkatkan</>
                ) : hasRuntimeOverview && hitRateNum > 0 ? (
                  <><TrendingDown className="h-3 w-3 text-red-600" /> Perlu banyak perbaikan</>
                ) : (
                  <>Belum ada data</>
                )}
              </span>
              <span>100%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" /> Observability Retrieval
          </CardTitle>
          <CardDescription>
            Trace pencarian terbaru dari AI service: mode retrieval, confidence, hasil, latency, dan sumber yang terpakai.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="border-dashed">
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Avg Latency</div>
                <div className="text-2xl font-bold mt-1">{retrievalSummary?.avgLatencyMs ?? 0} ms</div>
                <div className="text-xs text-muted-foreground mt-1">P95: {retrievalSummary?.p95LatencyMs ?? 0} ms</div>
              </CardContent>
            </Card>
            <Card className="border-dashed">
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Retrieval Hit Rate</div>
                <div className="text-2xl font-bold mt-1">{retrievalSummary?.hitRate ?? 0}%</div>
                <div className="text-xs text-muted-foreground mt-1">{retrievalSummary?.totalTraces ?? 0} trace tercatat</div>
              </CardContent>
            </Card>
            <Card className="border-dashed">
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Avg Result Count</div>
                <div className="text-2xl font-bold mt-1">{retrievalSummary?.avgResultCount ?? 0}</div>
                <div className="text-xs text-muted-foreground mt-1">Rata-rata kandidat per query</div>
              </CardContent>
            </Card>
            <Card className="border-dashed">
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Avg Top Score</div>
                <div className="text-2xl font-bold mt-1">
                  {typeof retrievalSummary?.avgTopScore === "number" ? retrievalSummary.avgTopScore.toFixed(3) : "-"}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Khusus trace yang punya skor similarity</div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Mode Retrieval</CardTitle>
                <CardDescription>Distribusi dan performa per mode pencarian.</CardDescription>
              </CardHeader>
              <CardContent>
                {retrievalModes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Belum ada trace retrieval.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Mode</TableHead>
                        <TableHead>Count</TableHead>
                        <TableHead>Hit Rate</TableHead>
                        <TableHead>Avg Latency</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {retrievalModes.map((item) => (
                        <TableRow key={item.mode}>
                          <TableCell>
                            <Badge className={retrievalModeBadgeClass(item.mode)}>
                              {formatRetrievalMode(item.mode)}
                            </Badge>
                          </TableCell>
                          <TableCell>{item.count}</TableCell>
                          <TableCell>{item.hitRate}%</TableCell>
                          <TableCell>{item.avgLatencyMs} ms</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Confidence Distribution</CardTitle>
                <CardDescription>Distribusi confidence hasil retrieval terbaru.</CardDescription>
              </CardHeader>
              <CardContent>
                {retrievalConfidence.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Belum ada trace retrieval.</p>
                ) : (
                  <div className="space-y-3">
                    {retrievalConfidence.map((item) => (
                      <div key={item.confidence} className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <Badge className={confidenceBadgeClass(item.confidence)}>
                            {item.confidence.toUpperCase()}
                          </Badge>
                          <div className="text-sm text-muted-foreground">
                            {item.count} trace • {item.percentage}%
                          </div>
                        </div>
                        <Progress value={item.percentage} className="h-2" />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Retrieval Traces</CardTitle>
              <CardDescription>
                Sampel query terbaru untuk debugging kualitas retrieval dan source coverage.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {retrievalTraces.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p>Belum ada trace retrieval yang tercatat.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Waktu</TableHead>
                      <TableHead>Query</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Confidence</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Latency</TableHead>
                      <TableHead>Top Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {retrievalTraces.slice(0, 15).map((trace, idx) => (
                      <TableRow
                        key={`${trace.timestamp}-${idx}`}
                        className="cursor-pointer"
                        onClick={() => setSelectedTraceIndex(idx)}
                      >
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatRelativeTime(new Date(trace.timestamp))}
                        </TableCell>
                        <TableCell className="max-w-[320px]">
                          <div className="space-y-1">
                            <div className="font-medium line-clamp-2">{trace.query}</div>
                            {trace.sourceTitles.length > 0 && (
                              <div className="text-xs text-muted-foreground line-clamp-1">
                                Sumber: {trace.sourceTitles.join(", ")}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={retrievalModeBadgeClass(trace.retrievalMode)}>
                            {formatRetrievalMode(trace.retrievalMode)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={confidenceBadgeClass(trace.confidence)}>
                            {trace.confidence.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell>{trace.resultCount}</TableCell>
                        <TableCell>{trace.searchTimeMs} ms</TableCell>
                        <TableCell>
                          {typeof trace.topScore === "number" ? trace.topScore.toFixed(3) : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Candidate Debug</CardTitle>
              <CardDescription>
                Rincian kandidat retrieval untuk trace yang dipilih. Ini menampilkan rank vector, rank keyword, RRF, rerank, dan kandidat yang lolos.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedTrace || !selectedTrace.candidateDebug || selectedTrace.candidateDebug.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Pilih trace retrieval yang memiliki kandidat untuk melihat debug ranking.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground mb-1">Trace terpilih</div>
                    <div className="font-medium">{selectedTrace.query}</div>
                    <div className="text-xs text-muted-foreground mt-2">
                      {formatRetrievalMode(selectedTrace.retrievalMode)} • {selectedTrace.searchTimeMs} ms • {selectedTrace.resultCount} hasil
                    </div>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kandidat</TableHead>
                        <TableHead>Sumber</TableHead>
                        <TableHead>Final</TableHead>
                        <TableHead>Vector</TableHead>
                        <TableHead>Keyword</TableHead>
                        <TableHead>RRF</TableHead>
                        <TableHead>Rerank</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedTrace.candidateDebug.map((candidate) => (
                        <TableRow key={candidate.id}>
                          <TableCell className="max-w-[280px]">
                            <div className="space-y-1">
                              <div className="font-medium line-clamp-2">{candidate.title}</div>
                              {candidate.matchType && (
                                <div className="text-xs text-muted-foreground">
                                  Match: {candidate.matchType}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {candidate.sourceType === "knowledge" ? "Knowledge" : "Document"}
                            </Badge>
                          </TableCell>
                          <TableCell>{candidate.finalScore.toFixed(3)}</TableCell>
                          <TableCell>
                            <div className="text-xs">
                              {typeof candidate.vectorScore === "number" ? candidate.vectorScore.toFixed(3) : "-"}
                              {typeof candidate.vectorRank === "number" && (
                                <div className="text-muted-foreground">rank #{candidate.vectorRank}</div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-xs">
                              {typeof candidate.keywordScore === "number" ? candidate.keywordScore.toFixed(3) : "-"}
                              {typeof candidate.keywordRank === "number" && (
                                <div className="text-muted-foreground">rank #{candidate.keywordRank}</div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{typeof candidate.rrfScore === "number" ? candidate.rrfScore.toFixed(4) : "-"}</TableCell>
                          <TableCell>{typeof candidate.rerankScore === "number" ? candidate.rerankScore.toFixed(3) : "-"}</TableCell>
                          <TableCell>
                            {candidate.selected ? (
                              <Badge className="bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300">Dipakai</Badge>
                            ) : (
                              <Badge variant="secondary">Drop</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" /> Observability Memory
          </CardTitle>
          <CardDescription>
            Menampilkan trace memory hybrid yang dipakai untuk konteks personal user, lengkap dengan skor lexical, semantic, recency, dan importance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="border-dashed">
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Total Memory Traces</div>
                <div className="text-2xl font-bold mt-1">{memorySummary?.totalTraces ?? 0}</div>
              </CardContent>
            </Card>
            <Card className="border-dashed">
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Avg Result Count</div>
                <div className="text-2xl font-bold mt-1">{memorySummary?.avgResultCount ?? 0}</div>
              </CardContent>
            </Card>
            <Card className="border-dashed">
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Avg Top Score</div>
                <div className="text-2xl font-bold mt-1">
                  {typeof memorySummary?.avgTopScore === "number" ? memorySummary.avgTopScore.toFixed(3) : "-"}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Source Memory</CardTitle>
              </CardHeader>
              <CardContent>
                {memorySources.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Belum ada trace memory.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source</TableHead>
                        <TableHead>Count</TableHead>
                        <TableHead>Avg Result</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {memorySources.map((source) => (
                        <TableRow key={source.source}>
                          <TableCell>{source.source}</TableCell>
                          <TableCell>{source.count}</TableCell>
                          <TableCell>{source.avgResultCount}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top Memory Types</CardTitle>
              </CardHeader>
              <CardContent>
                {memoryTypes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Belum ada tipe memory dominan.</p>
                ) : (
                  <div className="space-y-3">
                    {memoryTypes.map((item) => (
                      <div key={item.memoryType} className="flex items-center justify-between rounded-lg border p-3">
                        <div className="font-medium">{item.memoryType}</div>
                        <Badge variant="outline">{item.count}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent Memory Traces</CardTitle>
              </CardHeader>
              <CardContent>
                {memoryTraces.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Belum ada trace memory.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Waktu</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Query</TableHead>
                        <TableHead>Result</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {memoryTraces.slice(0, 12).map((trace, idx) => (
                        <TableRow
                          key={`${trace.createdAt}-${idx}`}
                          className="cursor-pointer"
                          onClick={() => setSelectedMemoryTraceIndex(idx)}
                        >
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatRelativeTime(new Date(trace.createdAt))}
                          </TableCell>
                          <TableCell>{trace.source}</TableCell>
                          <TableCell className="max-w-[260px]">
                            <div className="line-clamp-2 font-medium">{trace.query}</div>
                          </TableCell>
                          <TableCell>{trace.resultCount}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Memory Candidate Debug</CardTitle>
                <CardDescription>
                  Trace yang dipilih menunjukkan kenapa suatu memory terambil: lexical, semantic, recency, importance, dan boost operasional.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!selectedMemoryTrace || selectedMemoryTrace.candidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Pilih trace memory untuk melihat kandidat yang terambil.</p>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <div className="font-medium">{selectedMemoryTrace.query}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {selectedMemoryTrace.source} • {selectedMemoryTrace.resultCount} memory • {typeof selectedMemoryTrace.topScore === "number" ? selectedMemoryTrace.topScore.toFixed(3) : "-"}
                      </div>
                      {selectedMemoryTrace.summaryText && (
                        <div className="text-xs text-muted-foreground mt-2 line-clamp-3">
                          {selectedMemoryTrace.summaryText}
                        </div>
                      )}
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Memory</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Final</TableHead>
                          <TableHead>Lexical</TableHead>
                          <TableHead>Semantic</TableHead>
                          <TableHead>Recency</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedMemoryTrace.candidates.map((candidate) => (
                          <TableRow key={candidate.id}>
                            <TableCell className="max-w-[260px]">
                              <div className="line-clamp-2 font-medium">{candidate.content}</div>
                              <div className="text-xs text-muted-foreground mt-1">{formatRelativeTime(new Date(candidate.createdAt))}</div>
                            </TableCell>
                            <TableCell><Badge variant="outline">{candidate.memoryType}</Badge></TableCell>
                            <TableCell>{candidate.relevanceScore.toFixed(3)}</TableCell>
                            <TableCell>{candidate.lexicalScore.toFixed(3)}</TableCell>
                            <TableCell>{candidate.semanticScore.toFixed(3)}</TableCell>
                            <TableCell>{candidate.recencyScore.toFixed(3)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" /> Guardrail Observability
            </CardTitle>
            <CardDescription>
              Transparansi outer guard yang tetap deterministik: spam, takeover, supersede, protocol guard, dan pending-state.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Card className="border-dashed">
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Total Events</div>
                  <div className="text-2xl font-bold mt-1">{guardrailObservability?.summary.totalEvents ?? 0}</div>
                </CardContent>
              </Card>
              <Card className="border-dashed">
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Blocked</div>
                  <div className="text-2xl font-bold mt-1">{guardrailObservability?.summary.blockedCount ?? 0}</div>
                </CardContent>
              </Card>
              <Card className="border-dashed">
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Handled</div>
                  <div className="text-2xl font-bold mt-1">{guardrailObservability?.summary.handledCount ?? 0}</div>
                </CardContent>
              </Card>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Guard</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Aksi</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(guardrailObservability?.recentEvents || []).slice(0, 10).map((item, idx) => (
                  <TableRow key={`${item.createdAt}-${idx}`}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatRelativeTime(new Date(item.createdAt))}
                    </TableCell>
                    <TableCell>{item.guardType}</TableCell>
                    <TableCell>{item.guardStage}</TableCell>
                    <TableCell>
                      <Badge variant={item.action === "blocked" ? "destructive" : "outline"}>{item.action}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      <div className="line-clamp-2 text-sm">{item.reason || "-"}</div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5" /> Tool Policy Tuning
            </CardTitle>
            <CardDescription>
              Allowlisting sekarang tidak murni heuristic. Policy dari golden set/runtime ikut mempengaruhi subset tool per turn.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Card className="border-dashed">
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Policies</div>
                  <div className="text-2xl font-bold mt-1">{toolPolicyObservability?.summary.totalPolicies ?? 0}</div>
                </CardContent>
              </Card>
              <Card className="border-dashed">
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Events</div>
                  <div className="text-2xl font-bold mt-1">{toolPolicyObservability?.summary.totalEvents ?? 0}</div>
                </CardContent>
              </Card>
              <Card className="border-dashed">
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Policy Hit Rate</div>
                  <div className="text-2xl font-bold mt-1">{toolPolicyObservability?.summary.policyHitRate ?? 0}%</div>
                </CardContent>
              </Card>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Policy</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Allowed Tools</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(toolPolicyObservability?.policies || []).slice(0, 8).map((policy) => (
                  <TableRow key={policy.policyKey}>
                    <TableCell className="max-w-[220px]">
                      <div className="line-clamp-2 font-medium">{policy.policyKey}</div>
                      <div className="text-xs text-muted-foreground mt-1">{policy.matchTerms.join(", ")}</div>
                    </TableCell>
                    <TableCell>{policy.source}</TableCell>
                    <TableCell>{(policy.confidence * 100).toFixed(0)}%</TableCell>
                    <TableCell className="max-w-[260px]">
                      <div className="line-clamp-2 text-sm">{policy.allowedTools.join(", ")}</div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5" /> Eval & Release Gate
          </CardTitle>
          <CardDescription>
            Latest golden set run untuk regression detection, release gate, dan trace-grade observability.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!evaluation ? (
            <p className="text-sm text-muted-foreground">Belum ada data evaluasi golden set yang persisten.</p>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-5">
                <Card className="border-dashed">
                  <CardContent className="pt-6">
                    <div className="text-sm text-muted-foreground">Overall</div>
                    <div className="text-2xl font-bold mt-1">{(evaluation.overallAccuracy * 100).toFixed(1)}%</div>
                  </CardContent>
                </Card>
                <Card className="border-dashed">
                  <CardContent className="pt-6">
                    <div className="text-sm text-muted-foreground">Intent</div>
                    <div className="text-2xl font-bold mt-1">{(evaluation.intentAccuracy * 100).toFixed(1)}%</div>
                  </CardContent>
                </Card>
                <Card className="border-dashed">
                  <CardContent className="pt-6">
                    <div className="text-sm text-muted-foreground">Tool</div>
                    <div className="text-2xl font-bold mt-1">{(evaluation.toolAccuracy * 100).toFixed(1)}%</div>
                  </CardContent>
                </Card>
                <Card className="border-dashed">
                  <CardContent className="pt-6">
                    <div className="text-sm text-muted-foreground">Keyword</div>
                    <div className="text-2xl font-bold mt-1">{(evaluation.keywordAccuracy * 100).toFixed(1)}%</div>
                  </CardContent>
                </Card>
                <Card className="border-dashed">
                  <CardContent className="pt-6">
                    <div className="text-sm text-muted-foreground">Release Gate</div>
                    <div className="mt-2">
                      <Badge className={evaluation.releaseGatePass ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300" : "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"}>
                        {evaluation.releaseGatePass ? "PASS" : "FAIL"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline">Run: {evaluation.runId}</Badge>
                <Badge variant="outline">{evaluation.total} item</Badge>
                <Badge variant={evaluation.regressionDetected ? "destructive" : "outline"}>
                  {evaluation.regressionDetected ? "Regression detected" : "No regression"}
                </Badge>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Query</TableHead>
                    <TableHead>Intent</TableHead>
                    <TableHead>Tools</TableHead>
                    <TableHead>Trace Grade</TableHead>
                    <TableHead>Latency</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {failedEvalItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        Tidak ada item evaluasi yang bermasalah pada run terbaru.
                      </TableCell>
                    </TableRow>
                  ) : (
                    failedEvalItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="max-w-[340px]">
                          <div className="line-clamp-2 font-medium">{item.query}</div>
                          {item.traceId && (
                            <div className="text-xs text-muted-foreground mt-1">Trace: {item.traceId}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{item.predictedIntent}</div>
                          {item.expectedIntent && (
                            <div className="text-xs text-muted-foreground">Expected: {item.expectedIntent}</div>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          <div className="line-clamp-2 text-sm">
                            {Array.isArray(item.actualTools) ? item.actualTools.join(", ") : "-"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={item.traceGrade === "A" ? "outline" : "destructive"}>
                            {item.traceGrade || "-"} {typeof item.traceScore === "number" ? `(${item.traceScore})` : ""}
                          </Badge>
                        </TableCell>
                        <TableCell>{item.latencyMs} ms</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      {/* Intents Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" /> Top Intent / Pertanyaan
          </CardTitle>
          <CardDescription>
            Jenis pertanyaan yang paling sering ditanyakan warga — intent dengan confidence rendah
            menandakan AI kurang yakin menjawab, perlu tambah knowledge.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {intents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Brain className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>Belum ada data intent tersedia</p>
              <p className="text-xs mt-1">Data akan muncul setelah ada percakapan dengan AI</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Intent</TableHead>
                  <TableHead>Jumlah</TableHead>
                  <TableHead>Avg Confidence</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {intents.map((item, idx) => {
                  const conf = typeof item.avgConfidence === 'number' ? item.avgConfidence : 0
                  const confPct = conf > 1 ? conf : conf * 100
                  return (
                    <TableRow key={idx}>
                      <TableCell className="font-mono text-sm">{idx + 1}</TableCell>
                      <TableCell className="font-medium">{item.intent}</TableCell>
                      <TableCell>{item.count}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={confPct} className="h-2 w-20" />
                          <span className="text-sm">{confPct.toFixed(0)}%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {confPct >= 70 ? (
                          <Badge className="bg-green-100 text-green-800">Baik</Badge>
                        ) : confPct >= 40 ? (
                          <Badge className="bg-yellow-100 text-yellow-800">Perlu Perbaikan</Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-800">Coverage Rendah</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600" /> Rekomendasi
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {hasRuntimeOverview && hitRateNum < 50 && hitRateNum > 0 && (
              <li className="flex items-start gap-2">
                <XCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Coverage Rate rendah ({overview.hitRate}%)</p>
                  <p className="text-xs text-muted-foreground">
                    Tambahkan lebih banyak artikel ke knowledge base, terutama untuk pertanyaan yang sering ditanyakan.
                  </p>
                </div>
              </li>
            )}
            {overview.fallbackCount > overview.knowledgeHits && (
              <li className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Banyak pertanyaan dijawab fallback</p>
                  <p className="text-xs text-muted-foreground">
                    {overview.fallbackCount} pertanyaan dijawab dengan fallback. Periksa log pertanyaan dan tambah knowledge yang relevan.
                  </p>
                </div>
              </li>
            )}
            {intents.some(i => (typeof i.avgConfidence === 'number' ? (i.avgConfidence > 1 ? i.avgConfidence : i.avgConfidence * 100) : 0) < 40) && (
              <li className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Ada intent dengan confidence rendah</p>
                  <p className="text-xs text-muted-foreground">
                    Beberapa jenis pertanyaan memiliki confidence di bawah 40%. Tambahkan knowledge atau perbaiki existing knowledge untuk intent tersebut.
                  </p>
                </div>
              </li>
            )}
            {hasRuntimeOverview && hitRateNum >= 70 && (
              <li className="flex items-start gap-2">
                <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Knowledge base dalam kondisi baik!</p>
                  <p className="text-xs text-muted-foreground">
                    Coverage rate sudah {overview.hitRate}%. Tetap pantau secara berkala dan tambahkan knowledge baru jika ada layanan baru.
                  </p>
                </div>
              </li>
            )}
            {conflictStatusCounts.open > 0 && (
              <li className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-500 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Ada {conflictStatusCounts.open} data berkonflik di knowledge base</p>
                  <p className="text-xs text-muted-foreground">
                    AI mendeteksi informasi yang saling bertentangan dari sumber berbeda. Periksa tabel &quot;Data Berkonflik&quot; di bawah dan perbaiki knowledge yang tidak akurat.
                    {conflictStatusCounts.auto_resolved > 0 && ` (${conflictStatusCounts.auto_resolved} konflik sudah otomatis di-resolve karena ada data resmi di database)`}
                  </p>
                </div>
              </li>
            )}
            {overview.totalQueries === 0 && (
              <li className="flex items-start gap-2">
                <HelpCircle className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Belum ada data percakapan</p>
                  <p className="text-xs text-muted-foreground">
                    Data analytics akan tersedia setelah ada warga yang bertanya melalui WhatsApp atau Webchat.
                  </p>
                </div>
              </li>
            )}
          </ul>
        </CardContent>
      </Card>

      {/* Knowledge Conflicts Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-600" /> Data Berkonflik
              </CardTitle>
              <CardDescription className="mt-1.5">
                AI mendeteksi informasi yang saling bertentangan dari sumber knowledge yang berbeda.
                Periksa dan perbaiki knowledge yang tidak akurat agar AI memberikan jawaban konsisten.
              </CardDescription>
            </div>
            {topConflicts.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={requestDeleteAllConflicts}
                disabled={deletingAllConflicts}
              >
                {deletingAllConflicts ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Hapus Semua
              </Button>
            )}
          </div>
          {(conflictStatusCounts.open > 0 || conflictStatusCounts.resolved > 0 || conflictStatusCounts.auto_resolved > 0) && (
            <div className="flex gap-2 mt-2 flex-wrap">
              <Badge className="bg-orange-100 text-orange-800">{conflictStatusCounts.open} Belum Ditangani</Badge>
              <Badge className="bg-blue-100 text-blue-800">{conflictStatusCounts.auto_resolved} Auto-Resolved</Badge>
              <Badge className="bg-green-100 text-green-800">{conflictStatusCounts.resolved} Sudah Diperbaiki</Badge>
              {conflictStatusCounts.ignored > 0 && (
                <Badge className="bg-gray-100 text-gray-600">{conflictStatusCounts.ignored} Diabaikan</Badge>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {topConflicts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>Tidak ada konflik data yang terdeteksi</p>
              <p className="text-xs mt-1">Semua knowledge base konsisten dan tidak saling bertentangan</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Sumber 1</TableHead>
                  <TableHead>Sumber 2</TableHead>
                  <TableHead>Deskripsi Konflik</TableHead>
                  <TableHead>Frekuensi</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Terakhir</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topConflicts.map((conflict, idx) => {
                  const lastSeen = conflict.lastSeen ? new Date(conflict.lastSeen) : null
                  const relativeTime = lastSeen ? formatRelativeTime(lastSeen) : "-"
                  return (
                    <TableRow key={conflict.id}>
                      <TableCell className="font-mono text-sm">{idx + 1}</TableCell>
                      <TableCell className="max-w-[120px] truncate text-xs" title={conflict.source1}>
                        {conflict.source1}
                      </TableCell>
                      <TableCell className="max-w-[120px] truncate text-xs" title={conflict.source2}>
                        {conflict.source2}
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <p className="text-xs text-muted-foreground truncate" title={conflict.summary}>
                          {conflict.summary.length > 100 ? conflict.summary.substring(0, 100) + '...' : conflict.summary}
                        </p>
                      </TableCell>
                      <TableCell>
                        <span className={`font-medium ${conflict.hitCount >= 5 ? "text-red-600" : conflict.hitCount >= 3 ? "text-yellow-600" : ""}`}>
                          {conflict.hitCount}×
                        </span>
                      </TableCell>
                      <TableCell>
                        {conflict.status === 'open' ? (
                          <Badge className="bg-orange-100 text-orange-800 text-xs">Belum Ditangani</Badge>
                        ) : conflict.status === 'auto_resolved' ? (
                          <Badge className="bg-blue-100 text-blue-800 text-xs">Auto-Resolved</Badge>
                        ) : conflict.status === 'resolved' ? (
                          <Badge className="bg-green-100 text-green-800 text-xs">Diperbaiki</Badge>
                        ) : (
                          <Badge className="bg-gray-100 text-gray-600 text-xs">Diabaikan</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{relativeTime}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Knowledge Gaps Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageSquareWarning className="h-5 w-5 text-orange-600" /> Pertanyaan Belum Terjawab
              </CardTitle>
              <CardDescription className="mt-1.5">
                Pertanyaan warga yang tidak ditemukan jawabannya di knowledge base — tambahkan
                knowledge untuk topik ini agar AI dapat menjawab dengan lebih baik.
              </CardDescription>
            </div>
            {topGaps.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={requestDeleteAllGaps}
                disabled={deletingAllGaps}
              >
                {deletingAllGaps ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Hapus Semua
              </Button>
            )}
          </div>
          {(gapStatusCounts.open > 0 || gapStatusCounts.resolved > 0) && (
            <div className="flex gap-2 mt-2">
              <Badge className="bg-orange-100 text-orange-800">{gapStatusCounts.open} Belum Ditangani</Badge>
              <Badge className="bg-green-100 text-green-800">{gapStatusCounts.resolved} Sudah Dijawab</Badge>
              {gapStatusCounts.ignored > 0 && (
                <Badge className="bg-gray-100 text-gray-600">{gapStatusCounts.ignored} Diabaikan</Badge>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {topGaps.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>Tidak ada knowledge gap yang terdeteksi</p>
              <p className="text-xs mt-1">Semua pertanyaan warga sudah terjawab oleh knowledge base</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Pertanyaan</TableHead>
                  <TableHead>Frekuensi</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Terakhir</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topGaps.map((gap, idx) => {
                  const lastSeen = gap.lastSeen ? new Date(gap.lastSeen) : null
                  const relativeTime = lastSeen
                    ? formatRelativeTime(lastSeen)
                    : "-"
                  return (
                    <TableRow key={gap.id}>
                      <TableCell className="font-mono text-sm">{idx + 1}</TableCell>
                      <TableCell className="max-w-xs truncate" title={gap.query}>
                        {gap.query}
                      </TableCell>
                      <TableCell>
                        <span className={`font-medium ${gap.hitCount >= 5 ? "text-red-600" : gap.hitCount >= 3 ? "text-yellow-600" : ""}`}>
                          {gap.hitCount}×
                        </span>
                      </TableCell>
                      <TableCell className="capitalize text-xs">{gap.channel}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{relativeTime}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => requestDeleteGap(gap.id)}
                          disabled={deletingGapId === gap.id}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          {deletingGapId === gap.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
