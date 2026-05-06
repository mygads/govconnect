import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole } from '@/lib/auth'
import { apiFetch, buildUrl, getHeaders, ServicePath } from '@/lib/api-client'

const NOTIFICATION_SETTINGS_KEYS = {
  enabled: 'dashboard_notification_enabled',
  urgentNotifications: 'dashboard_notification_urgent_enabled',
  soundEnabled: 'dashboard_notification_sound_enabled',
} as const

const DEFAULT_NOTIFICATION_SETTINGS = {
  enabled: true,
  urgentNotifications: true,
  soundEnabled: true,
}

async function getUrgentTypesFromDB(): Promise<string[]> {
  try {
    const url = new URL(buildUrl(ServicePath.CASE, '/complaints/types'))
    url.searchParams.set('is_urgent', 'true')

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

async function getStoredNotificationSettings() {
  const rows = await prisma.system_settings.findMany({
    where: { key: { in: Object.values(NOTIFICATION_SETTINGS_KEYS) } },
  })

  const rowMap = new Map(rows.map((row) => [row.key, row.value]))

  return {
    enabled: rowMap.get(NOTIFICATION_SETTINGS_KEYS.enabled) ? rowMap.get(NOTIFICATION_SETTINGS_KEYS.enabled) === 'true' : DEFAULT_NOTIFICATION_SETTINGS.enabled,
    urgentNotifications: rowMap.get(NOTIFICATION_SETTINGS_KEYS.urgentNotifications)
      ? rowMap.get(NOTIFICATION_SETTINGS_KEYS.urgentNotifications) === 'true'
      : DEFAULT_NOTIFICATION_SETTINGS.urgentNotifications,
    soundEnabled: rowMap.get(NOTIFICATION_SETTINGS_KEYS.soundEnabled)
      ? rowMap.get(NOTIFICATION_SETTINGS_KEYS.soundEnabled) === 'true'
      : DEFAULT_NOTIFICATION_SETTINGS.soundEnabled,
  }
}

export async function GET(request: NextRequest) {
  try {
    const [, authError] = await requireRole(request, 'superadmin')
    if (authError) return authError

    const [urgentCategories, settings] = await Promise.all([
      getUrgentTypesFromDB(),
      getStoredNotificationSettings(),
    ])

    return NextResponse.json({
      success: true,
      data: {
        ...settings,
        urgentCategories,
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
    const [, authError] = await requireRole(request, 'superadmin')
    if (authError) return authError

    const body = await request.json().catch(() => ({}))
    const nextSettings = {
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : DEFAULT_NOTIFICATION_SETTINGS.enabled,
      urgentNotifications: body.urgentNotifications !== undefined ? Boolean(body.urgentNotifications) : DEFAULT_NOTIFICATION_SETTINGS.urgentNotifications,
      soundEnabled: body.soundEnabled !== undefined ? Boolean(body.soundEnabled) : DEFAULT_NOTIFICATION_SETTINGS.soundEnabled,
    }

    await prisma.$transaction([
      prisma.system_settings.upsert({
        where: { key: NOTIFICATION_SETTINGS_KEYS.enabled },
        update: { value: String(nextSettings.enabled), description: 'Enable dashboard complaint notifications' },
        create: { key: NOTIFICATION_SETTINGS_KEYS.enabled, value: String(nextSettings.enabled), description: 'Enable dashboard complaint notifications' },
      }),
      prisma.system_settings.upsert({
        where: { key: NOTIFICATION_SETTINGS_KEYS.urgentNotifications },
        update: { value: String(nextSettings.urgentNotifications), description: 'Enable urgent dashboard complaint notifications' },
        create: { key: NOTIFICATION_SETTINGS_KEYS.urgentNotifications, value: String(nextSettings.urgentNotifications), description: 'Enable urgent dashboard complaint notifications' },
      }),
      prisma.system_settings.upsert({
        where: { key: NOTIFICATION_SETTINGS_KEYS.soundEnabled },
        update: { value: String(nextSettings.soundEnabled), description: 'Enable dashboard notification sound' },
        create: { key: NOTIFICATION_SETTINGS_KEYS.soundEnabled, value: String(nextSettings.soundEnabled), description: 'Enable dashboard notification sound' },
      }),
    ])

    return NextResponse.json({
      success: true,
      message: 'Settings saved successfully',
      data: nextSettings,
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
