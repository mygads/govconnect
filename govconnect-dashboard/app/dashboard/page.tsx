"use client"

import { ComponentType, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useAuth } from "@/components/auth/AuthContext"
import { useRealtime } from "@/components/dashboard/RealtimeProvider"
import { SuperadminDashboard } from "@/components/dashboard/SuperadminDashboard"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { documents, statistics } from "@/lib/frontend-api"
import { isSuperadmin } from "@/lib/rbac"
import { cn, formatDateTime } from "@/lib/utils"
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  MessageCircle,
  PieChart,
  RefreshCcw,
  Settings,
  Sparkles,
  TrendingUp,
  XCircle,
} from "lucide-react"

type ChartComponent = ComponentType<{ data: any; options?: any }>
type Charts = { Bar: ChartComponent; Doughnut: ChartComponent; Line: ChartComponent }

type DocumentStats = {
  total: number
  completed: number
  processing: number
  failed: number
  pending: number
  totalChunks: number
}

type TrendPoint = { label: string; complaints: number; services: number }

const statusLabels = ["Baru", "Proses", "Selesai", "Batal", "Ditolak"]
const statusColors = ["#f59e0b", "#8b5cf6", "#10b981", "#94a3b8", "#ef4444"]

function normalizeTrends(data: any): TrendPoint[] {
  const rows = Array.isArray(data) ? data : data?.data || data?.trends || data?.items || []
  if (!Array.isArray(rows)) return []

  return rows
    .map((row: any, index: number) => ({
      label: String(row.label || row.date || row.period || row.day || row.month || `#${index + 1}`),
      complaints: Number(row.complaints ?? row.laporan ?? row.totalLaporan ?? row.total_laporan ?? 0),
      services: Number(row.services ?? row.layanan ?? row.totalLayanan ?? row.total_layanan ?? 0),
    }))
    .filter((row) => row.complaints > 0 || row.services > 0)
}

function formatTime(date: string, timezone?: string | null) {
  return formatDateTime(date, timezone, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; className: string }> = {
    OPEN: { label: "Baru", className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
    PROCESS: { label: "Proses", className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" },
    DONE: { label: "Selesai", className: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" },
    CANCELED: { label: "Batal", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
    REJECT: { label: "Ditolak", className: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
    baru: { label: "Baru", className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
    proses: { label: "Proses", className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" },
    selesai: { label: "Selesai", className: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" },
    dibatalkan: { label: "Batal", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
    ditolak: { label: "Ditolak", className: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
  }
  const item = map[status] || { label: status || "Baru", className: "bg-muted text-muted-foreground" }
  return <Badge className={item.className}>{item.label}</Badge>
}

function MetricCard({ title, value, detail, icon, tone, loading }: {
  title: string
  value: number
  detail: string
  icon: React.ReactNode
  tone: string
  loading: boolean
}) {
  return (
    <Card className="overflow-hidden border-0 bg-card/80 shadow-sm ring-1 ring-border/60">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            {loading ? <Skeleton className="mt-3 h-8 w-20" /> : <div className="mt-2 text-3xl font-bold tracking-tight">{value.toLocaleString("id-ID")}</div>}
            <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
          </div>
          <div className={cn("rounded-2xl p-3", tone)}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function DashboardHome() {
  const { user } = useAuth()
  const { stats, recentComplaints, urgentComplaints, loading, refreshData } = useRealtime()
  const [charts, setCharts] = useState<Charts | null>(null)
  const [trendPoints, setTrendPoints] = useState<TrendPoint[]>([])
  const [docStats, setDocStats] = useState<DocumentStats | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    Promise.all([import("chart.js"), import("react-chartjs-2")]).then(([chartjs, reactChart]) => {
      const { Chart, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, PointElement, LineElement, Filler } = chartjs
      Chart.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, PointElement, LineElement, Filler)
      setCharts({ Bar: reactChart.Bar, Doughnut: reactChart.Doughnut, Line: reactChart.Line })
    })
  }, [])

  useEffect(() => {
    let active = true
    Promise.allSettled([statistics.getTrends("weekly"), documents.getStats()]).then(([trendsResult, docsResult]) => {
      if (!active) return
      if (trendsResult.status === "fulfilled") setTrendPoints(normalizeTrends(trendsResult.value))
      if (docsResult.status === "fulfilled") setDocStats(docsResult.value?.data || docsResult.value)
    })
    return () => { active = false }
  }, [])

  const completionRate = useMemo(() => {
    const done = stats?.complaints.done || 0
    const total = stats?.complaints.total || 0
    return total ? Math.round((done / total) * 100) : 0
  }, [stats])

  const documentReadyRate = docStats?.total ? Math.round((docStats.completed / docStats.total) * 100) : 0
  const openWork = (stats?.complaints.open || 0) + (stats?.complaints.process || 0) + (stats?.services?.open || 0) + (stats?.services?.process || 0)

  const complaintStatusData = {
    labels: statusLabels,
    datasets: [{
      data: [stats?.complaints.open || 0, stats?.complaints.process || 0, stats?.complaints.done || 0, stats?.complaints.canceled || 0, stats?.complaints.reject || 0],
      backgroundColor: statusColors,
      borderWidth: 0,
    }],
  }

  const statusBarData = {
    labels: statusLabels,
    datasets: [
      {
        label: "Laporan",
        data: [stats?.complaints.open || 0, stats?.complaints.process || 0, stats?.complaints.done || 0, stats?.complaints.canceled || 0, stats?.complaints.reject || 0],
        backgroundColor: "rgba(37, 99, 235, 0.75)",
        borderRadius: 8,
      },
      {
        label: "Permohonan",
        data: [stats?.services?.open || 0, stats?.services?.process || 0, stats?.services?.done || 0, stats?.services?.canceled || 0, stats?.services?.reject || 0],
        backgroundColor: "rgba(16, 185, 129, 0.75)",
        borderRadius: 8,
      },
    ],
  }

  const trendData = {
    labels: trendPoints.map((point) => point.label),
    datasets: [
      {
        label: "Laporan",
        data: trendPoints.map((point) => point.complaints),
        borderColor: "rgb(37, 99, 235)",
        backgroundColor: "rgba(37, 99, 235, 0.12)",
        fill: true,
        tension: 0.35,
      },
      {
        label: "Permohonan",
        data: trendPoints.map((point) => point.services),
        borderColor: "rgb(16, 185, 129)",
        backgroundColor: "rgba(16, 185, 129, 0.1)",
        fill: true,
        tension: 0.35,
      },
    ],
  }

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: "bottom" as const } },
    scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
  }

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "68%",
    plugins: { legend: { position: "bottom" as const } },
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await refreshData()
    setRefreshing(false)
  }

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-3xl border bg-gradient-to-br from-slate-950 via-blue-950 to-emerald-900 p-6 text-white shadow-lg">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <Badge className="mb-4 bg-white/15 text-white hover:bg-white/20">Dashboard Operasional Real-time</Badge>
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Selamat datang, {user?.name || "Admin Desa"}</h1>
            <p className="mt-3 max-w-2xl text-sm text-blue-100 md:text-base">
              Pantau laporan masyarakat, permohonan layanan, knowledge base, dan aktivitas WhatsApp dari satu layar.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button onClick={handleRefresh} disabled={refreshing} variant="secondary" className="bg-white text-slate-950 hover:bg-white/90">
              <RefreshCcw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} /> Refresh data
            </Button>
            <Button asChild variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white">
              <Link href="/dashboard/statistik">Lihat statistik <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/15">
            <p className="text-xs text-blue-100">Laporan hari ini</p>
            <p className="mt-1 text-2xl font-bold">{loading ? "-" : stats?.todayCount || 0}</p>
          </div>
          <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/15">
            <p className="text-xs text-blue-100">Aktivitas 1 jam terakhir</p>
            <p className="mt-1 text-2xl font-bold">{loading ? "-" : stats?.lastHourCount || 0}</p>
          </div>
          <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/15">
            <p className="text-xs text-blue-100">Pekerjaan aktif</p>
            <p className="mt-1 text-2xl font-bold">{loading ? "-" : openWork}</p>
          </div>
        </div>
      </div>

      {urgentComplaints.filter((complaint) => ['OPEN', 'baru'].includes(complaint.status)).length > 0 && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30">
          <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3 text-red-700 dark:text-red-300">
              <div className="rounded-full bg-red-100 p-2 dark:bg-red-900"><AlertTriangle className="h-5 w-5" /></div>
              <div>
                <p className="font-semibold">{urgentComplaints.filter((complaint) => ['OPEN', 'baru'].includes(complaint.status)).length} laporan darurat aktif</p>
                <p className="text-sm opacity-80">Perlu ditangani segera oleh admin.</p>
              </div>
            </div>
            <Button asChild variant="destructive"><Link href="/dashboard/laporan">Buka laporan</Link></Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Total Laporan" value={stats?.complaints.total || 0} detail={`${stats?.todayCount || 0} masuk hari ini`} icon={<FileText className="h-5 w-5" />} tone="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" loading={loading} />
        <MetricCard title="Dalam Proses" value={(stats?.complaints.process || 0) + (stats?.services?.process || 0)} detail="laporan + permohonan" icon={<Loader2 className="h-5 w-5" />} tone="bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300" loading={loading} />
        <MetricCard title="Selesai" value={(stats?.complaints.done || 0) + (stats?.services?.done || 0)} detail={`${completionRate}% laporan selesai`} icon={<CheckCircle2 className="h-5 w-5" />} tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" loading={loading} />
        <MetricCard title="Ditolak/Batal" value={(stats?.complaints.reject || 0) + (stats?.complaints.canceled || 0) + (stats?.services?.reject || 0) + (stats?.services?.canceled || 0)} detail="butuh evaluasi alur" icon={<XCircle className="h-5 w-5" />} tone="bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" loading={loading} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-blue-600" /> Tren Mingguan</CardTitle>
            <CardDescription>Pergerakan laporan dan permohonan dari data statistik sistem.</CardDescription>
          </CardHeader>
          <CardContent className="h-80">
            {charts && trendPoints.length > 0 ? <charts.Line data={trendData} options={chartOptions} /> : <EmptyChart loading={!charts} label="Belum ada data tren" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><PieChart className="h-5 w-5 text-emerald-600" /> Status Laporan</CardTitle>
            <CardDescription>Distribusi status laporan masyarakat.</CardDescription>
          </CardHeader>
          <CardContent className="h-80">
            {charts && (stats?.complaints.total || 0) > 0 ? <charts.Doughnut data={complaintStatusData} options={doughnutOptions} /> : <EmptyChart loading={!charts || loading} label="Belum ada laporan" />}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-violet-600" /> Beban Kerja per Status</CardTitle>
            <CardDescription>Perbandingan laporan dan permohonan layanan.</CardDescription>
          </CardHeader>
          <CardContent className="h-80">
            {charts ? <charts.Bar data={statusBarData} options={chartOptions} /> : <EmptyChart loading label="Memuat chart" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-amber-600" /> Knowledge Base</CardTitle>
            <CardDescription>Kesiapan dokumen pengetahuan AI.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {!docStats ? (
              <div className="space-y-3"><Skeleton className="h-8 w-24" /><Skeleton className="h-3 w-full" /><Skeleton className="h-20 w-full" /></div>
            ) : (
              <>
                <div className="flex items-end justify-between">
                  <div><p className="text-3xl font-bold">{docStats.total.toLocaleString("id-ID")}</p><p className="text-sm text-muted-foreground">total dokumen</p></div>
                  <Badge variant="outline">{docStats.totalChunks.toLocaleString("id-ID")} chunks</Badge>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm"><span>Siap dipakai</span><span>{documentReadyRate}%</span></div>
                  <Progress value={documentReadyRate} />
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <MiniStat label="Completed" value={docStats.completed} className="text-emerald-600" />
                  <MiniStat label="Processing" value={docStats.processing} className="text-blue-600" />
                  <MiniStat label="Pending" value={docStats.pending} className="text-amber-600" />
                  <MiniStat label="Failed" value={docStats.failed} className="text-red-600" />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5 text-blue-600" /> Aktivitas Terbaru</CardTitle>
              <CardDescription>Laporan masyarakat terbaru dari sistem realtime.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm"><Link href="/dashboard/laporan">Semua <ArrowRight className="ml-1 h-4 w-4" /></Link></Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
            ) : recentComplaints.length === 0 ? (
              <div className="rounded-2xl border border-dashed py-10 text-center text-sm text-muted-foreground">Belum ada laporan terbaru.</div>
            ) : (
              <div className="space-y-3">
                {recentComplaints.slice(0, 6).map((complaint) => (
                  <Link key={complaint.id} href={`/dashboard/laporan/${complaint.id}`} className="flex items-start gap-3 rounded-2xl border p-3 transition-colors hover:bg-muted/50">
                    <div className={cn("rounded-xl p-2", complaint.is_urgent ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600")}>
                      {complaint.is_urgent ? <AlertTriangle className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{complaint.complaint_id}</p>
                        {statusBadge(complaint.status)}
                        {complaint.is_urgent && <Badge variant="destructive">Darurat</Badge>}
                      </div>
                      <p className="mt-1 truncate text-sm text-muted-foreground">{complaint.kategori?.replace(/_/g, " ")}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatTime(complaint.created_at, user?.village_timezone)}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-amber-600" /> Aksi Cepat</CardTitle>
            <CardDescription>Akses modul operasional utama.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <QuickAction href="/dashboard/laporan" icon={<FileText className="h-5 w-5" />} title="Kelola Laporan" desc="Tindak lanjuti laporan masyarakat" tone="bg-blue-100 text-blue-700" />
            <QuickAction href="/dashboard/pelayanan" icon={<CheckCircle2 className="h-5 w-5" />} title="Permohonan Layanan" desc="Pantau pengajuan layanan publik" tone="bg-emerald-100 text-emerald-700" />
            <QuickAction href="/dashboard/livechat" icon={<MessageCircle className="h-5 w-5" />} title="Live Chat" desc="Tangani percakapan WhatsApp" tone="bg-green-100 text-green-700" />
            <QuickAction href="/dashboard/knowledge" icon={<BookOpen className="h-5 w-5" />} title="Knowledge Base" desc="Perbarui sumber jawaban AI" tone="bg-amber-100 text-amber-700" />
            <QuickAction href="/dashboard/channel-settings" icon={<Settings className="h-5 w-5" />} title="Channel Settings" desc="Atur WhatsApp dan webchat" tone="bg-violet-100 text-violet-700" />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function EmptyChart({ loading, label }: { loading?: boolean; label: string }) {
  return (
    <div className="flex h-full items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground">
      {loading ? <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Memuat chart...</div> : label}
    </div>
  )
}

function MiniStat({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <p className={cn("text-lg font-bold", className)}>{value.toLocaleString("id-ID")}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function QuickAction({ href, icon, title, desc, tone }: { href: string; icon: React.ReactNode; title: string; desc: string; tone: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-2xl border p-3 transition-colors hover:bg-muted/50">
      <div className={cn("rounded-xl p-2", tone)}>{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-none">{title}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{desc}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}

export default function DashboardPage() {
  const { user } = useAuth()

  if (isSuperadmin(user?.role)) {
    return <SuperadminDashboard />
  }

  return <DashboardHome />
}
