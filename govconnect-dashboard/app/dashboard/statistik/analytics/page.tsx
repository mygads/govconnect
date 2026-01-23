"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertCircle, TrendingUp, TrendingDown, Clock, Calendar, BarChart3, Activity, Zap } from "lucide-react"
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, PointElement, LineElement, Filler } from "chart.js"
import { Bar, Line, Doughnut } from "react-chartjs-2"
import { statistics } from "@/lib/frontend-api"
import { cn } from "@/lib/utils"

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, PointElement, LineElement, Filler)

interface TrendData {
  period: string
  labels: string[]
  trends: {
    complaints: number[]
    services: number[]
    total: number[]
  }
  predictions: {
    labels: string[]
    values: number[]
  }
  peakAnalysis: {
    peakHour: { hour: number; count: number; label: string }
    peakDay: { day: number; count: number; label: string }
    hourlyDistribution: number[]
    dailyDistribution: number[]
  }
  categoryTrends: Array<{
    kategori: string
    data: number[]
  }>
  summary: {
    totalComplaints: number
    totalServices: number
    avgPerPeriod: number
    growthRate: number
  }
}

export default function AnalyticsPage() {
  const [trendData, setTrendData] = useState<TrendData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('weekly')

  const fetchTrends = useCallback(async () => {
    try {
      setLoading(true)
      const data = await statistics.getTrends(period)
      setTrendData(data)
      setError(null)
    } catch (err: any) {
      setError(err.message || "Gagal memuat tren")
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    fetchTrends()
  }, [fetchTrends])

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
        <div className="grid gap-6 lg:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-64 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (error || !trendData) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-200px)]">
        <Card className="w-full max-w-md border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Gagal memuat data
            </CardTitle>
            <CardDescription>{error || "Tidak ada data"}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  // Main trend chart with predictions
  const trendChartData = {
    labels: [...trendData.labels, ...trendData.predictions.labels.map(l => `Prediksi ${l}`)],
    datasets: [
      {
        label: 'Laporan',
        data: [...trendData.trends.complaints, ...Array(trendData.predictions.labels.length).fill(null)],
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.3,
        fill: true,
      },
      {
        label: 'Permohonan Layanan',
        data: [...trendData.trends.services, ...Array(trendData.predictions.labels.length).fill(null)],
        borderColor: 'rgb(168, 85, 247)',
        backgroundColor: 'rgba(168, 85, 247, 0.1)',
        tension: 0.3,
        fill: true,
      },
      {
        label: 'Prediksi Total',
        data: [...Array(trendData.labels.length).fill(null), ...trendData.predictions.values],
        borderColor: 'rgb(234, 179, 8)',
        backgroundColor: 'rgba(234, 179, 8, 0.2)',
        borderDash: [5, 5],
        tension: 0.3,
        fill: false,
        pointStyle: 'star',
        pointRadius: 6,
      },
    ],
  }

  // Hourly distribution chart
  const hourlyChartData = {
    labels: Array.from({ length: 24 }, (_, i) => `${i}:00`),
    datasets: [
      {
        label: 'Jumlah Permohonan',
        data: trendData.peakAnalysis.hourlyDistribution,
        backgroundColor: trendData.peakAnalysis.hourlyDistribution.map((v, i) => 
          i === trendData.peakAnalysis.peakHour.hour 
            ? 'rgba(239, 68, 68, 0.8)' 
            : 'rgba(59, 130, 246, 0.6)'
        ),
        borderColor: trendData.peakAnalysis.hourlyDistribution.map((v, i) => 
          i === trendData.peakAnalysis.peakHour.hour 
            ? 'rgb(239, 68, 68)' 
            : 'rgb(59, 130, 246)'
        ),
        borderWidth: 1,
      },
    ],
  }

  // Daily distribution chart
  const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
  const dailyChartData = {
    labels: dayNames,
    datasets: [
      {
        label: 'Jumlah Permohonan',
        data: trendData.peakAnalysis.dailyDistribution,
        backgroundColor: trendData.peakAnalysis.dailyDistribution.map((v, i) => 
          i === trendData.peakAnalysis.peakDay.day 
            ? 'rgba(239, 68, 68, 0.8)' 
            : 'rgba(34, 197, 94, 0.6)'
        ),
        borderColor: trendData.peakAnalysis.dailyDistribution.map((v, i) => 
          i === trendData.peakAnalysis.peakDay.day 
            ? 'rgb(239, 68, 68)' 
            : 'rgb(34, 197, 94)'
        ),
        borderWidth: 2,
        borderRadius: 8,
      },
    ],
  }

  // Category trends chart
  const categoryColors = [
    { bg: 'rgba(59, 130, 246, 0.6)', border: 'rgb(59, 130, 246)' },
    { bg: 'rgba(168, 85, 247, 0.6)', border: 'rgb(168, 85, 247)' },
    { bg: 'rgba(236, 72, 153, 0.6)', border: 'rgb(236, 72, 153)' },
    { bg: 'rgba(251, 146, 60, 0.6)', border: 'rgb(251, 146, 60)' },
    { bg: 'rgba(34, 197, 94, 0.6)', border: 'rgb(34, 197, 94)' },
    { bg: 'rgba(14, 165, 233, 0.6)', border: 'rgb(14, 165, 233)' },
    { bg: 'rgba(239, 68, 68, 0.6)', border: 'rgb(239, 68, 68)' },
  ]

  const categoryTrendChartData = {
    labels: trendData.labels,
    datasets: trendData.categoryTrends.slice(0, 5).map((cat, index) => ({
      label: cat.kategori.replace(/_/g, ' '),
      data: cat.data,
      borderColor: categoryColors[index % categoryColors.length].border,
      backgroundColor: categoryColors[index % categoryColors.length].bg,
      tension: 0.3,
      fill: false,
    })),
  }

  // Summary donut
  const summaryDonutData = {
    labels: ['Laporan', 'Permohonan Layanan'],
    datasets: [
      {
        data: [trendData.summary.totalComplaints, trendData.summary.totalServices],
        backgroundColor: ['rgba(59, 130, 246, 0.8)', 'rgba(168, 85, 247, 0.8)'],
        borderColor: ['rgb(59, 130, 246)', 'rgb(168, 85, 247)'],
        borderWidth: 2,
      },
    ],
  }

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
      },
    },
  }

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
      },
    },
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Analisis Tren</h1>
          <p className="text-muted-foreground mt-2">
            Analisis tren laporan dan prediksi volume
          </p>
        </div>
        
        {/* Period Toggle */}
        <div className="flex items-center gap-2 bg-muted rounded-lg p-1">
          <button
            onClick={() => setPeriod('weekly')}
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-colors",
              period === 'weekly' 
                ? "bg-background shadow text-foreground" 
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Mingguan
          </button>
          <button
            onClick={() => setPeriod('monthly')}
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-colors",
              period === 'monthly' 
                ? "bg-background shadow text-foreground" 
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Bulanan
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Laporan</p>
                <p className="text-2xl font-bold">{trendData.summary.totalComplaints}</p>
              </div>
              <div className="h-12 w-12 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <BarChart3 className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Rata-rata/{period === 'weekly' ? 'Minggu' : 'Bulan'}</p>
                <p className="text-2xl font-bold">{trendData.summary.avgPerPeriod}</p>
              </div>
              <div className="h-12 w-12 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <Activity className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Laju Pertumbuhan</p>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-bold">{Math.abs(trendData.summary.growthRate)}%</p>
                  {trendData.summary.growthRate >= 0 ? (
                    <TrendingUp className="h-5 w-5 text-green-500" />
                  ) : (
                    <TrendingDown className="h-5 w-5 text-red-500" />
                  )}
                </div>
              </div>
              <div className={cn(
                "h-12 w-12 rounded-lg flex items-center justify-center",
                trendData.summary.growthRate >= 0 
                  ? "bg-green-100 dark:bg-green-900/30" 
                  : "bg-red-100 dark:bg-red-900/30"
              )}>
                {trendData.summary.growthRate >= 0 ? (
                  <TrendingUp className="h-6 w-6 text-green-600 dark:text-green-400" />
                ) : (
                  <TrendingDown className="h-6 w-6 text-red-600 dark:text-red-400" />
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Prediksi Berikutnya</p>
                <p className="text-2xl font-bold">{trendData.predictions.values[0] || 0}</p>
              </div>
              <div className="h-12 w-12 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
                <Zap className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Tren Laporan & Prediksi
          </CardTitle>
          <CardDescription>
            Grafik tren laporan dan permohonan layanan {period === 'weekly' ? 'per minggu' : 'per bulan'} dengan prediksi
          </CardDescription>
        </CardHeader>
        <CardContent className="h-80">
          <Line data={trendChartData} options={chartOptions} />
        </CardContent>
      </Card>

      {/* Peak Analysis */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Peak Hours */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Distribusi Jam
            </CardTitle>
            <CardDescription>
              Jam sibuk: <span className="font-semibold text-red-500">{trendData.peakAnalysis.peakHour.label}</span>
              {" "}({trendData.peakAnalysis.peakHour.count} laporan)
            </CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            <Bar data={hourlyChartData} options={barOptions} />
          </CardContent>
        </Card>

        {/* Peak Days */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Distribusi Hari
            </CardTitle>
            <CardDescription>
              Hari tersibuk: <span className="font-semibold text-red-500">{trendData.peakAnalysis.peakDay.label}</span>
              {" "}({trendData.peakAnalysis.peakDay.count} laporan)
            </CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            <Bar data={dailyChartData} options={barOptions} />
          </CardContent>
        </Card>
      </div>

      {/* Category Trends & Summary */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Category Trends */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Tren per Kategori</CardTitle>
            <CardDescription>
              Perubahan tren untuk top 5 kategori laporan
            </CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {trendData.categoryTrends.length > 0 ? (
              <Line data={categoryTrendChartData} options={chartOptions} />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                Tidak ada data kategori
              </div>
            )}
          </CardContent>
        </Card>

        {/* Distribution Summary */}
        <Card>
          <CardHeader>
            <CardTitle>Distribusi Total</CardTitle>
            <CardDescription>
              Perbandingan laporan vs permohonan layanan
            </CardDescription>
          </CardHeader>
          <CardContent className="h-72 flex items-center justify-center">
            <div className="w-48 h-48">
              <Doughnut 
                data={summaryDonutData} 
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      position: 'bottom' as const,
                    },
                  },
                }} 
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Peak Analysis Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-orange-200 dark:border-orange-900/50 bg-orange-50/50 dark:bg-orange-900/10">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center flex-shrink-0">
                <Clock className="h-6 w-6 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Insight Jam Tersibuk</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Laporan paling banyak masuk pada jam <span className="font-bold text-orange-600">{trendData.peakAnalysis.peakHour.label}</span>.
                  Pastikan admin tersedia pada waktu tersebut untuk respons cepat.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-green-200 dark:border-green-900/50 bg-green-50/50 dark:bg-green-900/10">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                <Calendar className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Insight Hari Tersibuk</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Hari <span className="font-bold text-green-600">{trendData.peakAnalysis.peakDay.label}</span> adalah hari tersibuk.
                  Pertimbangkan untuk menambah sumber daya pada hari tersebut.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
