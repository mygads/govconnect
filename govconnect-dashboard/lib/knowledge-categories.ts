import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { buildScopedNameKey, normalizeScopedName } from '@/lib/utils'

function isDuplicateCategoryError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

const categorySelect = {
  id: true,
  name: true,
  name_key: true,
} as const

export async function findVillageKnowledgeCategoryByName(villageId: string, categoryName?: string | null) {
  const normalizedName = normalizeScopedName(categoryName)
  if (!normalizedName) return null

  return prisma.knowledge_categories.findFirst({
    where: {
      village_id: villageId,
      name_key: buildScopedNameKey(normalizedName),
    },
    select: categorySelect,
  })
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

  const nameKey = buildScopedNameKey(normalizedName)
  const existing = await prisma.knowledge_categories.findFirst({
    where: {
      village_id: options.villageId,
      name_key: nameKey,
    },
    select: categorySelect,
  })

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
    const created = await prisma.knowledge_categories.create({
      data: {
        village_id: options.villageId,
        name: normalizedName,
        name_key: nameKey,
        is_default: options.isDefaultOnCreate ?? false,
      },
      select: categorySelect,
    })

    return {
      categoryId: created.id,
      categoryName: created.name,
    }
  } catch (error) {
    if (!isDuplicateCategoryError(error)) throw error

    const category = await prisma.knowledge_categories.findFirst({
      where: {
        village_id: options.villageId,
        name_key: nameKey,
      },
      select: categorySelect,
    })

    return {
      categoryId: category?.id,
      categoryName: category?.name || normalizedName,
    }
  }
}
