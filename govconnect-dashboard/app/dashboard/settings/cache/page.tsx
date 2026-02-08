"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertCircle,
  Database,
  RefreshCcw,
  Trash2,
  Zap,
  Activity,
  Server,
} from "lucide-react"
import { useAuth } from "@/components/auth/AuthContext"
import { useToast } from "@/hooks/use-toast"
import { redirect } from "next/navigation"

interface CacheEntry {
  name: string
  size: number
  maxSize: number
  hits: number
  misses: number
  hitRate: string
  ttlMs: number
}

interface CacheStats {
  cacheEnabled: boolean
  activeProcessing: number
  umpCaches: CacheEntry[]
  responseCache: any
  timestamp: string
}

export default function CacheManagementPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [stats, setStats] = useState<CacheStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [togglingMode, setTogglingMode] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Only super admin can access
  if (user && user.role !== 'superadmin' && user.role !== 'SUPERADMIN' && user.role !== 'super_admin') {
    redirect('/dashboard')
  }

  const fetchStats = useCallback(async () => {
    try {
      setError(null)
      const response = await fetch('/api/cache', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      })

      if (!response.ok) {
        throw new Error('Gagal mengambil data cache')
      }

      const data = await response.json()
      setStats(data)
    } catch (err: any) {
      setError(err.message || 'Gagal menghubungi AI Service')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  const handleClearAll = async () => {
    setClearing(true)
    try {
      const response = await fetch('/api/cache', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ action: 'clear-all' }),
      })

      if (!response.ok) throw new Error('Gagal menghapus cache')

      const data = await response.json()
      toast({
        title: "Cache Dihapus",
        description: `${data.details?.umpCachesCleared || 0} cache berhasil dihapus. Data sekarang fresh.`,
      })

      // Refresh stats
      fetchStats()
    } catch (err: any) {
      toast({
        title: "Gagal",
        description: err.message || "Gagal menghapus cache",
        variant: "destructive",
      })
    } finally {
      setClearing(false)
    }
  }

  const handleToggleMode = async (enabled: boolean) => {
    setTogglingMode(true)
    try {
      const response = await fetch('/api/cache', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ action: 'set-mode', enabled }),
      })

      if (!response.ok) throw new Error('Gagal mengubah mode cache')

      const data = await response.json()
      toast({
        title: enabled ? "Mode Production" : "Mode Development",
        description: data.message,
      })

      // Refresh stats
      fetchStats()
    } catch (err: any) {
      toast({
        title: "Gagal",
        description: err.message || "Gagal mengubah mode",
        variant: "destructive",
      })
    } finally {
      setTogglingMode(false)
    }
  }

  const formatTTL = (ms: number) => {
    if (ms >= 60000) return `${Math.round(ms / 60000)}m`
    return `${Math.round(ms / 1000)}s`
  }

  const totalCacheEntries = stats?.umpCaches?.reduce((sum, c) => sum + c.size, 0) || 0
  const totalHits = stats?.umpCaches?.reduce((sum, c) => sum + c.hits, 0) || 0
  const totalMisses = stats?.umpCaches?.reduce((sum, c) => sum + c.misses, 0) || 0
  const overallHitRate = totalHits + totalMisses > 0
    ? ((totalHits / (totalHits + totalMisses)) * 100).toFixed(1)
    : '0.0'

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Cache Management</h1>
          <p className="text-muted-foreground">Kelola cache AI service</p>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2"><Skeleton className="h-4 w-20" /></CardHeader>
              <CardContent><Skeleton className="h-8 w-16" /></CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="p-6"><Skeleton className="h-48 w-full" /></CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Cache Management</h1>
          <p className="text-muted-foreground">Kelola cache AI service</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mb-4" />
            <h3 className="text-lg font-semibold">Gagal Memuat Data</h3>
            <p className="text-muted-foreground mt-2">{error}</p>
            <Button onClick={fetchStats} className="mt-4" variant="outline">
              <RefreshCcw className="mr-2 h-4 w-4" />
              Coba Lagi
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cache Management</h1>
          <p className="text-muted-foreground">Kelola cache AI service untuk performa optimal</p>
        </div>
        <Button onClick={fetchStats} variant="outline" size="sm">
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Mode</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <Badge variant={stats?.cacheEnabled ? "default" : "secondary"} className="text-sm">
              {stats?.cacheEnabled ? '🚀 Production' : '🔧 Development'}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cache Entries</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCacheEntries}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Hit Rate</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overallHitRate}%</div>
            <p className="text-xs text-muted-foreground">
              {totalHits} hits / {totalMisses} misses
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Processing</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.activeProcessing || 0}</div>
            <p className="text-xs text-muted-foreground">pesan sedang diproses</p>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Cache Mode Toggle */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Mode Cache</CardTitle>
            <CardDescription>
              Toggle antara mode Production (cache aktif) dan Development (cache mati, data selalu fresh)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-4">
              <Switch
                id="cache-mode"
                checked={stats?.cacheEnabled ?? true}
                onCheckedChange={handleToggleMode}
                disabled={togglingMode}
              />
              <Label htmlFor="cache-mode" className="text-sm">
                {stats?.cacheEnabled
                  ? 'Cache Aktif (Production) — Response lebih cepat'
                  : 'Cache Mati (Development) — Data selalu fresh'}
              </Label>
            </div>
            {!stats?.cacheEnabled && (
              <p className="text-xs text-amber-600 mt-3">
                ⚠️ Mode development akan membuat response lebih lambat karena setiap request memproses ulang data.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Clear All Caches */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Hapus Semua Cache</CardTitle>
            <CardDescription>
              Hapus semua data cache agar data terbaru diambil dari database. Berguna setelah update data desa.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={handleClearAll}
              variant="destructive"
              disabled={clearing}
              className="w-full"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {clearing ? 'Menghapus...' : 'Hapus Semua Cache'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Cache Details Table */}
      <Card>
        <CardHeader>
          <CardTitle>Detail Cache</CardTitle>
          <CardDescription>
            Status masing-masing cache di AI service
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cache Name</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-right">Max</TableHead>
                <TableHead className="text-right">TTL</TableHead>
                <TableHead className="text-right">Hits</TableHead>
                <TableHead className="text-right">Misses</TableHead>
                <TableHead className="text-right">Hit Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats?.umpCaches?.map((cache, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-medium text-xs">
                    {cache.name}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant={cache.size > cache.maxSize * 0.8 ? "destructive" : "outline"}>
                      {cache.size}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {cache.maxSize}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatTTL(cache.ttlMs)}
                  </TableCell>
                  <TableCell className="text-right text-green-600">
                    {cache.hits}
                  </TableCell>
                  <TableCell className="text-right text-red-500">
                    {cache.misses}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant={parseFloat(cache.hitRate) > 50 ? "default" : "secondary"}>
                      {cache.hitRate}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(!stats?.umpCaches || stats.umpCaches.length === 0) && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Tidak ada data cache
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Footer info */}
      <p className="text-xs text-muted-foreground text-center">
        Gunakan tombol Refresh untuk memperbarui data · Terakhir diperbarui: {stats?.timestamp ? new Date(stats.timestamp).toLocaleTimeString('id-ID') : '-'}
      </p>
    </div>
  )
}
