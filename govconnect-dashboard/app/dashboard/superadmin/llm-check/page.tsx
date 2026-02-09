"use client"

import { useEffect, useState, useCallback } from "react"
import { redirect } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/components/auth/AuthContext"
import {
  Brain, RefreshCcw, CheckCircle2, XCircle, AlertTriangle,
  Clock, Server, Cpu, Activity
} from "lucide-react"

interface LLMTestResult {
  name: string
  status: string
  responseTime: number
  details?: any
  error?: string
}

interface LLMCheckData {
  timestamp: string
  aiServiceStatus: string
  aiServiceResponseTime?: number
  aiServiceDetails?: any
  aiServiceError?: string
  models?: any
  llmTests: LLMTestResult[]
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
      const res = await fetch("/api/superadmin/llm-check", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      if (res.ok) setData(await res.json())
    } catch (e) {
      console.error("LLM check failed:", e)
    } finally {
      setLoading(false)
      setChecking(false)
    }
  }, [])

  useEffect(() => { fetchCheck() }, [fetchCheck])

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-32" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  const getStatusIcon = (status: string) => {
    if (status === "healthy" || status === "connected") return <CheckCircle2 className="h-6 w-6 text-green-500" />
    if (status === "unhealthy" || status === "error" || status === "failed") return <XCircle className="h-6 w-6 text-red-500" />
    return <AlertTriangle className="h-6 w-6 text-yellow-500" />
  }

  const getStatusBadge = (status: string) => {
    if (status === "healthy" || status === "connected") return <Badge className="bg-green-100 text-green-800">Connected</Badge>
    if (status === "unhealthy" || status === "error") return <Badge className="bg-red-100 text-red-800">Error</Badge>
    if (status === "failed" || status === "unreachable") return <Badge className="bg-red-100 text-red-800">Unreachable</Badge>
    return <Badge variant="secondary">Unknown</Badge>
  }

  const models = data?.models
  const modelList = Array.isArray(models?.models) ? models.models : Array.isArray(models?.data) ? models.data : Array.isArray(models) ? models : []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">LLM Connection Check</h1>
          <p className="text-muted-foreground mt-2">
            Periksa konektivitas ke AI Service dan Large Language Model (LLM)
          </p>
        </div>
        <Button onClick={fetchCheck} variant="outline" disabled={checking}>
          <RefreshCcw className={`h-4 w-4 mr-2 ${checking ? "animate-spin" : ""}`} />
          {checking ? "Memeriksa..." : "Tes Koneksi"}
        </Button>
      </div>

      {data && (
        <>
          {/* AI Service Status */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card className={
              data.aiServiceStatus === "healthy" ? "border-green-200" :
              data.aiServiceStatus === "unhealthy" ? "border-red-200" : "border-yellow-200"
            }>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Server className="h-4 w-4" /> AI Service
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  {getStatusIcon(data.aiServiceStatus)}
                  <div>
                    {getStatusBadge(data.aiServiceStatus)}
                    {data.aiServiceResponseTime && (
                      <p className="text-xs text-muted-foreground mt-1">
                        <Clock className="h-3 w-3 inline mr-1" />
                        {data.aiServiceResponseTime}ms
                      </p>
                    )}
                  </div>
                </div>
                {data.aiServiceError && (
                  <p className="text-xs text-red-600 mt-2 bg-red-50 dark:bg-red-950 rounded p-2">{data.aiServiceError}</p>
                )}
              </CardContent>
            </Card>

            {/* LLM Test */}
            {data.llmTests.map((test, idx) => (
              <Card key={idx} className={
                test.status === "connected" ? "border-green-200" : "border-red-200"
              }>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Brain className="h-4 w-4" /> {test.name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    {getStatusIcon(test.status)}
                    <div>
                      {getStatusBadge(test.status)}
                      {test.responseTime > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          <Clock className="h-3 w-3 inline mr-1" />
                          {test.responseTime}ms
                        </p>
                      )}
                    </div>
                  </div>
                  {test.error && (
                    <p className="text-xs text-red-600 mt-2 bg-red-50 dark:bg-red-950 rounded p-2">{test.error}</p>
                  )}
                </CardContent>
              </Card>
            ))}

          </div>

          {/* AI Service Details */}
          {data.aiServiceDetails && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" /> AI Service Detail
                </CardTitle>
                <CardDescription>Informasi detail dari AI Service health endpoint</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-muted rounded-lg p-4 overflow-auto max-h-64 font-mono">
                  {JSON.stringify(data.aiServiceDetails, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}

          {/* Models Info */}
          {modelList.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cpu className="h-5 w-5" /> Model yang Digunakan
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2">
                  {modelList.map((model: any, idx: number) => (
                    <div key={idx} className="rounded-lg border p-3">
                      <p className="font-medium text-sm">{model.name || model.model || `Model ${idx + 1}`}</p>
                      {model.total_requests != null && (
                        <p className="text-xs text-muted-foreground">{model.total_requests} requests</p>
                      )}
                      {model.avg_response_time != null && (
                        <p className="text-xs text-muted-foreground">Avg: {model.avg_response_time}ms</p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Timestamp */}
          <p className="text-xs text-center text-muted-foreground">
            Terakhir diperiksa: {new Date(data.timestamp).toLocaleString("id-ID")}
          </p>
        </>
      )}
    </div>
  )
}
