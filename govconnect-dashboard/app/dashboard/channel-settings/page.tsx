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
import { auth as authApi, superadmin as superadminApi, fetchApiRaw } from "@/lib/frontend-api"
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
  AlertTriangle,
  Clock
} from "lucide-react"

interface ObjectStorageStatus {
  configured: boolean
  connected: boolean | null
  status: "connected" | "error" | "not_configured"
  provider: string | null
  endpoint: string | null
  region: string | null
  bucket: string | null
  publicUrl: string | null
  pathStyle: boolean
  usageBytes: number | null
  usageMb: number | null
  error: string | null
}

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
  status?: string | null
  lifecycle_status?: "active" | "offline" | "qr_needed" | "logged_out" | "error" | "replaced" | "unknown" | "creating" | "created"
  reconnectable?: boolean
  requires_qr?: boolean
  problematic?: boolean
  status_fetch_ok?: boolean
}

interface WebhookAuditIssue {
  severity: "info" | "warning" | "error"
  code: string
  message: string
}

interface WebhookAudit {
  providerActiveEvents: string[]
  requiredEvents: string[]
  subscribedEvents: string[]
  missingEvents: string[]
  webhookUrl: string
  expectedWebhookUrl: string
  webhookMatches: boolean
  hmacConfigured: boolean
  dbStatus: string | null
  issues: WebhookAuditIssue[]
}

interface WaActivityItem {
  id: string
  type: string
  severity: "info" | "warning" | "error"
  status: string | null
  message: string
  provider_event: string | null
  created_at: string
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

type WhatsAppSetupStage =
  | "idle"
  | "checking_object_storage"
  | "creating_session"
  | "session_created"
  | "connecting_session"
  | "waiting_genfity_wa"
  | "waiting_whatsapp_server"
  | "fetching_qr"
  | "waiting_scan"
  | "connected"
  | "error"

const whatsappSetupSteps: Array<{ stage: WhatsAppSetupStage; label: string }> = [
  { stage: "checking_object_storage", label: "Menghubungkan object storage Cloudflare" },
  { stage: "creating_session", label: "Membuat session WhatsApp baru" },
  { stage: "waiting_genfity_wa", label: "Menunggu koneksi ke Genfity WA" },
  { stage: "waiting_whatsapp_server", label: "Menunggu koneksi ke server WhatsApp" },
  { stage: "fetching_qr", label: "Mengambil QR code" },
  { stage: "waiting_scan", label: "Menunggu QR discan" },
  { stage: "connected", label: "Berhasil terhubung" },
]

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
  const [objectStorage, setObjectStorage] = useState<ObjectStorageStatus | null>(null)
  const [setupStage, setSetupStage] = useState<WhatsAppSetupStage>("idle")
  const [setupError, setSetupError] = useState("")
  const [setupStartedAt, setSetupStartedAt] = useState<number | null>(null)
  const [stageTick, setStageTick] = useState(0)
  const [webhookAudit, setWebhookAudit] = useState<WebhookAudit | null>(null)
  const [waActivities, setWaActivities] = useState<WaActivityItem[]>([])
  const [syncingWebhook, setSyncingWebhook] = useState(false)
  const [waStatusText, setWaStatusText] = useState("")
  const [settingWaStatusText, setSettingWaStatusText] = useState(false)
  const [proxyConfig, setProxyConfig] = useState<any | null>(null)
  const [s3Status, setS3Status] = useState<any | null>(null)
  const [historyDepth, setHistoryDepth] = useState("0")
  const [historyResult, setHistoryResult] = useState<any | null>(null)
  const [syncingHistory, setSyncingHistory] = useState(false)
  const [showS3DeleteDialog, setShowS3DeleteDialog] = useState(false)
  const [testingS3, setTestingS3] = useState(false)
  const [deletingS3, setDeletingS3] = useState(false)
  const [syncingS3, setSyncingS3] = useState(false)
  const [showMaintenanceDialog, setShowMaintenanceDialog] = useState(false)
  const [repairingLifecycle, setRepairingLifecycle] = useState(false)
  const [repairingAllSessions, setRepairingAllSessions] = useState(false)
  const [repairResult, setRepairResult] = useState<any | null>(null)

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
  const setupStageRef = useRef<WhatsAppSetupStage>("idle")

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (statusPollingRef.current) clearInterval(statusPollingRef.current)
      if (qrPollingRef.current) clearInterval(qrPollingRef.current)
    }
  }, [])

  useEffect(() => {
    if (["idle", "connected", "error", "session_created"].includes(setupStage)) return
    const interval = setInterval(() => setStageTick((value) => value + 1), 1000)
    return () => clearInterval(interval)
  }, [setupStage])

  const updateSetupStage = useCallback((stage: WhatsAppSetupStage, error = "") => {
    if (setupStageRef.current !== stage) {
      setupStageRef.current = stage
      setSetupStartedAt(Date.now())
    }
    setSetupStage(stage)
    setSetupError(error)
    setStageTick((value) => value + 1)
  }, [])

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const meJson = await authApi.me()
        setAuth(meJson.user)

        if (meJson.user.village_id) {
          setSelectedVillageId(meJson.user.village_id)
          return
        }

        if (meJson.user.role === "superadmin") {
          const vJson = await superadminApi.getVillages()
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

  const fetchWebhookAudit = useCallback(async () => {
    if (!selectedVillageId) {
      setWebhookAudit(null)
      return null
    }
    try {
      const response = await fetchApiRaw(withVillage("/api/whatsapp/webhook-audit"))
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setWebhookAudit(null)
        return null
      }
      setWebhookAudit(data?.data || null)
      return data?.data || null
    } catch (error) {
      console.error("Error fetching webhook audit:", error)
      setWebhookAudit(null)
      return null
    }
  }, [selectedVillageId, withVillage])

  const fetchWaActivities = useCallback(async () => {
    if (!selectedVillageId) {
      setWaActivities([])
      return
    }
    try {
      const response = await fetchApiRaw(withVillage("/api/whatsapp/activity?limit=8"))
      const data = await response.json().catch(() => null)
      if (response.ok) setWaActivities(data?.data || [])
    } catch (error) {
      console.error("Error fetching WA activities:", error)
    }
  }, [selectedVillageId, withVillage])

  const handleSetWaStatusText = async () => {
    const text = waStatusText.trim()
    if (!text) {
      toast({ title: "Status kosong", description: "Isi teks status WhatsApp terlebih dahulu.", variant: "destructive" })
      return
    }

    try {
      setSettingWaStatusText(true)
      const response = await fetchApiRaw(withVillage("/api/whatsapp/status/text"), {
        method: "POST",
        body: JSON.stringify({ text }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.success) throw new Error(data?.error || "Gagal mengubah status WhatsApp")
      setWaStatusText("")
      await fetchWaActivities()
      toast({ title: "Status WhatsApp Diperbarui", description: "Status teks WhatsApp berhasil dikirim ke provider." })
    } catch (error: any) {
      toast({ title: "Gagal Update Status", description: error.message || "Gagal mengubah status WhatsApp", variant: "destructive" })
    } finally {
      setSettingWaStatusText(false)
    }
  }

  const handleSyncWebhook = async () => {
    try {
      setSyncingWebhook(true)
      const response = await fetchApiRaw(withVillage("/api/whatsapp/webhook-sync"), { method: "POST" })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || data?.message || "Gagal sinkron webhook")
      setWebhookAudit(data?.data || null)
      await fetchWaActivities()
      toast({
        title: "Webhook Disinkronkan",
        description: "Konfigurasi webhook/session WhatsApp sudah diperiksa dan diperbaiki jika perlu.",
      })
    } catch (error: any) {
      toast({
        title: "Gagal Sinkron",
        description: error.message || "Gagal sinkron webhook",
        variant: "destructive",
      })
    } finally {
      setSyncingWebhook(false)
    }
  }

  const fetchOperationalDetails = useCallback(async () => {
    if (!selectedVillageId) return
    try {
      const [proxyResponse, s3Response] = await Promise.all([
        fetchApiRaw(withVillage('/api/whatsapp/proxy-config')),
        fetchApiRaw(withVillage('/api/whatsapp/s3')),
      ])
      const proxyData = await proxyResponse.json().catch(() => null)
      const s3Data = await s3Response.json().catch(() => null)
      if (proxyResponse.ok) setProxyConfig(proxyData?.data || null)
      if (s3Response.ok) setS3Status(s3Data?.data || null)
    } catch (error) {
      console.error('Error fetching WA operational details:', error)
    }
  }, [selectedVillageId, withVillage])

  const handleSyncHistory = async () => {
    try {
      setSyncingHistory(true)
      const history = Math.max(0, Math.min(Number(historyDepth) || 0, 1000))
      const response = await fetchApiRaw(withVillage('/api/whatsapp/history-sync'), { method: 'POST', body: JSON.stringify({ history }) })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Gagal sync history')
      setHistoryResult(data.data || data.result || data)
      await fetchWaActivities()
      toast({ title: 'History Sync Dikirim', description: `Provider diminta sync history ${history} pesan.` })
    } catch (error: any) {
      toast({ title: 'Gagal Sync History', description: error.message || 'Gagal sync history', variant: 'destructive' })
    } finally {
      setSyncingHistory(false)
    }
  }

  const handleSyncS3 = async () => {
    try {
      setSyncingS3(true)
      const response = await fetchApiRaw(withVillage('/api/whatsapp/s3/sync'), { method: 'POST' })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Gagal sync S3 provider')
      await fetchOperationalDetails()
      await fetchWaActivities()
      toast({ title: 'S3 Provider Disinkronkan', description: 'Media WhatsApp sekarang diarahkan ke mode S3.' })
    } catch (error: any) {
      toast({ title: 'Gagal Sync S3', description: error.message || 'Gagal sync S3 provider', variant: 'destructive' })
    } finally {
      setSyncingS3(false)
    }
  }

  const handleLifecycleRepair = async () => {
    try {
      setRepairingLifecycle(true)
      const response = await fetchApiRaw(withVillage('/api/whatsapp/lifecycle-sync'), { method: 'POST' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || 'Gagal repair session')
      setRepairResult(data.data)
      await Promise.all([fetchSessionStatus(), fetchWebhookAudit(), fetchOperationalDetails(), fetchWaActivities()])
      if (data?.warning || data?.success === false) {
        toast({ title: 'Repair Session Selesai dengan Peringatan', description: 'Sebagian sinkronisasi gagal. Cek detail hasil maintenance.' })
      } else {
        toast({ title: 'Repair Session Selesai', description: 'Webhook, HMAC, status, dan S3 sudah disinkronkan.' })
      }
    } catch (error: any) {
      toast({ title: 'Gagal Repair Session', description: error.message || 'Gagal repair session', variant: 'destructive' })
    } finally {
      setRepairingLifecycle(false)
    }
  }

  const handleRepairAllSessions = async () => {
    try {
      setRepairingAllSessions(true)
      const response = await fetchApiRaw('/api/whatsapp/repair-all', { method: 'POST' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || 'Gagal repair semua session')
      setRepairResult(data.data)
      await Promise.all([fetchWebhookAudit(), fetchOperationalDetails(), fetchWaActivities()])
      if (data?.warning || data?.success === false) {
        toast({ title: 'Repair Semua Session Selesai dengan Peringatan', description: `${data.data?.count || 0} session diproses, ${data.data?.warningCount || 0} perlu dicek.` })
      } else {
        toast({ title: 'Repair Semua Session Selesai', description: `${data.data?.count || 0} session diproses.` })
      }
    } catch (error: any) {
      toast({ title: 'Gagal Repair Semua Session', description: error.message || 'Gagal repair semua session', variant: 'destructive' })
    } finally {
      setRepairingAllSessions(false)
    }
  }

  const handleTestS3 = async () => {
    try {
      setTestingS3(true)
      const response = await fetchApiRaw(withVillage('/api/whatsapp/s3/test'), { method: 'POST' })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Gagal test S3')
      await fetchOperationalDetails()
      toast({ title: 'S3 OK', description: 'Provider berhasil mengakses konfigurasi S3.' })
    } catch (error: any) {
      toast({ title: 'S3 Bermasalah', description: error.message || 'Gagal test S3', variant: 'destructive' })
    } finally {
      setTestingS3(false)
    }
  }

  const handleDeleteS3 = async () => {
    try {
      setDeletingS3(true)
      const response = await fetchApiRaw(withVillage('/api/whatsapp/s3'), { method: 'DELETE' })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Gagal hapus S3 provider')
      await fetchOperationalDetails()
      toast({ title: 'S3 Provider Dihapus', description: 'Konfigurasi S3 di provider WhatsApp sudah dihapus.' })
    } catch (error: any) {
      toast({ title: 'Gagal Hapus S3', description: error.message || 'Gagal hapus S3 provider', variant: 'destructive' })
    } finally {
      setDeletingS3(false)
    }
  }

  // Fetch session status - returns the status data
  const fetchSessionStatus = useCallback(async (): Promise<SessionStatus | null> => {
    try {
      if (!selectedVillageId) {
        setSessionStatus(null)
        setSessionExists(null)
        setQrCode("")
        return null
      }
      
      const response = await fetchApiRaw(withVillage("/api/whatsapp/status"))
      
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
        status: data.data?.status || null,
        lifecycle_status: data.data?.lifecycle_status,
        reconnectable: Boolean(data.data?.reconnectable),
        requires_qr: Boolean(data.data?.requires_qr),
        problematic: Boolean(data.data?.problematic),
        status_fetch_ok: data.data?.status_fetch_ok !== false,
      }
      
      setSessionStatus(status)
      if (showQrDialog) {
        if (status.loggedIn) {
          updateSetupStage("connected")
        } else if (status.connected) {
          updateSetupStage(status.qrcode ? "waiting_scan" : "fetching_qr")
        } else {
          updateSetupStage("waiting_whatsapp_server")
        }
      }

      // Update QR code if available
      if (data.data?.qrcode) {
        setQrCode(data.data.qrcode)
        if (showQrDialog && !status.loggedIn) updateSetupStage("waiting_scan")
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
  }, [selectedVillageId, withVillage, showQrDialog, updateSetupStage])

  // Fetch QR code
  const fetchQRCode = useCallback(async () => {
    try {
      setQrLoading(true)
      if (!sessionStatus?.loggedIn && !qrCode) updateSetupStage("fetching_qr")
      const response = await fetchApiRaw(withVillage("/api/whatsapp/qr"))
      
      let data: any = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      
      if (response.ok && data?.data?.QRCode) {
        setQrCode(data.data.QRCode)
        updateSetupStage("waiting_scan")
      } else if (!sessionStatus?.loggedIn) {
        updateSetupStage("waiting_whatsapp_server")
      }
    } catch (error) {
      console.error("Error fetching QR code:", error)
    } finally {
      setQrLoading(false)
    }
  }, [withVillage, sessionStatus?.loggedIn, qrCode, updateSetupStage])

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
      const response = await fetchApiRaw(withVillage(`/api/whatsapp/check-duplicate?wa_number=${encodeURIComponent(waNumber)}`))
      
      if (!response.ok) return null
      
      const data = await response.json()
      if (data?.data?.isDuplicate) {
        const existingVillageName = villages.find((village) => village.id === data.data.existingVillageId)?.name || data.data.existingVillageName || data.data.existingVillageId
        return {
          existingVillageId: data.data.existingVillageId,
          existingVillageName,
          waNumber,
        }
      }
      return null
    } catch (error) {
      console.error("Error checking duplicate WA number:", error)
      return null
    }
  }, [villages, withVillage])

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
      const response = await fetchApiRaw(withVillage("/api/whatsapp/force-disconnect"), {
        method: "POST",
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
        updateSetupStage("connected")
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
  }, [fetchSessionStatus, fetchQRCode, stopPolling, toast, checkDuplicateWaNumber, updateSetupStage])

  // Handle close QR dialog
  const handleCloseQrDialog = useCallback(() => {
    stopPolling()
    setShowQrDialog(false)
    setQrCode("")
    if (setupStage !== "connected") updateSetupStage("idle")
    fetchSessionStatus()
  }, [stopPolling, fetchSessionStatus, setupStage, updateSetupStage])

  useEffect(() => {
    const fetchSettings = async () => {
      if (!selectedVillageId) return
      try {
        setLoading(true)
        const response = await fetchApiRaw(withVillage("/api/channel-settings"))
        if (response.ok) {
          const data = await response.json()
          setSettings({
            wa_number: data.data?.wa_number || "",
            webhook_url: data.data?.webhook_url || "",
            enabled_wa: Boolean(data.data?.enabled_wa),
            enabled_webchat: Boolean(data.data?.enabled_webchat ?? false),
          })
          setObjectStorage(data.data?.object_storage || null)
        }
      } catch (error) {
        console.error("Failed to load channel settings:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchSettings()
    fetchSessionStatus()
    fetchWebhookAudit()
    fetchWaActivities()
    fetchOperationalDetails()
  }, [selectedVillageId, withVillage, fetchSessionStatus, fetchWebhookAudit, fetchWaActivities, fetchOperationalDetails])

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
      updateSetupStage("checking_object_storage")
      const settingsResponse = await fetchApiRaw(withVillage("/api/channel-settings"))
      if (settingsResponse.ok) {
        const settingsData = await settingsResponse.json()
        setObjectStorage(settingsData.data?.object_storage || null)
      }
      updateSetupStage("creating_session")
      const response = await fetchApiRaw(withVillage("/api/whatsapp/session"), {
        method: "POST",
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
      updateSetupStage("session_created")
    } catch (error: any) {
      updateSetupStage("error", error.message || "Gagal membuat session")
      toast({
        title: "Gagal",
        description: error.message || "Gagal membuat session",
        variant: "destructive",
      })
    } finally {
      setSessionLoading(false)
      fetchSessionStatus()
      fetchWebhookAudit()
      fetchWaActivities()
    }
  }

  const handleDisconnectSession = async () => {
    try {
      setSessionLoading(true)
      const response = await fetchApiRaw(withVillage("/api/whatsapp/disconnect"), {
        method: "POST",
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

  const handleLogoutSession = async () => {
    try {
      setSessionLoading(true)
      stopPolling()
      setShowQrDialog(false)
      const response = await fetchApiRaw(withVillage("/api/whatsapp/logout"), {
        method: "POST",
      })

      let data: any = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      if (!response.ok) {
        throw new Error(data?.error || data?.message || "Gagal logout session")
      }

      setQrCode("")
      toast({
        title: "Logout berhasil",
        description: "Session WhatsApp logout. QR perlu discan ulang untuk login.",
      })
      await fetchSessionStatus()
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal logout session",
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
    updateSetupStage("connecting_session")

    try {
      // First try to connect the session
      const connectResponse = await fetchApiRaw(withVillage("/api/whatsapp/connect"), {
        method: "POST",
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

      updateSetupStage("waiting_genfity_wa")

      // Check initial status
      const initialStatus = await fetchSessionStatus()

      if (initialStatus?.loggedIn) {
        updateSetupStage("connected")
        toast({
          title: "Sudah Terhubung",
          description: "Session WhatsApp sudah terautentikasi.",
        })
        return
      }

      if (!initialStatus?.connected) updateSetupStage("waiting_whatsapp_server")

      // Fetch initial QR code
      updateSetupStage("fetching_qr")
      await fetchQRCode()

      // Start polling
      startQrPolling()

    } catch (error: any) {
      updateSetupStage("error", error.message || "Gagal menghubungkan session")
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
      
      const response = await fetchApiRaw(withVillage("/api/whatsapp/session"), {
        method: "DELETE",
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

  const getLifecycleStatus = () => {
    if (!sessionExists) return "none"
    if (sessionStatus?.lifecycle_status) return sessionStatus.lifecycle_status
    if (sessionStatus?.loggedIn && sessionStatus?.connected) return "active"
    if (sessionStatus?.loggedIn && !sessionStatus?.connected) return "offline"
    if (sessionStatus?.qrcode || sessionStatus?.requires_qr) return "qr_needed"
    return "unknown"
  }

  const getSessionDisplay = () => {
    const lifecycle = getLifecycleStatus()
    if (lifecycle === "active") {
      return {
        title: "WhatsApp aktif",
        description: sessionStatus?.jid ? `+${getPhoneNumber(sessionStatus.jid)}` : "Session WhatsApp aktif.",
        badge: "Terhubung",
        iconClass: "bg-green-100 text-green-700",
        badgeClass: "bg-green-100 text-green-800",
        icon: <CheckCircle className="h-5 w-5" />,
      }
    }
    if (lifecycle === "offline") {
      return {
        title: "Session tersimpan, sedang offline",
        description: "Auth WhatsApp masih ada. Klik Reconnect untuk menyambungkan tanpa QR.",
        badge: "Offline",
        iconClass: "bg-amber-100 text-amber-700",
        badgeClass: "bg-amber-100 text-amber-800",
        icon: <Wifi className="h-5 w-5" />,
      }
    }
    if (lifecycle === "qr_needed") {
      return {
        title: "Menunggu scan QR",
        description: "Scan QR untuk login ulang WhatsApp.",
        badge: "Perlu QR",
        iconClass: "bg-blue-100 text-blue-700",
        badgeClass: "bg-blue-100 text-blue-800",
        icon: <QrCode className="h-5 w-5" />,
      }
    }
    if (lifecycle === "logged_out") {
      return {
        title: "WhatsApp logout",
        description: "Akun sudah logout. Perlu scan QR ulang.",
        badge: "Logout",
        iconClass: "bg-red-100 text-red-700",
        badgeClass: "bg-red-100 text-red-800",
        icon: <Wifi className="h-5 w-5" />,
      }
    }
    if (lifecycle === "error" || lifecycle === "replaced") {
      return {
        title: lifecycle === "replaced" ? "Session digantikan" : "Session bermasalah",
        description: lifecycle === "replaced" ? "Stream WhatsApp digantikan koneksi lain." : "Provider melaporkan error session WhatsApp.",
        badge: lifecycle === "replaced" ? "Replaced" : "Error",
        iconClass: "bg-red-100 text-red-700",
        badgeClass: "bg-red-100 text-red-800",
        icon: <Wifi className="h-5 w-5" />,
      }
    }
    if (sessionExists) {
      return {
        title: "Status belum bisa dipastikan",
        description: "Provider belum bisa dicek. Jangan logout atau hapus session jika belum yakin.",
        badge: "Unknown",
        iconClass: "bg-muted text-muted-foreground",
        badgeClass: "",
        icon: <Wifi className="h-5 w-5" />,
      }
    }
    return {
      title: "WhatsApp belum terhubung",
      description: "Buat session untuk menghubungkan nomor WhatsApp.",
      badge: "Belum Aktif",
      iconClass: "bg-muted text-muted-foreground",
      badgeClass: "",
      icon: <Wifi className="h-5 w-5" />,
    }
  }

  const getObjectStorageSetupText = () => {
    if (!objectStorage) return "Mengecek koneksi object storage Cloudflare..."
    if (objectStorage.status === "connected") return `Object storage Cloudflare terhubung${objectStorage.bucket ? ` ke bucket ${objectStorage.bucket}` : ""}.`
    if (objectStorage.status === "not_configured") return "Object storage Cloudflare belum dikonfigurasi. Session tetap dibuat, tetapi media WhatsApp bisa terbatas."
    return `Object storage Cloudflare bermasalah${objectStorage.error ? `: ${objectStorage.error}` : "."}`
  }

  const getSetupMessage = (stage: WhatsAppSetupStage = setupStage) => {
    switch (stage) {
      case "checking_object_storage": return getObjectStorageSetupText()
      case "creating_session": return "Membuat session WhatsApp baru..."
      case "session_created": return "Session sudah dibuat. Klik Lihat QR Code untuk lanjut menghubungkan ke Genfity WA dan server WhatsApp."
      case "connecting_session": return "Menghubungkan session ke Genfity WA..."
      case "waiting_genfity_wa": return "Menunggu koneksi ke Genfity WA..."
      case "waiting_whatsapp_server": return "Menunggu koneksi ke server WhatsApp..."
      case "fetching_qr": return "Mengambil QR code dari server WhatsApp..."
      case "waiting_scan": return "QR code siap. Menunggu QR discan dari WhatsApp."
      case "connected": return "Berhasil terhubung. Session WhatsApp siap digunakan."
      case "error": return setupError || "Terjadi kendala saat menyiapkan session WhatsApp."
      default: return sessionExists === false ? "Session WhatsApp belum dibuat." : "Menunggu status session WhatsApp."
    }
  }

  const getSetupHint = (stage: WhatsAppSetupStage = setupStage) => {
    const elapsed = setupStartedAt ? Date.now() - setupStartedAt : 0
    if (stage === "idle" && sessionExists !== false) return "Refresh status jika session baru saja dibuat dari proses lain."
    if (stage === "session_created") return "Progress berikutnya akan berjalan saat tombol Lihat QR Code ditekan."
    if (stage === "checking_object_storage" && objectStorage?.status === "error") return "Session akan tetap dicoba dibuat, tetapi pengiriman atau penerimaan media WhatsApp bisa gagal sampai storage diperbaiki."
    if (stage === "checking_object_storage" && objectStorage?.status === "not_configured") return "Konfigurasi S3/R2 diperlukan untuk media WhatsApp, terutama gambar, dokumen, dan file session yang disimpan di storage."
    if (stage === "waiting_genfity_wa" && elapsed > 15_000) return "Masih menyiapkan session di Genfity WA. Proses ini bisa sedikit lebih lama saat service baru aktif."
    if (stage === "waiting_whatsapp_server" && elapsed > 30_000) return "Server WhatsApp belum mengirim QR. Sistem akan mengambil QR otomatis saat tersedia."
    if (stage === "fetching_qr") return "Jika QR belum muncul, halaman ini akan mencoba mengambil ulang otomatis."
    return ""
  }

  const getStepState = (stage: WhatsAppSetupStage, visibleStage: WhatsAppSetupStage = setupStage) => {
    const currentIndex = whatsappSetupSteps.findIndex((step) => step.stage === visibleStage)
    const stepIndex = whatsappSetupSteps.findIndex((step) => step.stage === stage)
    if (visibleStage === "idle") return "pending"
    if (visibleStage === "session_created" && (stage === "checking_object_storage" || stage === "creating_session")) return "done"
    if (visibleStage === "connected") return "done"
    if (visibleStage === "error" && stepIndex === Math.max(currentIndex, 0)) return "error"
    if (stepIndex < currentIndex) return "done"
    if (stepIndex === currentIndex) return "active"
    return "pending"
  }

  const getAuditSeverity = () => {
    if (!webhookAudit) return "unknown"
    if (webhookAudit.issues.some((issue) => issue.severity === "error")) return "error"
    if (webhookAudit.issues.some((issue) => issue.severity === "warning")) return "warning"
    return "ok"
  }

  const formatActivityTime = (value: string) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return "-"
    return date.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
  }

  const humanizeCode = (value?: string | null) => {
    if (!value) return "-"
    return value
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  }

  const formatS3Mode = (value?: string | null) => {
    if (value === "s3") return "S3/R2"
    if (value === "both") return "S3/R2 + Base64"
    if (value === "base64") return "Base64"
    return "-"
  }

  const formatProviderAvailability = () => {
    if (s3Status?.provider?.error) return "bermasalah"
    if (s3Status?.provider) return "tersedia"
    return "belum ada"
  }

  const formatActivityMeta = (activity: WaActivityItem) => {
    const parts = [humanizeCode(activity.type)]
    if (activity.status) parts.push(humanizeCode(activity.status))
    if (activity.provider_event) parts.push(humanizeCode(activity.provider_event))
    return parts.join(" · ")
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      const response = await fetchApiRaw(withVillage("/api/channel-settings"), {
        method: "PUT",
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

  const isSuperadmin = auth?.role === "superadmin"
  const sessionDisplay = getSessionDisplay()
  const lifecycleStatus = getLifecycleStatus()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Koneksi WhatsApp</h1>
        <p className="text-muted-foreground mt-2">Buat session WhatsApp, scan QR, dan kelola status koneksi.</p>
      </div>

      {isSuperadmin && (
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
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Wifi className="h-5 w-5" />
                  Status Session
                </CardTitle>
                <CardDescription>Session disimpan otomatis di server dan tidak memerlukan input token manual.</CardDescription>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => fetchSessionStatus()} disabled={sessionLoading} title="Refresh status" aria-label="Refresh status">
                <RefreshCw className={`h-4 w-4 ${sessionLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-full ${sessionDisplay.iconClass}`}>
                    {sessionDisplay.icon}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{sessionDisplay.title}</p>
                    <p className="text-xs text-muted-foreground">{sessionDisplay.description}</p>
                  </div>
                </div>
                <Badge variant="secondary" className={sessionDisplay.badgeClass}>
                  {sessionDisplay.badge}
                </Badge>
              </div>
            </div>

            {sessionExists === true && (lifecycleStatus === "offline" || lifecycleStatus === "logged_out" || lifecycleStatus === "error" || lifecycleStatus === "replaced" || lifecycleStatus === "unknown") && (
              <div className={`rounded-lg border p-3 text-sm ${lifecycleStatus === "offline" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-900"}`}>
                {lifecycleStatus === "offline" && "Session auth masih tersimpan, tetapi koneksi ke WhatsApp sedang offline. Gunakan Reconnect agar tersambung lagi tanpa scan QR."}
                {lifecycleStatus === "logged_out" && "Session sudah logout dari WhatsApp. Anda perlu scan QR ulang untuk login kembali."}
                {lifecycleStatus === "error" && "Provider melaporkan error pada session WhatsApp. Periksa audit atau lakukan reconnect manual."}
                {lifecycleStatus === "replaced" && "Session WhatsApp digantikan oleh koneksi lain. Pastikan hanya ada satu koneksi aktif untuk nomor ini."}
                {lifecycleStatus === "unknown" && "Status provider belum dapat dipastikan. Hindari menghapus session sebelum memastikan kondisi provider."}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {(sessionExists === null || sessionExists === false) && (
                <Button type="button" onClick={handleCreateSession} disabled={sessionLoading}>
                  {sessionLoading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Wifi className="h-4 w-4 mr-2" />}
                  {sessionLoading ? getSetupMessage() : "Hubungkan WhatsApp"}
                </Button>
              )}
              {sessionExists === true && (lifecycleStatus === "offline" || lifecycleStatus === "active" || lifecycleStatus === "unknown" || lifecycleStatus === "error" || lifecycleStatus === "replaced") && (
                <Button type="button" onClick={handleViewQR} disabled={sessionLoading}>
                  <Wifi className="h-4 w-4 mr-2" />
                  {lifecycleStatus === "offline" ? "Reconnect" : "Connect"}
                </Button>
              )}
              {sessionExists === true && (lifecycleStatus === "qr_needed" || lifecycleStatus === "logged_out") && (
                <Button type="button" onClick={handleViewQR} disabled={sessionLoading}>
                  <QrCode className="h-4 w-4 mr-2" />
                  Scan QR
                </Button>
              )}
              {sessionExists === true && (lifecycleStatus === "active" || lifecycleStatus === "offline") && (
                <Button type="button" variant="outline" onClick={handleDisconnectSession} disabled={sessionLoading}>
                  <Wifi className="h-4 w-4 mr-2" />
                  Disconnect sementara
                </Button>
              )}
              {sessionExists === true && (
                <Button type="button" variant="outline" onClick={handleLogoutSession} disabled={sessionLoading}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Logout & reset
                </Button>
              )}
              {sessionExists === true && (
                <Button type="button" variant="destructive" onClick={handleDeleteSession} disabled={sessionLoading}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Hapus session
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => setShowMaintenanceDialog(true)} disabled={!sessionExists}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Maintenance
              </Button>
            </div>

            {isSuperadmin && sessionExists === true && sessionStatus?.loggedIn && (
              <div className="rounded-lg border p-4 space-y-3">
                <div>
                  <p className="text-sm font-medium">Status Teks WhatsApp</p>
                  <p className="text-xs text-muted-foreground">Update status teks operasional untuk nomor WhatsApp desa.</p>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={waStatusText}
                    onChange={(event) => setWaStatusText(event.target.value)}
                    placeholder="Contoh: Layanan desa aktif Senin-Jumat 08.00-15.00"
                    maxLength={700}
                  />
                  <Button type="button" variant="outline" onClick={handleSetWaStatusText} disabled={settingWaStatusText || !waStatusText.trim()}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${settingWaStatusText ? "animate-spin" : ""}`} />
                    Set Status
                  </Button>
                </div>
              </div>
            )}

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

        {isSuperadmin && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                Webhook & Session Sync
              </CardTitle>
              <CardDescription>Audit konfigurasi provider, event webhook, dan HMAC session WhatsApp.</CardDescription>
            </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                {getAuditSeverity() === "ok" && <Badge className="bg-green-100 text-green-800">Audit OK</Badge>}
                {getAuditSeverity() === "warning" && <Badge className="bg-amber-100 text-amber-800">Ada Warning</Badge>}
                {getAuditSeverity() === "error" && <Badge className="bg-red-100 text-red-800">Ada Error</Badge>}
                {getAuditSeverity() === "unknown" && <Badge variant="secondary">Belum Diaudit</Badge>}
                {webhookAudit && <span className="text-xs text-muted-foreground">DB: {webhookAudit.dbStatus || "-"}</span>}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={fetchWebhookAudit} disabled={!selectedVillageId || syncingWebhook}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Audit
                </Button>
                <Button type="button" size="sm" onClick={handleSyncWebhook} disabled={!selectedVillageId || syncingWebhook}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${syncingWebhook ? "animate-spin" : ""}`} />
                  Sync Webhook
                </Button>
              </div>
            </div>

            {webhookAudit && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="rounded-lg border p-3">
                  <p className="text-muted-foreground">Required / Subscribed</p>
                  <p className="font-semibold">{webhookAudit.requiredEvents.length} / {webhookAudit.subscribedEvents.length}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-muted-foreground">Missing Events</p>
                  <p className={webhookAudit.missingEvents.length ? "font-semibold text-amber-700" : "font-semibold text-green-700"}>{webhookAudit.missingEvents.length}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-muted-foreground">Webhook / HMAC</p>
                  <p className="font-semibold">{webhookAudit.webhookMatches ? "URL OK" : "URL mismatch"} · {webhookAudit.hmacConfigured ? "HMAC OK" : "HMAC belum ada"}</p>
                </div>
              </div>
            )}

            {webhookAudit?.missingEvents?.length ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Event belum aktif: {webhookAudit.missingEvents.join(", ")}
              </div>
            ) : null}

            {webhookAudit?.issues?.length ? (
              <div className="space-y-2">
                {webhookAudit.issues.slice(0, 4).map((issue) => (
                  <div key={`${issue.code}-${issue.message}`} className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                    <AlertTriangle className={`mt-0.5 h-4 w-4 ${issue.severity === "error" ? "text-red-600" : "text-amber-600"}`} />
                    <div>
                      <p className="font-medium">{issue.message}</p>
                      <p className="text-xs text-muted-foreground">{issue.code}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-lg border p-3 text-sm">
                <p className="font-medium">Proxy Gateway</p>
                <p className="text-muted-foreground">Mode: {proxyConfig?.gateway || '-'}</p>
                <p className="text-muted-foreground">Instance: {proxyConfig?.instanceName || '-'}</p>
                <p className="text-muted-foreground">Session: {proxyConfig?.sessionId || '-'}</p>
              </div>
              <div className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">History Sync</p>
                    <p className="text-muted-foreground">Jumlah history yang diminta dari provider (0 = tidak import history lama).</p>
                    {historyResult && (
                      <pre className="mt-2 max-h-24 overflow-auto rounded bg-muted p-2 text-[11px] text-muted-foreground">{JSON.stringify(historyResult, null, 2)}</pre>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input className="w-24" type="number" min={0} max={1000} value={historyDepth} onChange={(event) => setHistoryDepth(event.target.value)} />
                    <Button type="button" variant="outline" size="sm" onClick={handleSyncHistory} disabled={syncingHistory}>
                      <RefreshCw className={`h-4 w-4 mr-2 ${syncingHistory ? "animate-spin" : ""}`} />
                      Sync
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border p-3 text-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">S3 Provider WhatsApp</p>
                    <Badge className={s3Status?.local?.media_delivery === 's3' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}>
                      Lokal: {formatS3Mode(s3Status?.local?.media_delivery)}
                    </Badge>
                    <Badge className={s3Status?.provider?.media_delivery === 's3' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}>
                      Provider: {formatS3Mode(s3Status?.provider?.media_delivery)}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">Konfigurasi lokal: {s3Status?.localConfigured ? 'siap' : 'belum siap'} · Provider: {formatProviderAvailability()}</p>
                  <p className="text-muted-foreground">Bucket: {s3Status?.local?.bucket || '-'}</p>
                  <p className="text-muted-foreground">Endpoint: {s3Status?.local?.endpoint || '-'}</p>
                  {(s3Status?.local?.media_delivery && s3Status.local.media_delivery !== 's3') || (s3Status?.provider?.media_delivery && s3Status.provider.media_delivery !== 's3') ? (
                    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <p>Mode media belum S3 penuh. Base64/both hanya untuk fallback dan debug karena payload lebih berat.</p>
                    </div>
                  ) : null}
                  {s3Status?.provider?.error && <p className="text-red-600">{s3Status.provider.error}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={fetchOperationalDetails}>Refresh</Button>
                  <Button type="button" variant="outline" size="sm" onClick={handleSyncS3} disabled={syncingS3 || !sessionExists || !s3Status?.localConfigured}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${syncingS3 ? "animate-spin" : ""}`} />Sync S3
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={handleTestS3} disabled={testingS3 || !sessionExists}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${testingS3 ? "animate-spin" : ""}`} />Test
                  </Button>
                  <Button type="button" variant="destructive" size="sm" onClick={() => setShowS3DeleteDialog(true)} disabled={deletingS3 || !sessionExists}>
                    <Trash2 className="h-4 w-4 mr-2" />Delete
                  </Button>
                </div>
              </div>
            </div>

            <div className="rounded-lg border p-3">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium">Aktivitas WhatsApp Terbaru</p>
                <Button type="button" variant="ghost" size="sm" onClick={fetchWaActivities}>Refresh</Button>
              </div>
              {waActivities.length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum ada aktivitas WA tersimpan.</p>
              ) : (
                <div className="space-y-2">
                  {waActivities.map((activity) => (
                    <div key={activity.id} className="flex items-start justify-between gap-3 text-sm">
                      <div>
                        <p className="font-medium">{activity.message}</p>
                        <p className="text-xs text-muted-foreground">{formatActivityMeta(activity)}</p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatActivityTime(activity.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={saving} className="min-w-[200px]">
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Menyimpan..." : "Simpan Pengaturan"}
          </Button>
        </div>
      </form>

      <Dialog open={showMaintenanceDialog} onOpenChange={setShowMaintenanceDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Maintenance WhatsApp
            </DialogTitle>
            <DialogDescription>
              Repair aman untuk menyinkronkan webhook, event wajib, HMAC, status session, dan S3. History tidak dijalankan otomatis.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-lg border p-3 text-sm">
              <p className="font-medium">Repair session desa ini</p>
              <p className="text-muted-foreground">Aman dijalankan berulang. Tidak menarik history lama agar tidak duplikasi pesan.</p>
              <Button type="button" className="mt-3" onClick={handleLifecycleRepair} disabled={repairingLifecycle || !sessionExists}>
                <RefreshCw className={`h-4 w-4 mr-2 ${repairingLifecycle ? "animate-spin" : ""}`} />
                Repair Sekarang
              </Button>
            </div>

            {isSuperadmin && (
              <div className="space-y-3 rounded-lg border p-3 text-sm">
                <p className="font-medium">Tools superadmin</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={handleSyncWebhook} disabled={syncingWebhook}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${syncingWebhook ? "animate-spin" : ""}`} />
                    Sync Webhook Desa Ini
                  </Button>
                  <Button type="button" variant="outline" onClick={handleSyncS3} disabled={syncingS3 || !sessionExists || !s3Status?.localConfigured}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${syncingS3 ? "animate-spin" : ""}`} />
                    Sync S3
                  </Button>
                  <Button type="button" variant="outline" onClick={handleTestS3} disabled={testingS3 || !sessionExists}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${testingS3 ? "animate-spin" : ""}`} />
                    Test S3
                  </Button>
                  <Button type="button" variant="outline" onClick={handleRepairAllSessions} disabled={repairingAllSessions}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${repairingAllSessions ? "animate-spin" : ""}`} />
                    Repair Semua Session Aktif
                  </Button>
                </div>

                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
                  <p className="font-medium">History Sync manual</p>
                  <p className="text-xs">Gunakan hanya untuk recovery/migrasi. Default 0 agar provider tidak mengimpor history lama.</p>
                  <div className="mt-2 flex gap-2">
                    <Input className="w-24" type="number" min={0} max={1000} value={historyDepth} onChange={(event) => setHistoryDepth(event.target.value)} />
                    <Button type="button" variant="outline" size="sm" onClick={handleSyncHistory} disabled={syncingHistory}>
                      <RefreshCw className={`h-4 w-4 mr-2 ${syncingHistory ? "animate-spin" : ""}`} />
                      Sync History
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {repairResult && (
              <pre className="max-h-64 overflow-auto rounded bg-muted p-3 text-xs text-muted-foreground">{JSON.stringify(repairResult, null, 2)}</pre>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMaintenanceDialog(false)}>Tutup</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <div className="rounded-lg border bg-muted/40 p-3 space-y-3">
              <div className="flex items-center gap-2">
                {setupStage === "connected" ? <CheckCircle className="h-5 w-5 text-green-600" /> : setupStage === "error" ? <XCircle className="h-5 w-5 text-red-600" /> : <RefreshCw className="h-5 w-5 animate-spin text-blue-600" />}
                <div>
                  <p className="text-sm font-medium">{getSetupMessage() || "Menyiapkan koneksi WhatsApp..."}</p>
                  {getSetupHint() && <p className="text-xs text-muted-foreground mt-1">{getSetupHint()}</p>}
                </div>
              </div>
              <details className="group rounded-md border bg-background/70 p-2">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground group-open:mb-2">
                  Lihat detail progress koneksi
                </summary>
                <div className="space-y-2">
                  {whatsappSetupSteps.map((step) => {
                    const state = getStepState(step.stage)
                    return (
                      <div key={step.stage} className="flex items-center gap-2 text-xs">
                        <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${state === "done" ? "bg-green-100 border-green-300 text-green-700" : state === "active" ? "bg-blue-100 border-blue-300 text-blue-700" : state === "error" ? "bg-red-100 border-red-300 text-red-700" : "bg-background text-muted-foreground"}`}>
                          {state === "done" ? <CheckCircle className="h-3 w-3" /> : state === "active" ? <RefreshCw className="h-3 w-3 animate-spin" /> : state === "error" ? <XCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                        </span>
                        <span className={state === "pending" ? "text-muted-foreground" : "font-medium"}>{step.label}</span>
                      </div>
                    )
                  })}
                </div>
              </details>
            </div>

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

      <AlertDialog open={showS3DeleteDialog} onOpenChange={setShowS3DeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Hapus S3 Provider WhatsApp?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Aksi ini menghapus konfigurasi S3 di provider WhatsApp untuk session aktif. Media/session provider bisa berhenti memakai storage eksternal sampai dikonfigurasi ulang.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingS3}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await handleDeleteS3()
                setShowS3DeleteDialog(false)
              }}
              disabled={deletingS3}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingS3 ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Hapus S3 Provider
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
