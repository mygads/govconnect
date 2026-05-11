import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedInternalRequest } from '@/lib/internal-api-auth'
import prisma from '@/lib/prisma'
import { findVillageImportantContactCategoryByName } from '@/lib/important-contact-categories'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function normalizeImportantContactPhone(phone: string): string {
  const cleaned = (phone || '')
    .trim()
    .replace(/@(?:s\.whatsapp\.net|c\.us|lid)$/i, '')
    .replace(/:\d+$/, '')
  const digits = cleaned.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('00')) return normalizeImportantContactPhone(digits.slice(2))
  if (digits.startsWith('620')) return `62${digits.slice(3)}`
  if (digits.startsWith('0')) return `62${digits.slice(1)}`
  if (digits.startsWith('62')) return digits
  if (digits.startsWith('8')) return `62${digits}`
  return digits
}

function choosePreferredContact(current: any, candidate: any) {
  const currentScore = (current.description ? 2 : 0) + (current.category?.id ? 2 : 0) + (current.category?.name ? 1 : 0) + String(current.name || '').length
  const candidateScore = (candidate.description ? 2 : 0) + (candidate.category?.id ? 2 : 0) + (candidate.category?.name ? 1 : 0) + String(candidate.name || '').length
  return candidateScore > currentScore ? candidate : current
}

function normalizeAndDedupeContacts(contacts: any[]) {
  const deduped = new Map<string, any>()

  for (const contact of contacts) {
    const normalizedPhone = normalizeImportantContactPhone(String(contact.phone || ''))
    const normalizedContact = {
      ...contact,
      phone: normalizedPhone || contact.phone,
    }
    const key = `${contact.category_id || contact.category?.id || 'uncategorized'}:${normalizedPhone || `id:${contact.id}`}`
    const existing = deduped.get(key)
    deduped.set(key, existing ? choosePreferredContact(existing, normalizedContact) : normalizedContact)
  }

  return Array.from(deduped.values())
}

const contactSelect = {
  id: true,
  category_id: true,
  name: true,
  phone: true,
  description: true,
  created_at: true,
  updated_at: true,
  category: {
    select: {
      id: true,
      village_id: true,
      name: true,
      created_at: true,
      updated_at: true,
    },
  },
} as const

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedInternalRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const villageId = searchParams.get('village_id')
    const categoryId = searchParams.get('category_id')
    const categoryName = searchParams.get('category_name')

    if (!villageId) {
      return NextResponse.json({ error: 'village_id is required' }, { status: 400 })
    }

    let resolvedCategoryId = categoryId

    if (!resolvedCategoryId && categoryName) {
      const category = await findVillageImportantContactCategoryByName(villageId, categoryName)
      resolvedCategoryId = category?.id || null
    }

    const contacts = await prisma.important_contacts.findMany({
      where: {
        category: {
          village_id: villageId,
          ...(resolvedCategoryId ? { id: resolvedCategoryId } : {}),
        },
      },
      select: contactSelect,
      orderBy: { created_at: 'asc' },
    })

    return NextResponse.json({ data: normalizeAndDedupeContacts(contacts) })
  } catch (error) {
    console.error('Error fetching important contacts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch important contacts' },
      { status: 500 }
    )
  }
}
