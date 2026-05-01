"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { redirect } from "next/navigation"
import {
  AlertTriangle,
  ArrowUpDown,
  Brain,
  CheckCircle2,
  Database,
  Loader2,
  Play,
  RefreshCcw,
  Search,
  XCircle,
} from "lucide-react"

import { useAuth } from "@/components/auth/AuthContext"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

type LaneName = "llm" | "embed" | "rewrite" | "rerank"

interface ProviderRow {
  id: string
  name: string
  slug: string
}

interface ModelRow {
  id: string
  lane_type: LaneName | string
  display_name: string
  upstream_model_name: string
  is_active: boolean
  provider_id: string
  provider?: ProviderRow
}

interface ModelTestResult {
  success?: boolean
  provider?: string
  model?: string
  responseTime?: number
  error?: string
  details?: any
}

interface ErrorLogEntry {
  id: string
  label: string
  message: string
  at: string
}

const laneOptions: LaneName[] = ["llm", "embed", "rewrite", "rerank"]

function getStatusIcon(result?: ModelTestResult) {
  if (!result) return <AlertTriangle className="h-5 w-5 text-muted-foreground" />
  if (result.success) return <CheckCircle2 className="h-5 w-5 text-emerald-500" />
  return <XCircle className="h-5 w-5 text-red-500" />
}

function getStatusBadge(result?: ModelTestResult) {
  if (!result) return <Badge variant="secondary">Belum dites</Badge>
  if (result.success) {
    return <Badge className="border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300">Connected</Badge>
  }
  return <Badge className="border-red-200 bg-red-500/10 text-red-700 dark:border-red-900 dark:text-red-300">Error</Badge>
}

function getLaneIcon(lane: string) {
  switch (lane) {
    case "embed":
      return <Database className="h-4 w-4" />
    case "rewrite":
      return <Search className="h-4 w-4" />
    case "rerank":
      return <ArrowUpDown className="h-4 w-4" />
    default:
      return <Brain className="h-4 w-4" />
  }
}

function modelLabel(model: ModelRow) {
  return `${model.display_name || model.upstream_model_name} · ${model.provider?.name || model.upstream_model_name}`
}

export default function LLMCheckPage() {
  const { user } = useAuth()
  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [adminModels, setAdminModels] = useState<ModelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [selectedLane, setSelectedLane] = useState<LaneName>("llm")
  const [selectedProviderId, setSelectedProviderId] = useState("all")
  const [selectedModelId, setSelectedModelId] = useState("")
  const [runningModelIds, setRunningModelIds] = useState<Set<string>>(new Set())
  const [testResults, setTestResults] = useState<Record<string, ModelTestResult>>({})
  const [errorLogs, setErrorLogs] = useState<ErrorLogEntry[]>([])

  useEffect(() => {
    if (user && user.role !== "superadmin") redirect("/dashboard")
  }, [user])

  const appendErrorLog = useCallback((label: string, message: string) => {
    setErrorLogs((current) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        label,
        message,
        at: new Date().toISOString(),
      },
      ...current,
    ].slice(0, 30))
  }, [])

  const loadCatalog = useCallback(async () => {
    try {
      setLoadingCatalog(true)
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
      const [providersRes, modelsRes] = await Promise.all([
        fetch("/api/superadmin/providers", { headers }),
        fetch("/api/superadmin/ai-models", { headers }),
      ])
      const providersPayload = await providersRes.json().catch(() => ({}))
      const modelsPayload = await modelsRes.json().catch(() => ({}))

      if (!providersRes.ok) throw new Error(providersPayload?.error || "Gagal memuat provider")
      if (!modelsRes.ok) throw new Error(modelsPayload?.error || "Gagal memuat model")

      setProviders(Array.isArray(providersPayload?.data) ? providersPayload.data : [])
      setAdminModels(Array.isArray(modelsPayload?.data) ? modelsPayload.data : [])
    } catch (error: any) {
      appendErrorLog("Load catalog", error?.message || "Gagal memuat data model/provider")
    } finally {
      setLoading(false)
      setLoadingCatalog(false)
    }
  }, [appendErrorLog])

  useEffect(() => {
    loadCatalog()
  }, [loadCatalog])

  const activeModels = useMemo(() => adminModels.filter((model) => model.is_active), [adminModels])

  const selectableModels = useMemo(() => {
    return activeModels.filter((model) => {
      if (model.lane_type !== selectedLane) return false
      if (selectedProviderId !== "all" && model.provider_id !== selectedProviderId) return false
      return true
    })
  }, [activeModels, selectedLane, selectedProviderId])

  useEffect(() => {
    setSelectedModelId((current) => selectableModels.some((model) => model.id === current) ? current : selectableModels[0]?.id || "")
  }, [selectableModels])

  const runModelTest = useCallback(async (model: ModelRow): Promise<ModelTestResult> => {
    const token = localStorage.getItem("token")
    const response = await fetch("/api/superadmin/ai-models/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ model_id: model.id }),
    })
    const payload = await response.json().catch(() => ({ success: false, error: `HTTP ${response.status}` }))
    if (!response.ok || payload?.success === false) {
      return { ...payload, success: false, error: payload?.error || `HTTP ${response.status}` }
    }
    return payload
  }, [])

  const testModels = useCallback(async (models: ModelRow[], label: string) => {
    if (models.length === 0) return
    const ids = models.map((model) => model.id)
    setRunningModelIds((current) => new Set([...current, ...ids]))

    const results = await Promise.all(models.map(async (model) => {
      try {
        const result = await runModelTest(model)
        if (!result.success) appendErrorLog(modelLabel(model), result.error || "Model test gagal")
        return { model, result }
      } catch (error: any) {
        const result = { success: false, error: error?.message || "Model test gagal" }
        appendErrorLog(modelLabel(model), result.error)
        return { model, result }
      }
    }))

    setTestResults((current) => {
      const next = { ...current }
      for (const { model, result } of results) next[model.id] = result
      return next
    })
    setRunningModelIds((current) => {
      const next = new Set(current)
      for (const id of ids) next.delete(id)
      return next
    })

    const failed = results.filter(({ result }) => !result.success).length
    if (failed > 0) appendErrorLog(label, `${failed} dari ${results.length} model gagal dites`)
  }, [appendErrorLog, runModelTest])

  const handleSelectedModelTest = () => {
    const model = activeModels.find((item) => item.id === selectedModelId)
    if (model) testModels([model], modelLabel(model))
  }

  const isRunning = runningModelIds.size > 0

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-48" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3, 4, 5].map((index) => <Skeleton key={index} className="h-36" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">AI Gateway Check</h1>
          <p className="mt-2 text-muted-foreground">
            Test model dilakukan manual: pilih satu model, cek satu group lane, atau cek semua model aktif.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={loadCatalog} variant="outline" disabled={loadingCatalog || isRunning}>
            <RefreshCcw className={`mr-2 h-4 w-4 ${loadingCatalog ? "animate-spin" : ""}`} />
            Refresh Model
          </Button>
          <Button onClick={() => testModels(selectableModels, `Group ${selectedLane.toUpperCase()}`)} variant="outline" disabled={isRunning || selectableModels.length === 0}>
            {isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : getLaneIcon(selectedLane)}
            Cek Group {selectedLane.toUpperCase()}
          </Button>
          <Button onClick={() => testModels(activeModels, "Cek semua model")} disabled={isRunning || activeModels.length === 0}>
            {isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Cek Semua
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Play className="h-5 w-5" /> Test Model</CardTitle>
          <CardDescription>Pilih lane, provider, dan model. Halaman ini tidak menjalankan check otomatis saat dibuka.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Group / Lane</Label>
              <Select value={selectedLane} onValueChange={(value) => setSelectedLane(value as LaneName)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {laneOptions.map((lane) => <SelectItem key={lane} value={lane}>{lane.toUpperCase()}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={selectedProviderId} onValueChange={setSelectedProviderId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua provider</SelectItem>
                  {providers.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Model</Label>
              <Select value={selectedModelId} onValueChange={setSelectedModelId} disabled={selectableModels.length === 0}>
                <SelectTrigger><SelectValue placeholder="Pilih model" /></SelectTrigger>
                <SelectContent>
                  {selectableModels.map((model) => <SelectItem key={model.id} value={model.id}>{modelLabel(model)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSelectedModelTest} disabled={isRunning || !selectedModelId}>
              {selectedModelId && runningModelIds.has(selectedModelId) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Test Model Dipilih
            </Button>
            <Button onClick={() => testModels(selectableModels, `Group ${selectedLane.toUpperCase()}`)} variant="outline" disabled={isRunning || selectableModels.length === 0}>
              Cek Semua di Group Ini
            </Button>
          </div>
        </CardContent>
      </Card>

      {errorLogs.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Log Error</AlertTitle>
          <AlertDescription>
            <div className="mt-2 space-y-2">
              {errorLogs.map((log) => (
                <div key={log.id} className="rounded-md border border-red-200/70 bg-red-500/10 p-2 text-xs dark:border-red-900">
                  <div className="font-medium">{log.label}</div>
                  <div>{log.message}</div>
                  <div className="text-red-700/70 dark:text-red-300/70">{new Date(log.at).toLocaleString("id-ID")}</div>
                </div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {selectableModels.map((model) => {
          const result = testResults[model.id]
          const running = runningModelIds.has(model.id)
          return (
            <Card key={model.id} className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-start justify-between gap-3 text-sm font-medium">
                  <span className="flex min-w-0 items-center gap-2">
                    {getLaneIcon(model.lane_type)}
                    <span className="break-all">{model.display_name || model.upstream_model_name}</span>
                  </span>
                  {getStatusBadge(result)}
                </CardTitle>
                <CardDescription className="break-all">
                  {model.provider?.name || "Provider"} · {model.upstream_model_name}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  {running ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : getStatusIcon(result)}
                  <div className="text-xs text-muted-foreground">
                    <div>Lane: <span className="font-medium text-foreground">{model.lane_type.toUpperCase()}</span></div>
                    {result?.responseTime != null && <div>Response: <span className="font-medium text-foreground">{result.responseTime}ms</span></div>}
                  </div>
                </div>
                {result?.error && (
                  <div className="rounded-lg border border-red-200 bg-red-500/10 p-3 text-xs text-red-700 dark:border-red-900 dark:text-red-300">
                    {result.error}
                  </div>
                )}
                <Button size="sm" variant="outline" onClick={() => testModels([model], modelLabel(model))} disabled={isRunning}>
                  {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  Test
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {selectableModels.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Tidak ada model aktif untuk filter ini.
          </CardContent>
        </Card>
      )}
    </div>
  )
}
