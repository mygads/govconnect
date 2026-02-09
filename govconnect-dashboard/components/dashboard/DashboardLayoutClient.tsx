"use client"

import type React from "react"
import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { GovConnectSidebar } from "@/components/dashboard/GovConnectSidebar"
import { DashboardNavbar } from "@/components/dashboard/DashboardNavbar"
import { RealtimeProvider } from "@/components/dashboard/RealtimeProvider"
import { UrgentAlertBanner } from "@/components/dashboard/NotificationCenter"
// LiveChatWidget removed — only shown on landing page and form pages
import { useAuth } from "@/components/auth/AuthContext"
import { isRouteAllowed, isSuperadmin, type AdminRole } from "@/lib/rbac"

interface DashboardLayoutClientProps {
  children: React.ReactNode
}

export default function DashboardLayoutClient({ children }: DashboardLayoutClientProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, isLoading } = useAuth()

  const userIsSuperadmin = isSuperadmin(user?.role)

  useEffect(() => {
    if (isLoading || !user) return
    if (!isRouteAllowed(user.role as AdminRole, pathname)) {
      router.replace('/dashboard')
    }
  }, [isLoading, pathname, router, user])

  const dashboardContent = (
    <SidebarProvider>
      <GovConnectSidebar />
      <SidebarInset>
        {!userIsSuperadmin && <UrgentAlertBanner />}
        <DashboardNavbar />
        <main className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900 p-4 md:p-6">
          {children}
        </main>
      </SidebarInset>
      {/* Live Chat Widget removed — only shown on landing page & form pages */}
    </SidebarProvider>
  )

  // Superadmin doesn't need RealtimeProvider (village complaint polling)
  if (userIsSuperadmin) {
    return dashboardContent
  }

  return (
    <RealtimeProvider>
      {dashboardContent}
    </RealtimeProvider>
  )
}
