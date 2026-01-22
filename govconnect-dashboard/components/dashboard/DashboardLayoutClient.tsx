"use client"

import type React from "react"
import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { GovConnectSidebar } from "@/components/dashboard/GovConnectSidebar"
import { DashboardNavbar } from "@/components/dashboard/DashboardNavbar"
import { RealtimeProvider } from "@/components/dashboard/RealtimeProvider"
import { UrgentAlertBanner } from "@/components/dashboard/NotificationCenter"
import { LiveChatWidget } from "@/components/landing/LiveChatWidget"
import { useAuth } from "@/components/auth/AuthContext"
import { isRouteAllowed, type AdminRole } from "@/lib/rbac"

interface DashboardLayoutClientProps {
  children: React.ReactNode
}

export default function DashboardLayoutClient({ children }: DashboardLayoutClientProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, isLoading } = useAuth()

  useEffect(() => {
    if (isLoading || !user) return
    if (!isRouteAllowed(user.role as AdminRole, pathname)) {
      router.replace('/dashboard')
    }
  }, [isLoading, pathname, router, user])

  return (
    <RealtimeProvider>
      <SidebarProvider>
        <GovConnectSidebar />
        <SidebarInset>
          <UrgentAlertBanner />
          <DashboardNavbar />
          <main className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900 p-4 md:p-6">
            {children}
          </main>
        </SidebarInset>
        {/* Live Chat Widget */}
        <LiveChatWidget />
      </SidebarProvider>
    </RealtimeProvider>
  )
}
