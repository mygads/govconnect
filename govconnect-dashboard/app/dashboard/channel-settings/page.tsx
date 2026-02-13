"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { useToast } from "@/hooks/use-toast"
import { 
  Wifi, 
  Save, 
  RefreshCw, 
  Trash2, 
  QrCode, 
  CheckCircle, 
  XCircle,
  Smartphone,
  X,
  AlertTriangle
} from "lucide-react"

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
  qrcode?: string
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

interface DuplicateInfo {
  existingVillageId: string
  existingVillageName: string
  waNumber: string
}

export default function ChannelSettingsPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null)
  const [sessionExists, setSessionExists] = useState<boolean | null>(null)
  const [auth, setAuth] = useState<AuthMeResponse["user"] | null>(null)
  const [villages, setVillages] = useState<VillageItem[]>([])
  const [selectedVillageId, setSelectedVillageId] = useState<string | null>(null)
  const [settings, setSettings] = useState<ChannelSettings>({
    wa_number: "",
    webhook_url: "",
    enabled_wa: false,
    enabled_webchat: false,
  })

  // QR Dialog states
  const [showQrDialog, setShowQrDialog] = useState(false)
  const [qrCode, setQrCode] = useState<string>("")
  const [qrLoading, setQrLoading] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  
  // Duplicate WA number dialog states
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false)
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null)
  const [isResolvingDuplicate, setIsResolvingDuplicate] = useState(false)
  
  // Polling refs
  const statusPollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const qrPollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (statusPollingRef.current) clearInterval(statusPollingRef.current)
      if (qrPollingRef.current) clearInterval(qrPollingRef.current)
    }
  }, [])

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

  const withVillage = useCallback((path: string) => {
    if (!selectedVillageId) return path
    const joiner = path.includes("?") ? "&" : "?"
    return `${path}${joiner}village_id=${encodeURIComponent(selectedVillageId)}`
  }, [selectedVillageId])

  // Fetch session status - returns the status data
  const fetchSessionStatus = useCallback(async (): Promise<SessionStatus | null> => {
    try {
      if (!selectedVillageId) {
        setSessionStatus(null)
        setSessionExists(null)
        setQrCode("")
        return null
      }
      
      const response = await fetch(withVillage("/api/whatsapp/status"), {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      
      let data: any = null
      try {
        data = await response.json()
      } catch {
        data = null
      }

      // Session belum dibuat
      if (response.status === 404 || data?.error === 'Session belum dibuat') {
        setSessionExists(false)
        setSessionStatus(null)
        setQrCode("")
        return null
      }

      if (!response.ok) {
        setSessionStatus(null)
        setSessionExists(null)
        setQrCode("")
        return null
      }

      // Dashboard API memetakan "belum ada session" => exists=false (status 200)
      if (data?.data?.exists === false) {
        setSessionExists(false)
        setSessionStatus(null)
        setQrCode("")
        return null
      }

      setSessionExists(true)
      
      const status: SessionStatus = {
        connected: Boolean(data.data?.connected),
        loggedIn: Boolean(data.data?.loggedIn),
        jid: data.data?.jid,
        wa_number: data.data?.wa_number || "",
        qrcode: data.data?.qrcode || "",
      }
      
      setSessionStatus(status)
      
      // Update QR code if available
      if (data.data?.qrcode) {
        setQrCode(data.data.qrcode)
      }
      
      // Update wa_number in settings if available
      if (data.data?.wa_number) {
        setSettings((prev) => ({ ...prev, wa_number: data.data.wa_number }))
      }

      return status
    } catch (error) {
      console.error("Error fetching session status:", error)
      setSessionStatus(null)
      setSessionExists(null)
      setQrCode("")
      return null
    }
  }, [selectedVillageId, withVillage])

  // Fetch QR code
  const fetchQRCode = useCallback(async () => {
    try {
      setQrLoading(true)
      const response = await fetch(withVillage("/api/whatsapp/qr"), {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      
      let data: any = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      
      if (response.ok && data?.data?.QRCode) {
        setQrCode(data.data.QRCode)
      }
    } catch (error) {
      console.error("Error fetching QR code:", error)
    } finally {
      setQrLoading(false)
    }
  }, [withVillage])

  // Stop all polling
  const stopPolling = useCallback(() => {
    if (statusPollingRef.current) {
      clearInterval(statusPollingRef.current)
      statusPollingRef.current = null
    }
    if (qrPollingRef.current) {
      clearInterval(qrPollingRef.current)
      qrPollingRef.current = null
    }
  }, [])

  // Check for duplicate WA number
  const checkDuplicateWaNumber = useCallback(async (waNumber: string): Promise<DuplicateInfo | null> => {
    try {
      const response = await fetch(withVillage(`/api/whatsapp/check-duplicate?wa_number=${encodeURIComponent(waNumber)}`), {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      
      if (!response.ok) return null
      
      const data = await response.json()
      if (data?.data?.isDuplicate) {
        return {
          existingVillageId: data.data.existingVillageId,
          existingVillageName: data.data.existingVillageName || data.data.existingVillageId,
          waNumber,
        }
      }
      return null
    } catch (error) {
      console.error("Error checking duplicate WA number:", error)
      return null
    }
  }, [withVillage])

  // Handle disconnect from current account (delete session)
  const handleDisconnectCurrentAccount = async () => {
    try {
      setIsResolvingDuplicate(true)
      await handleDeleteSession()
      setShowDuplicateDialog(false)
      setDuplicateInfo(null)
      toast({
        title: "Session Dihapus",
        description: "Session WhatsApp dari akun ini telah dihapus. Silakan gunakan nomor lain.",
      })
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal menghapus session",
        variant: "destructive",
      })
    } finally {
      setIsResolvingDuplicate(false)
    }
  }

  // Handle force disconnect from other account
  const handleForceDisconnectOther = async () => {
    if (!duplicateInfo) return
    
    try {
      setIsResolvingDuplicate(true)
      const response = await fetch(withVillage("/api/whatsapp/force-disconnect"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ target_village_id: duplicateInfo.existingVillageId }),
      })

      let data: any = null
      try {
        data = await response.json()
      } catch {
        data = null
      }

      if (!response.ok) {
        throw new Error(data?.error || "Gagal memutuskan session dari akun lain")
      }

      setShowDuplicateDialog(false)
      setDuplicateInfo(null)
      toast({
        title: "Berhasil",
        description: "Session WhatsApp dari akun lain berhasil diputuskan. Nomor ini sekarang terhubung ke akun Anda.",
      })
      
      // Refresh status
      await fetchSessionStatus()
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal memutuskan session dari akun lain",
        variant: "destructive",
      })
    } finally {
      setIsResolvingDuplicate(false)
    }
  }

  // Start polling for QR dialog
  const startQrPolling = useCallback(() => {
    stopPolling()
    
    // Status polling every 1 second
    statusPollingRef.current = setInterval(async () => {
      const status = await fetchSessionStatus()
      if (status?.loggedIn && status?.wa_number) {
        console.log("[QR_DIALOG] Session logged in, checking for duplicates")
        stopPolling()
        
        // Check for duplicate WA number
        const duplicate = await checkDuplicateWaNumber(status.wa_number)
        if (duplicate) {
          console.log("[QR_DIALOG] Duplicate WA number found:", duplicate)
          setDuplicateInfo(duplicate)
          setShowDuplicateDialog(true)
        } else {
          toast({
            title: "WhatsApp Terhubung!",
            description: "Session WhatsApp berhasil terautentikasi.",
          })
        }
      }
    }, 1000)

    // QR code polling every 2 seconds
    qrPollingRef.current = setInterval(async () => {
      await fetchQRCode()
    }, 2000)
  }, [fetchSessionStatus, fetchQRCode, stopPolling, toast, checkDuplicateWaNumber])

  // Handle close QR dialog
  const handleCloseQrDialog = useCallback(() => {
    stopPolling()
    setShowQrDialog(false)
    setQrCode("")
    fetchSessionStatus()
  }, [stopPolling, fetchSessionStatus])

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
            enabled_webchat: Boolean(data.data?.enabled_webchat ?? false),
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
  }, [selectedVillageId, withVillage, fetchSessionStatus])

  // Auto-refresh session status every 15 seconds (outside QR dialog)
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    // Only auto-poll when not in QR dialog (QR dialog has its own faster polling)
    if (showQrDialog || !selectedVillageId) {
      if (autoRefreshRef.current) {
        clearInterval(autoRefreshRef.current)
        autoRefreshRef.current = null
      }
      return
    }
    autoRefreshRef.current = setInterval(() => {
      fetchSessionStatus()
    }, 15_000)
    return () => {
      if (autoRefreshRef.current) {
        clearInterval(autoRefreshRef.current)
        autoRefreshRef.current = null
      }
    }
  }, [selectedVillageId, showQrDialog, fetchSessionStatus])

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

      setQrCode("")
      toast({
        title: "Disconnected",
        description: "WhatsApp berhasil diputuskan.",
      })
      await fetchSessionStatus()
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal disconnect session",
        variant: "destructive",
      })
    } finally {
      setSessionLoading(false)
    }
  }

  // Handle View QR - Opens modal and starts polling
  const handleViewQR = async () => {
    setShowQrDialog(true)
    setQrCode("")
    setIsConnecting(true)
    
    try {
      // First try to connect the session
      const connectResponse = await fetch(withVillage("/api/whatsapp/connect"), {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })

      let connectData: any = null
      try {
        connectData = await connectResponse.json()
      } catch {
        connectData = null
      }
      
      // Handle "already connected" as success - session is connected, just need to get QR
      const alreadyConnected = connectData?.error === "already connected" || 
                               connectData?.error?.includes?.("already connected")
      
      if (!connectResponse.ok && !alreadyConnected) {
        throw new Error(connectData?.error || connectData?.message || "Gagal menghubungkan session")
      }

      // Check initial status
      const initialStatus = await fetchSessionStatus()
      
      if (initialStatus?.loggedIn) {
        toast({
          title: "Sudah Terhubung",
          description: "Session WhatsApp sudah terautentikasi.",
        })
        return
      }

      // Fetch initial QR code
      await fetchQRCode()
      
      // Start polling
      startQrPolling()
      
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal menghubungkan session",
        variant: "destructive",
      })
      setShowQrDialog(false)
    } finally {
      setIsConnecting(false)
    }
  }

  const handleDeleteSession = async () => {
    try {
      setSessionLoading(true)
      stopPolling()
      setShowQrDialog(false)
      
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
      setSessionExists(false)
      setQrCode("")
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

  // Extract phone number from JID
  const getPhoneNumber = (jid?: string) => {
    if (!jid) return null
    return jid.split('@')[0].split(':')[0]
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
            <CardDescription>Superadmin perlu memilih desa untuk mengelola koneksi WhatsApp.</CardDescription>
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
            {/* Connection Status Overview */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border p-4 space-y-2">
                <Label className="text-sm font-medium">Status Koneksi</Label>
                <div className="flex items-center gap-2">
                  {sessionStatus?.connected ? (
                    <Badge variant="default" className="bg-green-100 text-green-800">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Tersambung
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-red-100 text-red-800">
                      <XCircle className="w-3 h-3 mr-1" />
                      Tidak Tersambung
                    </Badge>
                  )}
                </div>
              </div>
              
              <div className="rounded-lg border p-4 space-y-2">
                <Label className="text-sm font-medium">Status Login</Label>
                <div className="flex items-center gap-2">
                  {sessionStatus?.loggedIn ? (
                    <Badge variant="default" className="bg-green-100 text-green-800">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Sudah Login
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                      <QrCode className="w-3 h-3 mr-1" />
                      Perlu Scan QR
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* WhatsApp Number */}
            {sessionStatus?.loggedIn && sessionStatus?.jid && (
              <div className="rounded-lg border p-4 bg-green-50">
                <div className="flex items-center gap-2 text-green-800">
                  <Smartphone className="w-4 h-4" />
                  <span className="font-medium">Nomor WhatsApp Terhubung</span>
                </div>
                <p className="text-lg font-mono mt-1 text-green-900">
                  +{getPhoneNumber(sessionStatus.jid)}
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Kelola Session</p>
                  <p className="text-xs text-muted-foreground">
                    {sessionExists === false && "Session belum dibuat"}
                    {sessionExists === true && !sessionStatus?.loggedIn && "Session siap, perlu scan QR"}
                    {sessionExists === true && sessionStatus?.loggedIn && "Session aktif dan terhubung"}
                  </p>
                </div>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm" 
                  onClick={() => fetchSessionStatus()} 
                  disabled={sessionLoading}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${sessionLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
              
              <div className="flex flex-wrap gap-2">
                {/* Session belum dibuat */}
                {(sessionExists === null || sessionExists === false) && (
                  <Button type="button" onClick={handleCreateSession} disabled={sessionLoading}>
                    <Wifi className="h-4 w-4 mr-2" />
                    Buat Session
                  </Button>
                )}

                {/* Session ada tapi belum login */}
                {sessionExists === true && !sessionStatus?.loggedIn && (
                  <>
                    <Button type="button" onClick={handleViewQR} disabled={sessionLoading}>
                      <QrCode className="h-4 w-4 mr-2" />
                      Lihat QR Code
                    </Button>
                    <Button type="button" variant="destructive" onClick={handleDeleteSession} disabled={sessionLoading}>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Hapus Session
                    </Button>
                  </>
                )}

                {/* Session ada dan sudah login */}
                {sessionExists === true && sessionStatus?.loggedIn && (
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
            </div>

            {/* Channel Toggles */}
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

      {/* QR Code Dialog */}
      <Dialog open={showQrDialog} onOpenChange={handleCloseQrDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              Autentikasi WhatsApp
            </DialogTitle>
            <DialogDescription>
              Scan QR code dengan WhatsApp untuk menghubungkan session
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Session Status in Dialog */}
            <div className="bg-muted/50 p-3 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-medium">Status Session</Label>
                {(qrLoading || isConnecting) && (
                  <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Koneksi:</span>
                  <span className={`ml-2 font-medium ${sessionStatus?.connected ? 'text-green-600' : 'text-red-600'}`}>
                    {sessionStatus?.connected ? 'Ya' : 'Tidak'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Login:</span>
                  <span className={`ml-2 font-medium ${sessionStatus?.loggedIn ? 'text-green-600' : 'text-orange-600'}`}>
                    {sessionStatus?.loggedIn ? 'Ya' : 'Menunggu'}
                  </span>
                </div>
              </div>
            </div>

            {/* Success State */}
            {sessionStatus?.loggedIn && sessionStatus?.jid && (
              <div className="bg-green-50 border border-green-200 p-4 rounded-lg text-center">
                <CheckCircle className="mx-auto h-12 w-12 text-green-600 mb-2" />
                <p className="text-green-800 font-medium">WhatsApp Terhubung!</p>
                <p className="text-green-700 text-sm mt-1">
                  Nomor: +{getPhoneNumber(sessionStatus.jid)}
                </p>
                <p className="text-green-600 text-xs mt-2">
                  Session siap digunakan. Anda bisa menutup dialog ini.
                </p>
              </div>
            )}

            {/* QR Code Display */}
            {!sessionStatus?.loggedIn && (
              <>
                {isConnecting ? (
                  <div className="text-center py-8">
                    <RefreshCw className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">Menghubungkan session...</p>
                  </div>
                ) : qrCode ? (
                  <div className="space-y-3">
                    <div className="flex justify-center p-4 bg-white rounded-lg border">
                      <img
                        src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
                        alt="WhatsApp QR Code"
                        className="w-52 h-52"
                      />
                    </div>
                    <div className="text-center space-y-1">
                      <p className="text-xs text-muted-foreground">
                        QR code diperbarui otomatis setiap 2 detik
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Buka WhatsApp &gt; Menu &gt; Linked Devices &gt; Link a Device
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <QrCode className="mx-auto h-12 w-12 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">Memuat QR code...</p>
                  </div>
                )}

                {/* Connection Required Warning */}
                {sessionStatus && !sessionStatus.connected && !isConnecting && (
                  <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg text-center">
                    <XCircle className="mx-auto h-6 w-6 text-amber-600 mb-1" />
                    <p className="text-amber-800 text-sm font-medium">Session Disconnected</p>
                    <p className="text-amber-600 text-xs">Menunggu koneksi ke server WhatsApp...</p>
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseQrDialog}>
              <X className="h-4 w-4 mr-2" />
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate WA Number Alert Dialog */}
      <AlertDialog open={showDuplicateDialog} onOpenChange={setShowDuplicateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              Nomor WhatsApp Sudah Terdaftar
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                Nomor WhatsApp <span className="font-mono font-semibold">+{duplicateInfo?.waNumber}</span> sudah terhubung ke akun desa lain:
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="font-medium text-amber-800">{duplicateInfo?.existingVillageName}</p>
              </div>
              <p className="text-sm">
                Satu nomor WhatsApp hanya dapat digunakan oleh satu akun. Pilih salah satu opsi berikut:
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel 
              onClick={handleDisconnectCurrentAccount}
              disabled={isResolvingDuplicate}
              className="w-full sm:w-auto"
            >
              {isResolvingDuplicate ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Hapus dari Akun Ini
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleForceDisconnectOther}
              disabled={isResolvingDuplicate}
              className="w-full sm:w-auto bg-amber-600 hover:bg-amber-700"
            >
              {isResolvingDuplicate ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-2" />
              )}
              Hapus dari Akun Lain & Gunakan di Sini
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
