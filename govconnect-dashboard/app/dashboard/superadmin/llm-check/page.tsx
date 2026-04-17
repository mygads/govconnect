"use client"

import { useCallback, useEffect, useState } from "react"
import { redirect } from "next/navigation"
import {
  Activity,
  AlertTriangle,
  ArrowUpDown,
  Brain,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  Plug,
  RefreshCcw,
  Search,
  Server,
  XCircle,
} from "lucide-react"

import { useAuth } from "@/components/auth/AuthContext"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { superadmin } from "@/lib/frontend-api"

type LaneName = "llm" | "embed" | "rag" | "rerank"

interface GatewayInfo {
  kind: LaneName
  enabled: boolean
  provider: string
  baseUrl: string
  keyCount: number
  path: string
  model: string
  timeoutMs: number
  dimensions?: number
  topN?: number
}

interface LaneCheckResult {
  lane: LaneName
  label: string
  status: string
  responseTime: number
  provider?: string
  model?: string
  error?: string
  details?: any
}

interface LLMCheckData {
  timestamp: string
  aiServiceStatus: string
  aiServiceResponseTime?: number
  aiServiceDetails?: {
    gateways?: Record<LaneName, GatewayInfo>
    rerankEnabled?: boolean
    retrievalCacheEnabled?: boolean
  }
  aiServiceError?: string
  models?: any
  laneChecks: LaneCheckResult[]
  pingDetails?: any
}

function getStatusIcon(status: string) {
  if (status === "healthy" || status === "connected") {
    return <CheckCircle2 className="h-5 w-5 text-emerald-500" />
  }
  if (status === "disabled") {
    return <AlertTriangle className="h-5 w-5 text-amber-500" />
  }
  if (status === "unhealthy" || status === "error" || status === "failed" || status === "unreachable") {
    return <XCircle className="h-5 w-5 text-red-500" />
  }
  return <AlertTriangle className="h-5 w-5 text-amber-500" />
}

function getStatusBadge(status: string) {
  if (status === "healthy" || status === "connected") {
    return <Badge className="border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300">Connected</Badge>
  }
  if (status === "disabled") {
    return <Badge className="border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-900 dark:text-amber-300">Disabled</Badge>
  }
  if (status === "failed" || status === "unreachable") {
    return <Badge className="border-red-200 bg-red-500/10 text-red-700 dark:border-red-900 dark:text-red-300">Unreachable</Badge>
  }
  if (status === "unhealthy" || status === "error") {
    return <Badge className="border-red-200 bg-red-500/10 text-red-700 dark:border-red-900 dark:text-red-300">Error</Badge>
  }
  return <Badge variant="secondary">Unknown</Badge>
}

function getLaneIcon(lane: LaneName) {
  switch (lane) {
    case "embed":
      return <Database className="h-4 w-4" />
    case "rag":
      return <Search className="h-4 w-4" />
    case "rerank":
      return <ArrowUpDown className="h-4 w-4" />
    default:
      return <Brain className="h-4 w-4" />
  }
}

export default function LLMCheckPage() {
  const { user } = useAuth()
  const [data, setData] = useState<LLMCheckData | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (user && user.role !== "superadmin") redirect("/dashboard")
  }, [user])

  const fetchCheck = useCallback(async () => {
    try {
      setChecking(true)
      const response = await superadmin.getLLMCheck()
      setData(response)
    } catch (error) {
      console.error("AI gateway check failed:", error)
    } finally {
      setLoading(false)
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    fetchCheck()
  }, [fetchCheck])

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-72" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3, 4, 5].map((index) => (
            <Skeleton key={index} className="h-36" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  const models = data?.models
  const modelList = Array.isArray(models?.models)
    ? models.models
    : Array.isArray(models?.data)
      ? models.data
      : Array.isArray(models)
        ? models
        : []
  const gatewayEntries = data?.aiServiceDetails?.gateways
    ? Object.values(data.aiServiceDetails.gateways)
    : []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">AI Gateway Check</h1>
          <p className="mt-2 text-muted-foreground">
            Verifikasi koneksi health service dan 4 lane gateway: LLM, embed, RAG rewrite, dan rerank.
          </p>
        </div>
        <Button onClick={fetchCheck} variant="outline" disabled={checking}>
          <RefreshCcw className={`mr-2 h-4 w-4 ${checking ? "animate-spin" : ""}`} />
          {checking ? "Memeriksa..." : "Tes Ulang"}
        </Button>
      </div>

      {data && (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Server className="h-4 w-4" />
                  AI Service
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  {getStatusIcon(data.aiServiceStatus)}
                  <div className="space-y-1">
                    {getStatusBadge(data.aiServiceStatus)}
                    {data.aiServiceResponseTime != null && (
                      <p className="text-xs text-muted-foreground">
                        <Clock className="mr-1 inline h-3 w-3" />
                        {data.aiServiceResponseTime}ms
                      </p>
                    )}
                  </div>
                </div>
                {data.aiServiceError && (
                  <div className="rounded-lg border border-red-200 bg-red-500/10 p-3 text-xs text-red-700 dark:border-red-900 dark:text-red-300">
                    {data.aiServiceError}
                  </div>
                )}
              </CardContent>
            </Card>

            {data.laneChecks.map((lane) => (
              <Card key={lane.lane} className="border-border/60">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    {getLaneIcon(lane.lane)}
                    {lane.label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(lane.status)}
                    <div className="space-y-1">
                      {getStatusBadge(lane.status)}
                      {lane.responseTime > 0 && (
                        <p className="text-xs text-muted-foreground">
                          <Clock className="mr-1 inline h-3 w-3" />
                          {lane.responseTime}ms
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {lane.provider && <p>Provider: <span className="font-medium text-foreground">{lane.provider}</span></p>}
                    {lane.model && <p>Model: <span className="font-medium break-all text-foreground">{lane.model}</span></p>}
                  </div>
                  {lane.error && (
                    <div className="rounded-lg border border-red-200 bg-red-500/10 p-3 text-xs text-red-700 dark:border-red-900 dark:text-red-300">
                      {lane.error}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {gatewayEntries.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plug className="h-5 w-5" />
                  Konfigurasi Gateway Aktif
                </CardTitle>
                <CardDescription>
                  Snapshot lane dari endpoint health AI Service.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {gatewayEntries.map((gateway) => (
                    <div key={gateway.kind} className="rounded-xl border border-border/60 bg-background p-4">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{gateway.kind.toUpperCase()}</p>
                          <p className="text-xs text-muted-foreground">{gateway.provider}</p>
                        </div>
                        {getStatusBadge(gateway.enabled ? "connected" : "disabled")}
                      </div>
                      <div className="space-y-2 text-xs text-muted-foreground">
                        <p className="break-all font-medium text-foreground">{gateway.model}</p>
                        <p>Path: <span className="font-mono">{gateway.path}</span></p>
                        <p>Timeout: {gateway.timeoutMs}ms</p>
                        <p>Keys: {gateway.keyCount}</p>
                        {gateway.dimensions != null && <p>Dimensions: {gateway.dimensions}</p>}
                        {gateway.topN != null && <p>Top N: {gateway.topN}</p>}
                        <p className="break-all font-mono text-[11px]">{gateway.baseUrl}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">
                    Rerank: {data.aiServiceDetails?.rerankEnabled ? "On" : "Off"}
                  </Badge>
                  <Badge variant="outline">
                    Retrieval Cache: {data.aiServiceDetails?.retrievalCacheEnabled ? "On" : "Off"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )}

          {modelList.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cpu className="h-5 w-5" />
                  Model Activity
                </CardTitle>
                <CardDescription>
                  Statistik model dari AI Service untuk memastikan traffic sudah lewat gateway baru.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2">
                  {modelList.map((model: any, index: number) => (
                    <div key={index} className="rounded-xl border border-border/60 p-4">
                      <p className="text-sm font-semibold text-foreground break-all">
                        {model.name || model.model || `Model ${index + 1}`}
                      </p>
                      {model.total_requests != null && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Requests: {model.total_requests}
                        </p>
                      )}
                      {model.totalCalls != null && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Calls: {model.totalCalls}
                        </p>
                      )}
                      {model.avg_response_time != null && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Avg: {model.avg_response_time}ms
                        </p>
                      )}
                      {model.avgResponseTimeMs != null && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Avg: {model.avgResponseTimeMs}ms
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Raw Health Payload
              </CardTitle>
              <CardDescription>
                Payload asli untuk inspeksi cepat provider, path, dan hasil ping per lane.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-4 text-xs font-mono">
                {JSON.stringify({
                  health: data.aiServiceDetails,
                  ping: data.pingDetails,
                }, null, 2)}
              </pre>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground">
            Terakhir diperiksa: {new Date(data.timestamp).toLocaleString("id-ID")}
          </p>
        </>
      )}
    </div>
  )
}
