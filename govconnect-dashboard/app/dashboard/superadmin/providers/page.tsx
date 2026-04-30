"use client"

import { useCallback, useEffect, useState } from "react"
import { redirect } from "next/navigation"
import { Edit2, Loader2, Plus, Save, Server, Trash2, X } from "lucide-react"

import { useAuth } from "@/components/auth/AuthContext"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

interface ProviderRow {
  id: string
  name: string
  slug: string
  provider_kind: string
  base_url: string
  is_active: boolean
  created_at?: string
  updated_at?: string
  config_source?: "env" | "db"
  is_read_only?: boolean
  source_lane?: string
  default_headers_json?: Record<string, unknown> | null
  models?: Array<{ id: string; display_name: string; lane_type: string; is_active: boolean; config_source?: "env" | "db"; is_read_only?: boolean }>
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export default function SuperadminProvidersPage() {
  const { user } = useAuth()
  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [kind, setKind] = useState("openai_compatible")
  const [baseUrl, setBaseUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [headersJson, setHeadersJson] = useState("{}")
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [editingApiKey, setEditingApiKey] = useState(false)
  const [deletingProviderId, setDeletingProviderId] = useState<string | null>(null)

  useEffect(() => {
    if (user && user.role !== "superadmin") redirect("/dashboard")
  }, [user])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null
      const response = await fetch("/api/superadmin/providers", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || "Gagal memuat provider")
      setProviders(Array.isArray(payload?.data) ? payload.data : [])
    } catch (err: any) {
      setError(err?.message || "Gagal memuat provider")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const resetForm = () => {
    setEditingProviderId(null)
    setEditingApiKey(false)
    setName("")
    setKind("openai_compatible")
    setBaseUrl("")
    setApiKey("")
    setHeadersJson("{}")
  }

  const startEdit = (provider: ProviderRow) => {
    setEditingProviderId(provider.id)
    setEditingApiKey(false)
    setName(provider.name)
    setKind(provider.provider_kind || "openai_compatible")
    setBaseUrl(provider.base_url)
    setApiKey("")
    setHeadersJson(JSON.stringify(provider.default_headers_json || {}, null, 2))
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const handleSave = async () => {
    if (!name.trim() || !baseUrl.trim() || (!editingProviderId && !apiKey.trim())) {
      setError("Name, base URL, dan API key wajib diisi")
      return
    }

    try {
      setSubmitting(true)
      setError(null)
      setMessage(null)
      const token = localStorage.getItem("token")
      const parsedHeaders = headersJson.trim() ? JSON.parse(headersJson) : {}
      const body: Record<string, any> = {
        name: name.trim(),
        provider_kind: kind.trim(),
        base_url: baseUrl.trim(),
        default_headers_json: parsedHeaders,
      }
      if (!editingProviderId) body.slug = slugify(`${name}-${kind}`)
      if (apiKey.trim()) body.api_key = apiKey.trim()

      const response = await fetch(editingProviderId ? `/api/superadmin/providers/${encodeURIComponent(editingProviderId)}` : "/api/superadmin/providers", {
        method: editingProviderId ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || (editingProviderId ? "Gagal mengubah provider" : "Gagal membuat provider"))

      setMessage(editingProviderId ? "Provider AI berhasil diubah." : "Provider AI berhasil ditambahkan.")
      resetForm()
      await loadData()
    } catch (err: any) {
      setError(err?.message || (editingProviderId ? "Gagal mengubah provider" : "Gagal membuat provider"))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (provider: ProviderRow) => {
    if (!window.confirm(`Hapus provider ${provider.name}?`)) return

    try {
      setDeletingProviderId(provider.id)
      setError(null)
      setMessage(null)
      const token = localStorage.getItem("token")
      const response = await fetch(`/api/superadmin/providers/${encodeURIComponent(provider.id)}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || "Gagal menghapus provider")

      if (editingProviderId === provider.id) resetForm()
      setMessage("Provider AI berhasil dihapus.")
      await loadData()
    } catch (err: any) {
      setError(err?.message || "Gagal menghapus provider")
    } finally {
      setDeletingProviderId(null)
    }
  }

  if (loading) {
    return <div className="flex min-h-60 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat provider AI...</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">AI Providers</h1>
        <p className="mt-2 text-muted-foreground">Kelola gateway OpenAI-compatible yang dipakai oleh model primary dan fallback.</p>
      </div>

      {error && <Alert variant="destructive"><AlertTitle>Terjadi kesalahan</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {message && <Alert><AlertTitle>Berhasil</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Server className="h-5 w-5" /> {editingProviderId ? "Edit Provider" : "Tambah Provider"}</CardTitle>
          <CardDescription>{editingProviderId ? "Kosongkan API key jika tidak ingin mengubah secret." : "Secret API key hanya dikirim ke backend dan tidak ditampilkan lagi di dashboard."}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="provider-name">Name</Label><Input id="provider-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="OpenRouter Production" /></div>
          <div className="space-y-2"><Label htmlFor="provider-kind">Provider Kind</Label><Input id="provider-kind" value={kind} onChange={(e) => setKind(e.target.value)} placeholder="openai_compatible" /></div>
          <div className="space-y-2"><Label htmlFor="provider-base-url">Base URL</Label><Input id="provider-base-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://openrouter.ai/api/v1" /></div>
          <div className="space-y-2 lg:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="provider-api-key">API Key</Label>
              {editingProviderId && <Button type="button" size="sm" variant="ghost" onClick={() => { setEditingApiKey((value) => !value); setApiKey("") }}>{editingApiKey ? "Batal ubah key" : "Ubah key"}</Button>}
            </div>
            <Input id="provider-api-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={editingProviderId ? "Biarkan kosong jika tidak diubah" : "sk-..."} disabled={Boolean(editingProviderId && !editingApiKey)} />
          </div>
          <div className="space-y-2 lg:col-span-2"><Label htmlFor="provider-headers">Default Headers JSON</Label><Textarea id="provider-headers" value={headersJson} onChange={(e) => setHeadersJson(e.target.value)} className="min-h-[120px] font-mono text-xs" placeholder='{"HTTP-Referer":"https://govconnect"}' /></div>
          <div className="flex gap-2 lg:col-span-2">
            <Button onClick={handleSave} disabled={submitting}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : editingProviderId ? <Save className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}{editingProviderId ? "Simpan Perubahan" : "Simpan Provider"}</Button>
            {editingProviderId && <Button type="button" variant="outline" onClick={resetForm} disabled={submitting}><X className="mr-2 h-4 w-4" />Batal</Button>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Provider</CardTitle>
          <CardDescription>Model count membantu melihat provider mana yang sudah dipakai oleh lane runtime.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Base URL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Models</TableHead>
                <TableHead>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Belum ada provider AI.</TableCell></TableRow>
              ) : providers.map((provider) => (
                <TableRow key={provider.id}>
                  <TableCell className="font-medium">
                    <div>{provider.name}</div>
                    <div className="text-xs text-muted-foreground">{provider.slug}</div>
                  </TableCell>
                  <TableCell>{provider.provider_kind}</TableCell>
                  <TableCell className="max-w-[320px] truncate">{provider.base_url}</TableCell>
                  <TableCell>{provider.is_active ? "active" : "inactive"}</TableCell>
                  <TableCell>{provider.models?.length ?? 0}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => startEdit(provider)} disabled={provider.is_read_only}><Edit2 className="mr-2 h-4 w-4" />Edit</Button>
                      <Button size="sm" variant="destructive" onClick={() => handleDelete(provider)} disabled={provider.is_read_only || deletingProviderId === provider.id || (provider.models?.length ?? 0) > 0}>{deletingProviderId === provider.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}Delete</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
