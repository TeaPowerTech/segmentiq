import type { NormalisedEffort } from './types'

export interface CacheStore {
  get(key: string): Promise<{ data: NormalisedEffort; cachedAt: number } | null>
  set(key: string, value: NormalisedEffort, ttlSeconds: number): Promise<void>
  delete(key: string): Promise<void>
}

const TTL_SECONDS = 7 * 24 * 60 * 60

export class EffortCache {
  constructor(private readonly store: CacheStore) {}

  async get(athleteId: number, effortId: string): Promise<{
    effort: NormalisedEffort
    cachedAt: number
    cacheHit: true
  } | null> {
    const key = cacheKey(athleteId, effortId)
    const result = await this.store.get(key)
    if (!result) return null
    return { effort: result.data, cachedAt: result.cachedAt, cacheHit: true }
  }

  async set(athleteId: number, effort: NormalisedEffort): Promise<void> {
    const key = cacheKey(athleteId, effort.effortId)
    await this.store.set(key, effort, TTL_SECONDS)
  }

  async invalidate(athleteId: number, effortId: string): Promise<void> {
    const key = cacheKey(athleteId, effortId)
    await this.store.delete(key)
  }
}

function cacheKey(athleteId: number, effortId: string): string {
  return `${athleteId}:${effortId}`
}

export function createInMemoryCacheStore(): CacheStore {
  const store = new Map<string, {
    data: NormalisedEffort
    cachedAt: number
    expiresAt: number
  }>()

  return {
    async get(key) {
      const entry = store.get(key)
      if (!entry) return null
      if (Date.now() > entry.expiresAt) {
        store.delete(key)
        return null
      }
      return { data: entry.data, cachedAt: entry.cachedAt }
    },
    async set(key, value, ttlSeconds) {
      store.set(key, {
        data: value,
        cachedAt: Date.now(),
        expiresAt: Date.now() + ttlSeconds * 1000,
      })
    },
    async delete(key) {
      store.delete(key)
    },
  }
}
