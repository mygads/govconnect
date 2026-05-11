import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function normalizeScopedName(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

export function buildScopedNameKey(value: string): string {
  return normalizeScopedName(value).toLocaleLowerCase('id-ID')
}

export const DEFAULT_VILLAGE_TIME_ZONE = "Asia/Jakarta"
export const SUPPORTED_VILLAGE_TIME_ZONES = [
  "Asia/Jakarta",
  "Asia/Makassar",
  "Asia/Jayapura",
] as const

export type SupportedVillageTimeZone = typeof SUPPORTED_VILLAGE_TIME_ZONES[number]

const USD_TO_IDR = 18_000

export function resolveVillageTimezone(timezone?: string | null): SupportedVillageTimeZone {
  return SUPPORTED_VILLAGE_TIME_ZONES.includes((timezone || "") as SupportedVillageTimeZone)
    ? (timezone as SupportedVillageTimeZone)
    : DEFAULT_VILLAGE_TIME_ZONE
}

export function isSupportedVillageTimezone(timezone?: string | null): timezone is SupportedVillageTimeZone {
  return SUPPORTED_VILLAGE_TIME_ZONES.includes((timezone || "") as SupportedVillageTimeZone)
}

export function getVillageTimezoneLabel(timezone?: string | null): string {
  const resolved = resolveVillageTimezone(timezone)
  const labels: Record<SupportedVillageTimeZone, string> = {
    "Asia/Jakarta": "WIB (Asia/Jakarta)",
    "Asia/Makassar": "WITA (Asia/Makassar)",
    "Asia/Jayapura": "WIT (Asia/Jayapura)",
  }
  return labels[resolved]
}

export function getVillageTimezoneOptions() {
  return SUPPORTED_VILLAGE_TIME_ZONES.map((timezone) => ({
    value: timezone,
    label: getVillageTimezoneLabel(timezone),
  }))
}

export function getTimezoneAbbreviation(timezone?: string | null): "WIB" | "WITA" | "WIT" {
  const resolved = resolveVillageTimezone(timezone)
  if (resolved === "Asia/Makassar") return "WITA"
  if (resolved === "Asia/Jayapura") return "WIT"
  return "WIB"
}

export function formatDateTime(
  value: string | Date | null | undefined,
  timezone?: string | null,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!value) return "-"
  try {
    const date = typeof value === "string" ? new Date(value) : value
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: resolveVillageTimezone(timezone),
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      ...options,
    }).format(date)
  } catch {
    return "-"
  }
}

export function formatDateOnly(
  value: string | Date | null | undefined,
  timezone?: string | null,
  period?: "day" | "week" | "month",
): string {
  if (!value) return "-"
  try {
    const date = typeof value === "string" ? new Date(value) : value
    const baseOptions: Intl.DateTimeFormatOptions = { timeZone: resolveVillageTimezone(timezone) }
    if (period === "month") {
      return new Intl.DateTimeFormat("id-ID", { ...baseOptions, month: "short", year: "numeric" }).format(date)
    }
    return new Intl.DateTimeFormat("id-ID", { ...baseOptions, day: "numeric", month: "short" }).format(date)
  } catch {
    return "-"
  }
}

export function formatTimeOnly(
  value: string | Date | null | undefined,
  timezone?: string | null,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!value) return "-"
  try {
    const date = typeof value === "string" ? new Date(value) : value
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: resolveVillageTimezone(timezone),
      hour: "2-digit",
      minute: "2-digit",
      ...options,
    }).format(date)
  } catch {
    return "-"
  }
}

export function getVillageTimeContext(timezone?: string | null) {
  const resolved = resolveVillageTimezone(timezone)
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolved,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date())

  const getPart = (type: string) => parts.find((part) => part.type === type)?.value || ""
  const hour = Number(getPart("hour"))

  let timeOfDay = "malam"
  if (hour >= 5 && hour < 11) timeOfDay = "pagi"
  else if (hour >= 11 && hour < 15) timeOfDay = "siang"
  else if (hour >= 15 && hour < 18) timeOfDay = "sore"

  const todayDate = `${getPart("year")}-${getPart("month")}-${getPart("day")}`
  const tomorrowBase = new Date(Date.UTC(Number(getPart("year")), Number(getPart("month")) - 1, Number(getPart("day")) + 1))
  const tomorrow = tomorrowBase.toISOString().split("T")[0]

  return {
    timezone: resolved,
    timezoneLabel: getVillageTimezoneLabel(resolved),
    timezoneAbbreviation: getTimezoneAbbreviation(resolved),
    date: todayDate,
    tomorrow,
    time: `${getPart("hour")}:${getPart("minute")}`,
    timeOfDay,
  }
}

export function formatDate(date: string | Date | null | undefined, timezone?: string | null): string {
  return formatDateTime(date, timezone)
}

export function formatJakartaDateTime(value: string | Date | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  return formatDateTime(value, DEFAULT_VILLAGE_TIME_ZONE, options)
}

export function formatJakartaDate(value: string | Date | null | undefined, period?: "day" | "week" | "month"): string {
  return formatDateOnly(value, DEFAULT_VILLAGE_TIME_ZONE, period)
}

export function formatUSD(value?: number | null, options?: { preciseSmall?: boolean; minimumFractionDigits?: number; maximumFractionDigits?: number; signed?: boolean }): string {
  const amount = value ?? 0
  const sign = options?.signed && amount > 0 ? "+" : ""
  if (options?.preciseSmall && amount !== 0) {
    const rounded = Number(amount.toFixed(options.minimumFractionDigits ?? 2))
    if (Math.abs(amount - rounded) >= 0.000001) {
      return `${sign}$${amount.toFixed(8)}`
    }
  }

  const minimumFractionDigits = options?.minimumFractionDigits ?? (amount > 0 && amount < 0.000001 ? 8 : 6)
  const maximumFractionDigits = options?.maximumFractionDigits ?? (amount > 0 && amount < 0.000001 ? 8 : 6)
  return `${sign}${new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(amount)}`
}

export function formatIDRFromUSD(value?: number | null): string {
  const idr = (value ?? 0) * USD_TO_IDR
  if (idr > 0 && idr < 0.01) return `Rp ${idr.toFixed(8)}`
  if (idr >= 1_000_000) return `Rp ${(idr / 1_000_000).toFixed(2)} jt`
  if (idr >= 1_000) return `Rp ${(idr / 1_000).toFixed(1)} rb`
  return `Rp ${idr.toFixed(idr >= 1 ? 0 : 2)}`
}

export function formatStatus(status: string | null | undefined): string {
  if (!status) return '-'
  const statusMap: Record<string, string> = {
    'open': 'Baru',
    'process': 'Proses',
    'done': 'Selesai',
    'canceled': 'Dibatalkan',
    'reject': 'Ditolak',
    'baru': 'Baru',
    'proses': 'Proses',
    'selesai': 'Selesai',
    'dibatalkan': 'Dibatalkan',
    'ditolak': 'Ditolak',
  }
  return statusMap[status.toLowerCase()] || status
}

export function getStatusColor(status: string | null | undefined): string {
  if (!status) return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
  const colorMap: Record<string, string> = {
    'open': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    'process': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    'done': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    'canceled': 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    'reject': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    'baru': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    'proses': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    'selesai': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    'dibatalkan': 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    'ditolak': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  }
  return colorMap[status.toLowerCase()] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
}
