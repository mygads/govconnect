"use client"

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SERVICE_REQUEST_STATUS_LABELS, REPORT_STATUS_LABELS } from '@/lib/types'

interface DashboardStats {
  requests: {
    total: number
    pending: number
    processing: number
    completed: number
    today: number
    thisWeek: number
    thisMonth: number
  }
  reports: {
    total: number
    pending: number
    inProgress: number
    resolved: number
    today: number
  }
  conversations: {
    active: number
    today: number
  }
  services: {
    total: number
    active: number
  }
  recent: {
    requests: any[]
    reports: any[]
  }
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchDashboardStats()
  }, [])

  const fetchDashboardStats = async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/village/dashboard', {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (data.success) {
        setStats(data.data)
      } else {
        setError(data.error || 'Gagal memuat data')
      }
    } catch (err) {
      setError('Gagal terhubung ke server')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Dashboard Overview</h1>
        <p className="text-muted-foreground mt-2">Selamat datang di GovConnect Admin Dashboard</p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Permohonan Pending */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Permohonan Pending</p>
              <p className="text-3xl font-bold text-orange-600">{stats?.requests.pending || 0}</p>
            </div>
            <div className="h-12 w-12 bg-orange-100 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Dari {stats?.requests.total || 0} total permohonan</p>
        </div>

        {/* Pengaduan Aktif */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Pengaduan Aktif</p>
              <p className="text-3xl font-bold text-red-600">{(stats?.reports.pending || 0) + (stats?.reports.inProgress || 0)}</p>
            </div>
            <div className="h-12 w-12 bg-red-100 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Dari {stats?.reports.total || 0} total pengaduan</p>
        </div>

        {/* Percakapan Aktif */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Percakapan Aktif</p>
              <p className="text-3xl font-bold text-green-600">{stats?.conversations.active || 0}</p>
            </div>
            <div className="h-12 w-12 bg-green-100 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">{stats?.conversations.today || 0} percakapan hari ini</p>
        </div>

        {/* Layanan Aktif */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Layanan Aktif</p>
              <p className="text-3xl font-bold text-blue-600">{stats?.services.active || 0}</p>
            </div>
            <div className="h-12 w-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Dari {stats?.services.total || 0} total layanan</p>
        </div>
      </div>

      {/* Period Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Permohonan Hari Ini</p>
          <p className="text-2xl font-bold">{stats?.requests.today || 0}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Permohonan Minggu Ini</p>
          <p className="text-2xl font-bold">{stats?.requests.thisWeek || 0}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Permohonan Bulan Ini</p>
          <p className="text-2xl font-bold">{stats?.requests.thisMonth || 0}</p>
        </div>
      </div>

      {/* Recent Items */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Requests */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border">
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="font-semibold">Permohonan Terbaru</h3>
            <Link href="/dashboard/requests" className="text-sm text-blue-600 hover:underline">
              Lihat Semua →
            </Link>
          </div>
          <div className="divide-y">
            {stats?.recent.requests && stats.recent.requests.length > 0 ? (
              stats.recent.requests.map((req: any) => (
                <div key={req.id} className="p-4 hover:bg-muted/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{req.applicant_name}</p>
                      <p className="text-sm text-muted-foreground">{req.service?.name}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      req.status === 'SUBMITTED' ? 'bg-yellow-100 text-yellow-700' :
                      req.status === 'PROCESSING' ? 'bg-blue-100 text-blue-700' :
                      req.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {SERVICE_REQUEST_STATUS_LABELS[req.status as keyof typeof SERVICE_REQUEST_STATUS_LABELS] || req.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {req.ticket_number} • {new Date(req.created_at).toLocaleDateString('id-ID')}
                  </p>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                Belum ada permohonan
              </div>
            )}
          </div>
        </div>

        {/* Recent Reports */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border">
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="font-semibold">Pengaduan Terbaru</h3>
            <Link href="/dashboard/reports" className="text-sm text-blue-600 hover:underline">
              Lihat Semua →
            </Link>
          </div>
          <div className="divide-y">
            {stats?.recent.reports && stats.recent.reports.length > 0 ? (
              stats.recent.reports.map((report: any) => (
                <div key={report.id} className="p-4 hover:bg-muted/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{report.reporter_name}</p>
                      <p className="text-sm text-muted-foreground">{report.type?.name}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      report.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' :
                      report.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' :
                      report.status === 'RESOLVED' ? 'bg-green-100 text-green-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {REPORT_STATUS_LABELS[report.status as keyof typeof REPORT_STATUS_LABELS] || report.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {report.ticket_number} • {new Date(report.created_at).toLocaleDateString('id-ID')}
                  </p>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                Belum ada pengaduan
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border p-6">
        <h3 className="font-semibold mb-4">Aksi Cepat</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Link 
            href="/dashboard/services" 
            className="p-4 rounded-lg border hover:bg-muted/50 transition-colors flex items-center gap-3"
          >
            <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <div>
              <p className="font-medium">Tambah Layanan</p>
              <p className="text-sm text-muted-foreground">Buat layanan baru</p>
            </div>
          </Link>
          
          <Link 
            href="/dashboard/knowledge" 
            className="p-4 rounded-lg border hover:bg-muted/50 transition-colors flex items-center gap-3"
          >
            <div className="h-10 w-10 rounded-lg bg-purple-100 flex items-center justify-center">
              <svg className="h-5 w-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <div>
              <p className="font-medium">Knowledge Base</p>
              <p className="text-sm text-muted-foreground">Kelola informasi AI</p>
            </div>
          </Link>

          <Link 
            href="/dashboard/numbers" 
            className="p-4 rounded-lg border hover:bg-muted/50 transition-colors flex items-center gap-3"
          >
            <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
              <svg className="h-5 w-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <div>
              <p className="font-medium">Nomor Penting</p>
              <p className="text-sm text-muted-foreground">Kelola kontak darurat</p>
            </div>
          </Link>

          <Link 
            href="/dashboard/channels" 
            className="p-4 rounded-lg border hover:bg-muted/50 transition-colors flex items-center gap-3"
          >
            <div className="h-10 w-10 rounded-lg bg-teal-100 flex items-center justify-center">
              <svg className="h-5 w-5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </div>
            <div>
              <p className="font-medium">Channel</p>
              <p className="text-sm text-muted-foreground">Hubungkan WhatsApp</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
