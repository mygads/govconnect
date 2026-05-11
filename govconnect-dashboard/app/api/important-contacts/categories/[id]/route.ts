import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'
import { invalidateVillageAiCacheSafely } from '@/lib/ai-cache-invalidation'
import {
  findVillageImportantContactCategoryByName,
  updateVillageImportantContactCategory,
} from '@/lib/important-contact-categories'
import { normalizeScopedName } from '@/lib/utils'

function isDuplicateCategoryError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function buildComplaintTypesUrl(villageId: string) {
  const url = new URL(buildUrl(ServicePath.CASE, '/complaints/types'))
  url.searchParams.set('village_id', villageId)
  return url.toString()
}

function isLinkedToImportantCategory(
  type: { send_important_contacts?: boolean; important_contact_category?: string | null; important_contact_category_id?: string | null },
  category: { id: string; name: string },
) {
  if (!type.send_important_contacts) return false
  if (type.important_contact_category_id) {
    return type.important_contact_category_id === category.id
  }
  return type.important_contact_category === category.name
}

async function getSession(request: NextRequest) {
  const token = request.cookies.get('token')?.value ||
    request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null
  const session = await prisma.admin_sessions.findUnique({
    where: { token },
    include: { admin: true }
  })
  if (!session || session.expires_at < new Date()) return null
  return session
}

const categorySelect = {
  id: true,
  village_id: true,
  name: true,
  created_at: true,
  updated_at: true,
  contacts: true,
} as const

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await context.params

  const category = await prisma.important_contact_categories.findUnique({
    where: { id },
    select: categorySelect,
  })

  if (!category) {
    return NextResponse.json({ error: 'Category not found' }, { status: 404 })
  }

  if (category.village_id !== session.admin.village_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  let linkedComplaintTypes: any[] = []
  try {
    const response = await apiFetch(buildComplaintTypesUrl(category.village_id), {
      method: 'GET',
      headers: getHeaders({ 'x-village-id': category.village_id }),
    })

    if (response.ok) {
      const data = await response.json()
      const allTypes = data.data || []
      linkedComplaintTypes = allTypes.filter((type: any) =>
        isLinkedToImportantCategory(type, category)
      )
    }
  } catch (error) {
    console.error('Error fetching complaint types:', error)
  }

  return NextResponse.json({
    data: category,
    linkedComplaintTypes: linkedComplaintTypes.map((t: any) => ({
      id: t.id,
      name: t.name,
      category_name: t.category?.name || ''
    }))
  })
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await context.params

  const existingCategory = await prisma.important_contact_categories.findUnique({
    where: { id },
    select: categorySelect,
  })

  if (!existingCategory) {
    return NextResponse.json({ error: 'Category not found' }, { status: 404 })
  }

  if (existingCategory.village_id !== session.admin.village_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await request.json()
  const normalizedName = normalizeScopedName(body?.name)

  if (!normalizedName) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const duplicate = await findVillageImportantContactCategoryByName(existingCategory.village_id, normalizedName)
  if (duplicate && duplicate.id !== id) {
    return NextResponse.json({ error: 'Nama kategori kontak penting sudah dipakai di desa ini.' }, { status: 409 })
  }

  const oldName = existingCategory.name

  let category
  try {
    category = await updateVillageImportantContactCategory(id, existingCategory.village_id, normalizedName)
  } catch (error) {
    if (isDuplicateCategoryError(error)) {
      return NextResponse.json({ error: 'Nama kategori kontak penting sudah dipakai di desa ini.' }, { status: 409 })
    }
    throw error
  }

  if (!category) {
    return NextResponse.json({ error: 'Category not found' }, { status: 404 })
  }

  if (oldName !== normalizedName) {
    try {
      const response = await apiFetch(buildComplaintTypesUrl(existingCategory.village_id), {
        method: 'GET',
        headers: getHeaders({ 'x-village-id': existingCategory.village_id }),
      })

      if (response.ok) {
        const data = await response.json()
        const allTypes = data.data || []
        const linkedTypes = allTypes.filter((type: any) => isLinkedToImportantCategory(type, existingCategory))
        const legacyLinkedTypes = linkedTypes.filter((type: any) => !type.important_contact_category_id)

        for (const type of legacyLinkedTypes) {
          await apiFetch(buildUrl(ServicePath.CASE, `/complaints/types/${type.id}`), {
            method: 'PATCH',
            headers: getHeaders({ 'x-village-id': existingCategory.village_id }),
            body: JSON.stringify({
              name: type.name,
              description: type.description,
              is_urgent: type.is_urgent,
              require_address: type.require_address,
              send_important_contacts: true,
              important_contact_category: null,
              important_contact_category_id: category.id,
            }),
          })
        }
      }
    } catch (error) {
      console.error('Error updating linked complaint types:', error)
    }
  }

  await invalidateVillageAiCacheSafely(existingCategory.village_id)
  return NextResponse.json({ data: category })
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await context.params

  const existingCategory = await prisma.important_contact_categories.findUnique({
    where: { id },
    select: categorySelect,
  })

  if (!existingCategory) {
    return NextResponse.json({ error: 'Category not found' }, { status: 404 })
  }

  if (existingCategory.village_id !== session.admin.village_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  let linkedComplaintTypes: any[] = []
  try {
    const response = await apiFetch(buildComplaintTypesUrl(existingCategory.village_id), {
      method: 'GET',
      headers: getHeaders({ 'x-village-id': existingCategory.village_id }),
    })

    if (response.ok) {
      const data = await response.json()
      const allTypes = data.data || []
      linkedComplaintTypes = allTypes.filter((type: any) => isLinkedToImportantCategory(type, existingCategory))
    }
  } catch (error) {
    console.error('Error fetching complaint types:', error)
  }

  if (linkedComplaintTypes.length > 0) {
    for (const type of linkedComplaintTypes) {
      try {
        await apiFetch(buildUrl(ServicePath.CASE, `/complaints/types/${type.id}`), {
          method: 'PATCH',
          headers: getHeaders({ 'x-village-id': existingCategory.village_id }),
          body: JSON.stringify({
            name: type.name,
            description: type.description,
            is_urgent: type.is_urgent,
            require_address: type.require_address,
            send_important_contacts: false,
            important_contact_category: null,
            important_contact_category_id: null,
          }),
        })
      } catch (error) {
        console.error('Error updating complaint type:', error)
      }
    }
  }

  await prisma.important_contact_categories.delete({
    where: { id }
  })

  await invalidateVillageAiCacheSafely(existingCategory.village_id)
  return NextResponse.json({
    success: true,
    linkedTypesCleared: linkedComplaintTypes.length
  })
}
