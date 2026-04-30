"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { redirect } from "next/navigation"
import { Brain, Database, Edit2, Loader2, Play, Plus, Save, Search, Trash2, Waypoints, X } from "lucide-react"

import { useAuth } from "@/components/auth/AuthContext"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

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
  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [models, setModels] = useState<ModelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [testingModelIds, setTestingModelIds] = useState<Set<string>>(new Set())
  const [savingPriorityId, setSavingPriorityId] = useState<string | null>(null)
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, any>>({})

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
  const [notes, setNotes] = useState("")

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
      setProviders(providerRows)
      setModels(Array.isArray(modelsPayload?.data) ? modelsPayload.data : [])
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

  const resetForm = () => {
    setEditingModelId(null)
    setLaneType("llm")
    setDisplayName("")
    setUpstreamModelName("")
    setEndpointPath("")
    setActualInput("")
    setActualOutput("")
    setAdjustedInput("")
    setAdjustedOutput("")
    setPriority("100")
    setIsActive("true")
    setNotes("")
    setProviderId(providers.find((provider) => !provider.is_read_only)?.id || "")
  }

  const startEdit = (model: ModelRow) => {
    setEditingModelId(model.id)
    setProviderId(model.provider_id)
    setLaneType(model.lane_type)
    setDisplayName(model.display_name)
    setUpstreamModelName(model.upstream_model_name)
    setEndpointPath(model.endpoint_path || "")
    setActualInput(priceValue(model.actual_input_price_per_million_usd))
    setActualOutput(priceValue(model.actual_output_price_per_million_usd))
    setAdjustedInput(priceValue(model.adjusted_input_price_per_million_usd))
    setAdjustedOutput(priceValue(model.adjusted_output_price_per_million_usd))
    setPriority(String(model.priority ?? 100))
    setIsActive(model.is_active ? "true" : "false")
    setNotes(model.notes || "")
    window.scrollTo({ top: 0, behavior: "smooth" })
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

  const handlePriorityChange = async (model: ModelRow, value: string) => {
    const nextPriority = Number(value)
    if (!Number.isInteger(nextPriority)) return

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
      await loadData()
    } catch (err: any) {
      setError(err?.message || "Gagal menyimpan priority")
    } finally {
      setSavingPriorityId(null)
    }
  }

  const handleSave = async () => {
    if (!providerId || !displayName.trim() || !upstreamModelName.trim()) {
      setError("Provider, display name, dan upstream model wajib diisi")
      return
    }

    try {
      setSubmitting(true)
      setError(null)
      setMessage(null)
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

      setMessage(editingModelId ? "Model AI berhasil diubah." : "Model AI berhasil ditambahkan.")
      resetForm()
      await loadData()
    } catch (err: any) {
      setError(err?.message || (editingModelId ? "Gagal mengubah model AI" : "Gagal membuat model AI"))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (model: ModelRow) => {
    if (!window.confirm(`Hapus model ${model.display_name}?`)) return

    try {
      setDeletingModelId(model.id)
      setError(null)
      setMessage(null)
      const token = localStorage.getItem("token")
      const response = await fetch(`/api/superadmin/ai-models/${encodeURIComponent(model.id)}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || "Gagal menghapus model AI")

      if (editingModelId === model.id) resetForm()
      setMessage("Model AI berhasil dihapus.")
      await loadData()
    } catch (err: any) {
      setError(err?.message || "Gagal menghapus model AI")
    } finally {
      setDeletingModelId(null)
    }
  }

  if (loading) {
    return <div className="flex min-h-60 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat model AI...</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">AI Models</h1>
        <p className="mt-2 text-muted-foreground">Kelola model DB, lane runtime, endpoint, priority, dan biaya per 1 juta token.</p>
      </div>

      {error && <Alert variant="destructive"><AlertTitle>Terjadi kesalahan</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {message && <Alert><AlertTitle>Berhasil</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">{editingModelId ? <Edit2 className="h-5 w-5" /> : <Plus className="h-5 w-5" />} {editingModelId ? "Edit Model" : "Tambah Model"}</CardTitle>
          <CardDescription>Nama model boleh mengandung kata “free”, tapi biaya tetap mengikuti harga input/output. Isi 0 hanya jika memang gratis.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-2">
            <Label>Provider</Label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger><SelectValue placeholder="Pilih provider" /></SelectTrigger>
              <SelectContent>
                {providers.filter((provider) => !provider.is_read_only).map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Lane</Label>
            <Select value={laneType} onValueChange={setLaneType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {laneOptions.map((lane) => <SelectItem key={lane} value={lane}>{lane.toUpperCase()}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>Display Name</Label><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Claude Sonnet 4.7" /></div>
          <div className="space-y-2"><Label>Upstream Model Name</Label><Input value={upstreamModelName} onChange={(e) => setUpstreamModelName(e.target.value)} placeholder="anthropic/claude-sonnet-4.7" /></div>
          <div className="space-y-2"><Label>Endpoint Path</Label><Input value={endpointPath} onChange={(e) => setEndpointPath(e.target.value)} placeholder="/chat/completions" /></div>
          <div className="grid gap-4 md:grid-cols-2">
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
          <div className="flex gap-2 xl:col-span-2">
            <Button onClick={handleSave} disabled={submitting}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : editingModelId ? <Save className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}{editingModelId ? "Simpan Perubahan" : "Simpan Model"}</Button>
            {editingModelId && <Button type="button" variant="outline" onClick={resetForm} disabled={submitting}><X className="mr-2 h-4 w-4" />Batal</Button>}
          </div>
        </CardContent>
      </Card>

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
                    <TableHead>Adjusted</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.rows.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Belum ada model di lane ini.</TableCell></TableRow>
                  ) : group.rows.map((model) => {
                    const isTesting = testingModelIds.has(model.id)
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
                              defaultValue={model.priority ?? 100}
                              disabled={model.is_read_only || savingPriorityId === model.id}
                              onBlur={(event) => handlePriorityChange(model, event.target.value)}
                            />
                            {savingPriorityId === model.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                          </div>
                        </TableCell>
                        <TableCell>{formatPrice(model.actual_input_price_per_million_usd, model.actual_output_price_per_million_usd)}</TableCell>
                        <TableCell>{formatPrice(model.adjusted_input_price_per_million_usd, model.adjusted_output_price_per_million_usd)}</TableCell>
                        <TableCell>{model.is_active ? "active" : "inactive"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button size="sm" variant="outline" onClick={() => handleTest(model.id)} disabled={isTesting || !model.is_active}>
                              {isTesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                              Test
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => startEdit(model)} disabled={model.is_read_only}><Edit2 className="mr-2 h-4 w-4" />Edit</Button>
                            <Button size="sm" variant="destructive" onClick={() => handleDelete(model)} disabled={model.is_read_only || deletingModelId === model.id}>{deletingModelId === model.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}Delete</Button>
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
