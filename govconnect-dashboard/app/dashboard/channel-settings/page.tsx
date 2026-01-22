"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { Wifi, Save } from "lucide-react"

interface ChannelSettings {
  wa_number: string
  wa_token: string
  webhook_url?: string
  enabled_wa: boolean
  enabled_webchat: boolean
}

export default function ChannelSettingsPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<ChannelSettings>({
    wa_number: "",
    wa_token: "",
    webhook_url: "",
    enabled_wa: false,
    enabled_webchat: true,
  })

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        setLoading(true)
        const response = await fetch("/api/channel-settings", {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        })
        if (response.ok) {
          const data = await response.json()
          setSettings({
            wa_number: data.data?.wa_number || "",
            wa_token: data.data?.wa_token || "",
            webhook_url: data.data?.webhook_url || "",
            enabled_wa: Boolean(data.data?.enabled_wa),
            enabled_webchat: Boolean(data.data?.enabled_webchat ?? true),
          })
        }
      } catch (error) {
        console.error("Failed to load channel settings:", error)
      } finally {
        setLoading(false)
      }
    }
    fetchSettings()
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      const response = await fetch("/api/channel-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          wa_number: settings.wa_number,
          wa_token: settings.wa_token,
          enabled_wa: settings.enabled_wa,
          enabled_webchat: settings.enabled_webchat,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Gagal menyimpan pengaturan channel")
      }

      toast({
        title: "Pengaturan Tersimpan",
        description: "Pengaturan channel berhasil diperbarui.",
      })
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal menyimpan pengaturan channel",
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
        <h1 className="text-3xl font-bold text-foreground">Pengaturan Channel</h1>
        <p className="text-muted-foreground mt-2">Atur koneksi WhatsApp dan Webchat untuk desa ini.</p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wifi className="h-5 w-5" />
              Konfigurasi Channel
            </CardTitle>
            <CardDescription>1 desa hanya memiliki 1 nomor WhatsApp terhubung.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wa_number">Nomor WhatsApp</Label>
              <Input
                id="wa_number"
                value={settings.wa_number}
                onChange={(e) => setSettings((prev) => ({ ...prev, wa_number: e.target.value }))}
                placeholder="628123456789"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wa_token">Token WhatsApp</Label>
              <Input
                id="wa_token"
                value={settings.wa_token}
                onChange={(e) => setSettings((prev) => ({ ...prev, wa_token: e.target.value }))}
                placeholder="Token dari provider"
              />
            </div>
            <div className="space-y-2">
              <Label>Webhook URL (hanya baca)</Label>
              <Input value={settings.webhook_url || ""} readOnly className="bg-muted" />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Aktifkan WhatsApp</p>
                <p className="text-xs text-muted-foreground">AI akan memproses pesan WA jika aktif.</p>
              </div>
              <Switch
                checked={settings.enabled_wa}
                onCheckedChange={(value: boolean) => setSettings((prev) => ({ ...prev, enabled_wa: value }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Aktifkan Webchat</p>
                <p className="text-xs text-muted-foreground">AI akan memproses pesan Webchat jika aktif.</p>
              </div>
              <Switch
                checked={settings.enabled_webchat}
                onCheckedChange={(value: boolean) => setSettings((prev) => ({ ...prev, enabled_webchat: value }))}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving} className="min-w-[200px]">
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Menyimpan..." : "Simpan Pengaturan"}
          </Button>
        </div>
      </form>
    </div>
  )
}
