'use client'

import React, { useEffect, useState, Suspense, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Effort {
  id: string
  elapsed_time: number
  start_date: string
  average_heartrate?: number
  average_watts?: number
  pr_rank: number | null
  device_watts: boolean
  segment: any
}

interface EffortPoint {
  distancePct: number
  heartRate: number | null
  speedKph: number
  powerWatts: number | null
  elevationMetres: number
  elevationGainMetres: number
}

interface NormalisedEffort {
  effortId: string
  startDate: string
  elapsedSeconds: number
  averageHeartRate: number | null
  averagePowerWatts: number | null
  averageSpeedKph: number | null
  prRank: number | null
  hasPower: boolean
  points: EffortPoint[]
  segment: {
    name: string
    distanceMetres: number
    averageGradePct: number
  }
}

interface CompareData {
  effortA: NormalisedEffort
  effortB: NormalisedEffort
  deltas: {
    heartRate: (number | null)[]
    speedKph: number[]
    powerWatts: (number | null)[]
    totalTimeDeltaSeconds: number
  }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
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

function DeltaBadge({ delta, unit, invert = false }: {
  delta: number; unit: string; invert?: boolean
}) {
  const positive = invert ? delta < 0 : delta > 0
  const colour = positive ? 'text-green-400' : delta === 0 ? 'text-text-muted' : 'text-red-400'
  const sign = delta > 0 ? '+' : ''
  return <span className={`text-xs font-medium ${colour}`}>{sign}{delta.toFixed(1)}{unit}</span>
}

function MetricRow({ label, valueA, valueB, delta, unit, invert = false }: {
  label: string; valueA: string | null; valueB: string | null
  delta: number | null; unit: string; invert?: boolean
}) {
  if (valueA == null && valueB == null) return null
  return (
    <div className="grid grid-cols-3 items-center py-3 border-b border-border last:border-0">
      <div className="text-blue-400 text-sm font-medium">{valueA ?? '—'}</div>
      <div className="text-center">
        <div className="text-text-muted text-xs mb-1">{label}</div>
        {delta != null && <DeltaBadge delta={delta} unit={unit} invert={invert} />}
      </div>
      <div className="text-strava text-sm font-medium text-right">{valueB ?? '—'}</div>
    </div>
  )
}

function ScaledChart({ pointsA, pointsB, getValue }: {
  pointsA: EffortPoint[]; pointsB: EffortPoint[]
  getValue: (p: EffortPoint) => number | null
}) {
  const valsA = pointsA.map(getValue).filter((v): v is number => v != null)
  const valsB = pointsB.map(getValue).filter((v): v is number => v != null)
  const allVals = [...valsA, ...valsB]
  if (allVals.length === 0) return null
  const min = Math.min(...allVals)
  const max = Math.max(...allVals)
  const range = max - min || 1
  const pad = 4
  const toY = (v: number) => 60 - pad - ((v - min) / range) * (60 - pad * 2)
  const lineA = pointsA.filter((_, i) => i % 4 === 0)
    .map((p, i) => { const v = getValue(p); return v != null ? `${i * (200 / 50)},${toY(v)}` : null })
    .filter(Boolean).join(' ')
  const lineB = pointsB.filter((_, i) => i % 4 === 0)
    .map((p, i) => { const v = getValue(p); return v != null ? `${i * (200 / 50)},${toY(v)}` : null })
    .filter(Boolean).join(' ')
  return (
    <svg width="100%" height="100%" viewBox="0 0 200 60" preserveAspectRatio="none">
      {lineA && <polyline points={lineA} fill="none" stroke="#60A5FA" strokeWidth="1.5" />}
      {lineB && <polyline points={lineB} fill="none" stroke="#FC4C02" strokeWidth="1.5" strokeDasharray="4 2" />}
    </svg>
  )
}

function getPointAt(effort: NormalisedEffort, t: number): EffortPoint {
  const idx = Math.min(Math.floor(t * (effort.points.length - 1)), effort.points.length - 2)
  const frac = t * (effort.points.length - 1) - idx
  const a = effort.points[idx]
  const b = effort.points[idx + 1]
  return {
    distancePct: a.distancePct + (b.distancePct - a.distancePct) * frac,
    heartRate: a.heartRate != null && b.heartRate != null ? a.heartRate + (b.heartRate - a.heartRate) * frac : null,
    speedKph: a.speedKph + (b.speedKph - a.speedKph) * frac,
    powerWatts: a.powerWatts != null && b.powerWatts != null ? a.powerWatts + (b.powerWatts - a.powerWatts) * frac : null,
    elevationMetres: a.elevationMetres + (b.elevationMetres - a.elevationMetres) * frac,
    elevationGainMetres: a.elevationGainMetres + (b.elevationGainMetres - a.elevationGainMetres) * frac,
  }
}

function avgUpTo(effort: NormalisedEffort, t: number, getValue: (p: EffortPoint) => number | null): number | null {
  const endIdx = Math.floor(t * (effort.points.length - 1))
  const slice = effort.points.slice(0, endIdx + 1)
  const vals = slice.map(getValue).filter((v): v is number => v != null)
  if (vals.length === 0) return null
  return vals.reduce((s, v) => s + v, 0) / vals.length
}

function normalisedPowerUpTo(effort: NormalisedEffort, t: number): number | null {
  const endIdx = Math.floor(t * (effort.points.length - 1))
  if (endIdx < 2) return null
  const slice = effort.points.slice(0, endIdx + 1)
  const powers = slice.map(p => p.powerWatts).filter((v): v is number => v != null)
  if (powers.length < 2) return null
  const windowSize = Math.max(2, Math.round((30 / effort.elapsedSeconds) * effort.points.length))
  const rollingAvgs: number[] = []
  for (let i = windowSize - 1; i < powers.length; i++) {
    const window = powers.slice(i - windowSize + 1, i + 1)
    rollingAvgs.push(window.reduce((s, v) => s + v, 0) / window.length)
  }
  if (rollingAvgs.length === 0) return null
  const mean4th = rollingAvgs.reduce((s, v) => s + Math.pow(v, 4), 0) / rollingAvgs.length
  return Math.round(Math.pow(mean4th, 0.25))
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
}

function countUpTime(target: number, t: number): number {
  return Math.floor(target * Math.min(t, 1))
}

function gradeColour(grade: number): string {
  const abs = Math.abs(grade)
  if (abs < 3) return '#22C55E'
  if (abs < 6) return '#EAB308'
  if (abs < 10) return '#FC4C02'
  return '#EF4444'
}

// Core draw function — works at any scale
// s = scale factor (1 for preview 390×700, 2.769 for export 1080×1920)
// offsetY = top offset for export safe zone (250px at full res)
function drawAnimation(
  ctx: CanvasRenderingContext2D,
  t: number,
  eA: NormalisedEffort,
  eB: NormalisedEffort | null,
  sA: Effort,
  sB: Effort | null,
  minElev: number,
  elevRange: number,
  s: number,   // scale
  W: number,   // canvas width
  H: number,   // canvas height
  safeTop: number,  // top of safe zone in canvas pixels
  safeH: number,    // height of safe zone
) {
  const ORANGE = '#FC4C02'
  const PURPLE = '#A855F7'
  const WHITE = '#ffffff'
  const MUTED = '#888888'
  const DIM = '#444444'
  const DIMMER = '#333333'
  const GREEN = '#22C55E'
  const RED = '#EF4444'
  const GOLD = '#EAB308'
  const BORDER = '#1e1e1e'
  const SURFACE = '#111111'
  const BG = '#0a0a0a'

  const aFaster = !eB || eA.elapsedSeconds <= eB.elapsedSeconds
  const colA = aFaster ? ORANGE : PURPLE
  const colB = aFaster ? PURPLE : ORANGE

  function r(x: number) { return Math.round(x * s) }
  function ry(y: number) { return Math.round(safeTop + y * s) }

  function roundRect(x: number, y: number, w: number, h: number, radius: number) {
    const rw = r(w); if (rw <= 0) return
    const rx = r(x), ry2 = ry(y), rh = r(h), rr = r(radius)
    ctx.beginPath()
    ctx.moveTo(rx + rr, ry2)
    ctx.lineTo(rx + rw - rr, ry2)
    ctx.quadraticCurveTo(rx + rw, ry2, rx + rw, ry2 + rr)
    ctx.lineTo(rx + rw, ry2 + rh - rr)
    ctx.quadraticCurveTo(rx + rw, ry2 + rh, rx + rw - rr, ry2 + rh)
    ctx.lineTo(rx + rr, ry2 + rh)
    ctx.quadraticCurveTo(rx, ry2 + rh, rx, ry2 + rh - rr)
    ctx.lineTo(rx, ry2 + rr)
    ctx.quadraticCurveTo(rx, ry2, rx + rr, ry2)
    ctx.closePath()
  }

  // Layout constants in unscaled coords (390px base)
  const PAD = 16
  const CW = 390 - PAD * 2  // content width
  const HALF = 390 / 2

  // Phase progress
  const PHASE_HEADER_END = 0.08
  const PHASE_TIMES_END = 0.28
  const PHASE_DELTA_END = 0.38
  const PHASE_COUNTDOWN_END = 0.58
  const PHASE_RACE_END = 0.90

  const headerAlpha = Math.min(t / PHASE_HEADER_END, 1)
  const timesT = t < PHASE_HEADER_END ? 0 : Math.min((t - PHASE_HEADER_END) / (PHASE_TIMES_END - PHASE_HEADER_END), 1)
  const deltaT = t < PHASE_TIMES_END ? 0 : Math.min((t - PHASE_TIMES_END) / (PHASE_DELTA_END - PHASE_TIMES_END), 1)
  const countdownT = t < PHASE_DELTA_END ? 0 : Math.min((t - PHASE_DELTA_END) / (PHASE_COUNTDOWN_END - PHASE_DELTA_END), 1)
  const raceT = t < PHASE_COUNTDOWN_END ? 0 : Math.min((t - PHASE_COUNTDOWN_END) / (PHASE_RACE_END - PHASE_COUNTDOWN_END), 1)
  const holdT = t < PHASE_RACE_END ? 0 : Math.min((t - PHASE_RACE_END) / (1 - PHASE_RACE_END), 1)

  const tA = Math.min(raceT, 1)
  const ratioB = eB ? eB.elapsedSeconds / eA.elapsedSeconds : 1
  const tB = eB ? Math.min(raceT / ratioB, 1) : 1

  // ─── Orange left accent ────────────────────────────────────────────────────
  ctx.fillStyle = ORANGE
  ctx.fillRect(0, safeTop, r(4), safeH)

  // ─── Elevation + gradient — always visible ────────────────────────────────
  const elevY = 222  // unscaled y within safe zone
  const elevH = 110
  const elevPad = PAD
  const elevW = 390 - elevPad * 2

  const elevPts = eA.points.map((p, i) => ({
    x: r(elevPad + (i / (eA.points.length - 1)) * elevW),
    y: ry(elevY + elevH - ((p.elevationMetres - minElev) / elevRange) * elevH),
  }))

  const elevGrad = ctx.createLinearGradient(0, ry(elevY), 0, ry(elevY + elevH))
  elevGrad.addColorStop(0, 'rgba(252,76,2,0.2)')
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
  const gradeH2 = 18

  ctx.fillStyle = DIM
  ctx.font = `${r(9)}px -apple-system, sans-serif`
  ctx.textAlign = 'left'
  ctx.fillText('GRADIENT', r(PAD), ry(gradeY - 4))

  const segCount = 40
  for (let i = 0; i < segCount; i++) {
    const idx0 = Math.floor((i / segCount) * (eA.points.length - 1))
    const idx1 = Math.floor(((i + 1) / segCount) * (eA.points.length - 1))
    const p0 = eA.points[idx0]; const p1 = eA.points[idx1]
    const distDiff = (p1.distancePct - p0.distancePct) * eA.segment.distanceMetres
    const elevDiff = p1.elevationMetres - p0.elevationMetres
    const grade = distDiff > 0 ? (elevDiff / distDiff) * 100 : 0
    const segX = PAD + (i / segCount) * (390 - PAD * 2)
    const segW = (390 - PAD * 2) / segCount + 0.5
    ctx.fillStyle = gradeColour(grade)
    roundRect(segX, gradeY, segW, gradeH2, 2)
    ctx.fill()
  }

  const legendItems = [
    { label: '<3%', colour: GREEN },
    { label: '3-6%', colour: '#EAB308' },
    { label: '6-10%', colour: ORANGE },
    { label: '>10%', colour: RED },
  ]
  let lx = PAD
  const ly = gradeY + gradeH2 + 10
  legendItems.forEach(item => {
    ctx.fillStyle = item.colour
    ctx.fillRect(r(lx), ry(ly), r(8), r(6))
    ctx.fillStyle = DIM
    ctx.font = `${r(9)}px -apple-system, sans-serif`
    ctx.textAlign = 'left'
    ctx.fillText(item.label, r(lx + 10), ry(ly + 7))
    lx += 52
  })

  // ─── Header ───────────────────────────────────────────────────────────────
  ctx.globalAlpha = headerAlpha
  ctx.fillStyle = SURFACE
  ctx.fillRect(0, safeTop, W, r(68))
  ctx.strokeStyle = BORDER; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, ry(68)); ctx.lineTo(W, ry(68)); ctx.stroke()

  ctx.fillStyle = MUTED
  ctx.font = `500 ${r(10)}px -apple-system, sans-serif`
  ctx.textAlign = 'left'
  ctx.fillText('SEGMENT', r(PAD), ry(18))
  ctx.fillStyle = WHITE
  ctx.font = `700 ${r(16)}px -apple-system, sans-serif`
  ctx.fillText(eA.segment.name, r(PAD), ry(36))
  const distStr = eA.segment.distanceMetres >= 1000
    ? (eA.segment.distanceMetres / 1000).toFixed(1) + 'km'
    : Math.round(eA.segment.distanceMetres) + 'm'
  ctx.fillStyle = MUTED
  ctx.font = `400 ${r(11)}px -apple-system, sans-serif`
  ctx.fillText(`${distStr} · ${eA.segment.averageGradePct}% avg grade`, r(PAD), ry(54))
  ctx.fillStyle = DIMMER
  ctx.font = `600 ${r(11)}px -apple-system, sans-serif`
  ctx.textAlign = 'right'
  ctx.fillText('SEGMENTIQ', r(390 - PAD), ry(36))
  ctx.globalAlpha = 1

  // ─── Times row ────────────────────────────────────────────────────────────
  const timesY = 68
  const timesAlpha = Math.min(timesT * 3, 1)

  ctx.globalAlpha = timesAlpha
  ctx.strokeStyle = BORDER; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(r(HALF), ry(timesY)); ctx.lineTo(r(HALF), ry(timesY + 110)); ctx.stroke()

  const countedA = countUpTime(eA.elapsedSeconds, easeInOut(timesT))
  ctx.fillStyle = colA
  ctx.font = `500 ${r(10)}px -apple-system, sans-serif`
  ctx.textAlign = 'left'
  ctx.fillText('EFFORT A', r(PAD + 4), ry(timesY + 20))
  ctx.fillStyle = colA
  ctx.font = `700 ${r(36)}px -apple-system, sans-serif`
  ctx.fillText(formatTime(countedA), r(PAD + 4), ry(timesY + 58))
  ctx.fillStyle = DIM
  ctx.font = `400 ${r(11)}px -apple-system, sans-serif`
  ctx.fillText(formatDate(eA.startDate), r(PAD + 4), ry(timesY + 74))

  if (eA.prRank === 1 && timesT > 0.8) {
    ctx.globalAlpha = timesAlpha * ((timesT - 0.8) / 0.2)
    roundRect(PAD + 4, timesY + 82, 28, 16, 8)
    ctx.fillStyle = 'rgba(234,179,8,0.15)'; ctx.fill()
    roundRect(PAD + 4, timesY + 82, 28, 16, 8)
    ctx.strokeStyle = 'rgba(234,179,8,0.3)'; ctx.lineWidth = 1; ctx.stroke()
    ctx.fillStyle = GOLD; ctx.font = `600 ${r(9)}px -apple-system, sans-serif`
    ctx.textAlign = 'center'; ctx.fillText('PR', r(PAD + 18), ry(timesY + 94))
    ctx.globalAlpha = timesAlpha
  }

  if (eB) {
    const countedB = countUpTime(eB.elapsedSeconds, easeInOut(timesT))
    ctx.fillStyle = colB
    ctx.font = `500 ${r(10)}px -apple-system, sans-serif`
    ctx.textAlign = 'left'
    ctx.fillText('EFFORT B', r(HALF + PAD), ry(timesY + 20))
    ctx.fillStyle = colB
    ctx.font = `700 ${r(36)}px -apple-system, sans-serif`
    ctx.fillText(formatTime(countedB), r(HALF + PAD), ry(timesY + 58))
    ctx.fillStyle = DIM
    ctx.font = `400 ${r(11)}px -apple-system, sans-serif`
    ctx.fillText(formatDate(eB.startDate), r(HALF + PAD), ry(timesY + 74))

    if (eB.prRank === 1 && timesT > 0.8) {
      ctx.globalAlpha = timesAlpha * ((timesT - 0.8) / 0.2)
      roundRect(HALF + PAD, timesY + 82, 28, 16, 8)
      ctx.fillStyle = 'rgba(234,179,8,0.15)'; ctx.fill()
      roundRect(HALF + PAD, timesY + 82, 28, 16, 8)
      ctx.strokeStyle = 'rgba(234,179,8,0.3)'; ctx.lineWidth = 1; ctx.stroke()
      ctx.fillStyle = GOLD; ctx.font = `600 ${r(9)}px -apple-system, sans-serif`
      ctx.textAlign = 'center'; ctx.fillText('PR', r(HALF + PAD + 14), ry(timesY + 94))
      ctx.globalAlpha = timesAlpha
    }
  }
  ctx.globalAlpha = 1

  // ─── Delta banner ─────────────────────────────────────────────────────────
  const timeDelta = eB ? eA.elapsedSeconds - eB.elapsedSeconds : 0
  const deltaColour = timeDelta < 0 ? GREEN : timeDelta > 0 ? RED : WHITE

  if (deltaT > 0) {
    ctx.globalAlpha = easeInOut(deltaT)
    const deltaBg = timeDelta < 0 ? 'rgba(34,197,94,0.08)' : timeDelta > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.04)'
    ctx.fillStyle = deltaBg
    ctx.fillRect(0, ry(timesY + 110), W, r(36))
    ctx.strokeStyle = BORDER; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, ry(timesY + 110)); ctx.lineTo(W, ry(timesY + 110)); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, ry(timesY + 146)); ctx.lineTo(W, ry(timesY + 146)); ctx.stroke()
    ctx.fillStyle = deltaColour
    ctx.font = `700 ${r(16)}px -apple-system, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(
      timeDelta === 0 ? 'Dead heat' : `${timeDelta < 0 ? '▲' : '▼'} ${Math.abs(timeDelta)}s ${timeDelta < 0 ? '— A faster' : '— B faster'}`,
      r(195), ry(timesY + 133)
    )
    ctx.globalAlpha = 1
  }

  // ─── Countdown ────────────────────────────────────────────────────────────
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

  // ─── Racing dots ──────────────────────────────────────────────────────────
  if (raceT > 0) {
    const trailAEnd = Math.floor(tA * (eA.points.length - 1))
    if (trailAEnd > 0) {
      ctx.beginPath()
      for (let i = 0; i <= trailAEnd; i++) {
        const p = eA.points[i]
        const x = r(elevPad + p.distancePct * elevW)
        const y = ry(elevY + elevH - ((p.elevationMetres - minElev) / elevRange) * elevH)
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.strokeStyle = colA === ORANGE ? 'rgba(252,76,2,0.8)' : 'rgba(168,85,247,0.8)'
      ctx.lineWidth = r(2.5); ctx.lineJoin = 'round'; ctx.stroke()
    }

    if (eB) {
      const trailBEnd = Math.floor(tB * (eB.points.length - 1))
      if (trailBEnd > 0) {
        ctx.beginPath()
        for (let i = 0; i <= trailBEnd; i++) {
          const pB = eB.points[i]
          const pA = eA.points[Math.min(i, eA.points.length - 1)]
          const x = r(elevPad + pB.distancePct * elevW)
          const y = ry(elevY + elevH - ((pA.elevationMetres - minElev) / elevRange) * elevH)
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        }
        ctx.strokeStyle = colB === ORANGE ? 'rgba(252,76,2,0.8)' : 'rgba(168,85,247,0.8)'
        ctx.lineWidth = r(2.5); ctx.lineJoin = 'round'; ctx.stroke()
      }
    }

    const ptA = getPointAt(eA, tA)
    const dotAx = r(elevPad + ptA.distancePct * elevW)
    const dotAy = ry(elevY + elevH - ((ptA.elevationMetres - minElev) / elevRange) * elevH)
    const glowCA = colA === ORANGE ? 'rgba(252,76,2,' : 'rgba(168,85,247,'
    const glowA = ctx.createRadialGradient(dotAx, dotAy, 0, dotAx, dotAy, r(12))
    glowA.addColorStop(0, glowCA + '0.5)'); glowA.addColorStop(1, glowCA + '0)')
    ctx.fillStyle = glowA; ctx.beginPath(); ctx.arc(dotAx, dotAy, r(12), 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = colA; ctx.beginPath(); ctx.arc(dotAx, dotAy, r(5), 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = WHITE; ctx.lineWidth = r(1.5); ctx.stroke()
    ctx.fillStyle = colA; ctx.font = `bold ${r(10)}px -apple-system, sans-serif`; ctx.textAlign = 'center'
    ctx.fillText('A', dotAx, dotAy - r(12))

    if (eB) {
      const ptB = getPointAt(eB, tB)
      const dotBx = r(elevPad + ptB.distancePct * elevW)
      const bElevIdx = Math.min(Math.floor(tB * (eA.points.length - 1)), eA.points.length - 1)
      const dotBy = ry(elevY + elevH - ((eA.points[bElevIdx].elevationMetres - minElev) / elevRange) * elevH)
      const glowCB = colB === ORANGE ? 'rgba(252,76,2,' : 'rgba(168,85,247,'
      const glowB = ctx.createRadialGradient(dotBx, dotBy, 0, dotBx, dotBy, r(12))
      glowB.addColorStop(0, glowCB + '0.5)'); glowB.addColorStop(1, glowCB + '0)')
      ctx.fillStyle = glowB; ctx.beginPath(); ctx.arc(dotBx, dotBy, r(12), 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = colB; ctx.beginPath(); ctx.arc(dotBx, dotBy, r(5), 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = WHITE; ctx.lineWidth = r(1.5); ctx.stroke()
      ctx.fillStyle = colB; ctx.font = `bold ${r(10)}px -apple-system, sans-serif`; ctx.textAlign = 'center'
      ctx.fillText('B', dotBx, dotBy - r(12))
    }
  }

  // ─── Time gap tracker ─────────────────────────────────────────────────────
  const gapY = gradeY + gradeH2 + 28
  const gapH = 52
  const gapAlpha = raceT > 0 ? Math.min(raceT * 4, 1) : 0

  if (gapAlpha > 0 && eB) {
    ctx.globalAlpha = gapAlpha
    ctx.fillStyle = DIM; ctx.font = `400 ${r(9)}px -apple-system, sans-serif`; ctx.textAlign = 'left'
    ctx.fillText('TIME GAP', r(PAD), ry(gapY))

    const maxSecs = Math.max(eA.elapsedSeconds, eB.elapsedSeconds)
    const wallSecs = raceT * maxSecs
    const aProgress = Math.min(wallSecs / eA.elapsedSeconds, 1)
    const bProgress = Math.min(wallSecs / eB.elapsedSeconds, 1)

    const trackY = gapY + 12
    const trackW = 390 - PAD * 2
    ctx.fillStyle = BORDER
    roundRect(PAD, trackY, trackW, 6, 3); ctx.fill()

    const aDotX = r(PAD + aProgress * trackW)
    const trackPY = ry(trackY + 3)
    const glowCA2 = colA === ORANGE ? 'rgba(252,76,2,' : 'rgba(168,85,247,'
    const glowTA = ctx.createRadialGradient(aDotX, trackPY, 0, aDotX, trackPY, r(10))
    glowTA.addColorStop(0, glowCA2 + '0.4)'); glowTA.addColorStop(1, glowCA2 + '0)')
    ctx.fillStyle = glowTA; ctx.beginPath(); ctx.arc(aDotX, trackPY, r(10), 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = colA; ctx.beginPath(); ctx.arc(aDotX, trackPY, r(5), 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = WHITE; ctx.lineWidth = r(1.5); ctx.stroke()

    const bDotX = r(PAD + bProgress * trackW)
    const glowCB2 = colB === ORANGE ? 'rgba(252,76,2,' : 'rgba(168,85,247,'
    const glowTB = ctx.createRadialGradient(bDotX, trackPY, 0, bDotX, trackPY, r(10))
    glowTB.addColorStop(0, glowCB2 + '0.4)'); glowTB.addColorStop(1, glowCB2 + '0)')
    ctx.fillStyle = glowTB; ctx.beginPath(); ctx.arc(bDotX, trackPY, r(10), 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = colB; ctx.beginPath(); ctx.arc(bDotX, trackPY, r(5), 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = WHITE; ctx.lineWidth = r(1.5); ctx.stroke()

    if (Math.abs(aDotX - bDotX) > r(4)) {
      ctx.strokeStyle = aDotX > bDotX ? GREEN : RED
      ctx.lineWidth = r(2); ctx.setLineDash([r(3), r(2)])
      ctx.beginPath()
      ctx.moveTo(Math.min(aDotX, bDotX) + r(6), trackPY)
      ctx.lineTo(Math.max(aDotX, bDotX) - r(6), trackPY)
      ctx.stroke(); ctx.setLineDash([])
    }

    const aDistCovered = aProgress * eA.segment.distanceMetres
    const bDistCovered = bProgress * eB.segment.distanceMetres
    const aAhead = aDistCovered >= bDistCovered
    const gapMetres = Math.abs(aDistCovered - bDistCovered)
    const trailingSpeedMs = aAhead
      ? (eB.segment.distanceMetres / eB.elapsedSeconds)
      : (eA.segment.distanceMetres / eA.elapsedSeconds)
    const gapSecs = trailingSpeedMs > 0 ? Math.round(gapMetres / trailingSpeedMs) : 0

    const gapLabel = gapSecs < 2 ? 'Neck and neck'
      : `${gapSecs}s ${aAhead ? 'A leads' : 'B leads'}`
    const gapLabelColour = gapSecs < 2 ? WHITE
      : aAhead ? (colA === ORANGE ? GREEN : RED)
      : (colB === ORANGE ? GREEN : RED)

    ctx.fillStyle = gapLabelColour
    ctx.font = `bold ${r(13)}px -apple-system, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(gapLabel, r(195), ry(trackY + 30))
    ctx.fillStyle = DIM; ctx.font = `bold ${r(9)}px -apple-system, sans-serif`
    ctx.textAlign = 'left'; ctx.fillText('START', r(PAD), ry(trackY + 30))
    ctx.textAlign = 'right'; ctx.fillText('FINISH', r(390 - PAD), ry(trackY + 30))
    ctx.globalAlpha = 1
  }

  // ─── Live speed ───────────────────────────────────────────────────────────
  const liveY = gapY + gapH + 8
  const liveH = 60
  const liveAlpha = raceT > 0 ? Math.min(raceT * 4, 1) : 0

  if (liveAlpha > 0) {
    ctx.globalAlpha = liveAlpha
    ctx.strokeStyle = BORDER; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(r(HALF), ry(liveY)); ctx.lineTo(r(HALF), ry(liveY + liveH)); ctx.stroke()

    const ptACurrent = getPointAt(eA, tA)
    const ptBCurrent = eB ? getPointAt(eB, tB) : null

    ctx.fillStyle = colA; ctx.font = `bold ${r(9)}px -apple-system, sans-serif`; ctx.textAlign = 'left'
    ctx.fillText('LIVE SPEED', r(PAD + 4), ry(liveY + 12))
    ctx.fillStyle = WHITE; ctx.font = `bold ${r(26)}px -apple-system, sans-serif`
    ctx.fillText(`${ptACurrent.speedKph.toFixed(1)}`, r(PAD + 4), ry(liveY + 40))
    ctx.fillStyle = MUTED; ctx.font = `400 ${r(10)}px -apple-system, sans-serif`
    ctx.fillText('km/h', r(PAD + 4), ry(liveY + 54))
    ctx.fillStyle = DIM; ctx.fillText(formatPace(ptACurrent.speedKph), r(PAD + 60), ry(liveY + 54))

    if (ptBCurrent) {
      ctx.fillStyle = colB; ctx.font = `bold ${r(9)}px -apple-system, sans-serif`; ctx.textAlign = 'left'
      ctx.fillText('LIVE SPEED', r(HALF + PAD), ry(liveY + 12))
      ctx.fillStyle = WHITE; ctx.font = `bold ${r(26)}px -apple-system, sans-serif`
      ctx.fillText(`${ptBCurrent.speedKph.toFixed(1)}`, r(HALF + PAD), ry(liveY + 40))
      ctx.fillStyle = MUTED; ctx.font = `400 ${r(10)}px -apple-system, sans-serif`
      ctx.fillText('km/h', r(HALF + PAD), ry(liveY + 54))
      ctx.fillStyle = DIM; ctx.fillText(formatPace(ptBCurrent.speedKph), r(HALF + PAD + 56), ry(liveY + 54))
    }
    ctx.globalAlpha = 1
  }

  // ─── Tug of war bars ──────────────────────────────────────────────────────
  const barsStartY = liveY + liveH + 8
  const barTotalW = 390 - PAD * 2
  const barMid = 195
  const barAlpha = raceT > 0 ? Math.min(raceT * 6, 1) : 0

  ctx.globalAlpha = barAlpha

  const runAvgHrA = raceT > 0 ? avgUpTo(eA, tA, p => p.heartRate) : null
  const runAvgHrB = raceT > 0 && eB ? avgUpTo(eB, tB, p => p.heartRate) : null
  const avgHrA = runAvgHrA ?? (eA.averageHeartRate ?? null)
  const avgHrB = runAvgHrB ?? (eB?.averageHeartRate ?? null)
  const avgSpeedA = (raceT > 0 ? avgUpTo(eA, tA, p => p.speedKph) : null) ?? eA.averageSpeedKph
  const avgSpeedB = ((raceT > 0 && eB ? avgUpTo(eB, tB, p => p.speedKph) : null) ?? eB?.averageSpeedKph) ?? null
  const avgPowerA = (raceT > 0 ? avgUpTo(eA, tA, p => p.powerWatts) : null) ?? (eA.averagePowerWatts ?? null)
  const avgPowerB = ((raceT > 0 && eB ? avgUpTo(eB, tB, p => p.powerWatts) : null) ?? (eB?.averagePowerWatts ?? null))
  const npA = raceT > 0 ? normalisedPowerUpTo(eA, tA) : null
  const npB = raceT > 0 && eB ? normalisedPowerUpTo(eB, tB) : null

  let bY = barsStartY

  function drawTugBar(
    label: string,
    valA: number | null, valB: number | null,
    fmtA: string, fmtB: string,
    subA?: string, subB?: string,
    isEstA?: boolean, isEstB?: boolean,
  ) {
    if (valA == null && valB == null) return

    ctx.fillStyle = colA; ctx.font = `500 ${r(13)}px -apple-system, sans-serif`; ctx.textAlign = 'left'
    ctx.fillText(valA != null ? fmtA : '—', r(PAD + 4), ry(bY + 16))
    if (subA) {
      ctx.fillStyle = DIM; ctx.font = `400 ${r(9)}px -apple-system, sans-serif`
      ctx.fillText(subA, r(PAD + 4), ry(bY + 27))
    }
    if (isEstA && valA != null) {
      ctx.fillStyle = DIM; ctx.font = `400 ${r(8)}px -apple-system, sans-serif`
      ctx.fillText('avg', r(PAD + 4), ry(bY + (subA ? 37 : 27)))
    }

    ctx.fillStyle = DIM; ctx.font = `400 ${r(10)}px -apple-system, sans-serif`; ctx.textAlign = 'center'
    ctx.fillText(label, r(barMid), ry(bY + 10))

    ctx.fillStyle = colB; ctx.font = `500 ${r(13)}px -apple-system, sans-serif`; ctx.textAlign = 'right'
    ctx.fillText(valB != null ? fmtB : '—', r(390 - PAD - 4), ry(bY + 16))
    if (subB) {
      ctx.fillStyle = DIM; ctx.font = `400 ${r(9)}px -apple-system, sans-serif`; ctx.textAlign = 'right'
      ctx.fillText(subB, r(390 - PAD - 4), ry(bY + 27))
    }
    if (isEstB && valB != null) {
      ctx.fillStyle = DIM; ctx.font = `400 ${r(8)}px -apple-system, sans-serif`; ctx.textAlign = 'right'
      ctx.fillText('avg', r(390 - PAD - 4), ry(bY + (subB ? 37 : 27)))
    }

    const trackY2 = bY + (subA || subB ? 36 : 22)
    ctx.fillStyle = BORDER
    roundRect(PAD, trackY2, barTotalW, 6, 3); ctx.fill()

    const total = (valA ?? 0) + (valB ?? 0)
    const animEase = easeInOut(Math.min(raceT * 3, 1))

    if (total > 0) {
      if (valA != null) {
        const wA = (valA / total) * barTotalW * animEase
        ctx.fillStyle = colA
        roundRect(PAD, trackY2, wA, 6, 2); ctx.fill()
      }
      if (valB != null) {
        const wB = (valB / total) * barTotalW * animEase
        ctx.fillStyle = colB
        roundRect(PAD + barTotalW - wB, trackY2, wB, 6, 2); ctx.fill()
      }
    }

    bY += (subA || subB ? 52 : 38)
    ctx.strokeStyle = BORDER; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(r(PAD), ry(bY - 4)); ctx.lineTo(r(390 - PAD), ry(bY - 4)); ctx.stroke()
  }

  drawTugBar('AVG HR', avgHrA, avgHrB,
    avgHrA != null ? `${Math.round(avgHrA)} bpm` : '—',
    avgHrB != null ? `${Math.round(avgHrB)} bpm` : '—',
    undefined, undefined,
    runAvgHrA == null && avgHrA != null,
    runAvgHrB == null && avgHrB != null,
  )
  drawTugBar('AVG SPEED', avgSpeedA, avgSpeedB,
    avgSpeedA != null ? `${avgSpeedA.toFixed(1)} km/h` : '—',
    avgSpeedB != null ? `${avgSpeedB.toFixed(1)} km/h` : '—',
  )
  if (avgPowerA != null || avgPowerB != null) {
    drawTugBar('AVG POWER', avgPowerA, avgPowerB,
      avgPowerA != null ? `${Math.round(avgPowerA)}W${!sA.device_watts ? ' est.' : ''}` : '—',
      avgPowerB != null ? `${Math.round(avgPowerB)}W${!sB?.device_watts ? ' est.' : ''}` : '—',
      npA != null ? `NP ${npA}W` : undefined,
      npB != null ? `NP ${npB}W` : undefined,
      (raceT > 0 ? avgUpTo(eA, tA, p => p.powerWatts) : null) == null && avgPowerA != null,
      (raceT > 0 && eB ? avgUpTo(eB, tB, p => p.powerWatts) : null) == null && avgPowerB != null,
    )
  }

  ctx.globalAlpha = 1

  // ─── Footer ───────────────────────────────────────────────────────────────
  const footAlpha = holdT > 0 ? easeInOut(holdT) : (raceT > 0.8 ? (raceT - 0.8) / 0.2 : 0)
  const footY = 700 - 34
  ctx.globalAlpha = footAlpha
  ctx.strokeStyle = BORDER; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, ry(footY)); ctx.lineTo(W, ry(footY)); ctx.stroke()
  ctx.fillStyle = '#555555'; ctx.font = `700 ${r(11)}px -apple-system, sans-serif`; ctx.textAlign = 'left'
  ctx.fillText('SEGMENTIQ', r(PAD), ry(footY + 20))
  ctx.fillStyle = '#444444'; ctx.font = `400 ${r(10)}px -apple-system, sans-serif`; ctx.textAlign = 'right'
  ctx.fillText('segmentiq.vercel.app', r(390 - PAD), ry(footY + 20))
  ctx.globalAlpha = 1
}
interface SegmentReplayProps {
  effortA: NormalisedEffort
  effortB: NormalisedEffort | null
  summaryA: Effort
  summaryB: Effort | null
}

function SegmentReplay({ effortA, effortB, summaryA, summaryB }: SegmentReplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)
  const progressRef = useRef<number>(0)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const effortARef = useRef(effortA)
  const effortBRef = useRef(effortB)
  const summaryARef = useRef(summaryA)
  const summaryBRef = useRef(summaryB)

  useEffect(() => { effortARef.current = effortA }, [effortA])
  useEffect(() => { effortBRef.current = effortB }, [effortB])
  useEffect(() => { summaryARef.current = summaryA }, [summaryA])
  useEffect(() => { summaryBRef.current = summaryB }, [summaryB])

  const allElev = effortA.points.map(p => p.elevationMetres)
  const minElevRef = useRef(Math.min(...allElev))
  const elevRangeRef = useRef(Math.max(...allElev) - Math.min(...allElev) || 1)

  const PREVIEW_DURATION = 15000
  const EXPORT_DURATION = 30000

  // Preview: 390×700
  const PREVIEW_W = 390
  const PREVIEW_H = 700
  const PREVIEW_SCALE = 1
  const PREVIEW_SAFE_TOP = 0
  const PREVIEW_SAFE_H = 700

  // Export: 1080×1920 Instagram Stories with 250px safe zone padding
  const EXPORT_W = 1080
  const EXPORT_H = 1920
  const EXPORT_SCALE = 1080 / 390
  const EXPORT_SAFE_TOP = 250
  const EXPORT_SAFE_H = 1420

  const drawFrame = useCallback((t: number, exportMode = false) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const eA = effortARef.current
    const eB = effortBRef.current
    const sA = summaryARef.current
    const sB = summaryBRef.current
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
    const s = exportMode ? EXPORT_SCALE : PREVIEW_SCALE
    const safeTop = exportMode ? EXPORT_SAFE_TOP : PREVIEW_SAFE_TOP
    const safeH = exportMode ? EXPORT_SAFE_H : PREVIEW_SAFE_H

    // Background
    ctx.fillStyle = '#0a0a0a'
    ctx.fillRect(0, 0, W, H)

    if (exportMode) {
      // Top fade — transparent to #0a0a0a over 250px
      const topGrad = ctx.createLinearGradient(0, 0, 0, 250)
      topGrad.addColorStop(0, 'rgba(0,0,0,0)')
      topGrad.addColorStop(1, '#0a0a0a')
      ctx.fillStyle = topGrad
      ctx.fillRect(0, 0, W, 250)

      // Bottom fade — #0a0a0a to transparent over 250px
      const botGrad = ctx.createLinearGradient(0, H - 250, 0, H)
      botGrad.addColorStop(0, '#0a0a0a')
      botGrad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = botGrad
      ctx.fillRect(0, H - 250, W, 250)
    }

    drawAnimation(ctx, t, eA, eB, sA, sB, minElev, elevRange, s, W, H, safeTop, safeH)
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
    const remainingDuration = PREVIEW_DURATION * (1 - currentT)
    progressRef.current = currentT
    setPlaying(true)
    animate(remainingDuration, currentT, false)
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
      setExportError('Video export requires Chrome or Firefox. Safari is not supported.')
      return
    }

    setExporting(true)
    setExportError(null)
    cancelAnimationFrame(animFrameRef.current)
    progressRef.current = 0

    // Switch canvas to export dimensions
    drawFrame(0, true)

    const stream = canvas.captureStream(30)
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp8',
      videoBitsPerSecond: 12000000,  // higher bitrate for 1080p
    })
    const chunks: Blob[] = []
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'segmentiq-story.webm'; a.click()
      URL.revokeObjectURL(url)
      setExporting(false)
      // Restore preview dimensions
      drawFrame(progressRef.current, false)
    }

    recorder.start()
    animate(EXPORT_DURATION, 0, true, () => { recorder.stop() })
  }

  const progressPct = Math.round(progress * 100)

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-text-muted">Segment replay</div>
        <div className="text-xs text-text-muted">Export: 1080×1920 Instagram Story</div>
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
            exporting ? 'bg-surface border border-border text-text-muted cursor-not-allowed' : 'bg-strava hover:bg-strava-dark text-white'
          }`}
        >
          {exporting ? 'Recording 1080×1920 story…' : '⬇ Export Instagram Story (1080×1920)'}
        </button>
        <button onClick={restart} className="w-10 h-10 rounded-xl border border-border text-text-muted hover:text-white transition-colors text-sm">↺</button>
      </div>
      {exportError && <div className="mt-2 text-xs text-red-400">{exportError}</div>}
      <div className="mt-2 text-xs text-text-muted">
        Preview at 390×700 · Export records full 30s at 1080×1920 for Instagram Stories
      </div>
    </div>
  )
}
function drawExportCard(
  canvas: HTMLCanvasElement,
  effortA: NormalisedEffort,
  effortB: NormalisedEffort,
  summaryA: Effort,
  summaryB: Effort,
  timeDelta: number
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const W = 390, H = 700
  canvas.height = H

  const BG = '#0a0a0a'
  const SURFACE = '#111111'
  const BORDER = '#1e1e1e'
  const ORANGE = '#FC4C02'
  const WHITE = '#ffffff'
  const MUTED = '#888888'
  const DIM = '#444444'
  const DIMMER = '#333333'
  const GREEN = '#22C55E'
  const RED = '#EF4444'
  const GOLD = '#EAB308'

  const aFaster = timeDelta <= 0
  const colA = aFaster ? ORANGE : '#A855F7'
  const colB = aFaster ? '#A855F7' : ORANGE

  function roundRect(x: number, y: number, w: number, h: number, r: number) {
    if (w <= 0) return
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
  }

  const deltaColour = timeDelta < 0 ? GREEN : timeDelta > 0 ? RED : WHITE

  roundRect(0, 0, W, H, 16)
  ctx.fillStyle = BG; ctx.fill()
  roundRect(0, 0, W, H, 16)
  ctx.strokeStyle = BORDER; ctx.lineWidth = 1; ctx.stroke()
  ctx.fillStyle = ORANGE; ctx.fillRect(0, 0, 4, H)

  ctx.fillStyle = SURFACE; ctx.fillRect(0, 0, W, 68)
  ctx.strokeStyle = BORDER; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, 68); ctx.lineTo(W, 68); ctx.stroke()

  ctx.fillStyle = MUTED; ctx.font = '500 10px -apple-system, sans-serif'; ctx.textAlign = 'left'
  ctx.fillText('SEGMENT', 20, 18)
  ctx.fillStyle = WHITE; ctx.font = '700 16px -apple-system, sans-serif'
  ctx.fillText(effortA.segment.name, 20, 36)
  const distStr = effortA.segment.distanceMetres >= 1000
    ? (effortA.segment.distanceMetres / 1000).toFixed(1) + 'km'
    : Math.round(effortA.segment.distanceMetres) + 'm'
  ctx.fillStyle = MUTED; ctx.font = '400 11px -apple-system, sans-serif'
  ctx.fillText(`${distStr} · ${effortA.segment.averageGradePct}% avg grade`, 20, 54)
  ctx.fillStyle = DIMMER; ctx.font = '600 11px -apple-system, sans-serif'; ctx.textAlign = 'right'
  ctx.fillText('SEGMENTIQ', W - 20, 36)

  const timesY = 68
  const halfW = W / 2
  ctx.strokeStyle = BORDER; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(halfW, timesY); ctx.lineTo(halfW, timesY + 110); ctx.stroke()

  ctx.fillStyle = colA; ctx.font = '500 10px -apple-system, sans-serif'; ctx.textAlign = 'left'
  ctx.fillText('EFFORT A', 20, timesY + 20)
  ctx.fillStyle = colA; ctx.font = '700 36px -apple-system, sans-serif'
  ctx.fillText(formatTime(effortA.elapsedSeconds), 20, timesY + 58)
  ctx.fillStyle = DIM; ctx.font = '400 11px -apple-system, sans-serif'
  ctx.fillText(formatDate(effortA.startDate), 20, timesY + 74)

  if (effortA.prRank === 1) {
    roundRect(20, timesY + 82, 28, 16, 8)
    ctx.fillStyle = 'rgba(234,179,8,0.15)'; ctx.fill()
    roundRect(20, timesY + 82, 28, 16, 8)
    ctx.strokeStyle = 'rgba(234,179,8,0.3)'; ctx.lineWidth = 1; ctx.stroke()
    ctx.fillStyle = GOLD; ctx.font = '600 9px -apple-system, sans-serif'; ctx.textAlign = 'center'
    ctx.fillText('PR', 34, timesY + 94)
  }

  ctx.fillStyle = colB; ctx.font = '500 10px -apple-system, sans-serif'; ctx.textAlign = 'left'
  ctx.fillText('EFFORT B', halfW + 20, timesY + 20)
  ctx.fillStyle = colB; ctx.font = '700 36px -apple-system, sans-serif'
  ctx.fillText(formatTime(effortB.elapsedSeconds), halfW + 20, timesY + 58)
  ctx.fillStyle = DIM; ctx.font = '400 11px -apple-system, sans-serif'
  ctx.fillText(formatDate(effortB.startDate), halfW + 20, timesY + 74)

  if (effortB.prRank === 1) {
    roundRect(halfW + 20, timesY + 82, 28, 16, 8)
    ctx.fillStyle = 'rgba(234,179,8,0.15)'; ctx.fill()
    roundRect(halfW + 20, timesY + 82, 28, 16, 8)
    ctx.strokeStyle = 'rgba(234,179,8,0.3)'; ctx.lineWidth = 1; ctx.stroke()
    ctx.fillStyle = GOLD; ctx.font = '600 9px -apple-system, sans-serif'; ctx.textAlign = 'center'
    ctx.fillText('PR', halfW + 34, timesY + 94)
  }

  const deltaBgColour = timeDelta < 0 ? 'rgba(34,197,94,0.08)' : timeDelta > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.04)'
  ctx.fillStyle = deltaBgColour; ctx.fillRect(0, timesY + 110, W, 36)
  ctx.strokeStyle = BORDER; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, timesY + 110); ctx.lineTo(W, timesY + 110); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(0, timesY + 146); ctx.lineTo(W, timesY + 146); ctx.stroke()
  ctx.fillStyle = deltaColour; ctx.font = '700 16px -apple-system, sans-serif'; ctx.textAlign = 'center'
  ctx.fillText(
    timeDelta === 0 ? 'Dead heat' : `${timeDelta < 0 ? '▲' : '▼'} ${Math.abs(timeDelta)}s ${timeDelta < 0 ? '— A faster' : '— B faster'}`,
    W / 2, timesY + 133
  )

  const metY = timesY + 146
  const barW = W - 40
  const barMid = W / 2
  ctx.fillStyle = DIM; ctx.font = '400 10px -apple-system, sans-serif'; ctx.textAlign = 'left'
  ctx.fillText('METRICS', 20, metY + 20)

  let mY = metY + 34

  function drawStatBar(label: string, valA: number | null, valB: number | null, formatA: string, formatB: string) {
    if (valA == null && valB == null) return
    ctx.fillStyle = colA; ctx.font = '500 12px -apple-system, sans-serif'; ctx.textAlign = 'left'
    ctx.fillText(valA != null ? formatA : '—', 20, mY)
    ctx.fillStyle = DIM; ctx.font = '400 10px -apple-system, sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(label, barMid, mY)
    ctx.fillStyle = colB; ctx.font = '500 12px -apple-system, sans-serif'; ctx.textAlign = 'right'
    ctx.fillText(valB != null ? formatB : '—', W - 20, mY)
    ctx.fillStyle = BORDER; roundRect(20, mY + 5, barW, 5, 3); ctx.fill()
    const total = (valA ?? 0) + (valB ?? 0)
    if (total > 0) {
      if (valA != null) {
        ctx.fillStyle = colA
        roundRect(20, mY + 5, (valA / total) * barW, 5, 2); ctx.fill()
      }
      if (valB != null) {
        ctx.fillStyle = colB
        const wB = (valB / total) * barW
        roundRect(20 + barW - wB, mY + 5, wB, 5, 2); ctx.fill()
      }
    }
    mY += 32
  }

  drawStatBar('AVG HR', effortA.averageHeartRate, effortB.averageHeartRate,
    effortA.averageHeartRate != null ? `${Math.round(effortA.averageHeartRate)} bpm` : '—',
    effortB.averageHeartRate != null ? `${Math.round(effortB.averageHeartRate)} bpm` : '—')
  drawStatBar('AVG SPEED', effortA.averageSpeedKph, effortB.averageSpeedKph,
    effortA.averageSpeedKph != null ? `${effortA.averageSpeedKph.toFixed(1)} km/h` : '—',
    effortB.averageSpeedKph != null ? `${effortB.averageSpeedKph.toFixed(1)} km/h` : '—')
  if (effortA.averagePowerWatts != null || effortB.averagePowerWatts != null) {
    drawStatBar('AVG POWER', effortA.averagePowerWatts, effortB.averagePowerWatts,
      effortA.averagePowerWatts != null ? `${Math.round(effortA.averagePowerWatts)}W${!summaryA.device_watts ? ' est.' : ''}` : '—',
      effortB.averagePowerWatts != null ? `${Math.round(effortB.averagePowerWatts)}W${!summaryB.device_watts ? ' est.' : ''}` : '—')
  }

  const divY = mY + 4
  ctx.strokeStyle = BORDER; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, divY); ctx.lineTo(W, divY); ctx.stroke()

  const elY = divY + 14
  const elH = 80
  const elPad = 20
  const elW = W - elPad * 2
  ctx.fillStyle = DIM; ctx.font = '400 10px -apple-system, sans-serif'; ctx.textAlign = 'left'
  ctx.fillText('ELEVATION PROFILE', elPad, elY - 4)

  const elevPoints = effortA.points.map(p => p.elevationMetres)
  const minEl = Math.min(...elevPoints)
  const maxEl = Math.max(...elevPoints)
  const elRange = maxEl - minEl || 1
  const pts = elevPoints.map((v, i) => ({
    x: elPad + (i / (elevPoints.length - 1)) * elW,
    y: elY + elH - 4 - ((v - minEl) / elRange) * (elH - 14),
  }))

  ctx.beginPath()
  ctx.moveTo(pts[0].x, elY + elH)
  pts.forEach(p => ctx.lineTo(p.x, p.y))
  ctx.lineTo(pts[pts.length - 1].x, elY + elH)
  ctx.closePath()
  const elGrad = ctx.createLinearGradient(0, elY, 0, elY + elH)
  elGrad.addColorStop(0, 'rgba(252,76,2,0.35)'); elGrad.addColorStop(1, 'rgba(252,76,2,0.05)')
  ctx.fillStyle = elGrad; ctx.fill()
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  pts.forEach(p => ctx.lineTo(p.x, p.y))
  ctx.strokeStyle = ORANGE; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke()
  ctx.strokeStyle = BORDER; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(elPad, elY + elH); ctx.lineTo(W - elPad, elY + elH); ctx.stroke()

  const footY = elY + elH + 14
  ctx.strokeStyle = BORDER; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, footY); ctx.lineTo(W, footY); ctx.stroke()
  ctx.fillStyle = '#555555'; ctx.font = '700 11px -apple-system, sans-serif'; ctx.textAlign = 'left'
  ctx.fillText('SEGMENTIQ', 20, footY + 22)
  ctx.fillStyle = '#444444'; ctx.font = '400 10px -apple-system, sans-serif'; ctx.textAlign = 'right'
  ctx.fillText('segmentiq.vercel.app', W - 20, footY + 22)
}

function CompareContent() {
  const router = useRouter()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [data, setData] = useState<CompareData | null>(null)
  const [summaryA, setSummaryA] = useState<Effort | null>(null)
  const [summaryB, setSummaryB] = useState<Effort | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadComparison() {
      const session = localStorage.getItem('session')
      if (!session) { router.push('/'); return }
      const rawA = localStorage.getItem('compareEffortA')
      const rawB = localStorage.getItem('compareEffortB')
      if (!rawA || !rawB) {
        setError('No efforts selected — please go back and select two efforts')
        setLoading(false)
        return
      }
      const effortA: Effort = JSON.parse(rawA)
      const effortB: Effort = JSON.parse(rawB)
      setSummaryA(effortA)
      setSummaryB(effortB)
      try {
        const res = await fetch(
          `/api/efforts/compare?a=${effortA.id}&b=${effortB.id}`,
          { headers: { 'x-session': session } }
        )
        if (res.status === 401) { localStorage.removeItem('session'); router.push('/'); return }
        if (!res.ok) throw new Error('Failed to fetch comparison')
        const json = await res.json()
        setData(json.data)
      } catch (err) {
        setError('Failed to load comparison data')
      } finally {
        setLoading(false)
      }
    }
    loadComparison()
  }, [])

  useEffect(() => {
    if (data && summaryA && summaryB && canvasRef.current) {
      drawExportCard(canvasRef.current, data.effortA, data.effortB, summaryA, summaryB, data.deltas.totalTimeDeltaSeconds)
    }
  }, [data, summaryA, summaryB])

  function handleDownload() {
    if (!canvasRef.current) return
    const link = document.createElement('a')
    link.download = 'segmentiq-comparison.png'
    link.href = canvasRef.current.toDataURL('image/png')
    link.click()
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-text-muted text-sm">Loading comparison...</div>
      </div>
    )
  }

  if (error || !data || !summaryA || !summaryB) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 gap-4">
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-red-400 text-sm">
          {error ?? 'Something went wrong'}
        </div>
        <button onClick={() => router.back()} className="text-text-secondary text-sm hover:text-white transition-colors">
          ← Go back
        </button>
      </div>
    )
  }

  const { effortA, effortB, deltas } = data
  const timeDelta = deltas.totalTimeDeltaSeconds

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border px-4 py-4 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-text-secondary hover:text-white transition-colors text-lg">←</button>
        <div>
          <h1 className="font-semibold text-sm">{effortA.segment.name}</h1>
          <p className="text-text-muted text-xs">Effort comparison</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">

        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-surface border border-border rounded-2xl p-4">
            <div className="text-blue-400 text-xs font-medium mb-1">Effort A</div>
            <div className="text-white font-semibold text-lg">{formatTime(effortA.elapsedSeconds)}</div>
            <div className="text-text-muted text-xs mt-1">{formatDate(effortA.startDate)}</div>
            {effortA.prRank === 1 && (
              <span className="inline-block mt-2 text-xs font-medium px-2 py-0.5 rounded-full border bg-yellow-500/20 text-yellow-400 border-yellow-500/30">PR</span>
            )}
          </div>
          <div className="bg-surface border border-border rounded-2xl p-4">
            <div className="text-strava text-xs font-medium mb-1">Effort B</div>
            <div className="text-white font-semibold text-lg">{formatTime(effortB.elapsedSeconds)}</div>
            <div className="text-text-muted text-xs mt-1">{formatDate(effortB.startDate)}</div>
            {effortB.prRank === 1 && (
              <span className="inline-block mt-2 text-xs font-medium px-2 py-0.5 rounded-full border bg-yellow-500/20 text-yellow-400 border-yellow-500/30">PR</span>
            )}
          </div>
        </div>

        <div className={`rounded-2xl p-4 mb-6 text-center border ${
          timeDelta < 0 ? 'bg-green-500/10 border-green-500/20' :
          timeDelta > 0 ? 'bg-red-500/10 border-red-500/20' : 'bg-surface border-border'
        }`}>
          <div className="text-xs text-text-muted mb-1">Time difference</div>
          <div className={`text-2xl font-semibold ${timeDelta < 0 ? 'text-green-400' : timeDelta > 0 ? 'text-red-400' : 'text-white'}`}>
            {timeDelta < 0 ? '▲ ' : timeDelta > 0 ? '▼ ' : ''}{Math.abs(timeDelta)}s
          </div>
          <div className="text-xs text-text-muted mt-1">
            {timeDelta < 0 ? 'Effort A was faster' : timeDelta > 0 ? 'Effort B was faster' : 'Dead heat'}
          </div>
        </div>

        <div className="bg-surface border border-border rounded-2xl px-4 mb-6">
          <div className="grid grid-cols-3 items-center py-2 border-b border-border">
            <div className="text-blue-400 text-xs font-medium">A</div>
            <div className="text-center text-text-muted text-xs">Metric</div>
            <div className="text-strava text-xs font-medium text-right">B</div>
          </div>
          <MetricRow label="Avg HR"
            valueA={effortA.averageHeartRate != null ? `${Math.round(effortA.averageHeartRate)} bpm` : null}
            valueB={effortB.averageHeartRate != null ? `${Math.round(effortB.averageHeartRate)} bpm` : null}
            delta={effortA.averageHeartRate != null && effortB.averageHeartRate != null ? effortA.averageHeartRate - effortB.averageHeartRate : null}
            unit=" bpm" invert={true} />
          <MetricRow label="Avg speed"
            valueA={effortA.averageSpeedKph != null ? `${effortA.averageSpeedKph.toFixed(1)} km/h` : null}
            valueB={effortB.averageSpeedKph != null ? `${effortB.averageSpeedKph.toFixed(1)} km/h` : null}
            delta={effortA.averageSpeedKph != null && effortB.averageSpeedKph != null ? effortA.averageSpeedKph - effortB.averageSpeedKph : null}
            unit=" km/h" />
          {(effortA.hasPower || effortB.hasPower) && (
            <MetricRow label="Avg power"
              valueA={effortA.averagePowerWatts != null ? `${Math.round(effortA.averagePowerWatts)}W${!summaryA.device_watts ? ' est.' : ''}` : null}
              valueB={effortB.averagePowerWatts != null ? `${Math.round(effortB.averagePowerWatts)}W${!summaryB.device_watts ? ' est.' : ''}` : null}
              delta={effortA.averagePowerWatts != null && effortB.averagePowerWatts != null ? effortA.averagePowerWatts - effortB.averagePowerWatts : null}
              unit="W" />
          )}
        </div>

        {effortA.points?.length > 0 && effortB.points?.length > 0 && (
          <div className="bg-surface border border-border rounded-2xl p-4 mb-6">
            <div className="text-xs text-text-muted mb-3">Speed across segment</div>
            <div className="relative h-24">
              <ScaledChart pointsA={effortA.points} pointsB={effortB.points} getValue={p => p.speedKph} />
            </div>
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-2"><div className="w-4 h-0.5 bg-blue-400" /><span className="text-text-muted text-xs">Effort A</span></div>
              <div className="flex items-center gap-2"><div className="w-4 h-0.5 bg-strava" /><span className="text-text-muted text-xs">Effort B</span></div>
            </div>
          </div>
        )}

        {effortA.averageHeartRate != null && effortB.averageHeartRate != null &&
          effortA.points?.length > 0 && effortB.points?.length > 0 && (
          <div className="bg-surface border border-border rounded-2xl p-4 mb-6">
            <div className="text-xs text-text-muted mb-3">Heart rate across segment</div>
            <div className="relative h-24">
              <ScaledChart pointsA={effortA.points} pointsB={effortB.points} getValue={p => p.heartRate} />
            </div>
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-2"><div className="w-4 h-0.5 bg-blue-400" /><span className="text-text-muted text-xs">Effort A</span></div>
              <div className="flex items-center gap-2"><div className="w-4 h-0.5 bg-strava" /><span className="text-text-muted text-xs">Effort B</span></div>
            </div>
          </div>
        )}

        {data && summaryA && summaryB && (
          <SegmentReplay effortA={effortA} effortB={effortB} summaryA={summaryA} summaryB={summaryB} />
        )}

        {data && (
          <div className="bg-surface border border-border rounded-2xl p-4 mb-6">
            <div className="text-xs text-text-muted mb-3">Export card</div>
            <canvas ref={canvasRef} width={390} height={700} style={{ borderRadius: '12px', maxWidth: '100%' }} />
            <button onClick={handleDownload} className="w-full mt-4 bg-strava hover:bg-strava-dark transition-colors text-white text-sm font-medium py-3 rounded-xl">
              Download PNG
            </button>
          </div>
        )}

      </div>
    </div>
  )
}

export default function ComparePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-text-muted text-sm">Loading comparison...</div>
      </div>
    }>
      <CompareContent />
    </Suspense>
  )
}
