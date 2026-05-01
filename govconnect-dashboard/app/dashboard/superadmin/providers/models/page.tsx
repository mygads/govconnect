"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { redirect } from "next/navigation"
import { AlertTriangle, Brain, Database, Edit2, Eye, Loader2, Mic, Play, Plus, Save, Search, Trash2, Waypoints, X } from "lucide-react"

import { useAuth } from "@/components/auth/AuthContext"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
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

interface ProviderRow {
  id: string
  name: string
  slug: string
  is_read_only?: boolean
}

interface ModelRow {
  id: string
  provider_id: string
  lane_type: string
  display_name: string
  upstream_model_name: string
  endpoint_path?: string | null
  actual_pricing_type: string
  actual_fixed_price_usd?: number | null
  actual_input_price_per_million_usd?: number | null
  actual_output_price_per_million_usd?: number | null
  adjusted_pricing_type: string
  adjusted_fixed_price_usd?: number | null
  adjusted_input_price_per_million_usd?: number | null
  adjusted_output_price_per_million_usd?: number | null
  is_active: boolean
  supports_vision?: boolean
  supports_audio?: boolean
  priority?: number
  is_read_only?: boolean
  notes?: string | null
  provider?: {
    id: string
    name: string
    slug: string
  }
}

const laneOptions = ["llm", "embed", "rewrite", "rerank"]

const endpointOptionsByLane: Record<string, string[]> = {
  llm: ["/chat/completions"],
  embed: ["/embeddings"],
  rewrite: ["/chat/completions"],
  rerank: ["/rerank", "/v1/rerank", "/chat/completions"],
}

function endpointPresetKey(provider?: ProviderRow | null) {
  return `${provider?.slug || ""} ${provider?.name || ""}`.toLowerCase()
}

function endpointOptionsForProvider(provider: ProviderRow | undefined, lane: string) {
  const key = endpointPresetKey(provider)
  const providerOptions: Record<string, string[]> = {}

  if (/cohere/.test(key)) {
    providerOptions.embed = ["/v2/embed", "/embed", "/embeddings"]
    providerOptions.rerank = ["/v2/rerank", "/rerank"]
  } else if (/jina/.test(key)) {
    providerOptions.embed = ["/v1/embeddings", "/embeddings"]
    providerOptions.rerank = ["/v1/rerank", "/rerank"]
  } else if (/openrouter|genfity|openai|vercel/.test(key)) {
    providerOptions.llm = ["/chat/completions"]
    providerOptions.rewrite = ["/chat/completions"]
    providerOptions.embed = ["/embeddings"]
    providerOptions.rerank = ["/chat/completions", "/rerank", "/v1/rerank"]
  }

  return Array.from(new Set([...(providerOptions[lane] ?? []), ...(endpointOptionsByLane[lane] ?? [])]))
}

function defaultEndpointForLane(lane: string, provider?: ProviderRow) {
  return endpointOptionsForProvider(provider, lane)[0] ?? ""
}

function endpointMode(lane: string, endpointPath: string) {
  const normalized = endpointPath.trim().toLowerCase()
  const isChatPath = normalized.includes("chat/completions") || normalized.includes("responses")
  if (lane === "rerank" && isChatPath) return { label: "Chat fallback", variant: "secondary" as const }
  if (lane === "rerank") return { label: "Native endpoint", variant: "default" as const }
  if (lane === "embed" && normalized.includes("embeddings")) return { label: "Native endpoint", variant: "default" as const }
  if (lane === "llm" || lane === "rewrite") return { label: "Native endpoint", variant: "default" as const }
  return { label: "Custom endpoint", variant: "outline" as const }
}

function endpointWarning(lane: string, endpointPath: string) {
  const normalized = endpointPath.trim().toLowerCase()
  if (lane === "embed" && normalized && normalized !== "/embeddings") {
    return "Lane embed biasanya memakai /embeddings. Custom tetap boleh jika provider memang butuh path berbeda."
  }
  if (lane === "rerank" && normalized.includes("chat/completions")) {
    return "Rerank memakai chat fallback. Ini valid untuk model LLM, tapi bukan native rerank endpoint."
  }
  return null
}

type ConfirmAction = {
  title: string
  description: string
  actionLabel: string
  variant?: "default" | "destructive"
  onConfirm: () => Promise<void> | void
}

type ModelFormSnapshot = {
  provider_id: string
  lane_type: string
  display_name: string
  upstream_model_name: string
  endpoint_path: string
  actual_input: string
  actual_output: string
  adjusted_input: string
  adjusted_output: string
  priority: string
  is_active: string
  supports_vision: string
  supports_audio: string
  notes: string
}

function laneIcon(lane: string) {
  switch (lane) {
    case "embed":
      return <Database className="h-4 w-4" />
    case "rewrite":
      return <Search className="h-4 w-4" />
    case "rerank":
      return <Waypoints className="h-4 w-4" />
    default:
      return <Brain className="h-4 w-4" />
  }
}

function parseRequiredPrice(value: string, label: string) {
  if (value.trim() === "") throw new Error(`${label} wajib diisi. Isi 0 jika model benar-benar gratis.`)
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} harus angka 0 atau lebih`)
  return parsed
}

function formatPrice(input: number | null | undefined, output: number | null | undefined) {
  return `$${input ?? 0} input / $${output ?? 0} output per 1M token`
}

function priceValue(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value)
}

export default function SuperadminAIModelsPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [models, setModels] = useState<ModelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testingModelIds, setTestingModelIds] = useState<Set<string>>(new Set())
  const [savingPriorityId, setSavingPriorityId] = useState<string | null>(null)
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null)
  const [testingDraft, setTestingDraft] = useState(false)
  const [testResults, setTestResults] = useState<Record<string, any>>({})
  const [draftTestResult, setDraftTestResult] = useState<any>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmAction | null>(null)
  const [priorityDrafts, setPriorityDrafts] = useState<Record<string, string>>({})

  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [providerId, setProviderId] = useState("")
  const [laneType, setLaneType] = useState("llm")
  const [displayName, setDisplayName] = useState("")
  const [upstreamModelName, setUpstreamModelName] = useState("")
  const [endpointPath, setEndpointPath] = useState("")
  const [actualInput, setActualInput] = useState("")
  const [actualOutput, setActualOutput] = useState("")
  const [adjustedInput, setAdjustedInput] = useState("")
  const [adjustedOutput, setAdjustedOutput] = useState("")
  const [priority, setPriority] = useState("100")
  const [isActive, setIsActive] = useState("true")
  const [supportsVision, setSupportsVision] = useState("false")
  const [supportsAudio, setSupportsAudio] = useState("false")
  const [notes, setNotes] = useState("")
  const [formInitial, setFormInitial] = useState<ModelFormSnapshot>({
    provider_id: "",
    lane_type: "llm",
    display_name: "",
    upstream_model_name: "",
    endpoint_path: "",
    actual_input: "",
    actual_output: "",
    adjusted_input: "",
    adjusted_output: "",
    priority: "100",
    is_active: "true",
    supports_vision: "false",
    supports_audio: "false",
    notes: "",
  })

  useEffect(() => {
    if (user && user.role !== "superadmin") redirect("/dashboard")
  }, [user])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}

      const [providersRes, modelsRes] = await Promise.all([
        fetch("/api/superadmin/providers", { headers }),
        fetch("/api/superadmin/ai-models", { headers }),
      ])

      const providersPayload = await providersRes.json()
      const modelsPayload = await modelsRes.json()
      if (!providersRes.ok) throw new Error(providersPayload?.error || "Gagal memuat provider AI")
      if (!modelsRes.ok) throw new Error(modelsPayload?.error || "Gagal memuat model AI")

      const providerRows = Array.isArray(providersPayload?.data) ? providersPayload.data : []
      const editableProviders = providerRows.filter((provider: ProviderRow) => !provider.is_read_only)
      const modelRows = Array.isArray(modelsPayload?.data) ? modelsPayload.data : []
      setProviders(providerRows)
      setModels(modelRows)
      setPriorityDrafts(Object.fromEntries(modelRows.map((model: ModelRow) => [model.id, String(model.priority ?? 100)])))
      setProviderId((current) => current || editableProviders[0]?.id || "")
    } catch (err: any) {
      setError(err?.message || "Gagal memuat model AI")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const grouped = useMemo(() => laneOptions.map((lane) => ({
    lane,
    rows: models.filter((model) => model.lane_type === lane),
  })), [models])

  const selectedProvider = providers.find((provider) => provider.id === providerId)
  const endpointOptions = endpointOptionsForProvider(selectedProvider, laneType)
  const endpointSelectValue = endpointOptions.includes(endpointPath) ? endpointPath : "__manual__"
  const currentEndpointMode = endpointMode(laneType, endpointPath)
  const currentEndpointWarning = endpointWarning(laneType, endpointPath)

  const handleProviderChange = (nextProviderId: string) => {
    const nextProvider = providers.find((provider) => provider.id === nextProviderId)
    setProviderId(nextProviderId)
    setEndpointPath(defaultEndpointForLane(laneType, nextProvider))
    setDraftTestResult(null)
  }

  const handleLaneChange = (nextLane: string) => {
    setLaneType(nextLane)
    setEndpointPath(defaultEndpointForLane(nextLane, selectedProvider))
    setDraftTestResult(null)
  }

  const getFormSnapshot = (nextProviderId = providerId): ModelFormSnapshot => ({
    provider_id: nextProviderId,
    lane_type: laneType,
    display_name: displayName.trim(),
    upstream_model_name: upstreamModelName.trim(),
    endpoint_path: endpointPath.trim(),
    actual_input: actualInput.trim(),
    actual_output: actualOutput.trim(),
    adjusted_input: adjustedInput.trim(),
    adjusted_output: adjustedOutput.trim(),
    priority: priority.trim(),
    is_active: isActive,
    supports_vision: supportsVision,
    supports_audio: supportsAudio,
    notes: notes.trim(),
  })

  const isFormDirty = JSON.stringify(getFormSnapshot()) !== JSON.stringify(formInitial)

  const resetForm = () => {
    const nextProvider = providers.find((provider) => !provider.is_read_only)
    const nextProviderId = nextProvider?.id || ""
    const nextLane = "llm"
    const nextEndpointPath = defaultEndpointForLane(nextLane, nextProvider)
    setEditingModelId(null)
    setLaneType(nextLane)
    setDisplayName("")
    setUpstreamModelName("")
    setEndpointPath(nextEndpointPath)
    setActualInput("")
    setActualOutput("")
    setAdjustedInput("")
    setAdjustedOutput("")
    setPriority("100")
    setIsActive("true")
    setSupportsVision("false")
    setSupportsAudio("false")
    setNotes("")
    setDraftTestResult(null)
    setProviderId(nextProviderId)
    setFormInitial({
      provider_id: nextProviderId,
      lane_type: nextLane,
      display_name: "",
      upstream_model_name: "",
      endpoint_path: nextEndpointPath,
      actual_input: "",
      actual_output: "",
      adjusted_input: "",
      adjusted_output: "",
      priority: "100",
      is_active: "true",
      supports_vision: "false",
      supports_audio: "false",
      notes: "",
    })
  }

  const startCreate = () => {
    resetForm()
    setError(null)
    setFormOpen(true)
  }

  const startEdit = (model: ModelRow) => {
    const snapshot = {
      provider_id: model.provider_id,
      lane_type: model.lane_type,
      display_name: model.display_name.trim(),
      upstream_model_name: model.upstream_model_name.trim(),
      endpoint_path: (model.endpoint_path || "").trim(),
      actual_input: priceValue(model.actual_input_price_per_million_usd),
      actual_output: priceValue(model.actual_output_price_per_million_usd),
      adjusted_input: priceValue(model.adjusted_input_price_per_million_usd),
      adjusted_output: priceValue(model.adjusted_output_price_per_million_usd),
      priority: String(model.priority ?? 100),
      is_active: model.is_active ? "true" : "false",
      supports_vision: model.supports_vision ? "true" : "false",
      supports_audio: model.supports_audio ? "true" : "false",
      notes: (model.notes || "").trim(),
    }
    setEditingModelId(model.id)
    setProviderId(snapshot.provider_id)
    setLaneType(snapshot.lane_type)
    setDisplayName(snapshot.display_name)
    setUpstreamModelName(snapshot.upstream_model_name)
    setEndpointPath(snapshot.endpoint_path)
    setActualInput(snapshot.actual_input)
    setActualOutput(snapshot.actual_output)
    setAdjustedInput(snapshot.adjusted_input)
    setAdjustedOutput(snapshot.adjusted_output)
    setPriority(snapshot.priority)
    setIsActive(snapshot.is_active)
    setSupportsVision(snapshot.supports_vision)
    setSupportsAudio(snapshot.supports_audio)
    setNotes(snapshot.notes)
    setFormInitial(snapshot)
    setDraftTestResult(null)
    setError(null)
    setFormOpen(true)
  }

  const handleTest = async (modelId: string) => {
    try {
      setTestingModelIds((current) => new Set(current).add(modelId))
      setError(null)
      const token = localStorage.getItem("token")
      const response = await fetch("/api/superadmin/ai-models/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ model_id: modelId }),
      })
      const payload = await response.json()
      setTestResults((current) => ({ ...current, [modelId]: payload }))
      if (!response.ok || payload?.success === false) throw new Error(payload?.error || "Model test gagal")
    } catch (err: any) {
      setTestResults((current) => ({ ...current, [modelId]: { success: false, error: err?.message || "Model test gagal" } }))
    } finally {
      setTestingModelIds((current) => {
        const next = new Set(current)
        next.delete(modelId)
        return next
      })
    }
  }

  const handleTestMany = (rows: ModelRow[]) => {
    rows.filter((model) => model.is_active && !testingModelIds.has(model.id)).forEach((model) => {
      void handleTest(model.id)
    })
  }

  const handleTestDraft = async () => {
    if (!providerId || !laneType || !upstreamModelName.trim()) {
      toast({ title: "Gagal", description: "Provider, lane, dan upstream model wajib diisi sebelum test", variant: "destructive" })
      return
    }

    try {
      setTestingDraft(true)
      setDraftTestResult(null)
      const token = localStorage.getItem("token")
      const response = await fetch("/api/superadmin/ai-models/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          draft: {
            provider_id: providerId,
            lane_type: laneType,
            display_name: displayName.trim() || upstreamModelName.trim(),
            upstream_model_name: upstreamModelName.trim(),
            endpoint_path: endpointPath.trim() || null,
          },
        }),
      })
      const payload = await response.json()
      setDraftTestResult(payload)
      if (!response.ok || payload?.success === false) throw new Error(payload?.error || "Endpoint test gagal")
    } catch (err: any) {
      setDraftTestResult({ success: false, error: err?.message || "Endpoint test gagal" })
    } finally {
      setTestingDraft(false)
    }
  }

  const requestPrioritySave = (model: ModelRow) => {
    const nextPriority = Number(priorityDrafts[model.id] ?? model.priority ?? 100)
    if (!Number.isInteger(nextPriority)) {
      toast({ title: "Gagal", description: "Priority harus angka bulat", variant: "destructive" })
      return
    }
    if (nextPriority === (model.priority ?? 100)) return

    setPendingConfirm({
      title: "Simpan priority model?",
      description: `Priority ${model.display_name} akan diubah menjadi ${nextPriority}.`,
      actionLabel: "Simpan Priority",
      onConfirm: () => savePriority(model, nextPriority),
    })
  }

  const savePriority = async (model: ModelRow, nextPriority: number) => {
    try {
      setSavingPriorityId(model.id)
      setError(null)
      const token = localStorage.getItem("token")
      const response = await fetch(`/api/superadmin/ai-models/${encodeURIComponent(model.id)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ priority: nextPriority }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || "Gagal menyimpan priority")
      toast({ title: "Berhasil", description: "Priority model berhasil disimpan." })
      await loadData()
    } catch (err: any) {
      toast({ title: "Gagal", description: err?.message || "Gagal menyimpan priority", variant: "destructive" })
    } finally {
      setSavingPriorityId(null)
    }
  }

  const requestSave = () => {
    if (!providerId || !displayName.trim() || !upstreamModelName.trim()) {
      toast({ title: "Gagal", description: "Provider, display name, dan upstream model wajib diisi", variant: "destructive" })
      return
    }
    try {
      parseRequiredPrice(actualInput, "Harga actual input")
      parseRequiredPrice(actualOutput, "Harga actual output")
      parseRequiredPrice(adjustedInput, "Harga adjusted input")
      parseRequiredPrice(adjustedOutput, "Harga adjusted output")
      const nextPriority = Number(priority)
      if (!Number.isInteger(nextPriority)) throw new Error("Priority harus angka bulat")
    } catch (err: any) {
      toast({ title: "Gagal", description: err?.message || "Data model tidak valid", variant: "destructive" })
      return
    }
    if (!isFormDirty) return

    setPendingConfirm({
      title: editingModelId ? "Simpan perubahan model AI?" : "Tambah model AI?",
      description: editingModelId ? `Perubahan model ${displayName.trim()} akan disimpan.` : `Model ${displayName.trim()} akan ditambahkan.`,
      actionLabel: editingModelId ? "Simpan Perubahan" : "Simpan Model",
      onConfirm: handleSave,
    })
  }

  const handleSave = async () => {
    if (!providerId || !displayName.trim() || !upstreamModelName.trim() || !isFormDirty) return

    try {
      setSubmitting(true)
      setError(null)
        const actualInputPrice = parseRequiredPrice(actualInput, "Harga actual input")
      const actualOutputPrice = parseRequiredPrice(actualOutput, "Harga actual output")
      const adjustedInputPrice = parseRequiredPrice(adjustedInput, "Harga adjusted input")
      const adjustedOutputPrice = parseRequiredPrice(adjustedOutput, "Harga adjusted output")
      const nextPriority = Number(priority)
      if (!Number.isInteger(nextPriority)) throw new Error("Priority harus angka bulat")

      const token = localStorage.getItem("token")
      const body = {
        provider_id: providerId,
        lane_type: laneType,
        display_name: displayName.trim(),
        upstream_model_name: upstreamModelName.trim(),
        endpoint_path: endpointPath.trim() || null,
        actual_pricing_type: "per_million_tokens",
        actual_fixed_price_usd: null,
        actual_input_price_per_million_usd: actualInputPrice,
        actual_output_price_per_million_usd: actualOutputPrice,
        adjusted_pricing_type: "per_million_tokens",
        adjusted_fixed_price_usd: null,
        adjusted_input_price_per_million_usd: adjustedInputPrice,
        adjusted_output_price_per_million_usd: adjustedOutputPrice,
        is_active: isActive === "true",
        supports_vision: supportsVision === "true",
        supports_audio: supportsAudio === "true",
        priority: nextPriority,
        notes: notes.trim() || null,
      }
      const response = await fetch(editingModelId ? `/api/superadmin/ai-models/${encodeURIComponent(editingModelId)}` : "/api/superadmin/ai-models", {
        method: editingModelId ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || (editingModelId ? "Gagal mengubah model AI" : "Gagal membuat model AI"))

      toast({ title: "Berhasil", description: editingModelId ? "Model AI berhasil diubah." : "Model AI berhasil ditambahkan." })
      resetForm()
      setFormOpen(false)
      await loadData()
    } catch (err: any) {
      toast({ title: "Gagal", description: err?.message || (editingModelId ? "Gagal mengubah model AI" : "Gagal membuat model AI"), variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  const requestDelete = (model: ModelRow) => {
    setPendingConfirm({
      title: "Hapus model AI?",
      description: `Model ${model.display_name} akan dihapus permanen.`,
      actionLabel: "Hapus",
      variant: "destructive",
      onConfirm: () => handleDelete(model),
    })
  }

  const handleDelete = async (model: ModelRow) => {
    try {
      setDeletingModelId(model.id)
      setError(null)
        const token = localStorage.getItem("token")
      const response = await fetch(`/api/superadmin/ai-models/${encodeURIComponent(model.id)}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || "Gagal menghapus model AI")

      if (editingModelId === model.id) {
        resetForm()
        setFormOpen(false)
      }
      toast({ title: "Berhasil", description: "Model AI berhasil dihapus." })
      await loadData()
    } catch (err: any) {
      toast({ title: "Gagal", description: err?.message || "Gagal menghapus model AI", variant: "destructive" })
    } finally {
      setDeletingModelId(null)
    }
  }

  if (loading) {
    return <div className="flex min-h-60 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat model AI...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">AI Models</h1>
          <p className="mt-2 text-muted-foreground">Kelola model DB, lane runtime, endpoint, priority, dan biaya per 1 juta token.</p>
        </div>
        <Button onClick={startCreate}><Plus className="mr-2 h-4 w-4" />Tambah Model</Button>
      </div>

      {error && <Alert variant="destructive"><AlertTitle>Terjadi kesalahan</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

      <Dialog open={formOpen} onOpenChange={(open) => { setFormOpen(open); if (!open) resetForm() }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">{editingModelId ? <Edit2 className="h-5 w-5" /> : <Plus className="h-5 w-5" />} {editingModelId ? "Edit Model" : "Tambah Model"}</DialogTitle>
            <DialogDescription>Nama model boleh mengandung kata “free”, tapi biaya tetap mengikuti harga input/output. Isi 0 hanya jika memang gratis.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={providerId} onValueChange={handleProviderChange}>
                <SelectTrigger><SelectValue placeholder="Pilih provider" /></SelectTrigger>
                <SelectContent>
                  {providers.filter((provider) => !provider.is_read_only).map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Lane</Label>
              <Select value={laneType} onValueChange={handleLaneChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {laneOptions.map((lane) => <SelectItem key={lane} value={lane}>{lane.toUpperCase()}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Display Name</Label><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Claude Sonnet 4.7" /></div>
            <div className="space-y-2"><Label>Upstream Model Name</Label><Input value={upstreamModelName} onChange={(e) => setUpstreamModelName(e.target.value)} placeholder="anthropic/claude-sonnet-4.7" /></div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Label>Endpoint Path</Label>
                <Badge variant={currentEndpointMode.variant}>{currentEndpointMode.label}</Badge>
              </div>
              <div className="grid gap-2 md:grid-cols-[220px_1fr]">
                <Select
                  value={endpointSelectValue}
                  onValueChange={(value) => {
                    if (value !== "__manual__") {
                      setEndpointPath(value)
                      setDraftTestResult(null)
                    }
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Pilih endpoint" /></SelectTrigger>
                  <SelectContent>
                    {endpointOptions.map((path) => <SelectItem key={path} value={path}>{path}</SelectItem>)}
                    <SelectItem value="__manual__">Manual / custom</SelectItem>
                  </SelectContent>
                </Select>
                <Input value={endpointPath} onChange={(e) => { setEndpointPath(e.target.value); setDraftTestResult(null) }} placeholder={defaultEndpointForLane(laneType, selectedProvider) || "/chat/completions"} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={handleTestDraft} disabled={testingDraft || !providerId || !upstreamModelName.trim()}>
                  {testingDraft ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  Test Endpoint Ini
                </Button>
                {draftTestResult && (
                  <div className={`rounded border px-2 py-1 text-xs ${draftTestResult?.success ? "border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300" : "border-red-200 bg-red-500/10 text-red-700 dark:border-red-900 dark:text-red-300"}`}>
                    {draftTestResult?.success ? `Connected · ${draftTestResult?.responseTime ?? 0}ms · ${draftTestResult?.details?.mode || currentEndpointMode.label}` : draftTestResult?.error || "Error"}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Preset mengikuti provider dan lane, tapi tetap bisa dipilih dari dropdown atau diketik manual.</p>
              {currentEndpointWarning && (
                <p className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{currentEndpointWarning}</span>
                </p>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2"><Label>Priority</Label><Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} /></div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={isActive} onValueChange={setIsActive}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Active</SelectItem>
                    <SelectItem value="false">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Capability</Label>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant={supportsVision === "true" ? "default" : "outline"} onClick={() => setSupportsVision(supportsVision === "true" ? "false" : "true")} disabled={laneType !== "llm"}>
                    <Eye className="mr-2 h-4 w-4" />Image
                  </Button>
                  <Button type="button" size="sm" variant={supportsAudio === "true" ? "default" : "outline"} onClick={() => setSupportsAudio(supportsAudio === "true" ? "false" : "true")} disabled={laneType !== "llm"}>
                    <Mic className="mr-2 h-4 w-4" />Audio
                  </Button>
                </div>
              </div>
            </div>

            <div className="rounded-lg border p-4 space-y-4">
              <div>
                <div className="font-medium">Harga Actual</div>
                <p className="text-xs text-muted-foreground">Biaya asli provider per 1 juta token.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2"><Label>Input / 1M Token</Label><Input type="number" min="0" step="0.000001" value={actualInput} onChange={(e) => setActualInput(e.target.value)} placeholder="0" /></div>
                <div className="space-y-2"><Label>Output / 1M Token</Label><Input type="number" min="0" step="0.000001" value={actualOutput} onChange={(e) => setActualOutput(e.target.value)} placeholder="0" /></div>
              </div>
            </div>

            <div className="rounded-lg border p-4 space-y-4">
              <div>
                <div className="font-medium">Harga Adjusted</div>
                <p className="text-xs text-muted-foreground">Biaya yang dibebankan sistem per 1 juta token.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2"><Label>Input / 1M Token</Label><Input type="number" min="0" step="0.000001" value={adjustedInput} onChange={(e) => setAdjustedInput(e.target.value)} placeholder="0" /></div>
                <div className="space-y-2"><Label>Output / 1M Token</Label><Input type="number" min="0" step="0.000001" value={adjustedOutput} onChange={(e) => setAdjustedOutput(e.target.value)} placeholder="0" /></div>
              </div>
            </div>

            <div className="space-y-2 xl:col-span-2"><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Catatan internal untuk superadmin" /></div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)} disabled={submitting}><X className="mr-2 h-4 w-4" />Batal</Button>
            {isFormDirty && <Button onClick={requestSave} disabled={submitting}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : editingModelId ? <Save className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}{editingModelId ? "Simpan Perubahan" : "Simpan Model"}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingConfirm} onOpenChange={(open) => !open && setPendingConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingConfirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{pendingConfirm?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className={pendingConfirm?.variant === "destructive" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
              onClick={async () => {
                const action = pendingConfirm
                setPendingConfirm(null)
                await action?.onConfirm()
              }}
            >
              {pendingConfirm?.actionLabel || "Lanjutkan"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {grouped.map((group) => {
        const activeRows = group.rows.filter((model) => model.is_active && !model.is_read_only)
        return (
          <Card key={group.lane}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">{laneIcon(group.lane)} {group.lane.toUpperCase()}</CardTitle>
                  <CardDescription>Model aktif dan nonaktif untuk lane {group.lane}.</CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleTestMany(activeRows)} disabled={activeRows.length === 0 || activeRows.every((model) => testingModelIds.has(model.id))}>
                  <Play className="mr-2 h-4 w-4" />Test Semua Aktif
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Display Name</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Upstream</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Actual</TableHead>
                    <TableHead>Capability</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.rows.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Belum ada model di lane ini.</TableCell></TableRow>
                  ) : group.rows.map((model) => {
                    const isTesting = testingModelIds.has(model.id)
                    const priorityDraft = priorityDrafts[model.id] ?? String(model.priority ?? 100)
                    const isPriorityDirty = Number(priorityDraft) !== (model.priority ?? 100)
                    return (
                      <TableRow key={model.id}>
                        <TableCell className="font-medium">{model.display_name}</TableCell>
                        <TableCell>{model.provider?.name || model.provider_id}</TableCell>
                        <TableCell>{model.upstream_model_name}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              className="h-8 w-20"
                              value={priorityDraft}
                              disabled={model.is_read_only || savingPriorityId === model.id}
                              onChange={(event) => setPriorityDrafts((current) => ({ ...current, [model.id]: event.target.value }))}
                            />
                            {savingPriorityId === model.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                            {isPriorityDirty && !model.is_read_only && <Button size="sm" variant="outline" onClick={() => requestPrioritySave(model)} disabled={savingPriorityId === model.id}><Save className="mr-2 h-3 w-3" />Save</Button>}
                          </div>
                        </TableCell>
                        <TableCell>{formatPrice(model.actual_input_price_per_million_usd, model.actual_output_price_per_million_usd)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {model.supports_vision && <Badge variant="secondary"><Eye className="mr-1 h-3 w-3" />Image</Badge>}
                            {model.supports_audio && <Badge variant="secondary"><Mic className="mr-1 h-3 w-3" />Audio</Badge>}
                            {!model.supports_vision && !model.supports_audio && <span className="text-xs text-muted-foreground">Text only</span>}
                          </div>
                        </TableCell>
                        <TableCell>{model.is_active ? "active" : "inactive"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button size="sm" variant="outline" onClick={() => handleTest(model.id)} disabled={isTesting || !model.is_active}>
                              {isTesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                              Test
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => startEdit(model)} disabled={model.is_read_only}><Edit2 className="mr-2 h-4 w-4" />Edit</Button>
                            <Button size="sm" variant="destructive" onClick={() => requestDelete(model)} disabled={model.is_read_only || deletingModelId === model.id}>{deletingModelId === model.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}Delete</Button>
                            {testResults[model.id] && (
                              <div className={`max-w-[220px] rounded border p-2 text-xs ${testResults[model.id]?.success ? "border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300" : "border-red-200 bg-red-500/10 text-red-700 dark:border-red-900 dark:text-red-300"}`}>
                                {testResults[model.id]?.success ? `Connected · ${testResults[model.id]?.responseTime ?? 0}ms` : testResults[model.id]?.error || "Error"}
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
