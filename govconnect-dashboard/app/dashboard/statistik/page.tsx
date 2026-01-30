"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertCircle } from "lucide-react"
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, PointElement, LineElement } from "chart.js"
import { Bar, Pie, Line } from "react-chartjs-2"
import { statistics } from "@/lib/frontend-api"

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, PointElement, LineElement)

interface Statistics {
  complaints: {
    total: number
    open: number
    process: number
    done: number
    canceled: number
    reject: number
    by_kategori?: Record<string, number>
  }
  services: {
    total: number
    open: number
    process: number
    done: number
    canceled: number
    reject: number
  }
}

export default function StatistikPage() {
  const [stats, setStats] = useState<Statistics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchStatistics()
  }, [])

  const fetchStatistics = async () => {
    try {
      setLoading(true)
      const data = await statistics.getOverview()
      setStats(data)
      setError(null)
    } catch (err: any) {
      setError(err.message || "Gagal memuat statistik")
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid gap-6 md:grid-cols-2">
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

  if (error || !stats) {
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

  // Complaint Status Distribution
  const complaintStatusData = {
    labels: ["Baru", "Proses", "Selesai", "Dibatalkan", "Ditolak"],
    datasets: [
      {
        label: "Jumlah Laporan",
        data: [stats.complaints.open, stats.complaints.process, stats.complaints.done, stats.complaints.canceled, stats.complaints.reject],
        backgroundColor: ["rgba(234, 179, 8, 0.6)", "rgba(249, 115, 22, 0.6)", "rgba(34, 197, 94, 0.6)", "rgba(148, 163, 184, 0.6)", "rgba(239, 68, 68, 0.6)"],
        borderColor: ["rgb(234, 179, 8)", "rgb(249, 115, 22)", "rgb(34, 197, 94)", "rgb(148, 163, 184)", "rgb(239, 68, 68)"],
        borderWidth: 2,
      },
    ],
  }

  // Service Request Status Distribution
  const serviceStatusData = {
    labels: ["Baru", "Proses", "Selesai", "Dibatalkan", "Ditolak"],
    datasets: [
      {
        label: "Jumlah Permohonan",
        data: [stats.services.open, stats.services.process, stats.services.done, stats.services.canceled, stats.services.reject],
        backgroundColor: ["rgba(234, 179, 8, 0.6)", "rgba(249, 115, 22, 0.6)", "rgba(34, 197, 94, 0.6)", "rgba(148, 163, 184, 0.6)", "rgba(239, 68, 68, 0.6)"],
        borderColor: ["rgb(234, 179, 8)", "rgb(249, 115, 22)", "rgb(34, 197, 94)", "rgb(148, 163, 184)", "rgb(239, 68, 68)"],
        borderWidth: 2,
      },
    ],
  }

  // Complaint by Kategori
  const complaintByKategoriData = {
    labels: stats.complaints.by_kategori ? Object.keys(stats.complaints.by_kategori).map(k => k.replace(/_/g, " ")) : [],
    datasets: [
      {
        label: "Laporan per Kategori",
        data: stats.complaints.by_kategori ? Object.values(stats.complaints.by_kategori) : [],
        backgroundColor: [
          "rgba(59, 130, 246, 0.6)",
          "rgba(168, 85, 247, 0.6)",
          "rgba(236, 72, 153, 0.6)",
          "rgba(251, 146, 60, 0.6)",
          "rgba(34, 197, 94, 0.6)",
          "rgba(14, 165, 233, 0.6)",
        ],
        borderColor: [
          "rgb(59, 130, 246)",
          "rgb(168, 85, 247)",
          "rgb(236, 72, 153)",
          "rgb(251, 146, 60)",
          "rgb(34, 197, 94)",
          "rgb(14, 165, 233)",
        ],
        borderWidth: 2,
      },
    ],
  }


  const chartOptions = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        position: "top" as const,
      },
    },
  }

  const pieOptions = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        position: "right" as const,
      },
    },
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Statistik & Laporan</h1>
        <p className="text-muted-foreground mt-2">
          Visualisasi data laporan dan permohonan layanan
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Distribusi Status Laporan</CardTitle>
            <CardDescription>
              Total {stats.complaints.total} laporan berdasarkan status
            </CardDescription>
          </CardHeader>
          <CardContent className="h-80">
            <Bar data={complaintStatusData} options={chartOptions} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Distribusi Status Permohonan</CardTitle>
            <CardDescription>
              Total {stats.services.total} permohonan berdasarkan status
            </CardDescription>
          </CardHeader>
          <CardContent className="h-80">
            <Bar data={serviceStatusData} options={chartOptions} />
          </CardContent>
        </Card>

        {stats.complaints.by_kategori && Object.keys(stats.complaints.by_kategori).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Laporan Berdasarkan Kategori</CardTitle>
              <CardDescription>
                Distribusi kategori dari semua laporan masuk
              </CardDescription>
            </CardHeader>
            <CardContent className="h-80 flex items-center justify-center">
              <Pie data={complaintByKategoriData} options={pieOptions} />
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  )
}
