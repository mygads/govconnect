"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import {
  LayoutDashboard,
  FileText,
  Ticket,
  BarChart3,
  ChevronRight,
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar"

export function GovConnectSidebar() {
  const pathname = usePathname()
  const { theme, resolvedTheme } = useTheme()
  const { state } = useSidebar()

  const isActivePath = (path: string) => {
    if (path === "/dashboard") {
      return pathname === path
    }
    return pathname.startsWith(path)
  }

  const menuItems = [
    {
      title: "Overview",
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
      ],
    },
    {
      title: "Laporan Management",
      items: [
        {
          title: "List Laporan",
          url: "/dashboard/laporan",
          icon: FileText,
        },
      ],
    },
    {
      title: "Tiket Management",
      items: [
        {
          title: "List Tiket",
          url: "/dashboard/tiket",
          icon: Ticket,
        },
      ],
    },
  ]

  const currentTheme = resolvedTheme || theme || "light"
  const logoSrc = currentTheme === "dark" ? "/images/logo-dark.svg" : "/images/logo-light.svg"

  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <SidebarHeader className="border-b border-border p-4">
        <Link href="/dashboard" className="flex items-center gap-2">
          {state === "expanded" ? (
            <>
              <div className="relative h-8 w-8 flex-shrink-0">
                <Image
                  src={logoSrc}
                  alt="GovConnect Logo"
                  fill
                  className="object-contain"
                  priority
                  onError={(e) => {
                    const target = e.target as HTMLImageElement
                    target.style.display = 'none'
                  }}
                />
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-bold text-foreground">GovConnect</span>
                <span className="text-xs text-muted-foreground">Admin Dashboard</span>
              </div>
            </>
          ) : (
            <div className="relative h-8 w-8 mx-auto">
              <Image
                src={logoSrc}
                alt="GovConnect Logo"
                fill
                className="object-contain"
                priority
                onError={(e) => {
                  const target = e.target as HTMLImageElement
                  target.style.display = 'none'
                }}
              />
            </div>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {menuItems.map((group, index) => (
          <SidebarGroup key={index}>
            <SidebarGroupLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {group.title}
            </SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => (
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
                      <item.icon className={`h-4 w-4 flex-shrink-0 transition-colors ${
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
        ))}
      </SidebarContent>
    </Sidebar>
  )
}
