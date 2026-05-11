"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Edit2, Loader2, Plus, Save, Server, Trash2, X } from "lucide-react"

import { useAuth } from "@/components/auth/AuthContext"
import { useToast } from "@/hooks/use-toast"
import { fetchApi } from "@/lib/frontend-api"
import { isSuperadmin } from "@/lib/rbac"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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

type ConfirmAction = {
  title: string
  description: string
  actionLabel: string
  variant?: "default" | "destructive"
  onConfirm: () => Promise<void> | void
}

type ProviderFormSnapshot = {
  name: string
  kind: string
  base_url: string
  api_key: string
  headers_json: string
}

const providerKindOptions = [
  { value: "openai_compatible", label: "OpenAI Compatible", description: "Untuk OpenRouter dan gateway lain dengan format API OpenAI." },
  { value: "openrouter", label: "OpenRouter", description: "Adapter khusus OpenRouter." },
  { value: "genfity-gateway", label: "Genfity Gateway", description: "Gateway internal Genfity." },
  { value: "direct", label: "Direct", description: "Provider direct/custom yang sudah didukung runtime." },
  { value: "sumopod", label: "Sumopod", description: "Adapter Sumopod." },
  { value: "vercel", label: "Vercel", description: "Adapter Vercel AI Gateway." },
  { value: "cloudflare", label: "Cloudflare", description: "Adapter Cloudflare AI Gateway." },
]

export default function SuperadminProvidersPage() {
    const { user } = useAuth()
    const router = useRouter()
  const { toast } = useToast()
  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmAction | null>(null)
  const [name, setName] = useState("")
  const [kind, setKind] = useState("openai_compatible")
  const [baseUrl, setBaseUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [headersJson, setHeadersJson] = useState("{}")
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [editingApiKey, setEditingApiKey] = useState(false)
  const [deletingProviderId, setDeletingProviderId] = useState<string | null>(null)
  const [formInitial, setFormInitial] = useState<ProviderFormSnapshot>({
    name: "",
    kind: "openai_compatible",
    base_url: "",
    api_key: "",
    headers_json: "{}",
  })

  useEffect(() => {
    if (user && !isSuperadmin(user.role)) router.replace("/dashboard")
  }, [user, router])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const payload = await fetchApi<any>("/api/superadmin/providers")
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

  const getFormSnapshot = (): ProviderFormSnapshot => ({
    name: name.trim(),
    kind: kind.trim(),
    base_url: baseUrl.trim(),
    api_key: apiKey.trim(),
    headers_json: headersJson.trim() || "{}",
  })

  const isFormDirty = JSON.stringify(getFormSnapshot()) !== JSON.stringify(formInitial)

  const resetForm = () => {
    setEditingProviderId(null)
    setEditingApiKey(false)
    setName("")
    setKind("openai_compatible")
    setBaseUrl("")
    setApiKey("")
    setHeadersJson("{}")
    setFormInitial({
      name: "",
      kind: "openai_compatible",
      base_url: "",
      api_key: "",
      headers_json: "{}",
    })
  }

  const startCreate = () => {
    resetForm()
    setError(null)
    setFormOpen(true)
  }

  const startEdit = (provider: ProviderRow) => {
    const snapshot = {
      name: provider.name.trim(),
      kind: (provider.provider_kind || "openai_compatible").trim(),
      base_url: provider.base_url.trim(),
      api_key: "",
      headers_json: JSON.stringify(provider.default_headers_json || {}, null, 2),
    }
    setEditingProviderId(provider.id)
    setEditingApiKey(false)
    setName(snapshot.name)
    setKind(snapshot.kind)
    setBaseUrl(snapshot.base_url)
    setApiKey("")
    setHeadersJson(snapshot.headers_json)
    setFormInitial(snapshot)
    setError(null)
    setFormOpen(true)
  }

  const requestSave = () => {
    if (!name.trim() || !baseUrl.trim() || (!editingProviderId && !apiKey.trim())) {
      toast({ title: "Gagal", description: "Name, base URL, dan API key wajib diisi", variant: "destructive" })
      return
    }
    try {
      JSON.parse(headersJson.trim() || "{}")
    } catch {
      toast({ title: "Gagal", description: "Default Headers harus berupa JSON valid", variant: "destructive" })
      return
    }
    if (!isFormDirty) return

    setPendingConfirm({
      title: editingProviderId ? "Simpan perubahan provider?" : "Tambah provider AI?",
      description: editingProviderId ? `Perubahan provider ${name.trim()} akan disimpan.` : `Provider ${name.trim()} akan ditambahkan.`,
      actionLabel: editingProviderId ? "Simpan Perubahan" : "Simpan Provider",
      onConfirm: handleSave,
    })
  }

  const handleSave = async () => {
    if (!name.trim() || !baseUrl.trim() || (!editingProviderId && !apiKey.trim()) || !isFormDirty) return

    try {
      setSubmitting(true)
      setError(null)
      const parsedHeaders = headersJson.trim() ? JSON.parse(headersJson) : {}
      const body: Record<string, any> = {
        name: name.trim(),
        provider_kind: kind.trim(),
        base_url: baseUrl.trim(),
        default_headers_json: parsedHeaders,
      }
      if (!editingProviderId) body.slug = slugify(`${name}-${kind}`)
      if (apiKey.trim()) body.api_key = apiKey.trim()

      await fetchApi<any>(editingProviderId ? `/api/superadmin/providers/${encodeURIComponent(editingProviderId)}` : "/api/superadmin/providers", {
        method: editingProviderId ? "PUT" : "POST",
        body: JSON.stringify(body),
      })

      toast({ title: "Berhasil", description: editingProviderId ? "Provider AI berhasil diubah." : "Provider AI berhasil ditambahkan." })
      resetForm()
      setFormOpen(false)
      await loadData()
    } catch (err: any) {
      toast({ title: "Gagal", description: err?.message || (editingProviderId ? "Gagal mengubah provider" : "Gagal membuat provider"), variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  const requestDelete = (provider: ProviderRow) => {
    setPendingConfirm({
      title: "Hapus provider AI?",
      description: `Provider ${provider.name} akan dihapus permanen.`,
      actionLabel: "Hapus",
      variant: "destructive",
      onConfirm: () => handleDelete(provider),
    })
  }

  const handleDelete = async (provider: ProviderRow) => {
    try {
      setDeletingProviderId(provider.id)
      setError(null)
      await fetchApi<any>(`/api/superadmin/providers/${encodeURIComponent(provider.id)}`, {
        method: "DELETE",
      })

      if (editingProviderId === provider.id) {
        resetForm()
        setFormOpen(false)
      }
      toast({ title: "Berhasil", description: "Provider AI berhasil dihapus." })
      await loadData()
    } catch (err: any) {
      toast({ title: "Gagal", description: err?.message || "Gagal menghapus provider", variant: "destructive" })
    } finally {
      setDeletingProviderId(null)
    }
  }

  if (loading) {
    return <div className="flex min-h-60 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat provider AI...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">AI Providers</h1>
          <p className="mt-2 text-muted-foreground">Kelola gateway OpenAI-compatible yang dipakai oleh model primary dan fallback.</p>
        </div>
        <Button onClick={startCreate}><Plus className="mr-2 h-4 w-4" />Tambah Provider</Button>
      </div>

      {error && <Alert variant="destructive"><AlertTitle>Terjadi kesalahan</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

      <Dialog open={formOpen} onOpenChange={(open) => { setFormOpen(open); if (!open) resetForm() }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Server className="h-5 w-5" /> {editingProviderId ? "Edit Provider" : "Tambah Provider"}</DialogTitle>
            <DialogDescription>{editingProviderId ? "Kosongkan API key jika tidak ingin mengubah secret." : "Secret API key hanya dikirim ke backend dan tidak ditampilkan lagi di dashboard."}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="provider-name">Name</Label><Input id="provider-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="OpenRouter Production" /></div>
            <div className="space-y-2">
              <Label>Adapter Runtime</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger><SelectValue placeholder="Pilih adapter runtime" /></SelectTrigger>
                <SelectContent>
                  {providerKindOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                  {kind && !providerKindOptions.some((option) => option.value === kind) && <SelectItem value={kind}>{kind} (custom lama)</SelectItem>}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Dipakai runtime untuk memilih adapter gateway. Untuk OpenRouter atau API yang kompatibel OpenAI, pilih OpenAI Compatible.</p>
            </div>
            <div className="space-y-2"><Label htmlFor="provider-base-url">Base URL</Label><Input id="provider-base-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://openrouter.ai/api/v1" /></div>
            <div className="space-y-2 lg:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="provider-api-key">API Key</Label>
                {editingProviderId && <Button type="button" size="sm" variant="ghost" onClick={() => { setEditingApiKey((value) => !value); setApiKey("") }}>{editingApiKey ? "Batal ubah key" : "Ubah key"}</Button>}
              </div>
              <Input id="provider-api-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={editingProviderId ? "Biarkan kosong jika tidak diubah" : "sk-..."} disabled={Boolean(editingProviderId && !editingApiKey)} />
            </div>
            <div className="space-y-2 lg:col-span-2"><Label htmlFor="provider-headers">Default Headers JSON</Label><Textarea id="provider-headers" value={headersJson} onChange={(e) => setHeadersJson(e.target.value)} className="min-h-[120px] font-mono text-xs" placeholder='{"HTTP-Referer":"https://govconnect"}' /></div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)} disabled={submitting}><X className="mr-2 h-4 w-4" />Batal</Button>
            {isFormDirty && <Button onClick={requestSave} disabled={submitting}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : editingProviderId ? <Save className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}{editingProviderId ? "Simpan Perubahan" : "Simpan Provider"}</Button>}
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
                <TableHead>Adapter</TableHead>
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
                      <Button size="sm" variant="destructive" onClick={() => requestDelete(provider)} disabled={provider.is_read_only || deletingProviderId === provider.id || (provider.models?.length ?? 0) > 0}>{deletingProviderId === provider.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}Delete</Button>
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
