export type AdminRole = 'village_admin' | 'admin' | 'superadmin'

export type RouteRule = {
  path: string
  roles: AdminRole[]
}

const DISABLED_PATH_PREFIXES: string[] = []

// Routes that only superadmin can access
const SUPERADMIN_ONLY_RULES: RouteRule[] = [
  { path: '/dashboard/superadmin/ai-usage', roles: ['superadmin'] },
  { path: '/dashboard/superadmin/villages', roles: ['superadmin'] },
  { path: '/dashboard/superadmin/admins', roles: ['superadmin'] },
  { path: '/dashboard/superadmin/register', roles: ['superadmin'] },
  { path: '/dashboard/settings/cache', roles: ['superadmin'] },
  { path: '/dashboard/superadmin/system-health', roles: ['superadmin'] },
  { path: '/dashboard/superadmin/llm-check', roles: ['superadmin'] },
  { path: '/dashboard/superadmin/gemini-keys', roles: ['superadmin'] },
  { path: '/dashboard/superadmin/whatsapp', roles: ['superadmin'] },
]

// Routes that only village admins can access (superadmin should NOT access these)
const VILLAGE_ONLY_ROUTES: string[] = [
  '/dashboard/statistik',
  '/dashboard/laporan',
  '/dashboard/pengaduan',
  '/dashboard/layanan',
  '/dashboard/pelayanan',
  '/dashboard/channel-settings',
  '/dashboard/livechat',
  '/dashboard/knowledge',
  '/dashboard/testing-knowledge',
  '/dashboard/village-profile',
  '/dashboard/important-contacts',
  '/dashboard/knowledge-analytics',
]

const matchPath = (pathname: string, path: string) =>
  pathname === path || pathname.startsWith(`${path}/`)

export function isSuperadmin(role: AdminRole | string | undefined): boolean {
  return role === 'superadmin'
}

export function isRouteAllowed(role: AdminRole | undefined, pathname: string): boolean {
  if (DISABLED_PATH_PREFIXES.some((prefix) => matchPath(pathname, prefix))) return false
  if (!role) return true

  // Check superadmin-only routes FIRST (higher priority)
  const superadminRule = SUPERADMIN_ONLY_RULES.find((item) => matchPath(pathname, item.path))
  if (superadminRule) {
    return superadminRule.roles.includes(role)
  }

  // Superadmin cannot access village-specific routes
  if (role === 'superadmin') {
    const isVillageRoute = VILLAGE_ONLY_ROUTES.some((route) => matchPath(pathname, route))
    if (isVillageRoute) return false
  }

  return true
}

export function canAccess(role: AdminRole | undefined, allowedRoles?: AdminRole[], excludeRoles?: AdminRole[]): boolean {
  if (excludeRoles && excludeRoles.length > 0 && role && excludeRoles.includes(role)) return false
  if (!allowedRoles || allowedRoles.length === 0) return true
  if (!role) return false
  return allowedRoles.includes(role)
}
