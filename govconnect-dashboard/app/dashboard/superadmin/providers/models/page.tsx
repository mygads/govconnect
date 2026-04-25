"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { redirect } from "next/navigation"
import { Brain, Database, Loader2, Plus, Search, Waypoints } from "lucide-react"

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
  provider?: {
    id: string
    name: string
    slug: string
  }
}

const laneOptions = ["llm", "embed", "rewrite", "rerank"]
const pricingOptions = ["per_million_tokens", "fixed_per_call"]

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

function asNumber(value: string) {
  return value.trim() ? Number(value) : null
}

export default function SuperadminAIModelsPage() {
  const { user } = useAuth()
  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [models, setModels] = useState<ModelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [providerId, setProviderId] = useState("")
  const [laneType, setLaneType] = useState("llm")
  const [displayName, setDisplayName] = useState("")
  const [upstreamModelName, setUpstreamModelName] = useState("")
  const [endpointPath, setEndpointPath] = useState("")
  const [actualPricingType, setActualPricingType] = useState("per_million_tokens")
  const [actualFixed, setActualFixed] = useState("")
  const [actualInput, setActualInput] = useState("")
  const [actualOutput, setActualOutput] = useState("")
  const [adjustedPricingType, setAdjustedPricingType] = useState("per_million_tokens")
  const [adjustedFixed, setAdjustedFixed] = useState("")
  const [adjustedInput, setAdjustedInput] = useState("")
  const [adjustedOutput, setAdjustedOutput] = useState("")
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
      setProviders(providerRows)
      setModels(Array.isArray(modelsPayload?.data) ? modelsPayload.data : [])
      setProviderId((current) => current || providerRows[0]?.id || "")
    } catch (err: any) {
      setError(err?.message || "Gagal memuat model AI")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const grouped = useMemo(() => {
    return laneOptions.map((lane) => ({
      lane,
      rows: models.filter((model) => model.lane_type === lane),
    }))
  }, [models])

  const handleCreate = async () => {
    if (!providerId || !displayName.trim() || !upstreamModelName.trim()) {
      setError("Provider, display name, dan upstream model wajib diisi")
      return
    }

    try {
      setSubmitting(true)
      setError(null)
      setMessage(null)
      const token = localStorage.getItem("token")
      const response = await fetch("/api/superadmin/ai-models", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          provider_id: providerId,
          lane_type: laneType,
          display_name: displayName.trim(),
          upstream_model_name: upstreamModelName.trim(),
          endpoint_path: endpointPath.trim() || null,
          actual_pricing_type: actualPricingType,
          actual_fixed_price_usd: asNumber(actualFixed),
          actual_input_price_per_million_usd: asNumber(actualInput),
          actual_output_price_per_million_usd: asNumber(actualOutput),
          adjusted_pricing_type: adjustedPricingType,
          adjusted_fixed_price_usd: asNumber(adjustedFixed),
          adjusted_input_price_per_million_usd: asNumber(adjustedInput),
          adjusted_output_price_per_million_usd: asNumber(adjustedOutput),
          notes: notes.trim() || null,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || "Gagal membuat model AI")

      setMessage("Model AI berhasil ditambahkan.")
      setDisplayName("")
      setUpstreamModelName("")
      setEndpointPath("")
      setActualFixed("")
      setActualInput("")
      setActualOutput("")
      setAdjustedFixed("")
      setAdjustedInput("")
      setAdjustedOutput("")
      setNotes("")
      await loadData()
    } catch (err: any) {
      setError(err?.message || "Gagal membuat model AI")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="flex min-h-[240px] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat model AI...</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">AI Models</h1>
        <p className="mt-2 text-muted-foreground">Daftarkan model upstream, lane, endpoint, dan harga actual vs adjusted untuk runtime DB-backed.</p>
      </div>

      {error && <Alert variant="destructive"><AlertTitle>Terjadi kesalahan</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {message && <Alert><AlertTitle>Berhasil</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> Tambah Model</CardTitle>
          <CardDescription>Gunakan display name yang ramah admin; upstream model name tetap disimpan untuk runtime provider.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-2">
            <Label>Provider</Label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger><SelectValue placeholder="Pilih provider" /></SelectTrigger>
              <SelectContent>
                {providers.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}
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
          <div className="space-y-2 xl:col-span-2"><Label>Endpoint Path</Label><Input value={endpointPath} onChange={(e) => setEndpointPath(e.target.value)} placeholder="/chat/completions" /></div>

          <div className="rounded-lg border p-4 space-y-4">
            <div className="font-medium">Harga Actual</div>
            <div className="space-y-2"><Label>Pricing Type</Label><Select value={actualPricingType} onValueChange={setActualPricingType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{pricingOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2"><Label>Fixed USD</Label><Input type="number" step="0.000001" value={actualFixed} onChange={(e) => setActualFixed(e.target.value)} /></div>
              <div className="space-y-2"><Label>Input / 1M</Label><Input type="number" step="0.000001" value={actualInput} onChange={(e) => setActualInput(e.target.value)} /></div>
              <div className="space-y-2"><Label>Output / 1M</Label><Input type="number" step="0.000001" value={actualOutput} onChange={(e) => setActualOutput(e.target.value)} /></div>
            </div>
          </div>

          <div className="rounded-lg border p-4 space-y-4">
            <div className="font-medium">Harga Adjusted</div>
            <div className="space-y-2"><Label>Pricing Type</Label><Select value={adjustedPricingType} onValueChange={setAdjustedPricingType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{pricingOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2"><Label>Fixed USD</Label><Input type="number" step="0.000001" value={adjustedFixed} onChange={(e) => setAdjustedFixed(e.target.value)} /></div>
              <div className="space-y-2"><Label>Input / 1M</Label><Input type="number" step="0.000001" value={adjustedInput} onChange={(e) => setAdjustedInput(e.target.value)} /></div>
              <div className="space-y-2"><Label>Output / 1M</Label><Input type="number" step="0.000001" value={adjustedOutput} onChange={(e) => setAdjustedOutput(e.target.value)} /></div>
            </div>
          </div>

          <div className="space-y-2 xl:col-span-2"><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Catatan internal untuk superadmin" /></div>
          <div className="xl:col-span-2"><Button onClick={handleCreate} disabled={submitting}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Simpan Model</Button></div>
        </CardContent>
      </Card>

      {grouped.map((group) => (
        <Card key={group.lane}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">{laneIcon(group.lane)} {group.lane.toUpperCase()}</CardTitle>
            <CardDescription>Model aktif dan nonaktif untuk lane {group.lane}.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Display Name</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Upstream</TableHead>
                  <TableHead>Actual</TableHead>
                  <TableHead>Adjusted</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.rows.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Belum ada model di lane ini.</TableCell></TableRow>
                ) : group.rows.map((model) => (
                  <TableRow key={model.id}>
                    <TableCell className="font-medium">{model.display_name}</TableCell>
                    <TableCell>{model.provider?.name || model.provider_id}</TableCell>
                    <TableCell>{model.upstream_model_name}</TableCell>
                    <TableCell>{model.actual_pricing_type === "fixed_per_call" ? `$${model.actual_fixed_price_usd ?? 0}` : `$${model.actual_input_price_per_million_usd ?? 0} / $${model.actual_output_price_per_million_usd ?? 0}`}</TableCell>
                    <TableCell>{model.adjusted_pricing_type === "fixed_per_call" ? `$${model.adjusted_fixed_price_usd ?? 0}` : `$${model.adjusted_input_price_per_million_usd ?? 0} / $${model.adjusted_output_price_per_million_usd ?? 0}`}</TableCell>
                    <TableCell>{model.is_active ? "active" : "inactive"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
