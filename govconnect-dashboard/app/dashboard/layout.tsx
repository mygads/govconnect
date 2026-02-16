import type { Metadata } from "next"
import DashboardLayoutClient from "@/components/dashboard/DashboardLayoutClient"

export const metadata: Metadata = {
  title: "Dashboard | Tanggapin AI",
  description: "Admin dashboard for Tanggapin AI - Sistem layanan pemerintah berbasis WhatsApp",
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <DashboardLayoutClient>{children}</DashboardLayoutClient>
}
