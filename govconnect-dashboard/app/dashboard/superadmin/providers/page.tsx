"use client"

import { useCallback, useEffect, useState } from "react"
import { redirect } from "next/navigation"
import { Loader2, Plus, Server } from "lucide-react"

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
  models?: Array<{ id: string; display_name: string; lane_type: string; is_active: boolean }>
}

export default function SuperadminProvidersPage() {
  const { user } = useAuth()
  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [kind, setKind] = useState("openai_compatible")
  const [baseUrl, setBaseUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [headersJson, setHeadersJson] = useState("{}")

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

  const handleCreate = async () => {
    if (!name.trim() || !slug.trim() || !baseUrl.trim() || !apiKey.trim()) {
      setError("Name, slug, base URL, dan API key wajib diisi")
      return
    }

    try {
      setSubmitting(true)
      setError(null)
      setMessage(null)
      const token = localStorage.getItem("token")
      const parsedHeaders = headersJson.trim() ? JSON.parse(headersJson) : {}
      const response = await fetch("/api/superadmin/providers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          provider_kind: kind.trim(),
          base_url: baseUrl.trim(),
          api_key: apiKey.trim(),
          default_headers_json: parsedHeaders,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || "Gagal membuat provider")

      setMessage("Provider AI berhasil ditambahkan.")
      setName("")
      setSlug("")
      setKind("openai_compatible")
      setBaseUrl("")
      setApiKey("")
      setHeadersJson("{}")
      await loadData()
    } catch (err: any) {
      setError(err?.message || "Gagal membuat provider")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="flex min-h-[240px] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat provider AI...</div>
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
          <CardTitle className="flex items-center gap-2"><Server className="h-5 w-5" /> Tambah Provider</CardTitle>
          <CardDescription>Secret API key hanya dikirim ke backend dan tidak ditampilkan lagi di dashboard.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="provider-name">Name</Label><Input id="provider-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="OpenRouter Production" /></div>
          <div className="space-y-2"><Label htmlFor="provider-slug">Slug</Label><Input id="provider-slug" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="openrouter-prod" /></div>
          <div className="space-y-2"><Label htmlFor="provider-kind">Provider Kind</Label><Input id="provider-kind" value={kind} onChange={(e) => setKind(e.target.value)} placeholder="openai_compatible" /></div>
          <div className="space-y-2"><Label htmlFor="provider-base-url">Base URL</Label><Input id="provider-base-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://openrouter.ai/api/v1" /></div>
          <div className="space-y-2 lg:col-span-2"><Label htmlFor="provider-api-key">API Key</Label><Input id="provider-api-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." /></div>
          <div className="space-y-2 lg:col-span-2"><Label htmlFor="provider-headers">Default Headers JSON</Label><Textarea id="provider-headers" value={headersJson} onChange={(e) => setHeadersJson(e.target.value)} className="min-h-[120px] font-mono text-xs" placeholder='{"HTTP-Referer":"https://govconnect"}' /></div>
          <div className="lg:col-span-2"><Button onClick={handleCreate} disabled={submitting}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Simpan Provider</Button></div>
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
                <TableHead>Slug</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Base URL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Models</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Belum ada provider AI.</TableCell></TableRow>
              ) : providers.map((provider) => (
                <TableRow key={provider.id}>
                  <TableCell className="font-medium">{provider.name}</TableCell>
                  <TableCell>{provider.slug}</TableCell>
                  <TableCell>{provider.provider_kind}</TableCell>
                  <TableCell className="max-w-[320px] truncate">{provider.base_url}</TableCell>
                  <TableCell>{provider.is_active ? "active" : "inactive"}</TableCell>
                  <TableCell>{provider.models?.length ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
