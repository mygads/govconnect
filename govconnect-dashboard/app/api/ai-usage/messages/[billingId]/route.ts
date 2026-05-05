import { NextRequest, NextResponse } from 'next/server'
import { ai } from '@/lib/api-client'
import { getAdminSession } from '@/lib/auth'
import prisma from '@/lib/prisma'

type BillingRow = {
  message_id?: string | null
  trace_id?: string | null
  billing_group_id?: string | null
  channel?: string | null
  wa_user_id?: string | null
  session_id?: string | null
}

function extractIngestId(row: BillingRow) {
  const raw = row.message_id || row.session_id || ''
  return raw.startsWith('ingest:') ? raw.slice('ingest:'.length) : null
}

function extractAdminId(row: BillingRow) {
  const value = row.wa_user_id || row.session_id || ''
  const match = value.match(/admin_test_([^:]+)/)
  return match?.[1] || null
}

function classifyProcess(row: BillingRow) {
  const traceId = row.trace_id || ''
  const groupId = row.billing_group_id || ''
  if (row.channel === 'system_ingest' && groupId.startsWith('ingest:document:')) {
    return traceId.startsWith('document-ocr-') ? 'document_ocr' : 'document_embed'
  }
  if (row.channel === 'system_ingest' && groupId.startsWith('ingest:knowledge:')) return 'knowledge_embed'
  if ((row.wa_user_id || row.session_id || '').includes('admin_test_')) return 'dashboard_knowledge_test'
  if (row.channel === 'whatsapp' || row.wa_user_id) return 'whatsapp_chat'
  if (row.channel === 'webchat' || row.session_id) return 'webchat_chat'
  return 'ai_process'
}

async function buildContext(row: BillingRow, villageId: string) {
  const process = classifyProcess(row)
  const ingestId = extractIngestId(row)
  const adminId = extractAdminId(row)

  const [knowledge, document, admin] = await Promise.all([
    ingestId
      ? prisma.knowledge_base.findFirst({ where: { id: ingestId, village_id: villageId }, select: { id: true, title: true, category: true } })
      : Promise.resolve(null),
    ingestId
      ? prisma.knowledge_documents.findFirst({ where: { id: ingestId, village_id: villageId }, select: { id: true, title: true, original_name: true, category: true, status: true } })
      : Promise.resolve(null),
    adminId
      ? prisma.admin_users.findFirst({ where: { id: adminId, village_id: villageId }, select: { id: true, name: true, username: true } })
      : Promise.resolve(null),
  ])

  return {
    process,
    process_label: {
      document_embed: 'Embed dokumen knowledge base',
      document_ocr: 'OCR + embed dokumen scan',
      knowledge_embed: 'Embed entri knowledge base',
      dashboard_knowledge_test: 'Testing AI dari dashboard admin',
      whatsapp_chat: 'Percakapan WhatsApp warga',
      webchat_chat: 'Percakapan webchat warga',
      ai_process: 'Proses AI',
    }[process],
    admin: admin ? { id: admin.id, name: admin.name, username: admin.username } : null,
    knowledge: knowledge ? { id: knowledge.id, title: knowledge.title, category: knowledge.category } : null,
    document: document ? { id: document.id, title: document.title, original_name: document.original_name, category: document.category, status: document.status } : null,
    phone_number: row.wa_user_id || null,
    webchat_session: process === 'webchat_chat' || process === 'dashboard_knowledge_test' ? row.session_id : null,
    raw_ref: row.message_id || row.billing_group_id || row.trace_id || null,
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ billingId: string }> },
) {
  const session = await getAdminSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role === 'superadmin' || !session.villageId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { billingId } = await params
  try {
    const response = await ai.getVillageAIUsageMessageDetail(session.villageId, billingId)
    const payload = await response.json()
    if (response.ok && payload?.billing) {
      payload.billing = {
        ...payload.billing,
        context: await buildContext(payload.billing, session.villageId),
      }
    }
    return NextResponse.json(payload, { status: response.status })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to load AI usage message detail' }, { status: 500 })
  }
}
