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
  TrendingUp,
  Shield,
  ShieldCheck,
  FileWarning,
  Brain,
  Activity,
  Settings2,
  Bell,
  Bot,
  Cpu,
  Database,
  UserPlus,
  Target,
  HeartPulse,
  Plug,
  MessageSquare,
  Wallet,
  Megaphone,
  Lightbulb,
  Star,
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

interface MenuItem {
  title: string
  url: string
  icon: React.ComponentType<{ className?: string }>
  roles?: string[]
  excludeRoles?: string[]
  exact?: boolean
  /** When set, a pending-count badge is fetched and shown (village admin only). */
  badgeKey?: "ktp-pending"
}

interface MenuGroup {
  title: string
  items: MenuItem[]
}

export function GovConnectSidebar() {
  const pathname = usePathname()
  const { theme, resolvedTheme } = useTheme()
  const { state } = useSidebar()
  const { user } = useAuth()
  const [ktpPending, setKtpPending] = React.useState<number | null>(null)

  // Pending KTP verification count for the sidebar badge (village admins).
  React.useEffect(() => {
    if (user?.role === "superadmin") return
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch("/api/ktp-verifications?status=pending&limit=1")
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && typeof data?.pendingCount === "number") {
          setKtpPending(data.pendingCount)
        }
      } catch {
        // badge stays hidden on error — never blocks navigation
      }
    }
    load()
    const t = setInterval(load, 60000)
    return () => { cancelled = true; clearInterval(t) }
  }, [user?.role])

  const isActivePath = (item: MenuItem) => {
    if (item.exact || item.url === "/dashboard" || item.url === "/dashboard/statistik") {
      return pathname === item.url
    }

    if (pathname === item.url) {
      return true
    }

    return pathname.startsWith(item.url + "/")
  }

  const menuItems: MenuGroup[] = [
    // === SHARED: Dashboard (shown to all, but content differs) ===
    {
      title: "Ringkasan",
      items: [
        {
          title: "Dashboard",
          url: "/dashboard",
          icon: LayoutDashboard,
        },
      ],
    },

    // === VILLAGE ADMIN ONLY: Layanan ===
    {
      title: "Layanan Publik",
      items: [
        {
          title: "Daftar Pengaduan",
          url: "/dashboard/laporan",
          icon: FileText,
          excludeRoles: ["superadmin"],
        },
        {
          title: "Permohonan Layanan",
          url: "/dashboard/pelayanan",
          icon: FileText,
          excludeRoles: ["superadmin"],
        },
        {
          title: "Verifikasi Identitas",
          url: "/dashboard/verifikasi-identitas",
          icon: ShieldCheck,
          excludeRoles: ["superadmin"],
          badgeKey: "ktp-pending",
        },
        {
          title: "Sinyal Bukti",
          url: "/dashboard/sinyal-bukti",
          icon: FileWarning,
          excludeRoles: ["superadmin"],
        },
      ],
    },
    // === VILLAGE ADMIN ONLY: Channel ===
    {
      title: "Channel",
      items: [
        {
          title: "Pesan Masuk",
          url: "/dashboard/livechat",
          icon: MessageCircle,
          excludeRoles: ["superadmin"],
        },
      ],
    },
    // === VILLAGE ADMIN ONLY: Pengaturan Desa ===
    {
      title: "Pengaturan Desa",
      items: [
        {
          title: "Profil Desa",
          url: "/dashboard/village-profile",
          icon: Settings2,
          excludeRoles: ["superadmin"],
        },
        {
          title: "Nomor Penting",
          url: "/dashboard/important-contacts",
          icon: Bell,
          excludeRoles: ["superadmin"],
        },
        {
          title: "Kategori Pengaduan",
          url: "/dashboard/pengaduan/kategori-jenis",
          icon: Shield,
          excludeRoles: ["superadmin"],
        },
        {
          title: "Katalog Layanan",
          url: "/dashboard/layanan",
          icon: Settings2,
          excludeRoles: ["superadmin"],
        },

        {
          title: "Basis Pengetahuan",
          url: "/dashboard/knowledge",
          icon: Brain,
          excludeRoles: ["superadmin"],
        },
        {
          title: "WhatsApp",
          url: "/dashboard/channel-settings",
          icon: Smartphone,
          excludeRoles: ["superadmin"],
        },
      ],
    },
        // === VILLAGE ADMIN ONLY: Statistik ===
    {
      title: "Statistik",
      items: [
        {
          title: "Statistik",
          url: "/dashboard/statistik",
          icon: BarChart3,
          excludeRoles: ["superadmin"],
        },
        {
          title: "Analisis Tren",
          url: "/dashboard/statistik/analytics",
          icon: TrendingUp,
          excludeRoles: ["superadmin"],
        },
      ],
    },
    {
      title: "Pengaturan Lanjutan",
      items: [
        {
          title: "Identitas AI",
          url: "/dashboard/settings/identitas-ai",
          icon: Bot,
          excludeRoles: ["superadmin"],
        },
        {
          title: "Pengaturan Notifikasi",
          url: "/dashboard/settings/notifications",
          icon: Bell,
          excludeRoles: ["superadmin"],
        },
        {
          title: "Rate Limit & Blacklist",
          url: "/dashboard/settings/rate-limit",
          icon: Shield,
          excludeRoles: ["superadmin"],
        },
        {
          title: "Analitik Knowledge",
          url: "/dashboard/knowledge-analytics",
          icon: Target,
          excludeRoles: ["superadmin"],
        },
        {
          title: "Uji Pengetahuan",
          url: "/dashboard/testing-knowledge",
          icon: Activity,
          excludeRoles: ["superadmin"],
        },
        {
          title: "Statistik AI",
          url: "/dashboard/ai-usage",
          icon: Cpu,
          excludeRoles: ["superadmin"],
        },
        {
          title: "Saldo AI",
          url: "/dashboard/ai-balance",
          icon: Wallet,
          excludeRoles: ["superadmin"],
        },
      ],
    },
    // === SUPERADMIN ONLY: Kelola Desa & Admin ===
    {
      title: "Kelola Desa",
      items: [
        {
          title: "Register Desa Baru",
          url: "/dashboard/superadmin/register",
          icon: UserPlus,
          roles: ["superadmin"],
        },
        {
          title: "Daftar Desa",
          url: "/dashboard/superadmin/villages",
          icon: Shield,
          roles: ["superadmin"],
        },
        {
          title: "Admin Desa",
          url: "/dashboard/superadmin/village-admins",
          icon: Settings2,
          roles: ["superadmin"],
        },
      ],
    },
    // === SUPERADMIN ONLY: AI & Monitoring ===
    {
      title: "AI & Monitoring",
      items: [
        {
          title: "AI Token Usage",
          url: "/dashboard/superadmin/ai-usage",
          icon: Cpu,
          roles: ["superadmin"],
        },
        {
          title: "AI Generation Logs",
          url: "/dashboard/superadmin/ai-generations",
          icon: Activity,
          roles: ["superadmin"],
        },
        {
          title: "AI Providers",
          url: "/dashboard/superadmin/providers",
          icon: Plug,
          roles: ["superadmin"],
          exact: true,
        },
        {
          title: "AI Models",
          url: "/dashboard/superadmin/providers/models",
          icon: Brain,
          roles: ["superadmin"],
        },
        {
          title: "Lane Assignments",
          url: "/dashboard/superadmin/providers/assignments",
          icon: Activity,
          roles: ["superadmin"],
        },
        {
          title: "AI Wallets",
          url: "/dashboard/superadmin/ai-wallets",
          icon: Wallet,
          roles: ["superadmin"],
        },
        {
          title: "Billing Reconciliation",
          url: "/dashboard/superadmin/ai-billing-reconciliation",
          icon: BarChart3,
          roles: ["superadmin"],
        },
        {
          title: "System Health",
          url: "/dashboard/superadmin/system-health",
          icon: HeartPulse,
          roles: ["superadmin"],
        },
        {
          title: "Cek Koneksi LLM",
          url: "/dashboard/superadmin/llm-check",
          icon: Plug,
          roles: ["superadmin"],
        },
        {
          title: "WA Support V2",
          url: "/dashboard/superadmin/whatsapp",
          icon: MessageSquare,
          roles: ["superadmin"],
        },
      ],
    },
    // === SUPERADMIN ONLY: Pengaturan Sistem ===
    {
      title: "Pengaturan Sistem",
      items: [
        {
          title: "Cache Management",
          url: "/dashboard/settings/cache",
          icon: Database,
          roles: ["superadmin"],
        },
      ],
    },
    // === Fase-2: AI & perbaikan berkelanjutan (track B) ===
    {
      title: "AI & Perbaikan",
      items: [
        {
          title: "Laporan Kecamatan",
          url: "/dashboard/laporan-kecamatan",
          icon: BarChart3,
        },
        {
          title: "Broadcast",
          url: "/dashboard/broadcast",
          icon: Megaphone,
          excludeRoles: ["superadmin"],
        },
        {
          title: "Proposal KB",
          url: "/dashboard/proposal-kb",
          icon: Lightbulb,
          excludeRoles: ["superadmin"],
        },
        {
          title: "Skills Agen",
          url: "/dashboard/skills",
          icon: Brain,
          excludeRoles: ["superadmin"],
        },
        {
          title: "Tindak Lanjut CSAT",
          url: "/dashboard/csat-followup",
          icon: Star,
          excludeRoles: ["superadmin"],
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
            canAccess(user?.role as AdminRole, item.roles as AdminRole[], item.excludeRoles as AdminRole[])
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
                      isActive={isActivePath(item)}
                      tooltip={item.title}
                      className={`
                        group relative transition-all duration-200 hover:bg-accent/80
                        ${isActivePath(item)
                          ? 'bg-primary/10 dark:bg-primary/20 text-primary font-semibold border-l-4 border-primary'
                          : 'text-muted-foreground hover:text-foreground'
                        }
                      `}
                    >
                      <Link href={item.url} className="flex items-center gap-3 w-full">
                        <item.icon className={`h-4 w-4 shrink-0 transition-colors ${
                          isActivePath(item) ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                        }`} />
                        <span className="flex-1">{item.title}</span>
                        {item.badgeKey === "ktp-pending" && ktpPending !== null && ktpPending > 0 && (
                          <span className="ml-auto rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white">
                            {ktpPending > 99 ? "99+" : ktpPending}
                          </span>
                        )}
                        {isActivePath(item) && state === "expanded" && (
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
