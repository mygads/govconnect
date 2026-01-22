import type { Metadata } from "next"
import DashboardLayoutClient from "@/components/dashboard/DashboardLayoutClient"

export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: "Dashboard | GovConnect",
  description: "Admin dashboard for GovConnect - Sistem layanan pemerintah berbasis WhatsApp",
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <DashboardLayoutClient>{children}</DashboardLayoutClient>
}
