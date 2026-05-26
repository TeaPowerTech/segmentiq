import { Router, Request, Response } from 'express'
import { storeTokens, deleteTokens } from './strava'

const router = Router()

const CLIENT_ID = process.env.STRAVA_CLIENT_ID!
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET!
const REDIRECT_URI = process.env.STRAVA_REDIRECT_URI!
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'

router.get('/auth/strava', (_req: Request, res: Response) => {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
  })
  res.redirect(`https://www.strava.com/oauth/authorize?${params.toString()}`)
})

router.get('/auth/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query

  if (error || !code) {
    return res.redirect(`${FRONTEND_URL}?error=strava_denied`)
  }

  try {
    const response = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
      }),
    })

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.status}`)
    }

    const data = await response.json() as {
      access_token: string
      refresh_token: string
      expires_at: number
      scope: string
      athlete: {
        id: number
        firstname: string
        lastname: string
        weight: number
        profile: string
      }
    }

    await storeTokens({
      athleteId: data.athlete.id,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
      scope: data.scope,
    })

    // Pass session as a URL token — Vercel will set its own cookie
    const sessionToken = Buffer.from(JSON.stringify({
      athleteId: data.athlete.id,
      firstname: data.athlete.firstname,
      weightKg: data.athlete.weight ?? null,
    })).toString('base64')

    return res.redirect(
      `${FRONTEND_URL}/auth/complete?token=${sessionToken}&name=${encodeURIComponent(data.athlete.firstname)}`
    )

  } catch (err) {
    console.error('[auth callback error]', err)
    return res.redirect(`${FRONTEND_URL}?error=auth_failed`)
  }
})

router.post('/auth/logout', (req: Request, res: Response) => {
  const session = req.cookies?.session
  if (session) {
    try {
      const payload = JSON.parse(Buffer.from(session, 'base64').toString('utf8'))
      deleteTokens(payload.athleteId)
    } catch {}
  }
  res.clearCookie('session')
  res.json({ ok: true })
})

router.get('/auth/me', (req: Request, res: Response) => {
  const session = req.cookies?.session
  if (!session) {
    return res.status(401).json({ error: 'Not logged in' })
  }
  try {
    const payload = JSON.parse(Buffer.from(session, 'base64').toString('utf8'))
    return res.json({ athlete: payload })
  } catch {
    return res.status(401).json({ error: 'Invalid session' })
  }
})

export default router
