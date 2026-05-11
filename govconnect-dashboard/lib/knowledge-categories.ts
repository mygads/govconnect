import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { buildScopedNameKey, normalizeScopedName } from '@/lib/utils'
import { isMissingNameKeyColumnError } from '@/lib/schema-drift'

function isDuplicateCategoryError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

const categorySelect = {
  id: true,
  name: true,
} as const

type KnowledgeCategoryRecord = {
  id: string
  name: string
}

function matchesNormalizedName(name: string, normalizedName: string) {
  return normalizeScopedName(name) === normalizedName
}

export async function listVillageKnowledgeCategories(villageId: string) {
  return prisma.knowledge_categories.findMany({
    where: { village_id: villageId },
    select: {
      id: true,
      village_id: true,
      name: true,
      is_default: true,
      created_at: true,
      updated_at: true,
    },
    orderBy: { created_at: 'asc' },
  })
}

export async function findVillageKnowledgeCategoryByName(villageId: string, categoryName?: string | null) {
  const normalizedName = normalizeScopedName(categoryName)
  if (!normalizedName) return null

  try {
    return await prisma.knowledge_categories.findFirst({
      where: {
        village_id: villageId,
        name_key: buildScopedNameKey(normalizedName),
      },
      select: categorySelect,
    })
  } catch (error) {
    if (!isMissingNameKeyColumnError(error)) throw error

    const categories = await listVillageKnowledgeCategories(villageId)
    return categories.find((category) => matchesNormalizedName(category.name, normalizedName)) || null
  }
}

export async function createVillageKnowledgeCategory(villageId: string, categoryName: string, isDefaultOnCreate: boolean) {
  try {
    return await prisma.knowledge_categories.create({
      data: {
        village_id: villageId,
        name: categoryName,
        name_key: buildScopedNameKey(categoryName),
        is_default: isDefaultOnCreate,
      },
      select: categorySelect,
    })
  } catch (error) {
    if (!isMissingNameKeyColumnError(error)) throw error

    const rows = await prisma.$queryRaw<KnowledgeCategoryRecord[]>`
      INSERT INTO knowledge_categories (id, village_id, name, is_default, created_at, updated_at)
      VALUES (${randomUUID()}, ${villageId}, ${categoryName}, ${isDefaultOnCreate}, NOW(), NOW())
      RETURNING id, name
    `

    return rows[0] || null
  }
}

export async function resolveVillageKnowledgeCategory(options: {
  villageId?: string | null
  categoryId?: string | null
  categoryName?: string | null
  createIfMissing?: boolean
  isDefaultOnCreate?: boolean
}) {
  const normalizedName = normalizeScopedName(options.categoryName)

  if (!options.villageId) {
    if (options.categoryId) {
      const categoryById = await prisma.knowledge_categories.findUnique({
        where: { id: options.categoryId },
        select: categorySelect,
      })

      if (categoryById) {
        return {
          categoryId: categoryById.id,
          categoryName: categoryById.name,
        }
      }
    }

    return {
      categoryId: options.categoryId || undefined,
      categoryName: normalizedName || undefined,
    }
  }

  if (options.categoryId) {
    const categoryById = await prisma.knowledge_categories.findFirst({
      where: {
        id: options.categoryId,
        village_id: options.villageId,
      },
      select: categorySelect,
    })

    if (categoryById) {
      return {
        categoryId: categoryById.id,
        categoryName: categoryById.name,
      }
    }
  }

  if (!normalizedName) {
    return {
      categoryId: undefined,
      categoryName: undefined,
    }
  }

  const existing = await findVillageKnowledgeCategoryByName(options.villageId, normalizedName)
  if (existing) {
    return {
      categoryId: existing.id,
      categoryName: existing.name,
    }
  }

  if (!options.createIfMissing) {
    return {
      categoryId: undefined,
      categoryName: normalizedName,
    }
  }

  try {
    const created = await createVillageKnowledgeCategory(
      options.villageId,
      normalizedName,
      options.isDefaultOnCreate ?? false,
    )

    return {
      categoryId: created?.id,
      categoryName: created?.name || normalizedName,
    }
  } catch (error) {
    if (!isDuplicateCategoryError(error)) throw error

    const category = await findVillageKnowledgeCategoryByName(options.villageId, normalizedName)

    return {
      categoryId: category?.id,
      categoryName: category?.name || normalizedName,
    }
  }
}
