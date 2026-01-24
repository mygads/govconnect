"use client"

import { useEffect, useRef, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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

interface AuthMeResponse {
  user: {
    id: string
    username: string
    name: string
    role: string
    village_id: string | null
  }
}

interface VillageItem {
  id: string
  name: string
  slug?: string
}

export default function ChannelSettingsPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null)
  const [sessionExists, setSessionExists] = useState<boolean | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [auth, setAuth] = useState<AuthMeResponse["user"] | null>(null)
  const [villages, setVillages] = useState<VillageItem[]>([])
  const [selectedVillageId, setSelectedVillageId] = useState<string | null>(null)
  const [settings, setSettings] = useState<ChannelSettings>({
    wa_number: "",
    webhook_url: "",
    enabled_wa: false,
    enabled_webchat: true,
  })

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const token = localStorage.getItem("token")
        if (!token) return

        const meRes = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!meRes.ok) return
        const meJson = (await meRes.json()) as AuthMeResponse
        setAuth(meJson.user)

        if (meJson.user.village_id) {
          setSelectedVillageId(meJson.user.village_id)
          return
        }

        if (meJson.user.role === "superadmin") {
          const vRes = await fetch("/api/superadmin/villages", {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!vRes.ok) return
          const vJson = await vRes.json()
          const list = (vJson.data || []) as VillageItem[]
          setVillages(list)
          if (list.length > 0) {
            setSelectedVillageId(list[0].id)
          }
        }
      } catch (e) {
        console.error("Failed to bootstrap channel settings:", e)
      }
    }
    bootstrap()
  }, [])

  const withVillage = (path: string) => {
    if (!selectedVillageId) return path
    const joiner = path.includes("?") ? "&" : "?"
    return `${path}${joiner}village_id=${encodeURIComponent(selectedVillageId)}`
  }

  useEffect(() => {
    const fetchSettings = async () => {
      if (!selectedVillageId) return
      try {
        setLoading(true)
        const token = localStorage.getItem("token")
        const response = await fetch(withVillage("/api/channel-settings"), {
          headers: { Authorization: `Bearer ${token}` },
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
  }, [selectedVillageId])

  const fetchSessionStatus = async () => {
    try {
      if (!selectedVillageId) {
        setSessionStatus(null)
        setSessionExists(null)
        setQrCode(null)
        return
      }
      setSessionLoading(true)
      const response = await fetch(withVillage("/api/whatsapp/status"), {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      let data: any = null
      try {
        data = await response.json()
      } catch {
        data = null
      }

      // Jika backend masih mengembalikan 404 untuk "session belum dibuat",
      // map ke state yang benar supaya UI tidak spam polling.
      if (response.status === 404 || data?.error === 'Session belum dibuat') {
        setSessionExists(false)
        setSessionStatus(null)
        setQrCode(null)
        return
      }

      if (!response.ok) {
        setSessionStatus(null)
        setSessionExists(null)
        setQrCode(null)
        return
      }

      // Dashboard API memetakan "belum ada session" => exists=false (status 200)
      if (data?.data?.exists === false) {
        setSessionExists(false)
        setSessionStatus(null)
        setQrCode(null)
        return
      }

      setSessionExists(true)
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
      setSessionExists(null)
      setQrCode(null)
    } finally {
      setSessionLoading(false)
    }
  }

  useEffect(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
    }

    // Jangan polling kalau session belum dibuat / belum diketahui
    if (!selectedVillageId || sessionExists !== true) return

    pollingRef.current = setInterval(() => {
      fetchSessionStatus()
    }, 8000)

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
    }
  }, [selectedVillageId, sessionExists])

  const handleCreateSession = async () => {
    try {
      setSessionLoading(true)
      const response = await fetch(withVillage("/api/whatsapp/session"), {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })

      let data: any = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      if (!response.ok) {
        throw new Error(data?.error || data?.message || "Gagal membuat session")
      }

      toast({
        title: "Session Siap",
        description: data.data?.existing ? "Session sudah ada. Silakan konek QR." : "Session baru dibuat. Silakan konek QR.",
      })

      setSessionExists(true)
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal membuat session",
        variant: "destructive",
      })
    } finally {
      setSessionLoading(false)
      fetchSessionStatus()
    }
  }

  const handleDisconnectSession = async () => {
    try {
      setSessionLoading(true)
      const response = await fetch(withVillage("/api/whatsapp/disconnect"), {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })

      let data: any = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      if (!response.ok) {
        throw new Error(data?.error || data?.message || "Gagal disconnect session")
      }

      setQrCode(null)
      toast({
        title: "Disconnected",
        description: "WhatsApp berhasil diputuskan.",
      })
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal disconnect session",
        variant: "destructive",
      })
    } finally {
      setSessionLoading(false)
      fetchSessionStatus()
    }
  }

  const handleConnectSession = async () => {
    try {
      setSessionLoading(true)
      const response = await fetch(withVillage("/api/whatsapp/connect"), {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })

      let data: any = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      if (!response.ok) {
        throw new Error(data?.error || data?.message || "Gagal menghubungkan session")
      }

      const qrResponse = await fetch(withVillage("/api/whatsapp/qr"), {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      let qrData: any = null
      try {
        qrData = await qrResponse.json()
      } catch {
        qrData = null
      }
      if (qrResponse.ok) {
        const qrValue = qrData?.data?.QRCode || ""
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
      const response = await fetch(withVillage("/api/whatsapp/session"), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })

      let data: any = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      if (!response.ok) {
        throw new Error(data?.error || data?.message || "Gagal menghapus session")
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
      const response = await fetch(withVillage("/api/channel-settings"), {
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
        let error: any = null
        try {
          error = await response.json()
        } catch {
          error = null
        }
        throw new Error(error?.error || error?.message || "Gagal menyimpan pengaturan channel")
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

      {auth?.role === "superadmin" && (
        <Card>
          <CardHeader>
            <CardTitle>Pilih Desa</CardTitle>
            <CardDescription>Superadmin perlu memilih desa untuk mengelola koneksi WhatsApp & webhook.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label>Desa</Label>
            <Select value={selectedVillageId || ""} onValueChange={(v) => setSelectedVillageId(v)}>
              <SelectTrigger className="w-full max-w-md">
                <SelectValue placeholder="Pilih desa" />
              </SelectTrigger>
              <SelectContent>
                {villages.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

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
                  Muat Ulang
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {(sessionExists === null || sessionExists === false) && (
                  <Button type="button" onClick={handleCreateSession} disabled={sessionLoading}>
                    <Wifi className="h-4 w-4 mr-2" />
                    Buat Session
                  </Button>
                )}

                {sessionExists === true && !sessionStatus?.connected && (
                  <>
                    <Button type="button" variant="secondary" onClick={handleConnectSession} disabled={sessionLoading}>
                      <QrCode className="h-4 w-4 mr-2" />
                      Konek & Ambil QR
                    </Button>
                    <Button type="button" variant="destructive" onClick={handleDeleteSession} disabled={sessionLoading}>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Hapus Session
                    </Button>
                  </>
                )}

                {sessionExists === true && sessionStatus?.connected && (
                  <>
                    <Button type="button" variant="outline" onClick={handleDisconnectSession} disabled={sessionLoading}>
                      <Wifi className="h-4 w-4 mr-2" />
                      Disconnect
                    </Button>
                    <Button type="button" variant="destructive" onClick={handleDeleteSession} disabled={sessionLoading}>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Hapus Session
                    </Button>
                  </>
                )}
              </div>
              {qrCode && sessionExists === true && !sessionStatus?.connected && (
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
