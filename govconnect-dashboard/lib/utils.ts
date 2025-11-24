import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Date formatting helper
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

// Status formatting helper
export function formatStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'baru': 'Baru',
    'proses': 'Proses',
    'selesai': 'Selesai',
    'ditolak': 'Ditolak',
    'pending': 'Pending',
  }
  return statusMap[status.toLowerCase()] || status
}

// Status color helper
export function getStatusColor(status: string): string {
  const colorMap: Record<string, string> = {
    'baru': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    'pending': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    'proses': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    'selesai': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    'ditolak': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  }
  return colorMap[status.toLowerCase()] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
}
