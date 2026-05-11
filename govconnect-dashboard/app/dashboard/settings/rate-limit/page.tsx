"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
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
import {
  AlertCircle,
  Shield,
  ShieldOff,
  RefreshCcw,
  UserX,
  Clock,
  AlertTriangle,
  Ban,
  Trash2,
  Plus,
  Settings,
  MessageSquareWarning,
  Timer,
} from "lucide-react"
import { fetchApi } from "@/lib/frontend-api"

interface RateLimitConfig {
  enabled: boolean
  maxReportsPerDay: number
  cooldownSeconds: number
  autoBlacklistViolations: number
}

interface RateLimitStats {
  totalBlocked: number
  totalBlacklisted: number
  activeUsers: number
  topViolators: Array<{
    wa_user_id: string
    violations: number
    dailyReports: number
  }>
}

interface BlacklistEntry {
  wa_user_id: string
  reason: string
  addedAt: string
  addedBy: string
  expiresAt?: string
}

interface RateLimitData {
  config: RateLimitConfig
  stats: RateLimitStats
}

interface SpamBan {
  wa_user_id: string
  reason: string
  bannedAt: number
  expiresAt: number
  identicalText: string
  messageCount: number
  banType?: 'identical' | 'rate'
}

interface SpamGuardStats {
  enabled: boolean
  maxIdentical: number
  banDurationMs: number
  rateMaxMessages?: number
  rateWindowMs?: number
  activeTrackers: number
  activeBans: number
  supersededMessages: number
  bans: SpamBan[]
}

interface SpamGuardData {
  stats: SpamGuardStats
  channelBans: { total: number; bans: SpamBan[] }
}

type ConfirmAction = {
  title: string
  description: string
  actionLabel: string
  variant?: "default" | "destructive"
  onConfirm: () => Promise<void> | void
}

export default function RateLimitPage() {
  const { toast } = useToast()
  const [data, setData] = useState<RateLimitData | null>(null)
  const [blacklist, setBlacklist] = useState<{ total: number; entries: BlacklistEntry[] } | null>(null)
  const [spamGuard, setSpamGuard] = useState<SpamGuardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [spamGuardWarning, setSpamGuardWarning] = useState<string | null>(null)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [newBlacklist, setNewBlacklist] = useState({ wa_user_id: '', reason: '', expiresInDays: '' })
  const [submitting, setSubmitting] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmAction | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setSpamGuardWarning(null)
      setData(null)
      setBlacklist(null)
      setSpamGuard(null)

      const [rateLimitPayload, blacklistPayload, spamGuardResult] = await Promise.all([
        fetchApi<RateLimitData>('/api/rate-limit'),
        fetchApi<{ total: number; entries: BlacklistEntry[] }>('/api/rate-limit/blacklist'),
        fetchApi<SpamGuardData>('/api/spam-guard').then((data) => ({ ok: true as const, data })).catch((error: any) => ({ ok: false as const, error })),
      ])

      setData(rateLimitPayload)
      setBlacklist(blacklistPayload)

      if (spamGuardResult.ok) {
        setSpamGuard(spamGuardResult.data)
      } else {
        setSpamGuardWarning(spamGuardResult.error?.message || 'Spam Guard tidak dapat dimuat')
      }
    } catch (err: any) {
      setError(err.message || 'Gagal memuat data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const requestAddToBlacklist = () => {
    if (!newBlacklist.wa_user_id.trim() || !newBlacklist.reason.trim()) {
      toast({ title: "Gagal", description: "Nomor WhatsApp dan alasan wajib diisi", variant: "destructive" })
      return
    }

    setPendingConfirm({
      title: "Tambah ke blacklist?",
      description: `${newBlacklist.wa_user_id.trim()} akan diblokir dari layanan chatbot.`,
      actionLabel: "Tambah Blacklist",
      variant: "destructive",
      onConfirm: handleAddToBlacklist,
    })
  }

  const handleAddToBlacklist = async () => {
    if (!newBlacklist.wa_user_id.trim() || !newBlacklist.reason.trim()) return

    try {
      setSubmitting(true)
      await fetchApi('/api/rate-limit/blacklist', {
        method: 'POST',
        body: JSON.stringify({
          wa_user_id: newBlacklist.wa_user_id.trim(),
          reason: newBlacklist.reason.trim(),
          expiresInDays: newBlacklist.expiresInDays ? parseInt(newBlacklist.expiresInDays) : undefined,
        }),
      })

      toast({ title: "Berhasil", description: "Nomor berhasil ditambahkan ke blacklist." })
      setAddDialogOpen(false)
      setNewBlacklist({ wa_user_id: '', reason: '', expiresInDays: '' })
      fetchData()
    } catch (err: any) {
      toast({ title: "Gagal", description: err?.message || 'Gagal menambah blacklist', variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  const requestRemoveFromBlacklist = (wa_user_id: string) => {
    setPendingConfirm({
      title: "Hapus dari blacklist?",
      description: `${wa_user_id} akan dapat memakai layanan lagi jika tidak terkena batas lain.`,
      actionLabel: "Hapus Blacklist",
      variant: "destructive",
      onConfirm: () => handleRemoveFromBlacklist(wa_user_id),
    })
  }

  const handleRemoveFromBlacklist = async (wa_user_id: string) => {
    try {
      await fetchApi(`/api/rate-limit/blacklist?wa_user_id=${wa_user_id}`, {
        method: 'DELETE',
      })

      toast({ title: "Berhasil", description: "Nomor berhasil dihapus dari blacklist." })
      fetchData()
    } catch (err: any) {
      toast({ title: "Gagal", description: err?.message || 'Gagal menghapus blacklist', variant: "destructive" })
    }
  }

  const requestRemoveSpamBan = (wa_user_id: string) => {
    setPendingConfirm({
      title: "Hapus spam ban?",
      description: `Spam ban untuk ${wa_user_id} akan dihapus.`,
      actionLabel: "Hapus Ban",
      variant: "destructive",
      onConfirm: () => handleRemoveSpamBan(wa_user_id),
    })
  }

  const handleRemoveSpamBan = async (wa_user_id: string) => {
    try {
      await fetchApi(`/api/spam-guard?wa_user_id=${wa_user_id}`, {
        method: 'DELETE',
      })

      toast({ title: "Berhasil", description: "Spam ban berhasil dihapus." })
      fetchData()
    } catch (err: any) {
      toast({ title: "Gagal", description: err?.message || 'Gagal menghapus spam ban', variant: "destructive" })
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatPhoneNumber = (phone: string) => {
    // Format 628xxx to +62 8xxx-xxxx-xxxx
    if (phone.startsWith('62')) {
      const rest = phone.slice(2)
      return `+62 ${rest.slice(0, 3)}-${rest.slice(3, 7)}-${rest.slice(7)}`
    }
    return phone
  }

  const formatRemainingTime = (expiresAt: number) => {
    const remaining = expiresAt - Date.now()
    if (remaining <= 0) return 'Kedaluwarsa'
    const seconds = Math.ceil(remaining / 1000)
    if (seconds < 60) return `${seconds} detik`
    const minutes = Math.ceil(seconds / 60)
    return `${minutes} menit`
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Rate Limit
          </h1>
          <p className="text-muted-foreground">
            Kontrol rate limit dan blacklist nomor spam
          </p>
        </div>
        <Button onClick={fetchData} variant="outline" size="sm">
          <RefreshCcw className="h-4 w-4 mr-2" />
          Muat Ulang
        </Button>
      </div>

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

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30">
          <CardContent className="flex items-start gap-3 pt-6 text-red-700 dark:text-red-300">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium">Data rate limit tidak dapat dimuat.</p>
              <p className="text-sm">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {spamGuardWarning && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
          <CardContent className="flex items-start gap-3 pt-6 text-amber-800 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium">Spam Guard tidak lengkap.</p>
              <p className="text-sm">{spamGuardWarning}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {data && (
      <>
      {/* Config Card */}
      <Card className={data.config.enabled ? 'border-green-200 dark:border-green-900' : 'border-yellow-200 dark:border-yellow-900'}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Konfigurasi Rate Limit
          </CardTitle>
          <CardDescription>
            Pengaturan rate limit dari environment variable
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                {data.config.enabled ? (
                  <Shield className="h-4 w-4 text-green-500" />
                ) : (
                  <ShieldOff className="h-4 w-4 text-yellow-500" />
                )}
                <span className="text-sm font-medium">Status</span>
              </div>
              <Badge variant={data.config.enabled ? "default" : "secondary"}>
                {data.config.enabled ? 'AKTIF' : 'NONAKTIF'}
              </Badge>
            </div>
            
            <div className="p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                <span className="text-sm font-medium">Max Laporan/Hari</span>
              </div>
              <p className="text-2xl font-bold">{data.config.maxReportsPerDay}</p>
            </div>
            
            <div className="p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-medium">Cooldown</span>
              </div>
              <p className="text-2xl font-bold">{data.config.cooldownSeconds}s</p>
            </div>
            
            <div className="p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Ban className="h-4 w-4 text-red-500" />
                <span className="text-sm font-medium">Auto Blacklist</span>
              </div>
              <p className="text-2xl font-bold">{data.config.autoBlacklistViolations} pelanggaran</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Diblokir</p>
                <p className="text-2xl font-bold">{data.stats.totalBlocked}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-yellow-500 opacity-80" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Nomor Blacklist</p>
                <p className="text-2xl font-bold">{data.stats.totalBlacklisted}</p>
              </div>
              <UserX className="h-8 w-8 text-red-500 opacity-80" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Pengguna Aktif Hari Ini</p>
                <p className="text-2xl font-bold">{data.stats.activeUsers}</p>
              </div>
              <Shield className="h-8 w-8 text-green-500 opacity-80" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Violators */}
      {data.stats.topViolators && data.stats.topViolators.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Pelanggar Terbanyak
            </CardTitle>
            <CardDescription>
              Nomor dengan pelanggaran rate limit terbanyak
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nomor WhatsApp</TableHead>
                  <TableHead className="text-right">Pelanggaran</TableHead>
                  <TableHead className="text-right">Laporan Hari Ini</TableHead>
                  <TableHead className="text-center">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.stats.topViolators.map((user) => (
                  <TableRow key={user.wa_user_id}>
                    <TableCell className="font-mono">{formatPhoneNumber(user.wa_user_id)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={user.violations >= 5 ? "destructive" : "secondary"}>
                        {user.violations}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{user.dailyReports}</TableCell>
                    <TableCell className="text-center">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setNewBlacklist({ wa_user_id: user.wa_user_id, reason: 'Terlalu banyak pelanggaran rate limit', expiresInDays: '' })
                          setAddDialogOpen(true)
                        }}
                      >
                        <Ban className="h-4 w-4 mr-1" />
                        Blacklist
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Spam Guard Section */}
      {spamGuard && (
      <Card className={spamGuard.stats.enabled ? 'border-orange-200 dark:border-orange-900' : 'border-gray-200 dark:border-gray-800'}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareWarning className="h-5 w-5 text-orange-500" />
            Spam Guard
          </CardTitle>
          <CardDescription>
            Deteksi pesan identik berulang (ban per-teks), rate spam ({spamGuard?.stats.rateMaxMessages || 10} pesan berbeda dalam {Math.round((spamGuard?.stats.rateWindowMs || 10000) / 1000)}s = ban semua), dan bubble chat superseding. Pesan spam TIDAK disimpan ke history.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4 mb-6">
            <div className="p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                {spamGuard?.stats.enabled ? (
                  <Shield className="h-4 w-4 text-green-500" />
                ) : (
                  <ShieldOff className="h-4 w-4 text-yellow-500" />
                )}
                <span className="text-sm font-medium">Status</span>
              </div>
              <Badge variant={spamGuard?.stats.enabled ? "default" : "secondary"}>
                {spamGuard?.stats.enabled ? 'AKTIF' : 'NONAKTIF'}
              </Badge>
            </div>
            
            <div className="p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                <span className="text-sm font-medium">Maks Pesan Identik</span>
              </div>
              <p className="text-2xl font-bold">{spamGuard?.stats.maxIdentical || 5}</p>
            </div>
            
            <div className="p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Timer className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-medium">Durasi Ban</span>
              </div>
              <p className="text-2xl font-bold">{Math.round((spamGuard?.stats.banDurationMs || 60000) / 1000)}s</p>
            </div>
            
            <div className="p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Ban className="h-4 w-4 text-red-500" />
                <span className="text-sm font-medium">Ban Aktif</span>
              </div>
              <p className="text-2xl font-bold">{spamGuard?.stats.activeBans || 0}</p>
            </div>
          </div>

          {/* Rate Spam Config */}
          <div className="grid gap-4 md:grid-cols-2 mb-6">
            <div className="p-3 bg-muted/50 rounded-lg border">
              <span className="text-xs text-muted-foreground">Rate Spam Limit</span>
              <p className="text-sm font-medium">&gt;{spamGuard?.stats.rateMaxMessages || 10} pesan berbeda dalam {Math.round((spamGuard?.stats.rateWindowMs || 10000) / 1000)}s = ban 1 menit (semua pesan)</p>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg border">
              <span className="text-xs text-muted-foreground">Identical Spam Limit</span>
              <p className="text-sm font-medium">&gt;{spamGuard?.stats.maxIdentical || 5} pesan identik = ban teks itu saja selama {Math.round((spamGuard?.stats.banDurationMs || 60000) / 1000)}s</p>
            </div>
          </div>

          {/* Spam Ban List */}
          {(() => {
            const allBans = [
              ...(spamGuard?.stats.bans || []),
              ...(spamGuard?.channelBans.bans || []),
            ]
            // Deduplicate by wa_user_id + banType + identicalText
            const uniqueBans = allBans.filter((ban, index, self) =>
              index === self.findIndex(b => b.wa_user_id === ban.wa_user_id && b.identicalText === ban.identicalText && (b.banType || 'identical') === (ban.banType || 'identical'))
            )

            if (uniqueBans.length === 0) {
              return (
                <div className="text-center py-6 text-muted-foreground">
                  <MessageSquareWarning className="h-10 w-10 mx-auto mb-3 opacity-50" />
                  <p>Tidak ada nomor yang sedang di-ban karena spam</p>
                </div>
              )
            }

            return (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nomor WhatsApp</TableHead>
                    <TableHead>Tipe Ban</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead className="text-center">Jumlah Pesan</TableHead>
                    <TableHead>Sisa Ban</TableHead>
                    <TableHead className="text-center">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uniqueBans.map((ban) => (
                    <TableRow key={`${ban.wa_user_id}-${ban.banType || 'identical'}-${ban.identicalText || 'rate'}`}>
                      <TableCell className="font-mono">{formatPhoneNumber(ban.wa_user_id)}</TableCell>
                      <TableCell>
                        <Badge variant={ban.banType === 'rate' ? 'destructive' : 'secondary'}>
                          {ban.banType === 'rate' ? '⚡ Rate' : '📝 Identik'}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground" title={ban.identicalText || ban.reason}>
                        {ban.banType === 'rate' 
                          ? `Semua pesan diblokir` 
                          : <>&#x201C;{(ban.identicalText || '').substring(0, 50)}{(ban.identicalText || '').length > 50 ? '...' : ''}&#x201D;</>
                        }
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="destructive">{ban.messageCount}x</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3 text-orange-500" />
                          <span className="text-sm">{formatRemainingTime(ban.expiresAt)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => requestRemoveSpamBan(ban.wa_user_id)}
                          title="Hapus ban spam"
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          })()}
        </CardContent>
      </Card>
      )}

      {/* Blacklist Management */}
      {blacklist && (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-red-500" />
              Blacklist
            </CardTitle>
            <CardDescription>
              Nomor yang diblokir dari layanan chatbot
            </CardDescription>
          </div>
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Tambah ke Blacklist
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Tambah ke Blacklist</DialogTitle>
                <DialogDescription>
                  Tambahkan nomor WhatsApp ke daftar blacklist
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="wa_user_id">Nomor WhatsApp</Label>
                  <Input
                    id="wa_user_id"
                    placeholder="628123456789"
                    value={newBlacklist.wa_user_id}
                    onChange={(e) => setNewBlacklist({ ...newBlacklist, wa_user_id: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">Format: 628xxx (tanpa +)</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reason">Alasan</Label>
                  <Input
                    id="reason"
                    placeholder="Spam, pelanggaran ToS, dll."
                    value={newBlacklist.reason}
                    onChange={(e) => setNewBlacklist({ ...newBlacklist, reason: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expiresInDays">Durasi Blokir (hari, kosongkan untuk permanen)</Label>
                  <Input
                    id="expiresInDays"
                    type="number"
                    placeholder="7"
                    value={newBlacklist.expiresInDays}
                    onChange={(e) => setNewBlacklist({ ...newBlacklist, expiresInDays: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                  Batal
                </Button>
                <Button onClick={requestAddToBlacklist} disabled={submitting}>
                  {submitting ? 'Menyimpan...' : 'Tambah'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {!blacklist?.entries || blacklist.entries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Ban className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Belum ada nomor yang di-blacklist</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nomor WhatsApp</TableHead>
                  <TableHead>Alasan</TableHead>
                  <TableHead>Ditambahkan</TableHead>
                  <TableHead>Oleh</TableHead>
                  <TableHead>Kadaluarsa</TableHead>
                  <TableHead className="text-center">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {blacklist.entries.map((entry) => (
                  <TableRow key={entry.wa_user_id}>
                    <TableCell className="font-mono">{formatPhoneNumber(entry.wa_user_id)}</TableCell>
                    <TableCell>{entry.reason}</TableCell>
                    <TableCell className="text-sm">{formatDate(entry.addedAt)}</TableCell>
                    <TableCell>
                      <Badge variant={entry.addedBy === 'system' ? 'secondary' : 'default'}>
                        {entry.addedBy}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {entry.expiresAt ? (
                        <span className="text-sm">{formatDate(entry.expiresAt)}</span>
                      ) : (
                        <Badge variant="destructive">Permanen</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => requestRemoveFromBlacklist(entry.wa_user_id)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      )}
      </>
      )}
    </div>
  )
}
