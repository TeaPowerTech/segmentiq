import express, { Request, Response } from 'express'
import cookieParser from 'cookie-parser'
import { Pool } from 'pg'
import authRouter from './auth'
import { normaliseEffort, computeComparison, normaliseActivity, NormaliseError } from './normalise'
import { EffortCache, createInMemoryCacheStore } from './cache'
import {
  fetchEffort,
  fetchEffortStreams,
  fetchSegmentEfforts,
  fetchStarredSegments,
  fetchRecentActivities,
  fetchActivity,
  fetchActivityStreams,
  StravaAuthError,
  StravaRateLimitError,
  StravaNotFoundError,
} from './strava'

const app = express()
const port = process.env.PORT || 3000

app.use(express.json())
app.use(cookieParser())

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway.internal')
    ? false
    : { rejectUnauthorized: false },
})

async function setupDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS athlete_tokens (
      athlete_id        INTEGER PRIMARY KEY,
      access_token      TEXT NOT NULL,
      refresh_token     TEXT NOT NULL,
      expires_at        INTEGER NOT NULL,
      scope             TEXT NOT NULL,
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS effort_id_map (
      safe_id     SERIAL PRIMARY KEY,
      athlete_id  INTEGER NOT NULL,
      real_id     TEXT NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(athlete_id, real_id)
    );

    CREATE INDEX IF NOT EXISTS idx_effort_id_map_athlete
      ON effort_id_map(athlete_id);

    CREATE TABLE IF NOT EXISTS effort_cache (
      cache_key   TEXT PRIMARY KEY,
      athlete_id  INTEGER NOT NULL,
      effort_id   TEXT NOT NULL,
      data        JSONB NOT NULL,
      cached_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at  TIMESTAMPTZ NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_effort_cache_athlete
      ON effort_cache(athlete_id);

    CREATE INDEX IF NOT EXISTS idx_effort_cache_expires
      ON effort_cache(expires_at);

    CREATE TABLE IF NOT EXISTS coverage_cache (
      athlete_id    INTEGER PRIMARY KEY,
      tiles         JSONB NOT NULL,
      activity_count INTEGER NOT NULL DEFAULT 0,
      computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  console.log('[db] tables ready')
}

export async function storeTokensInDb(params: {
  athleteId: number
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope: string
}): Promise<void> {
  await db.query(`
    INSERT INTO athlete_tokens
      (athlete_id, access_token, refresh_token, expires_at, scope, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (athlete_id) DO UPDATE SET
      access_token  = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      expires_at    = EXCLUDED.expires_at,
      scope         = EXCLUDED.scope,
      updated_at    = NOW()
  `, [params.athleteId, params.accessToken, params.refreshToken,
      params.expiresAt, params.scope])
}

export async function getTokensFromDb(athleteId: number) {
  const result = await db.query(
    'SELECT * FROM athlete_tokens WHERE athlete_id = $1',
    [athleteId]
  )
  return result.rows[0] ?? null
}

export async function deleteTokensFromDb(athleteId: number): Promise<void> {
  await db.query('DELETE FROM athlete_tokens WHERE athlete_id = $1', [athleteId])
}

async function toSafeId(athleteId: number, realId: string): Promise<string> {
  const result = await db.query(`
    INSERT INTO effort_id_map (athlete_id, real_id)
    VALUES ($1, $2)
    ON CONFLICT (athlete_id, real_id) DO UPDATE SET real_id = EXCLUDED.real_id
    RETURNING safe_id
  `, [athleteId, realId])
  return String(result.rows[0].safe_id)
}

async function toRealId(safeId: string): Promise<string | null> {
  const parsed = parseInt(safeId, 10)
  if (isNaN(parsed)) return null
  const result = await db.query(
    'SELECT real_id FROM effort_id_map WHERE safe_id = $1',
    [parsed]
  )
  return result.rows[0]?.real_id ?? null
}

// ─── Tile math ────────────────────────────────────────────────────────────────

const ZOOM = 14

function latLonToTile(lat: number, lon: number): { x: number; y: number } {
  const n = Math.pow(2, ZOOM)
  const x = Math.floor((lon + 180) / 360 * n)
  const latRad = lat * Math.PI / 180
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n)
  return { x, y }
}

// Virtual activity types to exclude (Zwift etc.)
const VIRTUAL_TYPES = new Set(['VirtualRide', 'VirtualRun', 'VirtualRow'])

// ─── Coverage compute ─────────────────────────────────────────────────────────

interface TileHit {
  x: number
  y: number
  date: string
  count: number
}

async function computeCoverage(athleteId: number): Promise<TileHit[]> {
  const tileMap = new Map<string, TileHit>()
  let page = 1
  let totalActivities = 0

  console.log(`[coverage] computing for athlete ${athleteId}`)

  // Fetch all activities in pages of 50
  while (true) {
    const activities = await fetchRecentActivities(athleteId, page, 50)
    if (!activities || activities.length === 0) break

    const eligible = activities.filter((a: any) => !VIRTUAL_TYPES.has(a.type))
    totalActivities += eligible.length

    // Process in batches of 10 with delay to respect rate limits
    for (let i = 0; i < eligible.length; i += 10) {
      const batch = eligible.slice(i, i + 10)

      await Promise.all(batch.map(async (activity: any) => {
        try {
          const streams = await fetchActivityStreams(athleteId, String(activity.id))
          if (!streams?.latlng?.data) return

          const date = activity.start_date?.split('T')[0] ?? '1970-01-01'

          for (const [lat, lon] of streams.latlng.data) {
            if (typeof lat !== 'number' || typeof lon !== 'number') continue
            const { x, y } = latLonToTile(lat, lon)
            const key = `${x},${y}`
            const existing = tileMap.get(key)
            if (existing) {
              existing.count++
              if (date < existing.date) existing.date = date
            } else {
              tileMap.set(key, { x, y, date, count: 1 })
            }
          }
        } catch {
          // Skip activities that fail to fetch — don't abort the whole compute
        }
      }))

      // Small delay between batches to avoid Strava rate limiting
      if (i + 10 < eligible.length) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    if (activities.length < 50) break
    page++
  }

  console.log(`[coverage] done — ${tileMap.size} tiles from ${totalActivities} activities`)
  return Array.from(tileMap.values())
}

// ─── CORS ─────────────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  const origin = req.headers.origin
  const allowed = [
    'https://segmentiq.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001',
  ]
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-session')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.use('/api', authRouter)

// ─── Session middleware ───────────────────────────────────────────────────────

function requireSession(req: any, res: Response, next: any) {
  const sessionFromHeader = req.headers['x-session'] as string | undefined
  const sessionFromCookie = req.cookies?.session
  const session = sessionFromHeader || sessionFromCookie
  if (!session) {
    return res.status(401).json({ error: 'Not logged in', code: 'STRAVA_AUTH_EXPIRED' })
  }
  try {
    const payload = JSON.parse(Buffer.from(session, 'base64').toString('utf8'))
    req.athleteId = payload.athleteId
    req.athleteWeightKg = payload.weightKg ?? null
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid session', code: 'STRAVA_AUTH_EXPIRED' })
  }
}

// ─── Caches ───────────────────────────────────────────────────────────────────

const cache = new EffortCache(createInMemoryCacheStore())
const activityCache = new Map<string, { data: any; cachedAt: number }>()
const ACTIVITY_CACHE_TTL_MS = 1000 * 60 * 30

// Track in-progress coverage computations to avoid duplicate jobs
const coverageInProgress = new Set<number>()

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', app: 'SegmentIQ API' })
})

// ─── POST /api/convert ────────────────────────────────────────────────────────

app.post('/api/convert', express.raw({ type: 'video/webm', limit: '200mb' }), async (req: Request, res: Response) => {
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const { randomUUID } = await import('crypto')
  const fs = await import('fs')
  const os = await import('os')
  const path = await import('path')
  const execFileAsync = promisify(execFile)

  const tmpDir = os.tmpdir()
  const id = randomUUID()
  const inputPath = path.join(tmpDir, `${id}.webm`)
  const outputPath = path.join(tmpDir, `${id}.mp4`)

  try {
    await fs.promises.writeFile(inputPath, req.body)
    await execFileAsync('ffmpeg', [
      '-i', inputPath,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ])
    const mp4 = await fs.promises.readFile(outputPath)
    res.setHeader('Content-Type', 'video/mp4')
    res.setHeader('Content-Disposition', 'attachment; filename="segmentiq.mp4"')
    res.send(mp4)
  } catch (err) {
    console.error('[convert] ffmpeg error:', err)
    res.status(500).json({ error: 'Conversion failed', code: 'INTERNAL_ERROR' })
  } finally {
    await fs.promises.unlink(inputPath).catch(() => {})
    await fs.promises.unlink(outputPath).catch(() => {})
  }
})

// ─── GET /api/coverage ───────────────────────────────────────────────────────
// Returns cached tile data. If >24hrs old, triggers background recompute
// and returns the stale data immediately.

app.get('/api/coverage', requireSession, async (req: any, res: Response) => {
  try {
    const result = await db.query(
      'SELECT tiles, activity_count, computed_at FROM coverage_cache WHERE athlete_id = $1',
      [req.athleteId]
    )

    if (result.rows.length === 0) {
      // No data yet — return empty with status
      return res.json({
        tiles: [],
        activityCount: 0,
        computedAt: null,
        status: 'empty',
        inProgress: coverageInProgress.has(req.athleteId),
      })
    }

    const row = result.rows[0]
    const ageMs = Date.now() - new Date(row.computed_at).getTime()
    const stale = ageMs > 24 * 60 * 60 * 1000

    return res.json({
      tiles: row.tiles,
      activityCount: row.activity_count,
      computedAt: row.computed_at,
      status: stale ? 'stale' : 'fresh',
      inProgress: coverageInProgress.has(req.athleteId),
    })
  } catch (err) {
    return handleError(err, res)
  }
})

// ─── POST /api/coverage/refresh ──────────────────────────────────────────────
// Triggers a fresh coverage compute. Returns immediately with {started: true}.
// The compute runs in the background and updates the DB when done.
// Client should poll GET /api/coverage to see when it's ready.

app.post('/api/coverage/refresh', requireSession, async (req: any, res: Response) => {
  if (coverageInProgress.has(req.athleteId)) {
    return res.json({ started: false, reason: 'already_running' })
  }

  coverageInProgress.add(req.athleteId)
  res.json({ started: true })

  // Run in background — don't await
  ;(async () => {
    try {
      const tiles = await computeCoverage(req.athleteId)
      await db.query(`
        INSERT INTO coverage_cache (athlete_id, tiles, activity_count, computed_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (athlete_id) DO UPDATE SET
          tiles = EXCLUDED.tiles,
          activity_count = EXCLUDED.activity_count,
          computed_at = NOW()
      `, [req.athleteId, JSON.stringify(tiles), tiles.length])
      console.log(`[coverage] saved ${tiles.length} tiles for athlete ${req.athleteId}`)
    } catch (err) {
      console.error('[coverage] compute failed:', err)
    } finally {
      coverageInProgress.delete(req.athleteId)
    }
  })()
})

// ─── GET /api/segments/starred ────────────────────────────────────────────────

app.get('/api/segments/starred', requireSession, async (req: any, res: Response) => {
  try {
    const segments = await fetchStarredSegments(req.athleteId)
    const safe = segments.map((s: any) => ({ ...s, id: String(s.id) }))
    return res.json({ data: safe })
  } catch (err) {
    return handleError(err, res)
  }
})

// ─── GET /api/segments/:segmentId/efforts ─────────────────────────────────────

app.get('/api/segments/:segmentId/efforts', requireSession, async (req: any, res: Response) => {
  try {
    const segmentId = parseInt(req.params.segmentId, 10)
    const efforts = await fetchSegmentEfforts(req.athleteId, segmentId)
    const safe = await Promise.all(efforts.map(async (e: any) => ({
      ...e,
      id: await toSafeId(req.athleteId, String(e.id)),
      activity: { ...e.activity, id: String(e.activity.id) },
    })))
    return res.json({ data: safe })
  } catch (err) {
    return handleError(err, res)
  }
})

// MUST be registered before /api/efforts/:effortId
app.get('/api/efforts/compare', requireSession, async (req: any, res: Response) => {
  const { a: safeIdA, b: safeIdB } = req.query
  if (typeof safeIdA !== 'string' || typeof safeIdB !== 'string') {
    return res.status(400).json({ error: 'Both ?a= and ?b= effort IDs are required', code: 'INTERNAL_ERROR' })
  }
  const realIdA = await toRealId(safeIdA)
  const realIdB = await toRealId(safeIdB)
  if (!realIdA || !realIdB) {
    return res.status(404).json({ error: 'Efforts not found — please go back and reselect.', code: 'EFFORT_NOT_FOUND' })
  }
  try {
    const [resultA, resultB] = await Promise.all([
      getOrFetch(req.athleteId, realIdA, req.athleteWeightKg),
      getOrFetch(req.athleteId, realIdB, req.athleteWeightKg),
    ])
    const deltas = computeComparison(resultA.effort, resultB.effort)
    return res.json({
      data: { effortA: resultA.effort, effortB: resultB.effort, deltas },
      cacheHit: resultA.cacheHit && resultB.cacheHit,
    })
  } catch (err) {
    return handleError(err, res)
  }
})

// ─── GET /api/efforts/:effortId ───────────────────────────────────────────────

app.get('/api/efforts/:effortId', requireSession, async (req: any, res: Response) => {
  const safeKey = req.params.effortId
  const realEffortId = await toRealId(safeKey)
  if (!realEffortId) {
    return res.status(404).json({ error: 'Effort not found.', code: 'EFFORT_NOT_FOUND' })
  }
  try {
    const cached = await cache.get(req.athleteId, realEffortId)
    if (cached) {
      res.setHeader('X-Cache', 'HIT')
      return res.json({ data: cached.effort, cachedAt: cached.cachedAt, cacheHit: true })
    }
    res.setHeader('X-Cache', 'MISS')
    const rawEffort = await fetchEffort(req.athleteId, realEffortId)
    const streams = await fetchEffortStreams(
      req.athleteId,
      rawEffort.activity.id,
      parseInt(rawEffort.start_index, 10),
      parseInt(rawEffort.end_index, 10)
    )
    const normalised = normaliseEffort(rawEffort, streams, req.athleteWeightKg)
    normalised.athleteId = req.athleteId
    await cache.set(req.athleteId, normalised)
    return res.json({ data: normalised, cachedAt: null, cacheHit: false })
  } catch (err) {
    return handleError(err, res)
  }
})

// ─── GET /api/activities ──────────────────────────────────────────────────────

app.get('/api/activities', requireSession, async (req: any, res: Response) => {
  try {
    const page = parseInt((req.query.page as string) ?? '1', 10)
    const activities = await fetchRecentActivities(req.athleteId, page, 30)
    const safe = activities.map((a: any) => ({
      id: String(a.id),
      name: a.name,
      type: a.type,
      start_date: a.start_date,
      distance: a.distance,
      moving_time: a.moving_time,
      elapsed_time: a.elapsed_time,
      total_elevation_gain: a.total_elevation_gain,
      average_speed: a.average_speed,
      average_heartrate: a.average_heartrate ?? null,
      max_heartrate: a.max_heartrate ?? null,
      average_watts: a.average_watts ?? null,
      device_watts: a.device_watts ?? false,
      achievement_count: a.achievement_count ?? 0,
      pr_count: a.pr_count ?? 0,
    }))
    return res.json({ data: safe })
  } catch (err) {
    return handleError(err, res)
  }
})

// ─── GET /api/activities/:activityId ─────────────────────────────────────────

app.get('/api/activities/:activityId', requireSession, async (req: any, res: Response) => {
  const activityId = req.params.activityId
  const cacheKey = `${req.athleteId}:${activityId}`
  try {
    const cached = activityCache.get(cacheKey)
    if (cached && Date.now() - cached.cachedAt < ACTIVITY_CACHE_TTL_MS) {
      res.setHeader('X-Cache', 'HIT')
      return res.json({ data: cached.data, cacheHit: true })
    }
    res.setHeader('X-Cache', 'MISS')
    const [activity, streams] = await Promise.all([
      fetchActivity(req.athleteId, activityId),
      fetchActivityStreams(req.athleteId, activityId),
    ])
    const normalised = normaliseActivity(activity, streams, req.athleteWeightKg)
    activityCache.set(cacheKey, { data: normalised, cachedAt: Date.now() })
    return res.json({ data: normalised, cacheHit: false })
  } catch (err) {
    return handleError(err, res)
  }
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getOrFetch(
  athleteId: number,
  realEffortId: string,
  athleteWeightKg: number | null
) {
  const cached = await cache.get(athleteId, realEffortId)
  if (cached) return cached

  const rawEffort = await fetchEffort(athleteId, realEffortId)
  const streams = await fetchEffortStreams(
    athleteId,
    rawEffort.activity.id,
    parseInt(rawEffort.start_index, 10),
    parseInt(rawEffort.end_index, 10)
  )
  const normalised = normaliseEffort(rawEffort, streams, athleteWeightKg)
  normalised.athleteId = athleteId
  await cache.set(athleteId, normalised)
  return { effort: normalised, cachedAt: null, cacheHit: false }
}

function handleError(err: unknown, res: Response) {
  if (err instanceof StravaRateLimitError) {
    res.setHeader('Retry-After', String(err.retryAfterSeconds))
    return res.status(429).json({
      error: err.limitType === 'daily'
        ? 'Strava daily rate limit reached. Try again tomorrow.'
        : `Strava rate limit reached. Retry in ${Math.ceil(err.retryAfterSeconds / 60)} minutes.`,
      code: 'STRAVA_RATE_LIMITED',
    })
  }
  if (err instanceof StravaAuthError) {
    return res.status(401).json({
      error: 'Strava authentication expired. Please reconnect.',
      code: 'STRAVA_AUTH_EXPIRED',
    })
  }
  if (err instanceof StravaNotFoundError) {
    return res.status(404).json({
      error: 'Effort not found on Strava.',
      code: 'EFFORT_NOT_FOUND',
    })
  }
  if (err instanceof NormaliseError) {
    console.error('[normalise error]', err.message)
    return res.status(500).json({
      error: 'Failed to process effort data.',
      code: 'INTERNAL_ERROR',
    })
  }
  console.error('[unhandled error]', err)
  return res.status(500).json({
    error: 'Something went wrong. Please try again.',
    code: 'INTERNAL_ERROR',
  })
}

// ─── Start ────────────────────────────────────────────────────────────────────

setupDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`SegmentIQ API running on port ${port}`)
    })
  })
  .catch(err => {
    console.error('[fatal] database setup failed:', err)
    process.exit(1)
  })
