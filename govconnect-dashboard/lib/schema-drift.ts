import { Prisma } from '@prisma/client'

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function getErrorCode(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code
  if (typeof error === 'object' && error && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code
  }
  return null
}

export function isMissingColumnError(error: unknown, columnName?: string): boolean {
  const code = getErrorCode(error)
  const message = getErrorMessage(error).toLowerCase()
  const normalizedColumnName = columnName?.toLowerCase()

  const mentionsColumn = !normalizedColumnName || message.includes(normalizedColumnName)

  if ((code === 'P2022' || code === '42703') && mentionsColumn) {
    return true
  }

  if (!mentionsColumn) return false

  return (
    message.includes('does not exist') ||
    message.includes('column does not exist') ||
    message.includes('the column')
  )
}

export function isMissingNameKeyColumnError(error: unknown): boolean {
  return isMissingColumnError(error, 'name_key')
}

export function isMissingNotificationSettingsColumnError(error: unknown): boolean {
  return (
    isMissingColumnError(error, 'notification_enabled') ||
    isMissingColumnError(error, 'notification_urgent_enabled') ||
    isMissingColumnError(error, 'admin_notification_number')
  )
}

export function isMissingImportantContactCategoryLinkColumnError(error: unknown): boolean {
  return isMissingColumnError(error, 'important_contact_category_id')
}

export function buildSchemaDriftMessage(feature: string, migrationHint?: string): string {
  const suffix = migrationHint ? ` Jalankan migration terkait: ${migrationHint}.` : ''
  return `${feature} sedang memakai fallback kompatibilitas karena schema database belum sinkron.${suffix}`
}
