"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
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
} from "lucide-react"
import { useAuth } from "@/components/auth/AuthContext"

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

export default function RateLimitPage() {
  const { user } = useAuth()
  const [data, setData] = useState<RateLimitData | null>(null)
  const [blacklist, setBlacklist] = useState<{ total: number; entries: BlacklistEntry[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [newBlacklist, setNewBlacklist] = useState({ wa_user_id: '', reason: '', expiresInDays: '' })
  const [submitting, setSubmitting] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      
      const token = localStorage.getItem('token')
      const headers = { 'Authorization': `Bearer ${token}` }

      const [rateLimitRes, blacklistRes] = await Promise.all([
        fetch('/api/rate-limit', { headers }),
        fetch('/api/rate-limit/blacklist', { headers }),
      ])

      if (rateLimitRes.ok) setData(await rateLimitRes.json())
      if (blacklistRes.ok) setBlacklist(await blacklistRes.json())
    } catch (err: any) {
      setError(err.message || 'Gagal memuat data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleAddToBlacklist = async () => {
    if (!newBlacklist.wa_user_id || !newBlacklist.reason) return
    
    try {
      setSubmitting(true)
      const token = localStorage.getItem('token')
      
      const response = await fetch('/api/rate-limit/blacklist', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wa_user_id: newBlacklist.wa_user_id,
          reason: newBlacklist.reason,
          expiresInDays: newBlacklist.expiresInDays ? parseInt(newBlacklist.expiresInDays) : undefined,
        }),
      })

      if (response.ok) {
        setAddDialogOpen(false)
        setNewBlacklist({ wa_user_id: '', reason: '', expiresInDays: '' })
        fetchData()
      }
    } catch (err) {
      console.error('Failed to add to blacklist:', err)
    } finally {
      setSubmitting(false)
    }
  }

  const handleRemoveFromBlacklist = async (wa_user_id: string) => {
    if (!confirm(`Hapus ${wa_user_id} dari blacklist?`)) return
    
    try {
      const token = localStorage.getItem('token')
      
      const response = await fetch(`/api/rate-limit/blacklist?wa_user_id=${wa_user_id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (response.ok) {
        fetchData()
      }
    } catch (err) {
      console.error('Failed to remove from blacklist:', err)
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

      {/* Config Card */}
      <Card className={data?.config.enabled ? 'border-green-200 dark:border-green-900' : 'border-yellow-200 dark:border-yellow-900'}>
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
                {data?.config.enabled ? (
                  <Shield className="h-4 w-4 text-green-500" />
                ) : (
                  <ShieldOff className="h-4 w-4 text-yellow-500" />
                )}
                <span className="text-sm font-medium">Status</span>
              </div>
              <Badge variant={data?.config.enabled ? "default" : "secondary"}>
                {data?.config.enabled ? 'AKTIF' : 'NONAKTIF'}
              </Badge>
            </div>
            
            <div className="p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                <span className="text-sm font-medium">Max Laporan/Hari</span>
              </div>
              <p className="text-2xl font-bold">{data?.config.maxReportsPerDay || 5}</p>
            </div>
            
            <div className="p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-medium">Cooldown</span>
              </div>
              <p className="text-2xl font-bold">{data?.config.cooldownSeconds || 30}s</p>
            </div>
            
            <div className="p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Ban className="h-4 w-4 text-red-500" />
                <span className="text-sm font-medium">Auto Blacklist</span>
              </div>
              <p className="text-2xl font-bold">{data?.config.autoBlacklistViolations || 10} pelanggaran</p>
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
                <p className="text-2xl font-bold">{data?.stats.totalBlocked || 0}</p>
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
                <p className="text-2xl font-bold">{data?.stats.totalBlacklisted || 0}</p>
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
                <p className="text-2xl font-bold">{data?.stats.activeUsers || 0}</p>
              </div>
              <Shield className="h-8 w-8 text-green-500 opacity-80" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Violators */}
      {data?.stats.topViolators && data.stats.topViolators.length > 0 && (
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

      {/* Blacklist Management */}
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
                <Button onClick={handleAddToBlacklist} disabled={submitting}>
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
                        onClick={() => handleRemoveFromBlacklist(entry.wa_user_id)}
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
    </div>
  )
}
