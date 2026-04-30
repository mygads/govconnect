"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { redirect } from "next/navigation"
import { Brain, Database, Loader2, Save, Search, Waypoints } from "lucide-react"

import { useAuth } from "@/components/auth/AuthContext"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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

interface ModelRow {
  id: string
  lane_type: string
  display_name: string
  upstream_model_name: string
  is_active: boolean
  priority?: number
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

type ConfirmAction = {
  title: string
  description: string
  actionLabel: string
  onConfirm: () => Promise<void> | void
}

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

export default function SuperadminLaneAssignmentsPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [models, setModels] = useState<ModelRow[]>([])
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [savingLane, setSavingLane] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, { primary_model_id: string; fallback_model_id: string }>>({})
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmAction | null>(null)

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
      setDrafts(Object.fromEntries(lanes.map((lane) => {
        const assignment = assignmentRows.find((row: AssignmentRow) => row.lane_type === lane && row.is_global_default)
        return [lane, {
          primary_model_id: assignment?.primary_model_id || "",
          fallback_model_id: assignment?.fallback_model_id || noFallbackValue,
        }]
      })))
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

  const isLaneDirty = (lane: string) => {
    const assignment = assignmentsByLane[lane]
    const draft = drafts[lane]
    if (!draft) return false
    return draft.primary_model_id !== (assignment?.primary_model_id || "") || draft.fallback_model_id !== (assignment?.fallback_model_id || noFallbackValue)
  }

  const requestSaveLane = (lane: string) => {
    const draft = drafts[lane]
    if (!draft?.primary_model_id) {
      toast({ title: "Gagal", description: `Primary model untuk lane ${lane.toUpperCase()} wajib dipilih`, variant: "destructive" })
      return
    }
    if (draft.fallback_model_id !== noFallbackValue && draft.fallback_model_id === draft.primary_model_id) {
      toast({ title: "Gagal", description: "Fallback model harus berbeda dari primary model", variant: "destructive" })
      return
    }
    if (!isLaneDirty(lane)) return

    setPendingConfirm({
      title: `Simpan assignment ${lane.toUpperCase()}?`,
      description: "Primary dan fallback model untuk lane ini akan diperbarui.",
      actionLabel: "Simpan Assignment",
      onConfirm: () => saveLane(lane),
    })
  }

  const saveLane = async (lane: string) => {
    const draft = drafts[lane]
    if (!draft?.primary_model_id) {
      toast({ title: "Gagal", description: `Primary model untuk lane ${lane.toUpperCase()} wajib dipilih`, variant: "destructive" })
      return
    }
    if (draft.fallback_model_id !== noFallbackValue && draft.fallback_model_id === draft.primary_model_id) {
      toast({ title: "Gagal", description: "Fallback model harus berbeda dari primary model", variant: "destructive" })
      return
    }

    try {
      setSavingLane(lane)
      setError(null)
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

      toast({ title: "Berhasil", description: `Assignment ${lane.toUpperCase()} berhasil disimpan.` })
      setDrafts((current) => ({
        ...current,
        [lane]: {
          primary_model_id: payload?.data?.primary_model_id || draft.primary_model_id,
          fallback_model_id: payload?.data?.fallback_model_id || noFallbackValue,
        },
      }))
      await loadData()
    } catch (err: any) {
      toast({ title: "Gagal", description: err?.message || "Gagal menyimpan lane assignment", variant: "destructive" })
    } finally {
      setSavingLane(null)
    }
  }

  if (loading) {
    return <div className="flex min-h-60 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat assignment lane...</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">AI Lane Assignments</h1>
        <p className="mt-2 text-muted-foreground">Pilih primary dan fallback model DB untuk setiap lane runtime.</p>
      </div>

      {error && <Alert variant="destructive"><AlertTitle>Terjadi kesalahan</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

      <AlertDialog open={!!pendingConfirm} onOpenChange={(open) => !open && setPendingConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingConfirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{pendingConfirm?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
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

      <div className="grid gap-6 xl:grid-cols-2">
        {lanes.map((lane) => {
          const laneModels = modelsByLane[lane] || []
          const assignment = assignmentsByLane[lane]
          const draft = drafts[lane] || { primary_model_id: "", fallback_model_id: noFallbackValue }
          const laneDirty = isLaneDirty(lane)
          return (
            <Card key={lane} className="border-border/70">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">{laneIcon(lane)} {lane.toUpperCase()}</span>
                  {assignment?.is_active && <span className="text-sm font-normal text-emerald-600">Active</span>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label>Primary Model</Label>
                  <Select value={draft.primary_model_id} onValueChange={(value) => setDrafts((current) => ({ ...current, [lane]: { ...(current[lane] || { fallback_model_id: noFallbackValue }), primary_model_id: value } }))}>
                    <SelectTrigger><SelectValue placeholder="Pilih primary model" /></SelectTrigger>
                    <SelectContent>
                      {laneModels.map((model) => <SelectItem key={model.id} value={model.id}>{model.display_name} · {model.provider?.name || model.upstream_model_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
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
                </div>

                {laneDirty && <Button onClick={() => requestSaveLane(lane)} disabled={savingLane === lane || laneModels.length === 0}>
                  {savingLane === lane ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Simpan {lane.toUpperCase()}
                </Button>}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
