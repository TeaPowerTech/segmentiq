const JSONBig = require('json-bigint')
const JSONBigString = JSONBig({ storeAsString: true })

const STRAVA_BASE = 'https://www.strava.com/api/v3'
const STREAM_KEYS = 'latlng,distance,altitude,velocity_smooth,heartrate,watts,cadence'

// ─── Error types ──────────────────────────────────────────────────────────────

export class StravaAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StravaAuthError'
  }
}

export class StravaRateLimitError extends Error {
  constructor(
    public readonly retryAfterSeconds: number,
    public readonly limitType: 'short' | 'daily'
  ) {
    super(`Strava rate limit hit (${limitType})`)
    this.name = 'StravaRateLimitError'
  }
}

export class StravaNotFoundError extends Error {
  constructor() {
    super('Strava resource not found')
    this.name = 'StravaNotFoundError'
  }
}

// ─── Token management ─────────────────────────────────────────────────────────

interface TokenRecord {
  accessToken: string
  refreshToken: string
  expiresAt: number
  athleteId: number
  scope: string
}

const tokenStore = new Map<number, TokenRecord>()

export async function storeTokens(params: {
  athleteId: number
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope: string
}): Promise<void> {
  tokenStore.set(params.athleteId, {
    accessToken: params.accessToken,
    refreshToken: params.refreshToken,
    expiresAt: params.expiresAt,
    athleteId: params.athleteId,
    scope: params.scope,
  })
}

export function deleteTokens(athleteId: number): void {
  tokenStore.delete(athleteId)
}

async function getValidAccessToken(athleteId: number): Promise<string> {
  const record = tokenStore.get(athleteId)

  if (!record) {
    throw new StravaAuthError(`No token found for athlete ${athleteId}`)
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const needsRefresh = record.expiresAt - nowSeconds < 300

  if (!needsRefresh) {
    return record.accessToken
  }

  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: record.refreshToken,
    }),
  })

  if (!response.ok) {
    tokenStore.delete(athleteId)
    throw new StravaAuthError('Token refresh failed — please reconnect Strava')
  }

  const text = await response.text()
  const data = JSONBigString.parse(text) as {
    access_token: string
    refresh_token: string
    expires_at: number
  }

  tokenStore.set(athleteId, {
    ...record,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
  })

  return data.access_token
}

// ─── Safe string conversion ───────────────────────────────────────────────────
// Converts all ID fields to strings immediately after parsing.
// Must be called before any object passes through JSON.stringify
// which would corrupt large integers.

function safeStringifyIds(obj: any): any {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(safeStringifyIds)
  if (typeof obj === 'object') {
    const result: any = {}
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'id' || key.endsWith('_id')) {
        result[key] = String(value)
      } else {
        result[key] = safeStringifyIds(value)
      }
    }
    return result
  }
  return obj
}

// ─── API calls ────────────────────────────────────────────────────────────────

async function stravaRequest<T>(athleteId: number, url: string): Promise<T> {
  const accessToken = await getValidAccessToken(athleteId)

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  })

  if (response.status === 429) {
    const retryAfter = parseInt(
      response.headers.get('X-RateLimit-Reset') ?? '900', 10
    )
    const usage = response.headers.get('X-RateLimit-Usage') ?? ''
    const limitType = usage.split(',')[1] === '1000' ? 'daily' : 'short'
    throw new StravaRateLimitError(retryAfter, limitType)
  }

  if (response.status === 401) {
    tokenStore.delete(athleteId)
    throw new StravaAuthError('Strava token invalid — please reconnect')
  }

  if (response.status === 404) {
    throw new StravaNotFoundError()
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Strava API error ${response.status}: ${body}`)
  }

  const text = await response.text()
  // Parse with json-bigint to preserve large IDs, then immediately
  // convert all ID fields to strings before any JSON.stringify can corrupt them
  const parsed = JSONBigString.parse(text)
  return safeStringifyIds(parsed) as T
}

export async function fetchStarredSegments(
  athleteId: number,
  perPage = 50
): Promise<any[]> {
  return stravaRequest<any[]>(
    athleteId,
    `${STRAVA_BASE}/segments/starred?per_page=${perPage}`
  )
}

export async function fetchEffort(
  athleteId: number,
  effortId: number
): Promise<any> {
  return stravaRequest<any>(
    athleteId,
    `${STRAVA_BASE}/segment_efforts/${effortId}`
  )
}

export async function fetchEffortStreams(
  athleteId: number,
  activityId: number,
  startIndex: number,
  endIndex: number
): Promise<any> {
  const url = `${STRAVA_BASE}/activities/${activityId}/streams?` +
    `keys=${STREAM_KEYS}&key_by_type=true&resolution=high&series_type=distance`

  const raw = await stravaRequest<Record<string, any>>(athleteId, url)
  const sliced: any = {}

  if (raw.latlng) {
    sliced.latlng = {
      ...raw.latlng,
      data: raw.latlng.data.slice(startIndex, endIndex + 1),
      original_size: endIndex - startIndex + 1,
    }
  }

  const numericKeys = [
    'distance', 'altitude', 'velocity_smooth',
    'heartrate', 'watts', 'cadence'
  ]

  for (const key of numericKeys) {
    if (raw[key]) {
      sliced[key] = {
        ...raw[key],
        data: raw[key].data.slice(startIndex, endIndex + 1),
        original_size: endIndex - startIndex + 1,
      }
    }
  }

  return sliced
}

export async function fetchSegmentEfforts(
  athleteId: number,
  segmentId: number,
  perPage = 50
): Promise<any[]> {
  const efforts = await stravaRequest<any[]>(
    athleteId,
    `${STRAVA_BASE}/segment_efforts?segment_id=${segmentId}&per_page=${perPage}`
  )
  return efforts.sort((a: any, b: any) => a.elapsed_time - b.elapsed_time)
}
