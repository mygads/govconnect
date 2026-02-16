"use client"

import { RealtimeStatsGrid, RecentComplaintsCard } from "@/components/dashboard/RealtimeStats"
import { useAuth } from "@/components/auth/AuthContext"
import { isSuperadmin } from "@/lib/rbac"
import { SuperadminDashboard } from "@/components/dashboard/SuperadminDashboard"

export default function DashboardPage() {
  const { user } = useAuth()

  // Superadmin gets a completely different dashboard
  if (isSuperadmin(user?.role)) {
    return <SuperadminDashboard />
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Ringkasan Dashboard</h1>
        <p className="text-muted-foreground mt-2">Selamat datang di Dashboard Admin Tanggapin AI</p>
      </div>

      {/* Real-time Stats Grid */}
      <RealtimeStatsGrid />

      {/* Recent Complaints */}
      <div className="grid gap-6 lg:grid-cols-2">
        <RecentComplaintsCard />
        
        {/* Quick Actions Card */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Aksi Cepat</h3>
          <div className="grid gap-3">
            <a 
              href="/dashboard/laporan" 
              className="p-4 rounded-lg border hover:bg-muted/50 transition-colors flex items-center gap-3"
            >
              <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <p className="font-medium">Lihat Semua Laporan</p>
                <p className="text-sm text-muted-foreground">Kelola laporan masyarakat</p>
              </div>
            </a>
            
            <a 
              href="/dashboard/livechat" 
              className="p-4 rounded-lg border hover:bg-muted/50 transition-colors flex items-center gap-3"
            >
              <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
                <svg className="h-5 w-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <div>
                <p className="font-medium">Live Chat</p>
                <p className="text-sm text-muted-foreground">Tangani percakapan WhatsApp</p>
              </div>
            </a>
            
            <a 
              href="/dashboard/channel-settings" 
              className="p-4 rounded-lg border hover:bg-muted/50 transition-colors flex items-center gap-3"
            >
              <div className="h-10 w-10 rounded-lg bg-purple-100 flex items-center justify-center">
                <svg className="h-5 w-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <p className="font-medium">Pengaturan Channel</p>
                <p className="text-sm text-muted-foreground">Atur koneksi WhatsApp</p>
              </div>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
