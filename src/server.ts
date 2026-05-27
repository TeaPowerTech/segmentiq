import express, { Request, Response } from 'express'
import cookieParser from 'cookie-parser'
import { Pool } from 'pg'
import authRouter from './auth'
import { normaliseEffort, computeComparison, NormaliseError } from './normalise'
import { EffortCache, createInMemoryCacheStore } from './cache'
import {
  fetchEffort,
  fetchEffortStreams,
  fetchSegmentEfforts,
  fetchStarredSegments,
  StravaAuthError,
  StravaRateLimitError,
  StravaNotFoundError,
} from './strava'

const app = express()
const port = process.env.PORT || 3000

app.use(express.json())
app.use(cookieParser())

// ─── Postgres ─────────────────────────────────────────────────────────────────

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
  `)
  console.log('[db] tables ready')
}

// ─── Token store — Postgres backed ───────────────────────────────────────────

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

// ─── ID map — Postgres backed ─────────────────────────────────────────────────

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

// ─── Auth routes ──────────────────────────────────────────────────────────────

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

// ─── Cache ────────────────────────────────────────────────────────────────────

const cache = new EffortCache(createInMemoryCacheStore())

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', app: 'SegmentIQ API' })
})

// ─── GET /api/segments/starred ────────────────────────────────────────────────

app.get('/api/segments/starred', requireSession, async (req: any, res: Response) => {
  try {
    const segments = await fetchStarredSegments(req.athleteId)
    const safe = segments.map((s: any) => ({
      ...s,
      id: String(s.id),
    }))
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

// ─── GET /api/efforts/compare?a=:idA&b=:idB ──────────────────────────────────
// MUST be registered before /api/efforts/:effortId to prevent Express
// matching "compare" as the effortId parameter

app.get('/api/efforts/compare', requireSession, async (req: any, res: Response) => {
  const { a: safeIdA, b: safeIdB } = req.query

  if (typeof safeIdA !== 'string' || typeof safeIdB !== 'string') {
    return res.status(400).json({
      error: 'Both ?a= and ?b= effort IDs are required',
      code: 'INTERNAL_ERROR',
    })
  }

  const realIdA = await toRealId(safeIdA)
  const realIdB = await toRealId(safeIdB)

  if (!realIdA || !realIdB) {
    return res.status(404).json({
      error: 'Efforts not found — please go back and reselect.',
      code: 'EFFORT_NOT_FOUND',
    })
  }

  try {
    const [resultA, resultB] = await Promise.all([
      getOrFetch(req.athleteId, realIdA, req.athleteWeightKg),
      getOrFetch(req.athleteId, realIdB, req.athleteWeightKg),
    ])

    const deltas = computeComparison(resultA.effort, resultB.effort)

    return res.json({
      data: {
        effortA: resultA.effort,
        effortB: resultB.effort,
        deltas,
      },
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
      return res.json({
        data: cached.effort,
        cachedAt: cached.cachedAt,
        cacheHit: true,
      })
    }

    res.setHeader('X-Cache', 'MISS')

    const rawEffort = await fetchEffort(req.athleteId, parseInt(realEffortId, 10))
    const streams = await fetchEffortStreams(
      req.athleteId,
      rawEffort.activity.id,
      rawEffort.start_index,
      rawEffort.end_index
    )

    const normalised = normaliseEffort(rawEffort, streams, req.athleteWeightKg)
    normalised.athleteId = req.athleteId
    await cache.set(req.athleteId, normalised)

    return res.json({ data: normalised, cachedAt: null, cacheHit: false })

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

  const rawEffort = await fetchEffort(athleteId, parseInt(realEffortId, 10))
  const streams = await fetchEffortStreams(
    athleteId,
    rawEffort.activity.id,
    rawEffort.start_index,
    rawEffort.end_index
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
