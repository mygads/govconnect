"use client"

import { useEffect, useRef, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { Wifi, Save, RefreshCw, Trash2, QrCode } from "lucide-react"

interface ChannelSettings {
  wa_number: string
  webhook_url?: string
  enabled_wa: boolean
  enabled_webchat: boolean
}

interface SessionStatus {
  connected: boolean
  loggedIn: boolean
  jid?: string
  wa_number?: string
}

export default function ChannelSettingsPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [settings, setSettings] = useState<ChannelSettings>({
    wa_number: "",
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
    fetchSessionStatus()
  }, [])

  const fetchSessionStatus = async () => {
    try {
      setSessionLoading(true)
      const response = await fetch("/api/whatsapp/status", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      if (!response.ok) {
        setSessionStatus(null)
        return
      }
      const data = await response.json()
      setSessionStatus({
        connected: Boolean(data.data?.connected),
        loggedIn: Boolean(data.data?.loggedIn),
        jid: data.data?.jid,
        wa_number: data.data?.wa_number || "",
      })
      if (data.data?.wa_number) {
        setSettings((prev) => ({ ...prev, wa_number: data.data.wa_number }))
      }
    } catch (error) {
      setSessionStatus(null)
    } finally {
      setSessionLoading(false)
    }
  }

  useEffect(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
    }

    pollingRef.current = setInterval(() => {
      fetchSessionStatus()
    }, 8000)

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
    }
  }, [])

  const handleCreateSession = async () => {
    try {
      setSessionLoading(true)
      const response = await fetch("/api/whatsapp/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || "Gagal membuat session")
      }

      toast({
        title: "Session Siap",
        description: data.data?.existing ? "Session sudah ada. Silakan konek QR." : "Session baru dibuat. Silakan konek QR.",
      })
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal membuat session",
        variant: "destructive",
      })
    } finally {
      setSessionLoading(false)
    }
  }

  const handleConnectSession = async () => {
    try {
      setSessionLoading(true)
      const response = await fetch("/api/whatsapp/connect", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || "Gagal menghubungkan session")
      }

      const qrResponse = await fetch("/api/whatsapp/qr", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      const qrData = await qrResponse.json()
      if (qrResponse.ok) {
        const qrValue = qrData.data?.QRCode || ""
        setQrCode(qrValue)
      }

      toast({
        title: "Session Terhubung",
        description: "Scan QR untuk login WhatsApp.",
      })
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal menghubungkan session",
        variant: "destructive",
      })
    } finally {
      setSessionLoading(false)
      fetchSessionStatus()
    }
  }

  const handleDeleteSession = async () => {
    try {
      setSessionLoading(true)
      const response = await fetch("/api/whatsapp/session", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || "Gagal menghapus session")
      }

      setSessionStatus(null)
      setQrCode(null)
      toast({
        title: "Session Dihapus",
        description: "Session WhatsApp berhasil dihapus.",
      })
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal menghapus session",
        variant: "destructive",
      })
    } finally {
      setSessionLoading(false)
    }
  }

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
        <h1 className="text-3xl font-bold text-foreground">Koneksi WhatsApp</h1>
        <p className="text-muted-foreground mt-2">Buat session WhatsApp, scan QR, dan kelola status koneksi.</p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wifi className="h-5 w-5" />
              Status Session
            </CardTitle>
            <CardDescription>Session disimpan otomatis di server dan tidak memerlukan input token manual.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wa_number">Nomor WhatsApp Terhubung</Label>
              <Input
                id="wa_number"
                value={settings.wa_number}
                readOnly
                className="bg-muted"
                placeholder="Belum terhubung"
              />
            </div>
            <div className="space-y-2">
              <Label>Webhook URL (hanya baca)</Label>
              <Input value={settings.webhook_url || ""} readOnly className="bg-muted" />
            </div>
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Status Session</p>
                  <p className="text-xs text-muted-foreground">
                    {sessionStatus?.connected ? "Tersambung" : "Belum tersambung"}
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={fetchSessionStatus} disabled={sessionLoading}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={handleCreateSession} disabled={sessionLoading}>
                  <Wifi className="h-4 w-4 mr-2" />
                  Buat Session
                </Button>
                <Button type="button" variant="secondary" onClick={handleConnectSession} disabled={sessionLoading}>
                  <QrCode className="h-4 w-4 mr-2" />
                  Konek & Ambil QR
                </Button>
                <Button type="button" variant="destructive" onClick={handleDeleteSession} disabled={sessionLoading}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Hapus Session
                </Button>
              </div>
              {qrCode && (
                <div className="rounded-lg border p-4 bg-muted/40 text-center">
                  <p className="text-xs text-muted-foreground mb-3">Scan QR untuk login WhatsApp</p>
                  <img
                    src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
                    alt="QR WhatsApp"
                    className="mx-auto w-48 h-48"
                  />
                </div>
              )}
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
