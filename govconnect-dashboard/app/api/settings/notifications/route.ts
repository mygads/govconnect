import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { apiFetch, buildUrl, getHeaders, ServicePath } from '@/lib/api-client'

const DEFAULT_NOTIFICATION_SETTINGS = {
  enabled: true,
  urgentNotifications: true,
  soundEnabled: true,
}

function requireVillageAdminSession(session: Awaited<ReturnType<typeof requireAuth>>[0]) {
  if (!session?.villageId) {
    return NextResponse.json({ error: 'Forbidden: village admin only' }, { status: 403 })
  }
  return null
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
  const config = await prisma.village_behavior_configs.findUnique({
    where: { village_id: villageId },
    select: {
      notification_enabled: true,
      notification_urgent_enabled: true,
    },
  })

  return {
    enabled: config?.notification_enabled ?? DEFAULT_NOTIFICATION_SETTINGS.enabled,
    urgentNotifications: config?.notification_urgent_enabled ?? DEFAULT_NOTIFICATION_SETTINGS.urgentNotifications,
    soundEnabled: DEFAULT_NOTIFICATION_SETTINGS.soundEnabled,
  }
}

export async function GET(request: NextRequest) {
  try {
    const [session, authError] = await requireAuth(request)
    if (authError) return authError

    const villageAdminError = requireVillageAdminSession(session)
    if (villageAdminError) return villageAdminError

    const villageId = session.villageId!

    const [urgentCategories, settings] = await Promise.all([
      getUrgentTypesFromDB(villageId),
      getNotificationSettingsFromBehaviorConfig(villageId),
    ])

    return NextResponse.json({
      success: true,
      data: {
        ...settings,
        urgentCategories,
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
    const nextSettings = {
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : DEFAULT_NOTIFICATION_SETTINGS.enabled,
      urgentNotifications: body.urgentNotifications !== undefined ? Boolean(body.urgentNotifications) : DEFAULT_NOTIFICATION_SETTINGS.urgentNotifications,
      soundEnabled: body.soundEnabled !== undefined ? Boolean(body.soundEnabled) : DEFAULT_NOTIFICATION_SETTINGS.soundEnabled,
    }

    await prisma.village_behavior_configs.upsert({
      where: { village_id: villageId },
      update: {
        notification_enabled: nextSettings.enabled,
        notification_urgent_enabled: nextSettings.urgentNotifications,
        updated_at: new Date(),
      },
      create: {
        village_id: villageId,
        notification_enabled: nextSettings.enabled,
        notification_urgent_enabled: nextSettings.urgentNotifications,
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Settings saved successfully',
      data: {
        ...nextSettings,
        villageId,
      },
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
