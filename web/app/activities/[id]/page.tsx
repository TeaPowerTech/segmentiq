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

function countUp(target: number, t: number): number {
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
  const idx = Math.min(Math.floor(t * (points.length - 1)), points.length - 2)
  const frac = t * (points.length - 1) - idx
  const a = points[idx]
  const b = points[idx + 1]
  return {
    distancePct: a.distancePct + (b.distancePct - a.distancePct) * frac,
    distanceMetres: a.distanceMetres + (b.distanceMetres - a.distanceMetres) * frac,
    elevationMetres: a.elevationMetres + (b.elevationMetres - a.elevationMetres) * frac,
    elevationGainMetres: a.elevationGainMetres + (b.elevationGainMetres - a.elevationGainMetres) * frac,
    heartRate: a.heartRate != null && b.heartRate != null
      ? a.heartRate + (b.heartRate - a.heartRate) * frac : null,
    speedKph: a.speedKph + (b.speedKph - a.speedKph) * frac,
    powerWatts: a.powerWatts != null && b.powerWatts != null
      ? a.powerWatts + (b.powerWatts - a.powerWatts) * frac : null,
    cadence: a.cadence != null && b.cadence != null
      ? a.cadence + (b.cadence - a.cadence) * frac : null,
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
  H: number,
  safeTop: number,
) {
  const ORANGE = '#FC4C02'
  const WHITE = '#ffffff'
  const MUTED = '#888888'
  const DIM = '#444444'
  const DIMMER = '#333333'
  const GREEN = '#22C55E'
  const RED = '#EF4444'
  const GOLD = '#EAB308'
  const BORDER = '#1e1e1e'
  const SURFACE = '#111111'

  function r(x: number) { return Math.round(x * s) }
  function ry(y: number) { return Math.round(safeTop + y * s) }

  function roundRect(x: number, y: number, w: number, h: number, radius: number) {
    const rw = r(w); if (rw <= 0) return
    const rx2 = r(x), ry2 = ry(y), rh = r(h), rr = r(radius)
    ctx.beginPath()
    ctx.moveTo(rx2 + rr, ry2)
    ctx.lineTo(rx2 + rw - rr, ry2)
    ctx.quadraticCurveTo(rx2 + rw, ry2, rx2 + rw, ry2 + rr)
    ctx.lineTo(rx2 + rw, ry2 + rh - rr)
    ctx.quadraticCurveTo(rx2 + rw, ry2 + rh, rx2 + rw - rr, ry2 + rh)
    ctx.lineTo(rx2 + rr, ry2 + rh)
    ctx.quadraticCurveTo(rx2, ry2 + rh, rx2, ry2 + rh - rr)
    ctx.lineTo(rx2, ry2 + rr)
    ctx.quadraticCurveTo(rx2, ry2, rx2 + rr, ry2)
    ctx.closePath()
  }

  const PAD = 16
  const CW = 390 - PAD * 2

  const PHASE_HEADER_END = 0.08
  const PHASE_STATS_END = 0.30
  const PHASE_SUMMARY_END = 0.40
  const PHASE_COUNTDOWN_END = 0.58
  const PHASE_RACE_END = 0.92

  const headerAlpha = Math.min(t / PHASE_HEADER_END, 1)
  const statsT = t < PHASE_HEADER_END ? 0 : Math.min((t - PHASE_HEADER_END) / (PHASE_STATS_END - PHASE_HEADER_END), 1)
  const summaryT = t < PHASE_STATS_END ? 0 : Math.min((t - PHASE_STATS_END) / (PHASE_SUMMARY_END - PHASE_STATS_END), 1)
  const countdownT = t < PHASE_SUMMARY_END ? 0 : Math.min((t - PHASE_SUMMARY_END) / (PHASE_COUNTDOWN_END - PHASE_SUMMARY_END), 1)
  const raceT = t < PHASE_COUNTDOWN_END ? 0 : Math.min((t - PHASE_COUNTDOWN_END) / (PHASE_RACE_END - PHASE_COUNTDOWN_END), 1)
  const holdT = t < PHASE_RACE_END ? 0 : Math.min((t - PHASE_RACE_END) / (1 - PHASE_RACE_END), 1)

  // Orange left accent
  ctx.fillStyle = ORANGE
  ctx.fillRect(0, safeTop, r(4), r(700))

  // Elevation — always visible
  const elevY = 230
  const elevH = 120
  const elevPad = PAD
  const elevW = 390 - elevPad * 2

  const elevPts = activity.points.map((p, i) => ({
    x: r(elevPad + (i / (activity.points.length - 1)) * elevW),
    y: ry(elevY + elevH - ((p.elevationMetres - minElev) / elevRange) * elevH),
  }))

  const elevGrad = ctx.createLinearGradient(0, ry(elevY), 0, ry(elevY + elevH))
  elevGrad.addColorStop(0, 'rgba(252,76,2,0.25)')
  elevGrad.addColorStop(1, 'rgba(252,76,2,0.02)')
  ctx.beginPath()
  ctx.moveTo(elevPts[0].x, ry(elevY + elevH))
  elevPts.forEach(p => ctx.lineTo(p.x, p.y))
  ctx.lineTo(elevPts[elevPts.length - 1].x, ry(elevY + elevH))
  ctx.closePath()
  ctx.fillStyle = elevGrad; ctx.fill()

  ctx.beginPath()
  elevPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
  ctx.strokeStyle = ORANGE; ctx.lineWidth = r(1.5); ctx.lineJoin = 'round'; ctx.stroke()

  // Grade profile
  const gradeY = elevY + elevH + 10
  const gradeH = 18
  ctx.fillStyle = DIM
  ctx.font = `${r(9)}px -apple-system, sans-serif`
  ctx.textAlign = 'left'
  ctx.fillText('GRADIENT', r(PAD), ry(gradeY - 4))

  const segCount = 40
  for (let i = 0; i < segCount; i++) {
    const idx0 = Math.floor((i / segCount) * (activity.points.length - 1))
    const idx1 = Math.floor(((i + 1) / segCount) * (activity.points.length - 1))
    const p0 = activity.points[idx0]; const p1 = activity.points[idx1]
    const distDiff = (p1.distancePct - p0.distancePct) * activity.distanceMetres
    const elevDiff = p1.elevationMetres - p0.elevationMetres
    const grade = distDiff > 0 ? (elevDiff / distDiff) * 100 : 0
    const segX = PAD + (i / segCount) * (390 - PAD * 2)
    ctx.fillStyle = gradeColour(grade)
    roundRect(segX, gradeY, (390 - PAD * 2) / segCount + 0.5, gradeH, 2)
    ctx.fill()
  }

  const legendItems = [
    { label: '<3%', colour: GREEN },
    { label: '3-6%', colour: GOLD },
    { label: '6-10%', colour: ORANGE },
    { label: '>10%', colour: RED },
  ]
  let lx = PAD
  const ly = gradeY + gradeH + 10
  legendItems.forEach(item => {
    ctx.fillStyle = item.colour
    ctx.fillRect(r(lx), ry(ly), r(8), r(6))
    ctx.fillStyle = item.colour
    ctx.font = `${r(9)}px -apple-system, sans-serif`
    ctx.textAlign = 'left'
    ctx.fillText(item.label, r(lx + 10), ry(ly + 7))
    lx += 52
  })

  // Header
  ctx.globalAlpha = headerAlpha
  ctx.fillStyle = SURFACE
  ctx.fillRect(0, safeTop, W, r(68))
  ctx.strokeStyle = BORDER; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, ry(68)); ctx.lineTo(W, ry(68)); ctx.stroke()

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
  ctx.font = `600 ${r(11)}px -apple-system, sans-serif`
  ctx.textAlign = 'right'
  ctx.fillText('SEGMENTIQ', r(390 - PAD), ry(36))
  ctx.globalAlpha = 1

  // Stats count up
  const statsY = 72
  const statsAlpha = Math.min(statsT * 3, 1)
  ctx.globalAlpha = statsAlpha

  const countedTime = countUp(activity.movingTimeSeconds, statsT)
  ctx.fillStyle = ORANGE
  ctx.font = `700 ${r(48)}px -apple-system, sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText(formatTime(countedTime), r(195), ry(statsY + 52))
  ctx.fillStyle = MUTED
  ctx.font = `400 ${r(10)}px -apple-system, sans-serif`
  ctx.fillText('MOVING TIME', r(195), ry(statsY + 66))

  const subY = statsY + 82
  const thirdW = 390 / 3
  const countedDist = countUp(activity.distanceMetres, statsT)
  const countedElev = countUp(activity.totalElevationGain, statsT)

  ctx.strokeStyle = BORDER; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(r(thirdW), ry(subY)); ctx.lineTo(r(thirdW), ry(subY + 44)); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(r(thirdW * 2), ry(subY)); ctx.lineTo(r(thirdW * 2), ry(subY + 44)); ctx.stroke()

  ctx.fillStyle = WHITE
  ctx.font = `700 ${r(20)}px -apple-system, sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText(formatDistance(countedDist), r(thirdW * 0.5), ry(subY + 22))
  ctx.fillText(`${Math.round(countedElev)}m`, r(thirdW * 1.5), ry(subY + 22))
  ctx.fillText(`${(activity.averageSpeedKph ?? 0).toFixed(1)}`, r(thirdW * 2.5), ry(subY + 22))

  ctx.fillStyle = MUTED
  ctx.font = `400 ${r(9)}px -apple-system, sans-serif`
  ctx.fillText('DISTANCE', r(thirdW * 0.5), ry(subY + 36))
  ctx.fillText('ELEVATION', r(thirdW * 1.5), ry(subY + 36))
  ctx.fillText('AVG KM/H', r(thirdW * 2.5), ry(subY + 36))
  ctx.globalAlpha = 1

  // Summary bars
  const summaryY = statsY + 132
  const summaryAlpha = easeInOut(summaryT)
  ctx.globalAlpha = summaryAlpha

  ctx.strokeStyle = BORDER; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, ry(summaryY)); ctx.lineTo(W, ry(summaryY)); ctx.stroke()

  let sY = summaryY + 8

  function drawSummaryBar(label: string, value: number | null, fmt: string, maxRef: number | null) {
    if (value == null) return
    ctx.fillStyle = ORANGE
    ctx.font = `500 ${r(13)}px -apple-system, sans-serif`
    ctx.textAlign = 'left'
    ctx.fillText(fmt, r(PAD + 4), ry(sY + 14))
    ctx.fillStyle = DIM
    ctx.font = `400 ${r(9)}px -apple-system, sans-serif`
    ctx.textAlign = 'right'
    ctx.fillText(label, r(390 - PAD), ry(sY + 14))
    const trackY = sY + 20
    ctx.fillStyle = BORDER
    roundRect(PAD, trackY, CW, 5, 3); ctx.fill()
    if (maxRef != null && maxRef > 0) {
      const w = (value / maxRef) * CW * easeInOut(summaryT)
      ctx.fillStyle = ORANGE
      roundRect(PAD, trackY, w, 5, 2); ctx.fill()
    }
    sY += 34
    ctx.strokeStyle = BORDER; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(r(PAD), ry(sY - 4)); ctx.lineTo(r(390 - PAD), ry(sY - 4)); ctx.stroke()
  }

  drawSummaryBar('AVG HR', activity.averageHeartRate,
    activity.averageHeartRate != null ? `${Math.round(activity.averageHeartRate)} bpm` : '—',
    activity.maxHeartRate)
  drawSummaryBar('AVG SPEED', activity.averageSpeedKph,
    activity.averageSpeedKph != null ? `${activity.averageSpeedKph.toFixed(1)} km/h` : '—',
    activity.maxSpeedKph)
  if (activity.averagePowerWatts != null) {
    drawSummaryBar('AVG POWER', activity.averagePowerWatts,
      `${Math.round(activity.averagePowerWatts)}W${!activity.hasPower ? ' est.' : ''}${activity.normalisedPowerWatts != null ? `  NP ${activity.normalisedPowerWatts}W` : ''}`,
      activity.averagePowerWatts * 1.5)
  }
  ctx.globalAlpha = 1

  // Countdown
  if (countdownT > 0 && countdownT < 1) {
    const cd = countdownT * 4
    let label = ''
    let pulse = 0
    if (cd < 1) { label = '3'; pulse = 1 - cd }
    else if (cd < 2) { label = '2'; pulse = 1 - (cd - 1) }
    else if (cd < 3) { label = '1'; pulse = 1 - (cd - 2) }
    else { label = 'GO!'; pulse = cd - 3 }
    const alpha = label === 'GO!'
      ? Math.min(pulse * 3, 1) * (1 - Math.max((pulse - 0.5) * 2, 0))
      : Math.min(pulse * 2, 1)
    const scale = 1 + (1 - pulse) * 0.3
    ctx.globalAlpha = alpha
    ctx.save()
    ctx.translate(r(195), ry(elevY + elevH / 2))
    ctx.scale(scale, scale)
    ctx.fillStyle = label === 'GO!' ? GREEN : WHITE
    ctx.font = `900 ${r(label === 'GO!' ? 52 : 72)}px -apple-system, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, 0, 0)
    ctx.textBaseline = 'alphabetic'
    ctx.restore()
    ctx.globalAlpha = 1
  }

  // Racing dot
  if (raceT > 0) {
    const trailEnd = Math.floor(raceT * (activity.points.length - 1))
    if (trailEnd > 0) {
      ctx.beginPath()
      for (let i = 0; i <= trailEnd; i++) {
        const p = activity.points[i]
        const x = r(elevPad + p.distancePct * elevW)
        const y = ry(elevY + elevH - ((p.elevationMetres - minElev) / elevRange) * elevH)
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.strokeStyle = 'rgba(252,76,2,0.8)'
      ctx.lineWidth = r(2.5); ctx.lineJoin = 'round'; ctx.stroke()
    }

    const pt = getPointAt(activity.points, raceT)
    const dotX = r(elevPad + pt.distancePct * elevW)
    const dotY = ry(elevY + elevH - ((pt.elevationMetres - minElev) / elevRange) * elevH)
    const glow = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, r(12))
    glow.addColorStop(0, 'rgba(252,76,2,0.6)'); glow.addColorStop(1, 'rgba(252,76,2,0)')
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(dotX, dotY, r(12), 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = ORANGE; ctx.beginPath(); ctx.arc(dotX, dotY, r(5), 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = WHITE; ctx.lineWidth = r(1.5); ctx.stroke()
  }

  // Live stats during race
  const liveY = gradeY + gradeH + 28
  const liveAlpha = raceT > 0 ? Math.min(raceT * 4, 1) : 0

  if (liveAlpha > 0) {
    ctx.globalAlpha = liveAlpha
    const pt = getPointAt(activity.points, raceT)
    const liveItems = [
      { label: 'LIVE SPEED', value: pt.speedKph.toFixed(1), sub: `km/h · ${formatPace(pt.speedKph)}` },
      ...(pt.heartRate != null ? [{ label: 'LIVE HR', value: `${Math.round(pt.heartRate)}`, sub: 'bpm' }] : []),
      ...(pt.powerWatts != null ? [{ label: 'LIVE POWER', value: `${Math.round(pt.powerWatts)}`, sub: `W${!activity.hasPower ? ' est.' : ''}` }] : []),
    ]
    const colW = 390 / liveItems.length
    liveItems.forEach((item, i) => {
      const cx = i * colW
      if (i > 0) {
        ctx.strokeStyle = BORDER; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(r(cx), ry(liveY)); ctx.lineTo(r(cx), ry(liveY + 58)); ctx.stroke()
      }
      ctx.fillStyle = ORANGE; ctx.font = `bold ${r(9)}px -apple-system, sans-serif`; ctx.textAlign = 'left'
      ctx.fillText(item.label, r(cx + PAD), ry(liveY + 12))
      ctx.fillStyle = WHITE; ctx.font = `bold ${r(24)}px -apple-system, sans-serif`
      ctx.fillText(item.value, r(cx + PAD), ry(liveY + 38))
      ctx.fillStyle = DIM; ctx.font = `400 ${r(10)}px -apple-system, sans-serif`
      ctx.fillText(item.sub, r(cx + PAD), ry(liveY + 52))
    })

    // Distance + elevation gain counters
    const counterY = liveY + 64
    ctx.strokeStyle = BORDER; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, ry(counterY)); ctx.lineTo(W, ry(counterY)); ctx.stroke()

    const distSoFar = pt.distanceMetres
    const elevSoFar = pt.elevationGainMetres

    ctx.fillStyle = MUTED; ctx.font = `400 ${r(9)}px -apple-system, sans-serif`; ctx.textAlign = 'left'
    ctx.fillText('DISTANCE', r(PAD + 4), ry(counterY + 12))
    ctx.fillStyle = WHITE; ctx.font = `bold ${r(16)}px -apple-system, sans-serif`
    ctx.fillText(formatDistance(distSoFar), r(PAD + 4), ry(counterY + 28))

    ctx.fillStyle = MUTED; ctx.font = `400 ${r(9)}px -apple-system, sans-serif`; ctx.textAlign = 'center'
    ctx.fillText('ELEVATION GAIN', r(195), ry(counterY + 12))
    ctx.fillStyle = WHITE; ctx.font = `bold ${r(16)}px -apple-system, sans-serif`
    ctx.fillText(`${Math.round(elevSoFar)}m`, r(195), ry(counterY + 28))

    ctx.fillStyle = MUTED; ctx.font = `400 ${r(9)}px -apple-system, sans-serif`; ctx.textAlign = 'right'
    ctx.fillText('REMAINING', r(390 - PAD), ry(counterY + 12))
    ctx.fillStyle = WHITE; ctx.font = `bold ${r(16)}px -apple-system, sans-serif`
    ctx.fillText(formatDistance(activity.distanceMetres - distSoFar), r(390 - PAD), ry(counterY + 28))

    ctx.globalAlpha = 1
  }

  // Footer
  const footAlpha = holdT > 0 ? easeInOut(holdT) : (raceT > 0.85 ? (raceT - 0.85) / 0.15 : 0)
  const footY = 686
  ctx.globalAlpha = footAlpha
  ctx.strokeStyle = BORDER; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, ry(footY)); ctx.lineTo(W, ry(footY)); ctx.stroke()
  ctx.fillStyle = '#555555'; ctx.font = `700 ${r(11)}px -apple-system, sans-serif`; ctx.textAlign = 'left'
  ctx.fillText('SEGMENTIQ', r(PAD), ry(footY + 12))
  ctx.fillStyle = '#444444'; ctx.font = `400 ${r(10)}px -apple-system, sans-serif`; ctx.textAlign = 'right'
  ctx.fillText('segmentiq.vercel.app', r(390 - PAD), ry(footY + 12))
  ctx.globalAlpha = 1
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
  const PREVIEW_W = 390
  const PREVIEW_H = 700
  const EXPORT_W = 1080
  const EXPORT_H = 1920
  const EXPORT_SCALE = 1080 / 390
  const EXPORT_SAFE_TOP = 250

  const drawFrame = useCallback((t: number, exportMode = false) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const act = activityRef.current
    const minElev = minElevRef.current
    const elevRange = elevRangeRef.current

    if (exportMode) {
      canvas.width = EXPORT_W
      canvas.height = EXPORT_H
    } else {
      canvas.width = PREVIEW_W
      canvas.height = PREVIEW_H
    }

    const W = canvas.width
    const H = canvas.height
    const s = exportMode ? EXPORT_SCALE : 1
    const safeTop = exportMode ? EXPORT_SAFE_TOP : 0

    ctx.fillStyle = '#0a0a0a'
    ctx.fillRect(0, 0, W, H)

    if (exportMode) {
      const topGrad = ctx.createLinearGradient(0, 0, 0, 250)
      topGrad.addColorStop(0, 'rgba(0,0,0,0)')
      topGrad.addColorStop(1, '#0a0a0a')
      ctx.fillStyle = topGrad
      ctx.fillRect(0, 0, W, 250)

      const botGrad = ctx.createLinearGradient(0, H - 250, 0, H)
      botGrad.addColorStop(0, '#0a0a0a')
      botGrad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = botGrad
      ctx.fillRect(0, H - 250, W, 250)
    }

    drawActivityCard(ctx, t, act, minElev, elevRange, s, W, H, safeTop)
  }, [])

  const animate = useCallback((duration: number, startProgress: number, exportMode = false, onComplete?: () => void) => {
    const startTime = performance.now()
    const startT = startProgress

    function frame(now: number) {
      const elapsed = now - startTime
      const t = Math.min(startT + elapsed / duration, 1)
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
        ref={canvasRef}
        width={390}
        height={700}
        style={{ borderRadius: '8px', maxWidth: '100%', display: 'block', margin: '0 auto' }}
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={playing ? pause : play}
          className="w-8 h-8 rounded-full bg-strava flex items-center justify-center text-white text-xs flex-shrink-0"
        >
          {playing ? '⏸' : '▶'}
        </button>
        <input
          type="range" min={0} max={100} value={progressPct}
          onChange={e => seek(parseInt(e.target.value) / 100)}
          className="flex-1 accent-strava"
        />
        <span className="text-text-muted text-xs w-8 text-right">{Math.round(progress * 15)}s</span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={exporting ? undefined : exportVideo}
          disabled={exporting}
          className={`flex-1 text-sm font-medium py-2.5 rounded-xl transition-colors ${
            exporting
              ? 'bg-surface border border-border text-text-muted cursor-not-allowed'
              : 'bg-strava hover:bg-strava-dark text-white'
          }`}
        >
          {exporting ? 'Recording story…' : '⬇ Export Instagram Story (1080×1920)'}
        </button>
        <button
          onClick={restart}
          className="w-10 h-10 rounded-xl border border-border text-text-muted hover:text-white transition-colors text-sm"
        >
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
        if (res.status === 401) { localStorage.removeItem('session'); router.push('/'); return }
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

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-text-muted text-sm">Loading activity...</div>
      </div>
    )
  }

  if (error || !activity) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 gap-4">
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-red-400 text-sm">
          {error ?? 'Something went wrong'}
        </div>
        <button
          onClick={() => router.back()}
          className="text-text-secondary text-sm hover:text-white transition-colors"
        >
          ← Go back
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border px-4 py-4 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="text-text-secondary hover:text-white transition-colors text-lg"
        >←</button>
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

        {(activity.averageHeartRate != null || activity.averagePowerWatts != null || activity.averageCadence != null) && (
          <div className="bg-surface border border-border rounded-2xl px-4 py-3 mb-6">
            <div className="grid grid-cols-3 gap-4">
              {activity.averageHeartRate != null && (
                <div className="text-center">
                  <div className="text-text-muted text-xs mb-1">Avg HR</div>
                  <div className="text-white text-sm font-medium">{Math.round(activity.averageHeartRate)} bpm</div>
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
                  <div className="text-white text-sm font-medium">{Math.round(activity.averageCadence)} rpm</div>
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
