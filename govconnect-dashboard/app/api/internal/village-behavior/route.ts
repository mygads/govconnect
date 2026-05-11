import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedInternalRequest } from '@/lib/internal-api-auth'
import prisma from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type BehaviorConfig = {
  active_service_ids?: string[]
  important_contacts?: string[]
  service_hours?: Record<string, unknown>
  local_faq_priority?: string[]
  escalation_routing?: Record<string, unknown>
  complaint_rules?: string[]
  service_rules?: string[]
  notice?: string
  admin_notification_number?: string | null
}


function defaultConfig(): Required<BehaviorConfig> {
  return {
    active_service_ids: [],
    important_contacts: [],
    service_hours: {},
    local_faq_priority: [],
    escalation_routing: {},
    complaint_rules: [],
    service_rules: [],
    notice: 'Gunakan konfigurasi layanan, profil desa, kontak penting, dan knowledge base tenant sebagai sumber perilaku utama.',
    admin_notification_number: null,
  }
}

function normalizeConfig(config?: BehaviorConfig | null): Required<BehaviorConfig> {
  return { ...defaultConfig(), ...(config || {}) }
}

function parseLegacyConfig(raw?: string | null): Required<BehaviorConfig> | null {
  if (!raw) return null
  try { return normalizeConfig(JSON.parse(raw) as BehaviorConfig) } catch { return null }
}

async function findDedicatedConfig(villageId: string): Promise<Required<BehaviorConfig> | null> {
  try {
    const row = await (prisma as any).village_behavior_configs.findUnique({ where: { village_id: villageId } })
    if (!row) return null
    return normalizeConfig({
      active_service_ids: row.active_service_ids,
      important_contacts: row.important_contacts,
      service_hours: row.service_hours as Record<string, unknown> | undefined,
      local_faq_priority: row.local_faq_priority,
      escalation_routing: row.escalation_routing as Record<string, unknown> | undefined,
      complaint_rules: row.complaint_rules,
      service_rules: row.service_rules,
      notice: row.notice || undefined,
      admin_notification_number: row.admin_notification_number || null,
    })
  } catch (error: any) {
    console.warn('Dedicated village behavior lookup unavailable, using fallback storage', {
      error: error?.message,
    })
    return null
  }
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedInternalRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const villageId = request.nextUrl.searchParams.get('village_id')
  if (!villageId) return NextResponse.json({ error: 'village_id is required' }, { status: 400 })

  const key = `village_behavior:${villageId}`
  const [dedicatedConfig, setting, faqItems] = await Promise.all([
    findDedicatedConfig(villageId),
    prisma.system_settings.findUnique({ where: { key } }).catch(() => null),
    prisma.knowledge_base.findMany({
      where: { village_id: villageId, is_active: true, category: 'faq' },
      select: { title: true, priority: true },
      orderBy: [{ priority: 'desc' }, { updated_at: 'desc' }],
      take: 10,
    }).catch(() => []),
  ])

  const config = dedicatedConfig || parseLegacyConfig(setting?.value) || defaultConfig()
  if (!config.local_faq_priority.length && faqItems.length) config.local_faq_priority = faqItems.map((item) => item.title)

  return NextResponse.json({ data: { village_id: villageId, config } })
}

export async function PUT(request: NextRequest) {
  if (!isAuthorizedInternalRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const villageId = body?.village_id as string | undefined
  if (!villageId) return NextResponse.json({ error: 'village_id is required' }, { status: 400 })

  const config = normalizeConfig(body.config || {})

  try {
    const row = await (prisma as any).village_behavior_configs.upsert({
      where: { village_id: villageId },
      update: {
        active_service_ids: config.active_service_ids,
        important_contacts: config.important_contacts,
        service_hours: config.service_hours,
        local_faq_priority: config.local_faq_priority,
        escalation_routing: config.escalation_routing,
        complaint_rules: config.complaint_rules,
        service_rules: config.service_rules,
        notice: config.notice,
        admin_notification_number: config.admin_notification_number,
      },
      create: {
        village_id: villageId,
        active_service_ids: config.active_service_ids,
        important_contacts: config.important_contacts,
        service_hours: config.service_hours,
        local_faq_priority: config.local_faq_priority,
        escalation_routing: config.escalation_routing,
        complaint_rules: config.complaint_rules,
        service_rules: config.service_rules,
        notice: config.notice,
        admin_notification_number: config.admin_notification_number,
      },
    })

    return NextResponse.json({ success: true, data: { village_id: villageId, config: normalizeConfig({
      active_service_ids: row.active_service_ids,
      important_contacts: row.important_contacts,
      service_hours: row.service_hours as Record<string, unknown> | undefined,
      local_faq_priority: row.local_faq_priority,
      escalation_routing: row.escalation_routing as Record<string, unknown> | undefined,
      complaint_rules: row.complaint_rules,
      service_rules: row.service_rules,
      notice: row.notice || undefined,
      admin_notification_number: row.admin_notification_number || null,
    }) } })
  } catch (error: any) {
    console.warn('Dedicated village behavior storage unavailable, falling back to system_settings', {
      error: error?.message,
    })

    const key = `village_behavior:${villageId}`
    const setting = await prisma.system_settings.upsert({
      where: { key },
      update: { value: JSON.stringify(config), description: 'Village behavior configuration for GovConnect agent' },
      create: { key, value: JSON.stringify(config), description: 'Village behavior configuration for GovConnect agent' },
    })
    return NextResponse.json({ success: true, data: { village_id: villageId, config: parseLegacyConfig(setting.value) || config, storage: 'system_settings_fallback' } })
  }
}

