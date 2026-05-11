import { apiFetch, buildUrl, getHeaders, ServicePath } from '@/lib/api-client'

interface InvalidateVillageAiCacheOptions {
  intents?: string[]
  retrieval?: boolean
  profile?: boolean
}

async function readInvalidationError(response: Response) {
  try {
    const payload = await response.json() as { error?: string; message?: string }
    return payload.error || payload.message || `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}

export async function invalidateVillageAiCache(
  villageId: string,
  options: InvalidateVillageAiCacheOptions = {}
) {
  const response = await apiFetch(buildUrl(ServicePath.AI, '/admin/cache/invalidate-village'), {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      villageId,
      retrieval: options.retrieval ?? true,
      profile: options.profile ?? true,
      ...(options.intents?.length ? { intents: options.intents } : {}),
    }),
    timeout: 10000,
  })

  if (!response.ok) {
    throw new Error(await readInvalidationError(response))
  }
}

export async function invalidateVillageAiCacheSafely(
  villageId: string | null | undefined,
  options: InvalidateVillageAiCacheOptions = {}
) {
  if (!villageId) return

  try {
    await invalidateVillageAiCache(villageId, options)
  } catch (error: any) {
    console.error('Failed to invalidate village AI cache:', {
      villageId,
      error: error?.message || String(error),
      intents: options.intents,
      retrieval: options.retrieval,
      profile: options.profile,
    })
  }
}
