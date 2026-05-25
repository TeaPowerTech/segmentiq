import express, { Request, Response } from 'express'
import cookieParser from 'cookie-parser'
import authRouter from './auth'
import { normaliseEffort, computeComparison, NormaliseError } from './normalise'
import { EffortCache, createInMemoryCacheStore } from './cache'
import {
  fetchEffort,
  fetchEffortStreams,
  fetchSegmentEfforts,
  StravaAuthError,
  StravaRateLimitError,
  StravaNotFoundError,
} from './strava'

const app = express()
const port = process.env.PORT || 3000

app.use(express.json())
app.use(cookieParser())

// ─── Auth routes ──────────────────────────────────────────────────────────────

app.use('/api', authRouter)

// ─── Session middleware ───────────────────────────────────────────────────────

function requireSession(req: any, res: Response, next: any) {
  const session = req.cookies?.session
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

// ─── GET /api/segments/:segmentId/efforts ─────────────────────────────────────

app.get('/api/segments/:segmentId/efforts', requireSession, async (req: any, res: Response) => {
  try {
    const segmentId = parseInt(req.params.segmentId, 10)
    const efforts = await fetchSegmentEfforts(req.athleteId, segmentId)

    // Convert large IDs to strings to avoid JavaScript precision loss
    const safe = efforts.map((e: any) => ({
      ...e,
      id: String(e.id),
      activity: { ...e.activity, id: String(e.activity.id) },
    }))

    return res.json({ data: safe })
  } catch (err) {
    return handleError(err, res)
  }
})

// ─── GET /api/efforts/:effortId ───────────────────────────────────────────────

app.get('/api/efforts/:effortId', requireSession, async (req: any, res: Response) => {
  const effortId = req.params.effortId

  try {
    const cached = await cache.get(req.athleteId, effortId)
    if (cached) {
      res.setHeader('X-Cache', 'HIT')
      return res.json({
        data: cached.effort,
        cachedAt: cached.cachedAt,
        cacheHit: true,
      })
    }

    res.setHeader('X-Cache', 'MISS')

    const rawEffort = await fetchEffort(req.athleteId, parseInt(effortId, 10))
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

// ─── GET /api/efforts/compare?a=:idA&b=:idB ──────────────────────────────────

app.get('/api/efforts/compare', requireSession, async (req: any, res: Response) => {
  const { a: effortIdA, b: effortIdB } = req.query

  if (typeof effortIdA !== 'string' || typeof effortIdB !== 'string') {
    return res.status(400).json({
      error: 'Both ?a= and ?b= effort IDs are required',
      code: 'INTERNAL_ERROR',
    })
  }

  try {
    const [resultA, resultB] = await Promise.all([
      getOrFetch(req.athleteId, effortIdA, req.athleteWeightKg),
      getOrFetch(req.athleteId, effortIdB, req.athleteWeightKg),
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getOrFetch(
  athleteId: number,
  effortId: string,
  athleteWeightKg: number | null
) {
  const cached = await cache.get(athleteId, effortId)
  if (cached) return cached

  const rawEffort = await fetchEffort(athleteId, parseInt(effortId, 10))
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

app.listen(port, () => {
  console.log(`SegmentIQ API running on port ${port}`)
})
