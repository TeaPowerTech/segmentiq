'use client'

import React, { useEffect, useState, Suspense, useRef, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'

interface ActivityPoint {
  distancePct: number
  distanceMetres: number
  elevationMetres: number
  elevationGainMetres: number
  heartRate: number | null
  speedKph: number
  powerWatts: number | null
  cadence: number | null
}

interface NormalisedActivity {
  activityId: string
  name: string
  startDate: string
  movingTimeSeconds: number
  elapsedTimeSeconds: number
  distanceMetres: number
  totalElevationGain: number
  averageHeartRate: number | null
  maxHeartRate: number | null
  averageSpeedKph: number | null
  maxSpeedKph: number | null
  averagePowerWatts: number | null
  normalisedPowerWatts: number | null
  averageCadence: number | null
  hasPower: boolean
  type: string
  points: ActivityPoint[]
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function formatPace(speedKph: number): string {
  if (speedKph <= 0) return '—'
  const paceMinPerKm = 60 / speedKph
  const mins = Math.floor(paceMinPerKm)
  const secs = Math.round((paceMinPerKm - mins) * 60)
  return `${mins}:${secs.toString().padStart(2, '0')}/km`
}

function formatDistance(metres: number): string {
  return metres >= 1000
    ? `${(metres / 1000).toFixed(1)}km`
    : `${Math.round(metres)}m`
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function countUpNum(target: number, t: number): number {
  return Math.floor(target * Math.min(easeInOut(t), 1))
}

function gradeColour(grade: number): string {
  const abs = Math.abs(grade)
  if (abs < 3) return '#22C55E'
  if (abs < 6) return '#EAB308'
  if (abs < 10) return '#FC4C02'
  return '#EF4444'
}

function getPointAt(points: ActivityPoint[], t: number): ActivityPoint {
  const clamped = Math.max(0, Math.min(t, 1))
  const idx = Math.min(Math.floor(clamped * (points.length - 1)), points.length - 2)
  const frac = clamped * (points.length - 1) - idx
  const a = points[idx]
  const b = points[idx + 1]
  return {
    distancePct: a.distancePct + (b.distancePct - a.distancePct) * frac,
    distanceMetres: a.distanceMetres + (b.distanceMetres - a.distanceMetres) * frac,
    elevationMetres: a.elevationMetres + (b.elevationMetres - a.elevationMetres) * frac,
    elevationGainMetres: a.elevationGainMetres + (b.elevationGainMetres - a.elevationGainMetres) * frac,
    heartRate: a.heartRate != null && b.heartRate != null
      ? a.heartRate + (b.heartRate - a.heartRate) * frac : (a.heartRate ?? b.heartRate),
    speedKph: a.speedKph + (b.speedKph - a.speedKph) * frac,
    powerWatts: a.powerWatts != null && b.powerWatts != null
      ? a.powerWatts + (b.powerWatts - a.powerWatts) * frac : (a.powerWatts ?? b.powerWatts),
    cadence: a.cadence != null && b.cadence != null
      ? a.cadence + (b.cadence - a.cadence) * frac : (a.cadence ?? b.cadence),
  }
}

function drawActivityCard(
  ctx: CanvasRenderingContext2D,
  t: number,
  activity: NormalisedActivity,
  minElev: number,
  elevRange: number,
  s: number,
  W: number,
  safeTop: number,
) {
  const ORANGE = '#FC4C02'
  const WHITE = '#ffffff'
  const MUTED = '#888888'
  const DIM = '#444444'
  const DIMMER = '#555555'
  const GREEN = '#22C55E'
  const RED = '#EF4444'
  const GOLD = '#EAB308'
  const BORDER = '#1e1e1e'
  const SURFACE = '#111111'

  function r(x: number) { return Math.round(x * s) }
  function ry(y: number) { return Math.round(safeTop + y * s) }

  const PAD = 16

  // Layout
  const HEADER_H = 68
  const STATS_Y = 68
  const STATS_H = 110
  const ELEV_Y = 178
  const ELEV_H = 140
  const LEGEND_Y = 330
  const LIVE_Y = 350
  const LIVE_H = 110
  const MAX_Y = 470
  const MAX_H = 88
  const FOOTER_Y = 686

  // Phases
  // 0–15%:  countdown (4.5s export)
  // 15–35%: stats reveal — time first, then secondaries stagger in (6s export)
  // 35–100%: race (19.5s export)
  const PHASE_COUNTDOWN_END = 0.15
  const PHASE_STATS_END = 0.35

  const countdownT = Math.min(t / PHASE_COUNTDOWN_END, 1)
  const headerAlpha = Math.min(t / PHASE_COUNTDOWN_END, 1)
  const statsT = t < PHASE_COUNTDOWN_END ? 0
    : Math.min((t - PHASE_COUNTDOWN_END) / (PHASE_STATS_END - PHASE_COUNTDOWN_END), 1)
  const raceT = t < PHASE_STATS_END ? 0
    : Math.min((t - PHASE_STATS_END) / (1 - PHASE_STATS_END), 1)
  const footAlpha = raceT > 0.8 ? easeInOut((raceT - 0.8) / 0.2) : 0

  // Orange accent
  ctx.fillStyle = ORANGE
  ctx.fillRect(0, safeTop, r(4), r(700))

  // Elevation profile — coloured line by gradient, no blocks
  const elevPad = PAD
  const elevW = 390 - elevPad * 2

  const elevPts = activity.points.map((p) => ({
    x: r(elevPad + p.distancePct * elevW),
    y: ry(ELEV_Y + ELEV_H - ((p.elevationMetres - minElev) / elevRange) * ELEV_H),
    grade: 0, // filled below
  }))

  // Calculate grade per point
  for (let i = 0; i < activity.points.length; i++) {
    const prev = activity.points[Math.max(0, i - 2)]
    const next = activity.points[Math.min(activity.points.length - 1, i + 2)]
    const distDiff = (next.distancePct - prev.distancePct) * activity.distanceMetres
    const elevDiff = next.elevationMetres - prev.elevationMetres
    elevPts[i].grade = distDiff > 0 ? (elevDiff / distDiff) * 100 : 0
  }

  // Fill under the line (neutral dark orange)
  const elevGrad = ctx.createLinearGradient(0, ry(ELEV_Y), 0, ry(ELEV_Y + ELEV_H))
  elevGrad.addColorStop(0, 'rgba(252,76,2,0.15)')
  elevGrad.addColorStop(1, 'rgba(252,76,2,0.02)')
  ctx.beginPath()
  ctx.moveTo(elevPts[0].x, ry(ELEV_Y + ELEV_H))
  elevPts.forEach(p => ctx.lineTo(p.x, p.y))
  ctx.lineTo(elevPts[elevPts.length - 1].x, ry(ELEV_Y + ELEV_H))
  ctx.closePath()
  ctx.fillStyle = elevGrad; ctx.fill()

  // Draw elevation line as coloured segments
  ctx.lineWidth = r(2.5); ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  for (let i = 1; i < elevPts.length; i++) {
    const grade = (elevPts[i - 1].grade + elevPts[i].grade) / 2
    ctx.beginPath()
    ctx.moveTo(elevPts[i - 1].x, elevPts[i - 1].y)
    ctx.lineTo(elevPts[i].x, elevPts[i].y)
    ctx.strokeStyle = gradeColour(grade)
    ctx.stroke()
  }

  // Gradient legend — compact, sits just below profile
  const legendItems = [
    { label: '<3%', colour: GREEN },
    { label: '3–6%', colour: GOLD },
    { label: '6–10%', colour: ORANGE },
    { label: '>10%', colour: RED },
  ]
  let lx = PAD
  legendItems.forEach(item => {
    ctx.fillStyle = item.colour
    ctx.fillRect(r(lx), ry(LEGEND_Y), r(8), r(6))
    ctx.fillStyle = MUTED
    ctx.font = `${r(9)}px -apple-system, sans-serif`
    ctx.textAlign = 'left'
    ctx.fillText(item.label, r(lx + 11), ry(LEGEND_Y + 7))
    lx += 50
  })

  // Header
  ctx.globalAlpha = headerAlpha
  ctx.fillStyle = SURFACE
  ctx.fillRect(0, safeTop, W, r(HEADER_H))
  ctx.strokeStyle = BORDER; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, ry(HEADER_H)); ctx.lineTo(W, ry(HEADER_H)); ctx.stroke()

  ctx.fillStyle = MUTED
  ctx.font = `500 ${r(10)}px -apple-system, sans-serif`
  ctx.textAlign = 'left'
  ctx.fillText(activity.type.toUpperCase(), r(PAD + 4), ry(18))
  ctx.fillStyle = WHITE
  ctx.font = `700 ${r(16)}px -apple-system, sans-serif`
  ctx.fillText(activity.name, r(PAD + 4), ry(36))
  ctx.fillStyle = MUTED
  ctx.font = `400 ${r(11)}px -apple-system, sans-serif`
  ctx.fillText(formatDate(activity.startDate), r(PAD + 4), ry(54))
  ctx.fillStyle = DIMMER
  ctx.font = `700 ${r(11)}px -apple-system, sans-serif`
  ctx.textAlign = 'right'
  ctx.fillText('SEGMENTIQ', r(390 - PAD), ry(36))
  ctx.globalAlpha = 1

  // Countdown over elevation
  if (countdownT < 1) {
    const cd = countdownT * 4
    let label = ''
    let phase = 0
    if (cd < 1) { label = '3'; phase = cd }
    else if (cd < 2) { label = '2'; phase = cd - 1 }
    else if (cd < 3) { label = '1'; phase = cd - 2 }
    else { label = 'GO!'; phase = cd - 3 }

    const alpha = label === 'GO!'
      ? Math.min(phase * 4, 1) * (1 - Math.max((phase - 0.5) * 2, 0))
      : phase < 0.6 ? Math.min(phase * 5, 1) : 1 - ((phase - 0.6) / 0.4)
    const scale = 1 + (1 - phase) * 0.2

    ctx.globalAlpha = alpha
    ctx.save()
    ctx.translate(r(195), ry(ELEV_Y + ELEV_H / 2))
    ctx.scale(scale, scale)
    ctx.fillStyle = label === 'GO!' ? GREEN : WHITE
    ctx.font = `900 ${r(label === 'GO!' ? 64 : 88)}px -apple-system, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, 0, 0)
    ctx.textBaseline = 'alphabetic'
    ctx.restore()
    ctx.globalAlpha = 1
  }

  // Stats — staggered reveal
  // statsT 0–0.35: moving time counts up alone
  // statsT 0.35–0.55: distance fades in
  // statsT 0.55–0.75: elevation fades in
  // statsT 0.75–1.0:  avg speed fades in
  if (statsT > 0) {
    const timeT = Math.min(statsT / 0.35, 1)
    const distAlpha = statsT > 0.35 ? easeOut((statsT - 0.35) / 0.2) : 0
    const elevAlpha = statsT > 0.55 ? easeOut((statsT - 0.55) / 0.2) : 0
    const speedAlpha = statsT > 0.75 ? easeOut((statsT - 0.75) / 0.25) : 0

    // Moving time — large, counts up
    ctx.globalAlpha = Math.min(timeT * 3, 1)
    const countedTime = countUpNum(activity.movingTimeSeconds, timeT)
    ctx.fillStyle = ORANGE
    ctx.font = `700 ${r(44)}px -apple-system, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(formatTime(countedTime), r(195), ry(STATS_Y + 48))
    ctx.fillStyle = MUTED
    ctx.font = `400 ${r(10)}px -apple-system, sans-serif`
    ctx.fillText('MOVING TIME', r(195), ry(STATS_Y + 62))

    // Three secondary stats — staggered
    const subY = STATS_Y + 74
    const thirdW = 390 / 3

    // Dividers — appear with first secondary
    if (distAlpha > 0) {
      ctx.globalAlpha = distAlpha
      ctx.strokeStyle = BORDER; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(r(thirdW), ry(subY)); ctx.lineTo(r(thirdW), ry(subY + 40)); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(r(thirdW * 2), ry(subY)); ctx.lineTo(r(thirdW * 2), ry(subY + 40)); ctx.stroke()
    }

    // Distance
    ctx.globalAlpha = distAlpha
    const countedDist = countUpNum(activity.distanceMetres, distAlpha)
    ctx.fillStyle = WHITE
    ctx.font = `700 ${r(20)}px -apple-system, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(formatDistance(countedDist), r(thirdW * 0.5), ry(subY + 22))
    ctx.fillStyle = MUTED
    ctx.font = `400 ${r(9)}px -apple-system, sans-serif`
    ctx.fillText('DISTANCE', r(thirdW * 0.5), ry(subY + 36))

    // Elevation
    ctx.globalAlpha = elevAlpha
    const countedElev = countUpNum(activity.totalElevationGain, elevAlpha)
    ctx.fillStyle = WHITE
    ctx.font = `700 ${r(20)}px -apple-system, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(`${Math.round(countedElev)}m`, r(thirdW * 1.5), ry(subY + 22))
    ctx.fillStyle = MUTED
    ctx.font = `400 ${r(9)}px -apple-system, sans-serif`
    ctx.fillText('ELEVATION', r(thirdW * 1.5), ry(subY + 36))

    // Avg speed
    ctx.globalAlpha = speedAlpha
    ctx.fillStyle = WHITE
    ctx.font = `700 ${r(20)}px -apple-system, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(`${(activity.averageSpeedKph ?? 0).toFixed(1)}`, r(thirdW * 2.5), ry(subY + 22))
    ctx.fillStyle = MUTED
    ctx.font = `400 ${r(9)}px -apple-system, sans-serif`
    ctx.fillText('AVG SPEED', r(thirdW * 2.5), ry(subY + 36))

    ctx.globalAlpha = 1
  }

  // Racing dot + trail
  if (raceT > 0) {
    const trailEnd = Math.floor(raceT * (activity.points.length - 1))
    if (trailEnd > 0) {
      ctx.beginPath()
      for (let i = 0; i <= trailEnd; i++) {
        const p = activity.points[i]
        const x = r(elevPad + p.distancePct * elevW)
        const y = ry(ELEV_Y + ELEV_H - ((p.elevationMetres - minElev) / elevRange) * ELEV_H)
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'
      ctx.lineWidth = r(2); ctx.lineJoin = 'round'; ctx.stroke()
    }

    const pt = getPointAt(activity.points, raceT)
    const dotX = r(elevPad + pt.distancePct * elevW)
    const dotY = ry(ELEV_Y + ELEV_H - ((pt.elevationMetres - minElev) / elevRange) * ELEV_H)

    const glow = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, r(14))
    glow.addColorStop(0, 'rgba(255,255,255,0.5)')
    glow.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = glow
    ctx.beginPath(); ctx.arc(dotX, dotY, r(14), 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = WHITE
    ctx.beginPath(); ctx.arc(dotX, dotY, r(6), 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = ORANGE; ctx.lineWidth = r(2); ctx.stroke()
  }

  // Live counters
  if (raceT > 0) {
    ctx.globalAlpha = Math.min(raceT * 4, 1)

    const pt = getPointAt(activity.points, raceT)

    ctx.strokeStyle = BORDER; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, ry(LIVE_Y - 2)); ctx.lineTo(W, ry(LIVE_Y - 2)); ctx.stroke()

    const liveStats: { label: string; value: string; sub: string }[] = [
      { label: 'SPEED', value: pt.speedKph.toFixed(1), sub: formatPace(pt.speedKph) },
    ]
    if (pt.heartRate != null) {
      liveStats.push({ label: 'HEART RATE', value: `${Math.round(pt.heartRate)}`, sub: 'bpm' })
    }
    if (pt.powerWatts != null) {
      liveStats.push({ label: 'POWER', value: `${Math.round(pt.powerWatts)}`, sub: `W${!activity.hasPower ? ' est.' : ''}` })
    }

    const colW = 390 / liveStats.length
    liveStats.forEach((stat, i) => {
      const cx = i * colW
      if (i > 0) {
        ctx.strokeStyle = BORDER; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(r(cx), ry(LIVE_Y)); ctx.lineTo(r(cx), ry(LIVE_Y + 68)); ctx.stroke()
      }
      ctx.fillStyle = ORANGE
      ctx.font = `600 ${r(9)}px -apple-system, sans-serif`
      ctx.textAlign = 'left'
      ctx.fillText(stat.label, r(cx + PAD), ry(LIVE_Y + 14))
      ctx.fillStyle = WHITE
      ctx.font = `700 ${r(28)}px -apple-system, sans-serif`
      ctx.fillText(stat.value, r(cx + PAD), ry(LIVE_Y + 44))
      ctx.fillStyle = DIM
      ctx.font = `400 ${r(10)}px -apple-system, sans-serif`
      ctx.fillText(stat.sub, r(cx + PAD), ry(LIVE_Y + 58))
    })

    // Distance / elevation gain / remaining
    const counterY = LIVE_Y + 72
    ctx.strokeStyle = BORDER; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, ry(counterY)); ctx.lineTo(W, ry(counterY)); ctx.stroke()

    const distSoFar = pt.distanceMetres
    const elevSoFar = pt.elevationGainMetres
    const remaining = Math.max(0, activity.distanceMetres - distSoFar)

    const counterItems = [
      { label: 'DISTANCE', value: formatDistance(distSoFar), align: 'left' as const, x: PAD + 4 },
      { label: 'ELEV GAIN', value: `${Math.round(elevSoFar)}m`, align: 'center' as const, x: 195 },
      { label: 'REMAINING', value: formatDistance(remaining), align: 'right' as const, x: 390 - PAD - 4 },
    ]
    counterItems.forEach(item => {
      ctx.fillStyle = MUTED
      ctx.font = `400 ${r(9)}px -apple-system, sans-serif`
      ctx.textAlign = item.align
      ctx.fillText(item.label, r(item.x), ry(counterY + 14))
      ctx.fillStyle = WHITE
      ctx.font = `700 ${r(18)}px -apple-system, sans-serif`
      ctx.fillText(item.value, r(item.x), ry(counterY + 32))
    })

    // Max stats — fade in after 25% of race
    if (raceT > 0.25) {
      ctx.globalAlpha = easeOut(Math.min((raceT - 0.25) / 0.2, 1))
      ctx.strokeStyle = BORDER; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(0, ry(MAX_Y)); ctx.lineTo(W, ry(MAX_Y)); ctx.stroke()

      const maxItems: { label: string; value: string }[] = []
      if (activity.maxSpeedKph != null) {
        maxItems.push({ label: 'MAX SPEED', value: `${activity.maxSpeedKph.toFixed(1)} km/h` })
      }
      if (activity.maxHeartRate != null) {
        maxItems.push({ label: 'MAX HR', value: `${activity.maxHeartRate} bpm` })
      }
      if (activity.normalisedPowerWatts != null) {
        maxItems.push({ label: 'NP', value: `${activity.normalisedPowerWatts}W` })
      }

      if (maxItems.length > 0) {
        const mColW = 390 / maxItems.length
        maxItems.forEach((item, i) => {
          const cx = i * mColW
          if (i > 0) {
            ctx.strokeStyle = BORDER; ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(r(cx), ry(MAX_Y + 8))
            ctx.lineTo(r(cx), ry(MAX_Y + MAX_H - 8))
            ctx.stroke()
          }
          ctx.fillStyle = MUTED
          ctx.font = `400 ${r(9)}px -apple-system, sans-serif`
          ctx.textAlign = 'left'
          ctx.fillText(item.label, r(cx + PAD), ry(MAX_Y + 22))
          ctx.fillStyle = WHITE
          ctx.font = `700 ${r(22)}px -apple-system, sans-serif`
          ctx.fillText(item.value, r(cx + PAD), ry(MAX_Y + 48))
        })
      }
    }

    ctx.globalAlpha = 1
  }

  // Footer
  if (footAlpha > 0) {
    ctx.globalAlpha = footAlpha
    ctx.strokeStyle = BORDER; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, ry(FOOTER_Y)); ctx.lineTo(W, ry(FOOTER_Y)); ctx.stroke()
    ctx.fillStyle = '#888888'
    ctx.font = `700 ${r(11)}px -apple-system, sans-serif`
    ctx.textAlign = 'left'
    ctx.fillText('SEGMENTIQ', r(PAD), ry(FOOTER_Y + 12))
    ctx.fillStyle = '#666666'
    ctx.font = `400 ${r(10)}px -apple-system, sans-serif`
    ctx.textAlign = 'right'
    ctx.fillText('segmentiq.vercel.app', r(390 - PAD), ry(FOOTER_Y + 12))
    ctx.globalAlpha = 1
  }
}

function ActivityReplay({ activity }: { activity: NormalisedActivity }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)
  const progressRef = useRef<number>(0)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const activityRef = useRef(activity)
  useEffect(() => { activityRef.current = activity }, [activity])

  const allElev = activity.points.map(p => p.elevationMetres)
  const minElevRef = useRef(Math.min(...allElev))
  const elevRangeRef = useRef(Math.max(...allElev) - Math.min(...allElev) || 1)

  const PREVIEW_DURATION = 15000
  const EXPORT_DURATION = 30000

  const drawFrame = useCallback((t: number, exportMode = false) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const act = activityRef.current
    const minElev = minElevRef.current
    const elevRange = elevRangeRef.current

    if (exportMode) {
      canvas.width = 1080; canvas.height = 1920
    } else {
      canvas.width = 390; canvas.height = 700
    }

    const W = canvas.width
    const H = canvas.height
    const sc = exportMode ? 1080 / 390 : 1
    const safeTop = exportMode ? 250 : 0

    ctx.fillStyle = '#0a0a0a'
    ctx.fillRect(0, 0, W, H)

    if (exportMode) {
      const topGrad = ctx.createLinearGradient(0, 0, 0, 250)
      topGrad.addColorStop(0, 'rgba(0,0,0,0)')
      topGrad.addColorStop(1, '#0a0a0a')
      ctx.fillStyle = topGrad; ctx.fillRect(0, 0, W, 250)

      const botGrad = ctx.createLinearGradient(0, H - 250, 0, H)
      botGrad.addColorStop(0, '#0a0a0a')
      botGrad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = botGrad; ctx.fillRect(0, H - 250, W, 250)
    }

    drawActivityCard(ctx, t, act, minElev, elevRange, sc, W, safeTop)
  }, [])

  const animate = useCallback((duration: number, startProgress: number, exportMode = false, onComplete?: () => void) => {
    const startTime = performance.now()

    function frame(now: number) {
      const t = Math.min(startProgress + (now - startTime) / duration, 1)
      progressRef.current = t
      if (!exportMode) setProgress(t)
      drawFrame(t, exportMode)
      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(frame)
      } else {
        if (!exportMode) setPlaying(false)
        progressRef.current = 0
        onComplete?.()
      }
    }
    animFrameRef.current = requestAnimationFrame(frame)
  }, [drawFrame])

  function play() {
    cancelAnimationFrame(animFrameRef.current)
    const currentT = progressRef.current >= 1 ? 0 : progressRef.current
    progressRef.current = currentT
    setPlaying(true)
    animate(PREVIEW_DURATION * (1 - currentT), currentT, false)
  }

  function pause() {
    cancelAnimationFrame(animFrameRef.current)
    setPlaying(false)
  }

  function seek(t: number) {
    cancelAnimationFrame(animFrameRef.current)
    setPlaying(false)
    progressRef.current = t
    setProgress(t)
    drawFrame(t, false)
  }

  function restart() {
    cancelAnimationFrame(animFrameRef.current)
    progressRef.current = 0
    setProgress(0)
    drawFrame(0, false)
    setPlaying(false)
  }

  useEffect(() => { drawFrame(0, false) }, [drawFrame])
  useEffect(() => { return () => cancelAnimationFrame(animFrameRef.current) }, [])

  async function exportVideo() {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
      setExportError('Video export requires Chrome or Firefox.')
      return
    }
    setExporting(true)
    setExportError(null)
    cancelAnimationFrame(animFrameRef.current)
    progressRef.current = 0
    drawFrame(0, true)

    const stream = canvas.captureStream(30)
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp8',
      videoBitsPerSecond: 12000000,
    })
    const chunks: Blob[] = []
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `segmentiq-${activity.name.replace(/\s+/g, '-').toLowerCase()}.webm`
      a.click()
      URL.revokeObjectURL(url)
      setExporting(false)
      drawFrame(progressRef.current, false)
    }
    recorder.start()
    animate(EXPORT_DURATION, 0, true, () => { recorder.stop() })
  }

  const progressPct = Math.round(progress * 100)

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-text-muted">Activity replay</div>
        <div className="text-xs text-text-muted">1080×1920 Instagram Story</div>
      </div>
      <canvas
        ref={canvasRef} width={390} height={700}
        style={{ borderRadius: '8px', maxWidth: '100%', display: 'block', margin: '0 auto' }}
      />
      <div className="mt-3 flex items-center gap-3">
        <button onClick={playing ? pause : play}
          className="w-8 h-8 rounded-full bg-strava flex items-center justify-center text-white text-xs flex-shrink-0">
          {playing ? '⏸' : '▶'}
        </button>
        <input type="range" min={0} max={100} value={progressPct}
          onChange={e => seek(parseInt(e.target.value) / 100)}
          className="flex-1 accent-strava" />
        <span className="text-text-muted text-xs w-8 text-right">{Math.round(progress * 15)}s</span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={exporting ? undefined : exportVideo} disabled={exporting}
          className={`flex-1 text-sm font-medium py-2.5 rounded-xl transition-colors ${
            exporting
              ? 'bg-surface border border-border text-text-muted cursor-not-allowed'
              : 'bg-strava hover:bg-strava-dark text-white'
          }`}>
          {exporting ? 'Recording story…' : '⬇ Export Instagram Story (1080×1920)'}
        </button>
        <button onClick={restart}
          className="w-10 h-10 rounded-xl border border-border text-text-muted hover:text-white transition-colors text-sm">
          ↺
        </button>
      </div>
      {exportError && <div className="mt-2 text-xs text-red-400">{exportError}</div>}
      <div className="mt-2 text-xs text-text-muted">
        Preview at 390×700 · Export records full 30s at 1080×1920 for Instagram Stories
      </div>
    </div>
  )
}

function ActivityContent() {
  const router = useRouter()
  const params = useParams()
  const activityId = params.id as string
  const [activity, setActivity] = useState<NormalisedActivity | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const session = localStorage.getItem('session')
      if (!session) { router.push('/'); return }
      try {
        const res = await fetch(`/api/activities/${activityId}`, {
          headers: { 'x-session': session },
        })
        if (res.status === 401) {
          localStorage.removeItem('session'); router.push('/'); return
        }
        if (!res.ok) throw new Error('Failed to fetch activity')
        const json = await res.json()
        setActivity(json.data)
      } catch {
        setError('Failed to load activity')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [activityId])

  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-text-muted text-sm">Loading activity...</div>
    </div>
  )

  if (error || !activity) return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 gap-4">
      <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-red-400 text-sm">
        {error ?? 'Something went wrong'}
      </div>
      <button onClick={() => router.back()}
        className="text-text-secondary text-sm hover:text-white transition-colors">
        ← Go back
      </button>
    </div>
  )

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border px-4 py-4 flex items-center gap-3">
        <button onClick={() => router.back()}
          className="text-text-secondary hover:text-white transition-colors text-lg">←</button>
        <div>
          <h1 className="font-semibold text-sm">{activity.name}</h1>
          <p className="text-text-muted text-xs">{formatDate(activity.startDate)}</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-surface border border-border rounded-2xl p-4">
            <div className="text-text-muted text-xs mb-1">Moving time</div>
            <div className="text-white font-semibold text-lg">{formatTime(activity.movingTimeSeconds)}</div>
            <div className="text-text-muted text-xs mt-1">{formatDistance(activity.distanceMetres)}</div>
          </div>
          <div className="bg-surface border border-border rounded-2xl p-4">
            <div className="text-text-muted text-xs mb-1">Elevation gain</div>
            <div className="text-white font-semibold text-lg">{Math.round(activity.totalElevationGain)}m</div>
            <div className="text-text-muted text-xs mt-1">
              {activity.averageSpeedKph != null ? `${activity.averageSpeedKph.toFixed(1)} km/h avg` : ''}
            </div>
          </div>
        </div>

        {(activity.averageHeartRate != null ||
          activity.averagePowerWatts != null ||
          activity.averageCadence != null) && (
          <div className="bg-surface border border-border rounded-2xl px-4 py-3 mb-6">
            <div className="grid grid-cols-3 gap-4">
              {activity.averageHeartRate != null && (
                <div className="text-center">
                  <div className="text-text-muted text-xs mb-1">Avg HR</div>
                  <div className="text-white text-sm font-medium">
                    {Math.round(activity.averageHeartRate)} bpm
                  </div>
                  {activity.maxHeartRate != null && (
                    <div className="text-text-muted text-xs">max {activity.maxHeartRate}</div>
                  )}
                </div>
              )}
              {activity.averagePowerWatts != null && (
                <div className="text-center">
                  <div className="text-text-muted text-xs mb-1">Avg power</div>
                  <div className="text-white text-sm font-medium">
                    {Math.round(activity.averagePowerWatts)}W{!activity.hasPower ? ' est.' : ''}
                  </div>
                  {activity.normalisedPowerWatts != null && (
                    <div className="text-text-muted text-xs">NP {activity.normalisedPowerWatts}W</div>
                  )}
                </div>
              )}
              {activity.averageCadence != null && (
                <div className="text-center">
                  <div className="text-text-muted text-xs mb-1">Avg cadence</div>
                  <div className="text-white text-sm font-medium">
                    {Math.round(activity.averageCadence)} rpm
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <ActivityReplay activity={activity} />
      </div>
    </div>
  )
}

export default function ActivityPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-text-muted text-sm">Loading activity...</div>
      </div>
    }>
      <ActivityContent />
    </Suspense>
  )
}
