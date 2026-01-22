import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'govconnect-internal-2025-secret'

export async function GET(request: NextRequest) {
  try {
    const db = prisma as any
    const apiKey = request.headers.get('x-internal-api-key')
    if (!apiKey || apiKey !== INTERNAL_API_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
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
      const category = await db.important_contact_categories.findFirst({
        where: {
          village_id: villageId,
          name: { equals: categoryName, mode: 'insensitive' },
        },
        select: { id: true },
      })

      resolvedCategoryId = category?.id || null
    }

    const contacts = await db.important_contacts.findMany({
      where: {
        category: {
          village_id: villageId,
          ...(resolvedCategoryId ? { id: resolvedCategoryId } : {}),
        },
      },
      include: { category: true },
      orderBy: { created_at: 'asc' },
    })

    return NextResponse.json({ data: contacts })
  } catch (error) {
    console.error('Error fetching important contacts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch important contacts' },
      { status: 500 }
    )
  }
}
