import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getInternalApiKey(): string | null {
  return process.env['INTERNAL_API_KEY'] || null
}

export async function GET(request: NextRequest) {
  try {
    const db = prisma as any
    const expectedApiKey = getInternalApiKey()
    if (!expectedApiKey) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }
    const apiKey = request.headers.get('x-internal-api-key')
    if (!apiKey || apiKey !== expectedApiKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const villageId = searchParams.get('village_id')
    const category = searchParams.get('category')

    if (!villageId) {
      return NextResponse.json({ error: 'village_id is required' }, { status: 400 })
    }

    const categoryParam = (category || '').trim()

    const contacts = await db.important_contacts.findMany({
      where: {
        category: {
          village_id: villageId,
          ...(categoryParam
            ? {
                name: {
                  equals: categoryParam,
                  mode: 'insensitive',
                },
              }
            : {}),
        },
      },
      include: { category: true },
      orderBy: { created_at: 'asc' },
    })

    const result = (contacts || []).map((c: any) => ({
      name: c.name,
      phone: c.phone,
      description: c.description ?? null,
      category_name: c.category?.name ?? null,
    }))

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching important contacts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch important contacts' },
      { status: 500 }
    )
  }
}
