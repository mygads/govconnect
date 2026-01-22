"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import {
  LayoutDashboard,
  FileText,
  BarChart3,
  ChevronRight,
  Smartphone,
  MessageCircle,
  Download,
  TrendingUp,
  Shield,
  Brain,
  Activity,
  Settings2,
  Bell,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useAuth } from "@/components/auth/AuthContext"
import { canAccess, type AdminRole } from "@/lib/rbac"

export function GovConnectSidebar() {
  const pathname = usePathname()
  const { theme, resolvedTheme } = useTheme()
  const { state } = useSidebar()
  const { user } = useAuth()

  const isActivePath = (path: string) => {
    // Exact match for dashboard home
    if (path === "/dashboard") {
      return pathname === path
    }
    // Exact match for statistik (not its children)
    if (path === "/dashboard/statistik") {
      return pathname === path
    }
    // For other paths, use startsWith but ensure it's a complete segment
    if (pathname === path) {
      return true
    }
    // Check if path is a parent of current pathname (must be followed by /)
    return pathname.startsWith(path + "/")
  }

  const menuItems = [
    {
      title: "Ringkasan",
      items: [
        {
          title: "Dashboard",
          url: "/dashboard",
          icon: LayoutDashboard,
        },
        {
          title: "Statistik",
          url: "/dashboard/statistik",
          icon: BarChart3,
        },
        {
          title: "Trend Analitik",
          url: "/dashboard/statistik/analytics",
          icon: TrendingUp,
          roles: ["superadmin"],
        },
      ],
    },
    {
      title: "Pengaduan",
      items: [
        {
          title: "Daftar Pengaduan",
          url: "/dashboard/laporan",
          icon: FileText,
        },
        {
          title: "Kategori & Jenis",
          url: "/dashboard/pengaduan/kategori-jenis",
          icon: Shield,
        },
        {
          title: "Ekspor Laporan",
          url: "/dashboard/export",
          icon: Download,
        },
      ],
    },
    {
      title: "Layanan",
      items: [
        {
          title: "Katalog Layanan",
          url: "/dashboard/layanan",
          icon: Settings2,
        },
        {
          title: "Permohonan Layanan",
          url: "/dashboard/pelayanan",
          icon: FileText,
        },
      ],
    },
    {
      title: "Channel",
      items: [
        {
          title: "Channel Connect",
          url: "/dashboard/channel-settings",
          icon: Smartphone,
        },
        {
          title: "Live Chat & Takeover",
          url: "/dashboard/livechat",
          icon: MessageCircle,
        },
      ],
    },
    {
      title: "Basis Pengetahuan",
      items: [
        {
          title: "Knowledge Base & Dokumen",
          url: "/dashboard/knowledge",
          icon: Brain,
        },
        {
          title: "Uji Pengetahuan",
          url: "/dashboard/testing-knowledge",
          icon: Activity,
        },
      ],
    },
    {
      title: "Pengaturan",
      items: [
        {
          title: "Profil Desa",
          url: "/dashboard/village-profile",
          icon: Settings2,
        },
        {
          title: "Nomor Penting",
          url: "/dashboard/important-contacts",
          icon: Bell,
        },
        {
          title: "Akun Admin",
          url: "/dashboard/settings",
          icon: Settings2,
        },
        {
          title: "Pengaturan Notifikasi",
          url: "/dashboard/settings/notifications",
          icon: Bell,
        },
      ],
    },
    {
      title: "Super Admin",
      items: [
        {
          title: "Daftar Desa",
          url: "/dashboard/superadmin/villages",
          icon: Shield,
          roles: ["superadmin"],
        },
        {
          title: "Admin Desa",
          url: "/dashboard/superadmin/admins",
          icon: Settings2,
          roles: ["superadmin"],
        },
        {
          title: "AI Analytics",
          url: "/dashboard/ai-analytics",
          icon: Activity,
          roles: ["superadmin"],
        },
        {
          title: "Rate Limit & Blacklist",
          url: "/dashboard/settings/rate-limit",
          icon: Shield,
          roles: ["superadmin"],
        },
      ],
    },
  ]

  const currentTheme = resolvedTheme || theme || "light"
  const logoSrc = currentTheme === "dark" ? "/logo-dashboard-dark.png" : "/logo-dashboard.png"

  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-white dark:bg-gray-950">
      <SidebarHeader className="border-b border-border p-4 bg-white dark:bg-gray-950">
        <Link href="/dashboard" className="flex items-center gap-2">
          {state === "expanded" ? (
            <div className="relative h-10 w-40 shrink-0">
              <Image
                src={logoSrc}
                alt="GovConnect Logo"
                fill
                className="object-contain object-left"
                priority
              />
            </div>
          ) : (
            <div className="relative h-8 w-8 mx-auto">
              <Image
                src="/logo.png"
                alt="GovConnect Logo"
                fill
                className="object-contain"
                priority
              />
            </div>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className="bg-white dark:bg-gray-950">
        {menuItems.map((group, index) => {
          const allowedItems = group.items.filter((item) =>
            canAccess(user?.role as AdminRole, item.roles as AdminRole[])
          )

          if (allowedItems.length === 0) return null

          return (
            <SidebarGroup key={index}>
              <SidebarGroupLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {group.title}
              </SidebarGroupLabel>
              <SidebarMenu>
                {allowedItems.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActivePath(item.url)}
                      tooltip={item.title}
                      className={`
                        group relative transition-all duration-200 hover:bg-accent/80
                        ${isActivePath(item.url) 
                          ? 'bg-primary/10 dark:bg-primary/20 text-primary font-semibold border-l-4 border-primary' 
                          : 'text-muted-foreground hover:text-foreground'
                        }
                      `}
                    >
                      <Link href={item.url} className="flex items-center gap-3 w-full">
                        <item.icon className={`h-4 w-4 shrink-0 transition-colors ${
                          isActivePath(item.url) ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                        }`} />
                        <span className="flex-1">{item.title}</span>
                        {isActivePath(item.url) && state === "expanded" && (
                          <ChevronRight className="h-4 w-4 text-primary" />
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          )
        })}
      </SidebarContent>
    </Sidebar>
  )
}
