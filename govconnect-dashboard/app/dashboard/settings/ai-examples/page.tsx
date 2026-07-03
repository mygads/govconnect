"use client"

import { useState, useEffect, useCallback } from "react"
import { useAuth } from "@/components/auth/AuthContext"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { fetchApi, fetchApiRaw } from "@/lib/frontend-api"
import { RefreshCw, Plus, Trash2, Brain, Lightbulb } from "lucide-react"

const INTENT_OPTIONS = [
  "service_info", "service_listing", "contact_lookup", "emergency_contact",
  "complaint_creation", "status_lookup", "cancellation", "history_lookup",
  "service_edit", "complaint_update", "knowledge_query", "greeting",
  "out_of_scope", "unknown",
]

interface NluExample {
  id: string
  village_id: string | null
  utterance: string
  correct_intent: string
  correct_category: string | null
  source_message_id: string | null
  created_by: string | null
  enabled: boolean
  created_at: string
}

interface ListResponse {
  examples: NluExample[]
  count: number
}

export default function AiExamplesPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [examples, setExamples] = useState<NluExample[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ utterance: "", correct_intent: "service_info", correct_category: "" })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = user?.village_id ? `?village_id=${encodeURIComponent(user.village_id)}` : ""
      const res = await fetchApi<ListResponse>(`/api/admin/nlu-examples${params}`)
      setExamples(res.examples || [])
    } catch (err: any) {
      toast({ title: "Gagal memuat contoh NLU", description: err?.message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [user?.village_id, toast])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    if (!form.utterance.trim()) {
      toast({ title: "Pesan wajib diisi", variant: "destructive" })
      return
    }
    setAdding(true)
    try {
      await fetchApiRaw("/api/admin/nlu-examples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          village_id: user?.village_id,
          utterance: form.utterance.trim(),
          correct_intent: form.correct_intent,
          correct_category: form.correct_category || null,
        }),
      })
      toast({ title: "Contoh NLU ditambahkan" })
      setForm({ utterance: "", correct_intent: "service_info", correct_category: "" })
      setShowForm(false)
      load()
    } catch (err: any) {
      toast({ title: "Gagal menambah contoh", description: err?.message, variant: "destructive" })
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await fetchApiRaw(`/api/admin/nlu-examples/${encodeURIComponent(id)}`, { method: "DELETE" })
      toast({ title: "Contoh dihapus" })
      setExamples((prev) => prev.filter((e) => e.id !== id))
    } catch (err: any) {
      toast({ title: "Gagal menghapus", description: err?.message, variant: "destructive" })
    }
  }

  const handleToggle = async (ex: NluExample) => {
    try {
      await fetchApiRaw(`/api/admin/nlu-examples/${encodeURIComponent(ex.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !ex.enabled }),
      })
      setExamples((prev) => prev.map((e) => e.id === ex.id ? { ...e, enabled: !e.enabled } : e))
    } catch (err: any) {
      toast({ title: "Gagal mengubah status", description: err?.message, variant: "destructive" })
    }
  }

  return (
    <div className="container mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-purple-500" />
            Contoh NLU / Self-Improvement
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ajarkan AI memahami frasa warga yang sering salah dimengerti. Contoh-contoh ini langsung dipakai classifier setiap percakapan.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Muat Ulang
          </Button>
          <Button onClick={() => setShowForm(!showForm)}>
            <Plus className="h-4 w-4 mr-2" /> Tambah Contoh
          </Button>
        </div>
      </div>

      {showForm && (
        <Card className="p-4 space-y-3 border-purple-200 bg-purple-50/30">
          <div className="flex items-center gap-2 text-sm font-medium text-purple-700">
            <Lightbulb className="h-4 w-4" />
            Tambah contoh frasa yang sering salah dimengerti AI
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2 space-y-1">
              <Label htmlFor="utterance">Pesan warga (contoh frasa)</Label>
              <Input
                id="utterance"
                placeholder='cth: "badhe damel KTP" atau "mau batalin laporan saya"'
                value={form.utterance}
                onChange={(e) => setForm({ ...form, utterance: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="intent">Intent yang benar</Label>
              <select
                id="intent"
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.correct_intent}
                onChange={(e) => setForm({ ...form, correct_intent: e.target.value })}
              >
                {INTENT_OPTIONS.map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="category">Kategori knowledge (opsional, cth: layanan_administrasi)</Label>
            <Input
              id="category"
              placeholder="layanan_administrasi, panduan-sop, kontak, faq, ..."
              value={form.correct_category}
              onChange={(e) => setForm({ ...form, correct_category: e.target.value })}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleAdd} disabled={adding}>
              {adding ? "Menyimpan..." : "Simpan Contoh"}
            </Button>
            <Button variant="outline" onClick={() => setShowForm(false)}>Batal</Button>
          </div>
        </Card>
      )}

      {loading ? (
        <p className="text-muted-foreground text-sm">Memuat...</p>
      ) : examples.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          <Brain className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p>Belum ada contoh NLU. Tambahkan frasa warga yang sering salah dimengerti AI.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {examples.map((ex) => (
            <Card key={ex.id} className={`p-3 flex items-start justify-between gap-3 ${!ex.enabled ? "opacity-50" : ""}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">"{ex.utterance}"</p>
                <div className="flex gap-2 mt-1 flex-wrap">
                  <Badge variant="outline" className="text-xs">{ex.correct_intent}</Badge>
                  {ex.correct_category && <Badge variant="secondary" className="text-xs">{ex.correct_category}</Badge>}
                  {ex.source_message_id && <Badge variant="outline" className="text-xs text-orange-600">dari failed msg</Badge>}
                  <Badge variant={ex.enabled ? "default" : "secondary"} className="text-xs">
                    {ex.enabled ? "aktif" : "nonaktif"}
                  </Badge>
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="sm" variant="outline" onClick={() => handleToggle(ex)}>
                  {ex.enabled ? "Nonaktifkan" : "Aktifkan"}
                </Button>
                <Button size="sm" variant="destructive" onClick={() => handleDelete(ex.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
