"use client"

import { RealtimeStatsGrid, RecentComplaintsCard } from "@/components/dashboard/RealtimeStats"

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Ringkasan Dashboard</h1>
        <p className="text-muted-foreground mt-2">Selamat datang di Dashboard Admin GovConnect</p>
      </div>

      {/* Real-time Stats Grid */}
      <RealtimeStatsGrid />

      {/* Recent Complaints */}
      <div className="grid gap-6 lg:grid-cols-2">
        <RecentComplaintsCard />
        
        {/* Quick Actions Card - Optional */}
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
              href="/dashboard/settings/notifications" 
              className="p-4 rounded-lg border hover:bg-muted/50 transition-colors flex items-center gap-3"
            >
              <div className="h-10 w-10 rounded-lg bg-red-100 flex items-center justify-center">
                <svg className="h-5 w-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </div>
              <div>
                <p className="font-medium">Pengaturan Notifikasi</p>
                <p className="text-sm text-muted-foreground">Atur alert laporan darurat</p>
              </div>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
