import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { apiFetch, buildUrl, getHeaders, ServicePath } from '@/lib/api-client'
import { isMissingNotificationSettingsColumnError } from '@/lib/schema-drift'

const DEFAULT_NOTIFICATION_SETTINGS = {
  enabled: true,
  urgentNotifications: true,
  soundEnabled: true,
  adminNotificationNumber: '',
}

const NOTIFICATION_SETTINGS_FALLBACK_KEY_PREFIX = 'village_notification_settings:'
const NOTIFICATION_CONFIG_COLUMNS = [
  'notification_enabled',
  'notification_urgent_enabled',
  'admin_notification_number',
] as const

let notificationColumnsPromise: Promise<Set<string>> | null = null

function requireVillageAdminSession(session: Awaited<ReturnType<typeof requireAuth>>[0]) {
  if (!session?.villageId) {
    return NextResponse.json({ error: 'Forbidden: village admin only' }, { status: 403 })
  }
  return null
}

function getNotificationFallbackKey(villageId: string) {
  return `${NOTIFICATION_SETTINGS_FALLBACK_KEY_PREFIX}${villageId}`
}

function parseFallbackNotificationSettings(raw?: string | null) {
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<typeof DEFAULT_NOTIFICATION_SETTINGS>
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_NOTIFICATION_SETTINGS.enabled,
      urgentNotifications: typeof parsed.urgentNotifications === 'boolean' ? parsed.urgentNotifications : DEFAULT_NOTIFICATION_SETTINGS.urgentNotifications,
      soundEnabled: typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : DEFAULT_NOTIFICATION_SETTINGS.soundEnabled,
      adminNotificationNumber: typeof parsed.adminNotificationNumber === 'string'
        ? parsed.adminNotificationNumber.trim()
        : DEFAULT_NOTIFICATION_SETTINGS.adminNotificationNumber,
    }
  } catch {
    return null
  }
}

async function readFallbackNotificationSettings(villageId: string) {
  const setting = await prisma.system_settings.findUnique({
    where: { key: getNotificationFallbackKey(villageId) },
    select: { value: true },
  }).catch(() => null)

  return parseFallbackNotificationSettings(setting?.value)
}

async function writeFallbackNotificationSettings(villageId: string, settings: typeof DEFAULT_NOTIFICATION_SETTINGS) {
  await prisma.system_settings.upsert({
    where: { key: getNotificationFallbackKey(villageId) },
    update: {
      value: JSON.stringify(settings),
      description: 'Fallback notification settings when dedicated behavior config columns are unavailable',
    },
    create: {
      key: getNotificationFallbackKey(villageId),
      value: JSON.stringify(settings),
      description: 'Fallback notification settings when dedicated behavior config columns are unavailable',
    },
  })
}

async function getNotificationConfigColumns() {
  if (!notificationColumnsPromise) {
    notificationColumnsPromise = prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'village_behavior_configs'
        AND column_name IN ('notification_enabled', 'notification_urgent_enabled', 'admin_notification_number')
    `.then((rows) => new Set(rows.map((row) => row.column_name)))
      .catch(() => new Set<string>())
  }

  return notificationColumnsPromise
}

async function hasFullDedicatedNotificationConfig() {
  const columns = await getNotificationConfigColumns()
  return NOTIFICATION_CONFIG_COLUMNS.every((column) => columns.has(column))
}

async function getUrgentTypesFromDB(villageId: string): Promise<string[]> {
  try {
    const url = new URL(buildUrl(ServicePath.CASE, '/complaints/types'))
    url.searchParams.set('is_urgent', 'true')
    url.searchParams.set('village_id', villageId)

    const res = await apiFetch(url.toString(), {
      headers: getHeaders(),
      cache: 'no-store',
    })

    if (!res.ok) return []

    const data = await res.json()
    const types = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []
    return types.map((t: { name: string }) => t.name)
  } catch {
    return []
  }
}

async function getNotificationSettingsFromBehaviorConfig(villageId: string) {
  const fallbackSettings = await readFallbackNotificationSettings(villageId)
  const baseSettings = {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...(fallbackSettings || {}),
  }

  if (!await hasFullDedicatedNotificationConfig()) {
    return baseSettings
  }

  try {
    const config = await prisma.village_behavior_configs.findUnique({
      where: { village_id: villageId },
      select: {
        notification_enabled: true,
        notification_urgent_enabled: true,
        admin_notification_number: true,
      },
    })

    return {
      enabled: config?.notification_enabled ?? baseSettings.enabled,
      urgentNotifications: config?.notification_urgent_enabled ?? baseSettings.urgentNotifications,
      soundEnabled: baseSettings.soundEnabled,
      adminNotificationNumber: config?.admin_notification_number ?? baseSettings.adminNotificationNumber,
    }
  } catch (error) {
    if (!isMissingNotificationSettingsColumnError(error)) throw error
    return baseSettings
  }
}

async function persistNotificationSettings(villageId: string, settings: typeof DEFAULT_NOTIFICATION_SETTINGS) {
  const hasDedicatedConfig = await hasFullDedicatedNotificationConfig()

  if (hasDedicatedConfig) {
    try {
      await prisma.village_behavior_configs.upsert({
        where: { village_id: villageId },
        update: {
          notification_enabled: settings.enabled,
          notification_urgent_enabled: settings.urgentNotifications,
          admin_notification_number: settings.adminNotificationNumber || null,
          updated_at: new Date(),
        },
        create: {
          village_id: villageId,
          notification_enabled: settings.enabled,
          notification_urgent_enabled: settings.urgentNotifications,
          admin_notification_number: settings.adminNotificationNumber || null,
        },
      })

      await writeFallbackNotificationSettings(villageId, settings)
      return 'dedicated'
    } catch (error) {
      if (!isMissingNotificationSettingsColumnError(error)) throw error
    }
  }

  await writeFallbackNotificationSettings(villageId, settings)
  return 'system_settings_fallback'
}

async function getUrgentWaAutoSendStatus(): Promise<boolean | null> {
  try {
    const response = await apiFetch(buildUrl(ServicePath.NOTIFICATION, '/internal/urgent-alert-config'), {
      headers: getHeaders(),
      cache: 'no-store',
    })

    if (!response.ok) return null

    const payload = await response.json().catch(() => null)
    const value = payload?.data?.urgent_wa_auto_send_enabled
    return typeof value === 'boolean' ? value : null
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  try {
    const [session, authError] = await requireAuth(request)
    if (authError) return authError

    const villageAdminError = requireVillageAdminSession(session)
    if (villageAdminError) return villageAdminError

    const villageId = session.villageId!

    const [urgentCategories, settings, urgentWaAutoSendEnabled] = await Promise.all([
      getUrgentTypesFromDB(villageId),
      getNotificationSettingsFromBehaviorConfig(villageId),
      getUrgentWaAutoSendStatus(),
    ])

    return NextResponse.json({
      success: true,
      data: {
        ...settings,
        urgentCategories,
        urgentWaAutoSendEnabled,
        villageId,
      }
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const [session, authError] = await requireAuth(request)
    if (authError) return authError

    const villageAdminError = requireVillageAdminSession(session)
    if (villageAdminError) return villageAdminError

    const villageId = session.villageId!
    const body = await request.json().catch(() => ({}))
    const adminNotificationNumber = typeof body.adminNotificationNumber === 'string'
      ? body.adminNotificationNumber.trim()
      : DEFAULT_NOTIFICATION_SETTINGS.adminNotificationNumber

    const nextSettings = {
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : DEFAULT_NOTIFICATION_SETTINGS.enabled,
      urgentNotifications: body.urgentNotifications !== undefined ? Boolean(body.urgentNotifications) : DEFAULT_NOTIFICATION_SETTINGS.urgentNotifications,
      soundEnabled: body.soundEnabled !== undefined ? Boolean(body.soundEnabled) : DEFAULT_NOTIFICATION_SETTINGS.soundEnabled,
      adminNotificationNumber,
    }

    const storage = await persistNotificationSettings(villageId, nextSettings)
    const urgentWaAutoSendEnabled = await getUrgentWaAutoSendStatus()

    return NextResponse.json({
      success: true,
      message: 'Settings saved successfully',
      data: {
        ...nextSettings,
        urgentWaAutoSendEnabled,
        villageId,
        storage,
      },
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
