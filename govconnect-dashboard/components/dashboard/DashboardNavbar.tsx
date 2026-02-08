"use client"

import { LogOut, Settings, Moon, Sun, ChevronDown, Bell } from "lucide-react"
import { useTheme } from "next-themes"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useAuth } from "@/components/auth/AuthContext"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { NotificationCenter } from "@/components/dashboard/NotificationCenter"
import { isSuperadmin } from "@/lib/rbac"

export function DashboardNavbar() {
  const { theme, setTheme } = useTheme()
  const { user, logout } = useAuth()
  const router = useRouter()

  const userIsSuperadmin = isSuperadmin(user?.role)

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const formatRoleLabel = (role?: string | null) => {
    if (!role) return 'Administrator'
    const normalized = role.toLowerCase()
    const map: Record<string, string> = {
      superadmin: 'Super Admin',
      super_admin: 'Super Admin',
      village_admin: 'Admin Desa',
      admin: 'Admin',
    }
    if (map[normalized]) return map[normalized]
    return normalized
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  }

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-white dark:bg-gray-950 px-4 shadow-sm">
      <SidebarTrigger className="-ml-1 h-8 w-8 hover:bg-accent rounded-md transition-colors" />

      <div className="ml-auto flex items-center gap-2">
        {/* Notification Center - only for village admins (needs RealtimeProvider) */}
        {!userIsSuperadmin && <NotificationCenter />}

        {/* Theme Toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          className="h-8 w-8 rounded-lg hover:bg-accent/80 bg-accent/50 transition-colors"
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Ganti tema</span>
        </Button>

        <div className="border-r dark:border-white/60 h-6 ml-2"></div>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 gap-2 px-2 rounded-md hover:bg-accent transition-colors">
              <Avatar className="h-6 w-6 ring-2 ring-primary/30">
                <AvatarFallback className="bg-linear-to-r from-primary to-primary/80 text-white text-xs font-semibold">
                  {user ? getInitials(user.name) : 'AD'}
                </AvatarFallback>
              </Avatar>
              <div className="hidden md:block text-left">
                <p className="text-xs font-medium text-foreground">{user?.name || 'Admin'}</p>
                <p className="text-xs text-muted-foreground">{formatRoleLabel(user?.role)}</p>
              </div>
              <ChevronDown className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Akun Saya</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              onClick={() => router.push('/dashboard/settings')} 
              className="cursor-pointer"
            >
              <Settings className="mr-2 h-4 w-4" />
              <span>Pengaturan</span>
            </DropdownMenuItem>
            {userIsSuperadmin && (
              <DropdownMenuItem 
                onClick={() => router.push('/dashboard/settings/notifications')} 
                className="cursor-pointer"
              >
                <Bell className="mr-2 h-4 w-4" />
                <span>Pengaturan Notifikasi</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              <span>Keluar</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
