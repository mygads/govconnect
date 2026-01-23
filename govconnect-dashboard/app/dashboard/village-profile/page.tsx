"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { MapPin, Save, Building2, Clock } from "lucide-react"

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

export default function VillageProfilePage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

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

      toast({
        title: "Profil Desa Tersimpan",
        description: "Informasi profil desa berhasil diperbarui.",
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
              <Label htmlFor="address">Alamat Lengkap</Label>
              <Input
                id="address"
                value={form.address}
                onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
                placeholder="Jl. Raya Melati No. 10"
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
              Jam Operasional
            </CardTitle>
            <CardDescription>Gunakan format 24 jam (contoh 08:00 - 15:00).</CardDescription>
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
                    placeholder="08:00"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={operatingHours[day.key]?.close || ""}
                    onChange={(e) => updateHours(day.key, "close", e.target.value)}
                    placeholder="15:00"
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
