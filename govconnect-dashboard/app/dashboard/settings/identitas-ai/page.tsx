"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useToast } from "@/hooks/use-toast"
import { fetchApi } from "@/lib/frontend-api"
import { Bot, Save, TriangleAlert } from "lucide-react"

interface IdentityState {
  disclosure: boolean
  persona_name: string
  persona_description: string
}

export default function IdentitasAiPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<IdentityState>({
    disclosure: true,
    persona_name: "Gana",
    persona_description: "",
  })

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchApi<{ data?: { disclosure?: boolean; persona_name?: string; persona_description?: string | null } }>("/api/village-ai-identity")
        const d = res?.data
        if (d) {
          setForm({
            disclosure: d.disclosure !== false,
            persona_name: d.persona_name || "Gana",
            persona_description: d.persona_description || "",
          })
        }
      } catch (e: any) {
        toast({ title: "Gagal memuat", description: e?.message || "Tidak bisa memuat pengaturan identitas AI", variant: "destructive" })
      } finally {
        setLoading(false)
      }
    })()
  }, [toast])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await fetchApi("/api/village-ai-identity", {
        method: "PUT",
        body: JSON.stringify({
          disclosure: form.disclosure,
          persona_name: form.persona_name,
          persona_description: form.persona_description,
        }),
      })
      toast({ title: "Berhasil", description: "Pengaturan identitas AI disimpan. Berlaku maksimal ~1 menit kemudian." })
    } catch (e: any) {
      toast({ title: "Gagal menyimpan", description: e?.message || "Terjadi kesalahan", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const preview = form.disclosure
    ? `Halo! Saya ${form.persona_name || "Gana"}, asisten AI resmi layanan desa. Saya bukan petugas manusia, saya asisten AI yang siap membantu.`
    : `Halo! Saya ${form.persona_name || "Gana"}, asisten yang akan membantu Anda. Ada yang bisa saya bantu?`

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bot className="h-6 w-6" /> Identitas AI
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Atur bagaimana asisten AI memperkenalkan dirinya kepada warga desa Anda.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Transparansi identitas AI</CardTitle>
            <CardDescription>
              Saat aktif (disarankan), asisten akan menyebut dirinya sebagai asisten AI resmi dan menegaskan
              bahwa ia bukan petugas manusia. Saat dimatikan, asisten hanya memperkenalkan nama tanpa menyebut AI.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="disclosure" className="font-medium">
                Tampilkan bahwa ini adalah AI
              </Label>
              <Switch
                id="disclosure"
                checked={form.disclosure}
                onCheckedChange={(v) => setForm((f) => ({ ...f, disclosure: v }))}
                disabled={loading}
              />
            </div>
            {!form.disclosure && (
              <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>Perhatian</AlertTitle>
                <AlertDescription>
                  Menyembunyikan identitas AI tidak disarankan untuk layanan publik — warga berhak tahu
                  apakah ia berbicara dengan petugas manusia atau mesin. Perubahan ini dicatat di log aktivitas.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Persona</CardTitle>
            <CardDescription>
              Nama dan kepribadian asisten. Nama dipakai di sapaan dan seluruh percakapan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="persona_name">Nama asisten</Label>
              <Input
                id="persona_name"
                value={form.persona_name}
                onChange={(e) => setForm((f) => ({ ...f, persona_name: e.target.value }))}
                maxLength={40}
                placeholder="Gana"
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="persona_description">Deskripsi kepribadian (opsional)</Label>
              <Textarea
                id="persona_description"
                value={form.persona_description}
                onChange={(e) => setForm((f) => ({ ...f, persona_description: e.target.value }))}
                maxLength={500}
                rows={3}
                placeholder="Contoh: gunakan bahasa Jawa halus (krama), hangat dan santai seperti tetangga."
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Instruksi gaya bicara tambahan untuk asisten. Kosongkan untuk memakai bawaan (ramah, profesional, lugas).
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pratinjau sapaan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg bg-muted p-4 text-sm whitespace-pre-wrap">{loading ? "Memuat..." : preview}</div>
          </CardContent>
        </Card>

        <Button type="submit" disabled={saving || loading}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Menyimpan..." : "Simpan pengaturan"}
        </Button>
      </form>
    </div>
  )
}
