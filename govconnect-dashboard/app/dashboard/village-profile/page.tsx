"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { MapPin, Save, Building2, Clock, AlertTriangle, RefreshCw, CheckCircle, AlertCircle, Loader2 } from "lucide-react"

const DAYS = [
  { key: "senin", label: "Senin" },
  { key: "selasa", label: "Selasa" },
  { key: "rabu", label: "Rabu" },
  { key: "kamis", label: "Kamis" },
  { key: "jumat", label: "Jumat" },
  { key: "sabtu", label: "Sabtu" },
  { key: "minggu", label: "Minggu" },
]

type DayHours = {
  open?: string
  close?: string
}

type OperatingHours = Record<string, DayHours>

interface EmbeddingStatus {
  knowledge_id: string
  last_edited_at: string | null
  last_embedded_at: string | null
  needs_reembed: boolean
}

export default function VillageProfilePage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [reembedding, setReembedding] = useState(false)
  const [embeddingStatus, setEmbeddingStatus] = useState<EmbeddingStatus | null>(null)

  const [form, setForm] = useState({
    name: "",
    address: "",
    gmaps_url: "",
    short_name: "",
  })

  const [operatingHours, setOperatingHours] = useState<OperatingHours>({})

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        setLoading(true)
        const response = await fetch("/api/village-profile", {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        })
        if (response.ok) {
          const data = await response.json()
          const profile = data?.data
          if (profile) {
            setForm({
              name: profile.name || "",
              address: profile.address || "",
              gmaps_url: profile.gmaps_url || "",
              short_name: profile.short_name || "",
            })
            setOperatingHours(profile.operating_hours || {})
          }
          if (data?.embedding_status) {
            setEmbeddingStatus(data.embedding_status)
          }
        }
      } catch (error) {
        console.error("Failed to load village profile:", error)
      } finally {
        setLoading(false)
      }
    }
    fetchProfile()
  }, [])

  const updateHours = (dayKey: string, field: keyof DayHours, value: string) => {
    setOperatingHours((prev) => ({
      ...prev,
      [dayKey]: {
        ...prev[dayKey],
        [field]: value,
      },
    }))
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      const response = await fetch("/api/village-profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          ...form,
          operating_hours: operatingHours,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Gagal menyimpan profil desa")
      }

      // Refresh embedding status after save
      const refreshResponse = await fetch("/api/village-profile", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      if (refreshResponse.ok) {
        const data = await refreshResponse.json()
        if (data?.embedding_status) {
          setEmbeddingStatus(data.embedding_status)
        }
      }

      toast({
        title: "Profil Desa Tersimpan",
        description: "Informasi profil desa berhasil diperbarui. Data akan di-embed otomatis ke knowledge base.",
      })
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal menyimpan profil desa",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const handleReembed = async () => {
    if (!embeddingStatus?.knowledge_id) return
    
    setReembedding(true)
    try {
      const response = await fetch(`/api/knowledge/${embeddingStatus.knowledge_id}/embed`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      })

      if (!response.ok) {
        throw new Error("Gagal melakukan re-embed")
      }

      // Refresh embedding status
      const refreshResponse = await fetch("/api/village-profile", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      if (refreshResponse.ok) {
        const data = await refreshResponse.json()
        if (data?.embedding_status) {
          setEmbeddingStatus(data.embedding_status)
        }
      }

      toast({
        title: "Re-embed Berhasil",
        description: "Data profil desa berhasil di-embed ulang ke knowledge base.",
      })
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal melakukan re-embed",
        variant: "destructive",
      })
    } finally {
      setReembedding(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Profil Desa</h1>
        <p className="text-muted-foreground mt-2">Kelola informasi profil desa untuk basis pengetahuan dan form publik.</p>
      </div>

      {/* Alert untuk status embedding */}
      {embeddingStatus && embeddingStatus.needs_reembed && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Perhatian: Data Perlu Di-embed Ulang</AlertTitle>
          <AlertDescription className="mt-2">
            <p>Profil desa telah diubah sejak terakhir kali di-embed ke knowledge base AI.</p>
            <div className="mt-2 text-sm space-y-1">
              {embeddingStatus.last_edited_at && (
                <p><strong>Terakhir diedit:</strong> {new Date(embeddingStatus.last_edited_at).toLocaleString("id-ID")}</p>
              )}
              {embeddingStatus.last_embedded_at && (
                <p><strong>Terakhir di-embed:</strong> {new Date(embeddingStatus.last_embedded_at).toLocaleString("id-ID")}</p>
              )}
            </div>
            <p className="mt-2 text-sm">
              AI chatbot mungkin memberikan informasi yang tidak akurat. Silakan klik tombol "Re-embed ke AI" untuk memperbarui knowledge base.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={handleReembed}
              disabled={reembedding}
            >
              {reembedding ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Memproses...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Re-embed ke AI
                </>
              )}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Informasi Utama
            </CardTitle>
            <CardDescription>Data identitas desa/kelurahan.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Nama Desa/Kelurahan</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Kelurahan Melati"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="short_name">Nama Singkat (Slug Form)</Label>
              <Input
                id="short_name"
                value={form.short_name}
                onChange={(e) => setForm((prev) => ({ ...prev, short_name: e.target.value }))}
                placeholder="melati"
                required
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="address">Alamat Kantor</Label>
              <Input
                id="address"
                value={form.address}
                onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="gmaps_url">Google Maps URL (Opsional)</Label>
              <Input
                id="gmaps_url"
                value={form.gmaps_url}
                onChange={(e) => setForm((prev) => ({ ...prev, gmaps_url: e.target.value }))}
                placeholder="https://maps.google.com/?q=..."
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Jam Operasional Kantor
            </CardTitle>
            <CardDescription>
              Gunakan format 24 jam (contoh 08:00 - 15:00). Isi <strong>-</strong> jika hari tersebut libur. Kosongkan jika belum ada data.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {DAYS.map((day) => (
              <div key={day.key} className="grid gap-4 md:grid-cols-3 items-center">
                <div className="text-sm font-medium text-foreground">{day.label}</div>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <Input
                    value={operatingHours[day.key]?.open || ""}
                    onChange={(e) => updateHours(day.key, "open", e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={operatingHours[day.key]?.close || ""}
                    onChange={(e) => updateHours(day.key, "close", e.target.value)}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving} className="min-w-[200px]">
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Menyimpan..." : "Simpan Profil"}
          </Button>
        </div>
      </form>
    </div>
  )
}
