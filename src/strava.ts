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
  const data = parseStravaJson(text) as {
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

// ─── Safe JSON parsing ────────────────────────────────────────────────────────
// Strava IDs are 19-digit integers that exceed JavaScript's Number.MAX_SAFE_INTEGER.
// json-bigint does not reliably preserve these in all Node.js environments.
// The only guaranteed fix is a regex replacement on the raw JSON text that
// wraps all large integer ID values in quotes BEFORE JSON.parse ever sees them.

function parseStravaJson(text: string): any {
  const safeText = text
    .replace(/"id"\s*:\s*(\d{10,})/g, '"id":"$1"')
    .replace(/"athlete_id"\s*:\s*(\d{10,})/g, '"athlete_id":"$1"')
    .replace(/"activity_id"\s*:\s*(\d{10,})/g, '"activity_id":"$1"')
    .replace(/"segment_id"\s*:\s*(\d{10,})/g, '"segment_id":"$1"')
    .replace(/"gear_id"\s*:\s*(\d{10,})/g, '"gear_id":"$1"')

  return JSON.parse(safeText)
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
  return parseStravaJson(text) as T
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
  effortId: string
): Promise<any> {
  return stravaRequest<any>(
    athleteId,
    `${STRAVA_BASE}/segment_efforts/${effortId}`
  )
}

export async function fetchEffortStreams(
  athleteId: number,
  activityId: string,
  startIndex: number,
  endIndex: number
): Promise<any> {
  // No resolution parameter — use Strava's native resolution so that
  // start_index and end_index from the segment effort align correctly.
  // Using resolution=high causes Strava to resample the stream which
  // shifts the indices and produces incorrect segment slices.
  const url = `${STRAVA_BASE}/activities/${activityId}/streams?` +
    `keys=${STREAM_KEYS}&key_by_type=true&series_type=distance`

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
// ─── Activity list ────────────────────────────────────────────────────────────

export async function fetchRecentActivities(athleteId: number, page = 1, perPage = 30): Promise<any[]> {
  const token = await getValidToken(athleteId)
  const res = await fetchWithRetry(
    `https://www.strava.com/api/v3/athlete/activities?page=${page}&per_page=${perPage}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) await throwStravaError(res)
  const text = await res.text()
  return JSON.parse(parseStravaJson(text))
}

export async function fetchActivity(athleteId: number, activityId: string): Promise<any> {
  const token = await getValidToken(athleteId)
  const res = await fetchWithRetry(
    `https://www.strava.com/api/v3/activities/${activityId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) await throwStravaError(res)
  const text = await res.text()
  return JSON.parse(parseStravaJson(text))
}

export async function fetchActivityStreams(athleteId: number, activityId: string): Promise<any> {
  const token = await getValidToken(athleteId)
  const keys = 'time,distance,altitude,heartrate,watts,cadence,velocity_smooth,latlng'
  const res = await fetchWithRetry(
    `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=${keys}&key_by_type=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) await throwStravaError(res)
  const text = await res.text()
  return JSON.parse(parseStravaJson(text))
}
