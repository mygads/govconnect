import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Date formatting helper
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '-'
  try {
    const d = typeof date === 'string' ? new Date(date) : date
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d)
  } catch {
    return '-'
  }
}

// Status formatting helper
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

// Status color helper
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
