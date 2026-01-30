export type AdminRole = 'village_admin' | 'admin' | 'superadmin'

export type RouteRule = {
  path: string
  roles: AdminRole[]
}

const DISABLED_PATH_PREFIXES: string[] = []

const ROLE_RULES: RouteRule[] = [
  { path: '/dashboard/ai-analytics', roles: ['superadmin'] },
  { path: '/dashboard/superadmin/ai-quality', roles: ['superadmin'] },
  { path: '/dashboard/statistik/analytics', roles: ['superadmin'] },
  { path: '/dashboard/settings/rate-limit', roles: ['superadmin'] },
  { path: '/dashboard/settings/notifications', roles: ['superadmin'] },
]

const matchPath = (pathname: string, path: string) =>
  pathname === path || pathname.startsWith(`${path}/`)

export function isRouteAllowed(role: AdminRole | undefined, pathname: string): boolean {
  if (DISABLED_PATH_PREFIXES.some((prefix) => matchPath(pathname, prefix))) return false
  if (!role) return true

  const rule = ROLE_RULES.find((item) => matchPath(pathname, item.path))
  if (!rule) return true
  return rule.roles.includes(role)
}

export function canAccess(role: AdminRole | undefined, allowedRoles?: AdminRole[]): boolean {
  if (!allowedRoles || allowedRoles.length === 0) return true
  if (!role) return false
  return allowedRoles.includes(role)
}
