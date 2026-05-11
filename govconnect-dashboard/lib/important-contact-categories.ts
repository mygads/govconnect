import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma'
import { buildScopedNameKey, normalizeScopedName } from '@/lib/utils'
import { isMissingNameKeyColumnError } from '@/lib/schema-drift'

const categorySelect = {
  id: true,
  village_id: true,
  name: true,
  created_at: true,
  updated_at: true,
} as const

type ImportantContactCategoryRecord = {
  id: string
  village_id: string
  name: string
  created_at: Date
  updated_at: Date
}

function matchesNormalizedName(name: string, normalizedName: string) {
  return normalizeScopedName(name) === normalizedName
}

export async function listVillageImportantContactCategories(villageId: string) {
  return prisma.important_contact_categories.findMany({
    where: { village_id: villageId },
    select: categorySelect,
    orderBy: { created_at: 'asc' },
  })
}

export async function findVillageImportantContactCategoryById(villageId: string, categoryId: string) {
  return prisma.important_contact_categories.findFirst({
    where: { id: categoryId, village_id: villageId },
    select: categorySelect,
  })
}

export async function findVillageImportantContactCategoryByName(villageId: string, categoryName?: string | null) {
  const normalizedName = normalizeScopedName(categoryName)
  if (!normalizedName) return null

  try {
    return await prisma.important_contact_categories.findFirst({
      where: {
        village_id: villageId,
        name_key: buildScopedNameKey(normalizedName),
      },
      select: categorySelect,
    })
  } catch (error) {
    if (!isMissingNameKeyColumnError(error)) throw error

    const categories = await listVillageImportantContactCategories(villageId)
    return categories.find((category) => matchesNormalizedName(category.name, normalizedName)) || null
  }
}

export async function createVillageImportantContactCategory(villageId: string, categoryName: string) {
  try {
    return await prisma.important_contact_categories.create({
      data: {
        village_id: villageId,
        name: categoryName,
        name_key: buildScopedNameKey(categoryName),
      },
      select: categorySelect,
    })
  } catch (error) {
    if (!isMissingNameKeyColumnError(error)) throw error

    const rows = await prisma.$queryRaw<ImportantContactCategoryRecord[]>`
      INSERT INTO important_contact_categories (id, village_id, name, created_at, updated_at)
      VALUES (${randomUUID()}, ${villageId}, ${categoryName}, NOW(), NOW())
      RETURNING id, village_id, name, created_at, updated_at
    `

    return rows[0] || null
  }
}

export async function updateVillageImportantContactCategory(categoryId: string, villageId: string, categoryName: string) {
  try {
    return await prisma.important_contact_categories.update({
      where: { id: categoryId },
      data: {
        name: categoryName,
        name_key: buildScopedNameKey(categoryName),
      },
      select: categorySelect,
    })
  } catch (error) {
    if (!isMissingNameKeyColumnError(error)) throw error

    const rows = await prisma.$queryRaw<ImportantContactCategoryRecord[]>`
      UPDATE important_contact_categories
      SET name = ${categoryName}, updated_at = NOW()
      WHERE id = ${categoryId} AND village_id = ${villageId}
      RETURNING id, village_id, name, created_at, updated_at
    `

    return rows[0] || null
  }
}
