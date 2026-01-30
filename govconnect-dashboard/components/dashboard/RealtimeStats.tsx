"use client"

import React from 'react'
import { 
  FileText, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useRealtime } from './RealtimeProvider'
import { cn } from '@/lib/utils'

interface StatCardProps {
  title: string
  value: number
  icon: React.ReactNode
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
  className?: string
  iconClassName?: string
  loading?: boolean
}

function StatCard({ 
  title, 
  value, 
  icon, 
  trend, 
  trendValue, 
  className,
  iconClassName,
  loading 
}: StatCardProps) {
  if (loading) {
    return (
      <Card className={className}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-4 rounded" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-16 mb-1" />
          <Skeleton className="h-3 w-20" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <div className={cn("p-2 rounded-lg", iconClassName)}>
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value.toLocaleString()}</div>
        {trend && trendValue && (
          <p className={cn(
            "text-xs flex items-center gap-1 mt-1",
            trend === 'up' && "text-green-600",
            trend === 'down' && "text-red-600",
            trend === 'neutral' && "text-muted-foreground"
          )}>
            {trend === 'up' && <TrendingUp className="h-3 w-3" />}
            {trend === 'down' && <TrendingDown className="h-3 w-3" />}
            {trend === 'neutral' && <Minus className="h-3 w-3" />}
            {trendValue}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function RealtimeStatsGrid() {
  const { stats, loading, refreshData, urgentComplaints } = useRealtime()
  const [refreshing, setRefreshing] = React.useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    await refreshData()
    setRefreshing(false)
  }

  return (
    <div className="space-y-4">

      {/* Main Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Laporan"
          value={stats?.complaints.total || 0}
          icon={<FileText className="h-4 w-4" />}
          iconClassName="bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300"
          trend="up"
          trendValue={`+${stats?.todayCount || 0} hari ini`}
          loading={loading}
        />
        
        <StatCard
          title="Laporan Baru"
          value={stats?.complaints.open || 0}
          icon={<Clock className="h-4 w-4" />}
          iconClassName="bg-yellow-100 text-yellow-600 dark:bg-yellow-900 dark:text-yellow-300"
          trend="neutral"
          trendValue={`${stats?.lastHourCount || 0} jam terakhir`}
          loading={loading}
        />
        
        <StatCard
          title="Dalam Proses"
          value={stats?.complaints.process || 0}
          icon={<Loader2 className="h-4 w-4" />}
          iconClassName="bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300"
          loading={loading}
        />
        
        <StatCard
          title="Selesai"
          value={stats?.complaints.done || 0}
          icon={<CheckCircle2 className="h-4 w-4" />}
          iconClassName="bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300"
          loading={loading}
        />

        <StatCard
          title="Ditolak"
          value={stats?.complaints.reject || 0}
          icon={<XCircle className="h-4 w-4" />}
          iconClassName="bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300"
          loading={loading}
        />
      </div>

      {/* Urgent Stats */}
      {(urgentComplaints.length > 0 || loading) && (
        <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-red-700 dark:text-red-400">
              <AlertTriangle className="h-4 w-4" />
              Laporan Darurat Aktif
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-red-600 dark:text-red-400">
                  {urgentComplaints.length}
                </span>
                <span className="text-sm text-red-600/70 dark:text-red-400/70">
                  memerlukan penanganan segera
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Service Requests Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          title="Total Permohonan Layanan"
          value={stats?.services?.total || 0}
          icon={<FileText className="h-4 w-4" />}
          iconClassName="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          loading={loading}
        />
        
        <StatCard
          title="Layanan Baru"
          value={stats?.services?.open || 0}
          icon={<Clock className="h-4 w-4" />}
          iconClassName="bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-300"
          loading={loading}
        />
        
        <StatCard
          title="Layanan Selesai"
          value={stats?.services?.done || 0}
          icon={<CheckCircle2 className="h-4 w-4" />}
          iconClassName="bg-emerald-100 text-emerald-600 dark:bg-emerald-900 dark:text-emerald-300"
          loading={loading}
        />

        <StatCard
          title="Layanan Ditolak"
          value={stats?.services?.reject || 0}
          icon={<XCircle className="h-4 w-4" />}
          iconClassName="bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300"
          loading={loading}
        />
      </div>
    </div>
  )
}

export function RecentComplaintsCard() {
  const { recentComplaints, loading } = useRealtime()

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; className: string }> = {
      OPEN: {
        label: 'Baru',
        className: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
      },
      PROCESS: {
        label: 'Proses',
        className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
      },
      DONE: {
        label: 'Selesai',
        className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
      },
      CANCELED: {
        label: 'Dibatalkan',
        className: 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300'
      },
      REJECT: {
        label: 'Ditolak',
        className: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
      },
      baru: { 
        label: 'Baru', 
        className: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' 
      },
      proses: { 
        label: 'Proses', 
        className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' 
      },
      selesai: { 
        label: 'Selesai', 
        className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' 
      },
      ditolak: { 
        label: 'Ditolak', 
        className: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' 
      },
      dibatalkan: {
        label: 'Dibatalkan',
        className: 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300'
      },
    }
    const config = statusMap[status] || statusMap.baru
    return (
      <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", config.className)}>
        {config.label}
      </span>
    )
  }

  const formatTime = (date: string) => {
    const d = new Date(date)
    return d.toLocaleString('id-ID', { 
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Laporan Terbaru</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : recentComplaints.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            Belum ada laporan
          </p>
        ) : (
          <div className="space-y-3">
            {recentComplaints.slice(0, 5).map((complaint) => (
              <div 
                key={complaint.id}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors",
                  complaint.kategori.toLowerCase().includes('bencana') && "bg-red-50 dark:bg-red-950/20"
                )}
              >
                <div className="shrink-0 h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">
                      {complaint.complaint_id}
                    </span>
                    {getStatusBadge(complaint.status)}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">
                    {complaint.kategori.replace(/_/g, ' ')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatTime(complaint.created_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
