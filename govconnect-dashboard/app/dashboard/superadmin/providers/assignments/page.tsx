"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { redirect } from "next/navigation"
import { Brain, CheckCircle2, Database, Loader2, Save, Search, Waypoints } from "lucide-react"

import { useAuth } from "@/components/auth/AuthContext"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface ModelRow {
  id: string
  lane_type: string
  display_name: string
  upstream_model_name: string
  is_active: boolean
  provider?: {
    name: string
    slug: string
  }
}

interface AssignmentRow {
  id: string
  lane_type: string
  primary_model_id: string
  fallback_model_id?: string | null
  village_id?: string | null
  is_global_default: boolean
  is_active: boolean
  primary_model?: ModelRow
  fallback_model?: ModelRow | null
}

const lanes = ["llm", "embed", "rewrite", "rerank"]
const noFallbackValue = "__none__"

function laneIcon(lane: string) {
  switch (lane) {
    case "embed":
      return <Database className="h-5 w-5" />
    case "rewrite":
      return <Search className="h-5 w-5" />
    case "rerank":
      return <Waypoints className="h-5 w-5" />
    default:
      return <Brain className="h-5 w-5" />
  }
}

function modelLabel(model?: ModelRow | null) {
  if (!model) return "Belum dipilih"
  return `${model.display_name} · ${model.provider?.name || "Provider"}`
}

export default function SuperadminLaneAssignmentsPage() {
  const { user } = useAuth()
  const [models, setModels] = useState<ModelRow[]>([])
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [savingLane, setSavingLane] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, { primary_model_id: string; fallback_model_id: string }>>({})

  useEffect(() => {
    if (user && user.role !== "superadmin") redirect("/dashboard")
  }, [user])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}

      const [modelsRes, assignmentsRes] = await Promise.all([
        fetch("/api/superadmin/ai-models", { headers }),
        fetch("/api/superadmin/ai-lane-assignments", { headers }),
      ])

      const modelsPayload = await modelsRes.json()
      const assignmentsPayload = await assignmentsRes.json()
      if (!modelsRes.ok) throw new Error(modelsPayload?.error || "Gagal memuat model AI")
      if (!assignmentsRes.ok) throw new Error(assignmentsPayload?.error || "Gagal memuat assignment lane")

      const modelRows = Array.isArray(modelsPayload?.data) ? modelsPayload.data : []
      const assignmentRows = Array.isArray(assignmentsPayload?.data) ? assignmentsPayload.data : []
      setModels(modelRows)
      setAssignments(assignmentRows)
      setDrafts((current) => {
        const next = { ...current }
        for (const lane of lanes) {
          const assignment = assignmentRows.find((row: AssignmentRow) => row.lane_type === lane && row.is_global_default)
          if (!next[lane]) {
            next[lane] = {
              primary_model_id: assignment?.primary_model_id || "",
              fallback_model_id: assignment?.fallback_model_id || noFallbackValue,
            }
          }
        }
        return next
      })
    } catch (err: any) {
      setError(err?.message || "Gagal memuat assignment lane")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const modelsByLane = useMemo(() => {
    return Object.fromEntries(lanes.map((lane) => [lane, models.filter((model) => model.lane_type === lane && model.is_active)])) as Record<string, ModelRow[]>
  }, [models])

  const assignmentsByLane = useMemo(() => {
    return Object.fromEntries(lanes.map((lane) => [lane, assignments.find((row) => row.lane_type === lane && row.is_global_default) || null])) as Record<string, AssignmentRow | null>
  }, [assignments])

  const saveLane = async (lane: string) => {
    const draft = drafts[lane]
    if (!draft?.primary_model_id) {
      setError(`Primary model untuk lane ${lane.toUpperCase()} wajib dipilih`)
      return
    }
    if (draft.fallback_model_id !== noFallbackValue && draft.fallback_model_id === draft.primary_model_id) {
      setError("Fallback model harus berbeda dari primary model")
      return
    }

    try {
      setSavingLane(lane)
      setError(null)
      setMessage(null)
      const token = localStorage.getItem("token")
      const response = await fetch("/api/superadmin/ai-lane-assignments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          lane_type: lane,
          primary_model_id: draft.primary_model_id,
          fallback_model_id: draft.fallback_model_id === noFallbackValue ? null : draft.fallback_model_id,
          is_global_default: true,
          is_active: true,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || "Gagal menyimpan lane assignment")

      setMessage(`Assignment ${lane.toUpperCase()} berhasil disimpan.`)
      setDrafts((current) => ({
        ...current,
        [lane]: {
          primary_model_id: payload?.data?.primary_model_id || draft.primary_model_id,
          fallback_model_id: payload?.data?.fallback_model_id || noFallbackValue,
        },
      }))
      await loadData()
    } catch (err: any) {
      setError(err?.message || "Gagal menyimpan lane assignment")
    } finally {
      setSavingLane(null)
    }
  }

  if (loading) {
    return <div className="flex min-h-[240px] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat assignment lane...</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">AI Lane Assignments</h1>
        <p className="mt-2 text-muted-foreground">Pilih satu primary dan satu fallback opsional untuk setiap lane runtime: LLM, Embed, Rewrite, dan Rerank.</p>
      </div>

      {error && <Alert variant="destructive"><AlertTitle>Terjadi kesalahan</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {message && <Alert><AlertTitle>Berhasil</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>}

      <div className="grid gap-6 xl:grid-cols-2">
        {lanes.map((lane) => {
          const laneModels = modelsByLane[lane] || []
          const assignment = assignmentsByLane[lane]
          const draft = drafts[lane] || { primary_model_id: "", fallback_model_id: noFallbackValue }
          const primary = models.find((model) => model.id === draft.primary_model_id) || assignment?.primary_model
          const fallback = draft.fallback_model_id === noFallbackValue ? null : models.find((model) => model.id === draft.fallback_model_id) || assignment?.fallback_model

          return (
            <Card key={lane} className="border-border/70">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">{laneIcon(lane)} {lane.toUpperCase()}</span>
                  {assignment?.is_active && <span className="flex items-center gap-1 text-sm font-normal text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Active</span>}
                </CardTitle>
                <CardDescription>Assignment global default untuk lane {lane}. Village-specific override bisa ditambahkan dari API dengan village_id.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <div><span className="font-semibold">Primary saat ini:</span> {modelLabel(assignment?.primary_model)}</div>
                  <div><span className="font-semibold">Fallback saat ini:</span> {modelLabel(assignment?.fallback_model)}</div>
                </div>

                <div className="space-y-2">
                  <Label>Primary Model</Label>
                  <Select value={draft.primary_model_id} onValueChange={(value) => setDrafts((current) => ({ ...current, [lane]: { ...(current[lane] || { fallback_model_id: noFallbackValue }), primary_model_id: value } }))}>
                    <SelectTrigger><SelectValue placeholder="Pilih primary model" /></SelectTrigger>
                    <SelectContent>
                      {laneModels.map((model) => <SelectItem key={model.id} value={model.id}>{model.display_name} · {model.provider?.name || model.upstream_model_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Primary aktif: {modelLabel(primary)}</p>
                </div>

                <div className="space-y-2">
                  <Label>Fallback Model</Label>
                  <Select value={draft.fallback_model_id || noFallbackValue} onValueChange={(value) => setDrafts((current) => ({ ...current, [lane]: { ...(current[lane] || { primary_model_id: "" }), fallback_model_id: value } }))}>
                    <SelectTrigger><SelectValue placeholder="Pilih fallback model" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={noFallbackValue}>Tanpa fallback</SelectItem>
                      {laneModels.map((model) => <SelectItem key={model.id} value={model.id}>{model.display_name} · {model.provider?.name || model.upstream_model_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Fallback aktif: {modelLabel(fallback)}</p>
                </div>

                <Button onClick={() => saveLane(lane)} disabled={savingLane === lane || laneModels.length === 0}>
                  {savingLane === lane ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Simpan {lane.toUpperCase()}
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
