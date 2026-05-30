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
    const avg = window.reduce((s, v) => s + v, 0) / window.length
    rollingAvgs.push(avg)
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

// Grade colour — green=flat, yellow=moderate, orange=hard, red=steep
function gradeColour(grade: number): string {
  const abs = Math.abs(grade)
  if (abs < 3) return '#22C55E'
  if (abs < 6) return '#EAB308'
  if (abs < 10) return '#FC4C02'
  return '#EF4444'
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

  // Animation phases
  const PHASE_HEADER_END = 0.08
  const PHASE_TIMES_END = 0.28
  const PHASE_DELTA_END = 0.38
  const PHASE_COUNTDOWN_END = 0.50
  const PHASE_RACE_END = 0.90

  const drawFrame = useCallback((t: number) => {
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

    const W = 390
    const H = 700
    canvas.width = W
    canvas.height = H

    const BG = '#0a0a0a'
    const SURFACE = '#111111'
    const BORDER = '#1e1e1e'
    const ORANGE = '#FC4C02'
    const BLUE = '#60A5FA'
    const WHITE = '#ffffff'
    const MUTED = '#888888'
    const DIM = '#444444'
    const DIMMER = '#2a2a2a'
    const GREEN = '#22C55E'
    const RED = '#EF4444'
    const GOLD = '#EAB308'

    function roundRect(x: number, y: number, w: number, h: number, r: number) {
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

    ctx.fillStyle = BG
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = ORANGE
    ctx.fillRect(0, 0, 4, H)

    const headerAlpha = Math.min(t / PHASE_HEADER_END, 1)
    const timesT = t < PHASE_HEADER_END ? 0 : Math.min((t - PHASE_HEADER_END) / (PHASE_TIMES_END - PHASE_HEADER_END), 1)
    const deltaT = t < PHASE_TIMES_END ? 0 : Math.min((t - PHASE_TIMES_END) / (PHASE_DELTA_END - PHASE_TIMES_END), 1)
    const countdownT = t < PHASE_DELTA_END ? 0 : Math.min((t - PHASE_DELTA_END) / (PHASE_COUNTDOWN_END - PHASE_DELTA_END), 1)
    const raceT = t < PHASE_COUNTDOWN_END ? 0 : Math.min((t - PHASE_COUNTDOWN_END) / (PHASE_RACE_END - PHASE_COUNTDOWN_END), 1)
    const holdT = t < PHASE_RACE_END ? 0 : Math.min((t - PHASE_RACE_END) / (1 - PHASE_RACE_END), 1)

    // ─── Header ───────────────────────────────────────────────────────────────
    ctx.globalAlpha = headerAlpha
    ctx.fillStyle = SURFACE
    ctx.fillRect(0, 0, W, 58)
    ctx.strokeStyle = BORDER
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, 58); ctx.lineTo(W, 58); ctx.stroke()

    ctx.fillStyle = MUTED
    ctx.font = '400 11px -apple-system, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(eA.segment.name.toUpperCase(), 20, 26)

    ctx.fillStyle = WHITE
    ctx.font = '600 13px -apple-system, sans-serif'
    ctx.fillText(
      `${eA.segment.distanceMetres >= 1000
        ? (eA.segment.distanceMetres / 1000).toFixed(1) + 'km'
        : Math.round(eA.segment.distanceMetres) + 'm'} · ${eA.segment.averageGradePct}% avg grade`,
      20, 44
    )
    ctx.fillStyle = DIM
    ctx.font = '600 11px -apple-system, sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText('SEGMENTIQ', W - 20, 35)
    ctx.globalAlpha = 1

    // ─── Times row ────────────────────────────────────────────────────────────
    const timesY = 58
    const halfW = W / 2
    const timesAlpha = Math.min(timesT * 3, 1)

    ctx.globalAlpha = timesAlpha
    ctx.strokeStyle = BORDER
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(halfW, timesY); ctx.lineTo(halfW, timesY + 110); ctx.stroke()

    const countedA = countUpTime(eA.elapsedSeconds, easeInOut(timesT))
    ctx.fillStyle = BLUE
    ctx.font = '500 10px -apple-system, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText('EFFORT A', 20, timesY + 20)
    ctx.fillStyle = BLUE
    ctx.font = '700 36px -apple-system, sans-serif'
    ctx.fillText(formatTime(countedA), 20, timesY + 58)
    ctx.fillStyle = DIM
    ctx.font = '400 11px -apple-system, sans-serif'
    ctx.fillText(formatDate(eA.startDate), 20, timesY + 74)

    if (eA.prRank === 1 && timesT > 0.8) {
      ctx.globalAlpha = timesAlpha * ((timesT - 0.8) / 0.2)
      roundRect(20, timesY + 82, 28, 16, 8)
      ctx.fillStyle = 'rgba(234,179,8,0.15)'; ctx.fill()
      roundRect(20, timesY + 82, 28, 16, 8)
      ctx.strokeStyle = 'rgba(234,179,8,0.3)'; ctx.lineWidth = 1; ctx.stroke()
      ctx.fillStyle = GOLD
      ctx.font = '600 9px -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('PR', 34, timesY + 94)
      ctx.globalAlpha = timesAlpha
    }

    if (eB) {
      const countedB = countUpTime(eB.elapsedSeconds, easeInOut(timesT))
      ctx.fillStyle = ORANGE
      ctx.font = '500 10px -apple-system, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText('EFFORT B', halfW + 20, timesY + 20)
      ctx.fillStyle = ORANGE
      ctx.font = '700 36px -apple-system, sans-serif'
      ctx.fillText(formatTime(countedB), halfW + 20, timesY + 58)
      ctx.fillStyle = DIM
      ctx.font = '400 11px -apple-system, sans-serif'
      ctx.fillText(formatDate(eB.startDate), halfW + 20, timesY + 74)

      if (eB.prRank === 1 && timesT > 0.8) {
        ctx.globalAlpha = timesAlpha * ((timesT - 0.8) / 0.2)
        roundRect(halfW + 20, timesY + 82, 28, 16, 8)
        ctx.fillStyle = 'rgba(234,179,8,0.15)'; ctx.fill()
        roundRect(halfW + 20, timesY + 82, 28, 16, 8)
        ctx.strokeStyle = 'rgba(234,179,8,0.3)'; ctx.lineWidth = 1; ctx.stroke()
        ctx.fillStyle = GOLD
        ctx.font = '600 9px -apple-system, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('PR', halfW + 34, timesY + 94)
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
      ctx.fillRect(0, timesY + 110, W, 36)
      ctx.strokeStyle = BORDER; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(0, timesY + 110); ctx.lineTo(W, timesY + 110); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, timesY + 146); ctx.lineTo(W, timesY + 146); ctx.stroke()
      ctx.fillStyle = deltaColour
      ctx.font = '700 16px -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(
        timeDelta === 0 ? 'Dead heat' : `${timeDelta < 0 ? '▲' : '▼'} ${Math.abs(timeDelta)}s ${timeDelta < 0 ? '— A faster' : '— B faster'}`,
        W / 2, timesY + 133
      )
      ctx.globalAlpha = 1
    }

    // ─── Elevation area (always visible after delta) ───────────────────────────
    const elevStartY = timesY + 146 + 8
    const elevH = 110
    const elevPad = 16
    const elevW = W - elevPad * 2

    const elevAlpha = deltaT
    if (elevAlpha > 0) {
      ctx.globalAlpha = elevAlpha

      const elevPts = eA.points.map((p, i) => ({
        x: elevPad + (i / (eA.points.length - 1)) * elevW,
        y: elevStartY + elevH - ((p.elevationMetres - minElev) / elevRange) * elevH,
      }))

      const grad = ctx.createLinearGradient(0, elevStartY, 0, elevStartY + elevH)
      grad.addColorStop(0, 'rgba(252,76,2,0.2)')
      grad.addColorStop(1, 'rgba(252,76,2,0.02)')
      ctx.beginPath()
      ctx.moveTo(elevPts[0].x, elevStartY + elevH)
      elevPts.forEach(p => ctx.lineTo(p.x, p.y))
      ctx.lineTo(elevPts[elevPts.length - 1].x, elevStartY + elevH)
      ctx.closePath()
      ctx.fillStyle = grad; ctx.fill()

      ctx.beginPath()
      elevPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
      ctx.strokeStyle = ORANGE; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke()
      ctx.globalAlpha = 1
    }

    // ─── Countdown ────────────────────────────────────────────────────────────
    if (countdownT > 0 && countdownT < 1) {
      const cd = countdownT * 4 // 0-4 maps to: 3, 2, 1, GO
      let label = ''
      let pulse = 0

      if (cd < 1) { label = '3'; pulse = 1 - cd }
      else if (cd < 2) { label = '2'; pulse = 1 - (cd - 1) }
      else if (cd < 3) { label = '1'; pulse = 1 - (cd - 2) }
      else { label = 'GO!'; pulse = cd - 3 }

      const alpha = label === 'GO!' ? Math.min(pulse * 3, 1) * (1 - Math.max((pulse - 0.5) * 2, 0)) : Math.min(pulse * 2, 1)
      const scale = 1 + (1 - pulse) * 0.3

      ctx.globalAlpha = alpha
      ctx.save()
      ctx.translate(W / 2, elevStartY + elevH / 2)
      ctx.scale(scale, scale)
      ctx.fillStyle = label === 'GO!' ? GREEN : WHITE
      ctx.font = `900 ${label === 'GO!' ? 52 : 72}px -apple-system, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, 0, 0)
      ctx.textBaseline = 'alphabetic'
      ctx.restore()
      ctx.globalAlpha = 1
    }

    // ─── Racing dots ──────────────────────────────────────────────────────────
    const tA = Math.min(raceT, 1)
    const ratioB = eB ? eB.elapsedSeconds / eA.elapsedSeconds : 1
    const tB = eB ? Math.min(raceT / ratioB, 1) : 1

    if (raceT > 0) {
      const trailAEnd = Math.floor(tA * (eA.points.length - 1))
      if (trailAEnd > 0) {
        ctx.beginPath()
        for (let i = 0; i <= trailAEnd; i++) {
          const p = eA.points[i]
          const x = elevPad + p.distancePct * elevW
          const y = elevStartY + elevH - ((p.elevationMetres - minElev) / elevRange) * elevH
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        }
        ctx.strokeStyle = 'rgba(96,165,250,0.6)'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke()
      }

      if (eB) {
        const trailBEnd = Math.floor(tB * (eB.points.length - 1))
        if (trailBEnd > 0) {
          ctx.beginPath()
          for (let i = 0; i <= trailBEnd; i++) {
            const p = eB.points[i]
            const x = elevPad + p.distancePct * elevW
            const y = elevStartY + elevH - ((p.elevationMetres - minElev) / elevRange) * elevH
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
          }
          ctx.strokeStyle = 'rgba(252,76,2,0.6)'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke()
        }
      }

      const ptA = getPointAt(eA, tA)
      const dotAx = elevPad + ptA.distancePct * elevW
      const dotAy = elevStartY + elevH - ((ptA.elevationMetres - minElev) / elevRange) * elevH
      const glowA = ctx.createRadialGradient(dotAx, dotAy, 0, dotAx, dotAy, 12)
      glowA.addColorStop(0, 'rgba(96,165,250,0.5)'); glowA.addColorStop(1, 'rgba(96,165,250,0)')
      ctx.fillStyle = glowA; ctx.beginPath(); ctx.arc(dotAx, dotAy, 12, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = BLUE; ctx.beginPath(); ctx.arc(dotAx, dotAy, 5, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = WHITE; ctx.lineWidth = 1.5; ctx.stroke()
      ctx.fillStyle = BLUE; ctx.font = 'bold 10px -apple-system, sans-serif'; ctx.textAlign = 'center'
      ctx.fillText('A', dotAx, dotAy - 12)

      if (eB) {
        const ptB = getPointAt(eB, tB)
        const dotBx = elevPad + ptB.distancePct * elevW
        const dotBy = elevStartY + elevH - ((ptB.elevationMetres - minElev) / elevRange) * elevH
        const glowB = ctx.createRadialGradient(dotBx, dotBy, 0, dotBx, dotBy, 12)
        glowB.addColorStop(0, 'rgba(252,76,2,0.5)'); glowB.addColorStop(1, 'rgba(252,76,2,0)')
        ctx.fillStyle = glowB; ctx.beginPath(); ctx.arc(dotBx, dotBy, 12, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = ORANGE; ctx.beginPath(); ctx.arc(dotBx, dotBy, 5, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = WHITE; ctx.lineWidth = 1.5; ctx.stroke()
        ctx.fillStyle = ORANGE; ctx.font = 'bold 10px -apple-system, sans-serif'; ctx.textAlign = 'center'
        ctx.fillText('B', dotBx, dotBy - 12)
      }
    }

    // ─── Grade profile ────────────────────────────────────────────────────────
    const gradeY = elevStartY + elevH + 10
    const gradeH = 18
    const gradePad = 16
    const gradeW = W - gradePad * 2
    const gradeAlpha = deltaT

    if (gradeAlpha > 0) {
      ctx.globalAlpha = gradeAlpha
      ctx.fillStyle = DIM
      ctx.font = '400 9px -apple-system, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText('GRADIENT', gradePad, gradeY - 4)

      const pts = eA.points
      const segCount = 40
      for (let i = 0; i < segCount; i++) {
        const idx0 = Math.floor((i / segCount) * (pts.length - 1))
        const idx1 = Math.floor(((i + 1) / segCount) * (pts.length - 1))
        const p0 = pts[idx0]
        const p1 = pts[idx1]
        const distDiff = (p1.distancePct - p0.distancePct) * eA.segment.distanceMetres
        const elevDiff = p1.elevationMetres - p0.elevationMetres
        const grade = distDiff > 0 ? (elevDiff / distDiff) * 100 : 0

        const x = gradePad + (i / segCount) * gradeW
        const w = gradeW / segCount + 1

        ctx.fillStyle = gradeColour(grade)
        roundRect(x, gradeY, w, gradeH, 2)
        ctx.fill()
      }

      // Legend
      const legendItems = [
        { label: '<3%', colour: '#22C55E' },
        { label: '3-6%', colour: '#EAB308' },
        { label: '6-10%', colour: '#FC4C02' },
        { label: '>10%', colour: '#EF4444' },
      ]
      let lx = gradePad
      const ly = gradeY + gradeH + 10
      legendItems.forEach(item => {
        ctx.fillStyle = item.colour
        ctx.fillRect(lx, ly, 8, 6)
        ctx.fillStyle = DIM
        ctx.font = '400 9px -apple-system, sans-serif'
        ctx.textAlign = 'left'
        ctx.fillText(item.label, lx + 10, ly + 7)
        lx += 52
      })

      ctx.globalAlpha = 1
    }

    // ─── Time gap tracker ─────────────────────────────────────────────────────
    const gapY = gradeY + gradeH + 26
    const gapH = 48
    const gapPad = 16
    const gapW = W - gapPad * 2
    const gapAlpha = raceT > 0 ? Math.min(raceT * 4, 1) : 0

    if (gapAlpha > 0 && eB) {
      ctx.globalAlpha = gapAlpha

      ctx.fillStyle = DIM
      ctx.font = '400 9px -apple-system, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText('TIME GAP', gapPad, gapY)

      // Calculate live gap
      // tA and tB represent what fraction of their respective efforts each has completed
      // At raceT, A has done tA of their effort, B has done tB
      // Time elapsed for A = tA * eA.elapsedSeconds
      // Time elapsed for B = tB * eB.elapsedSeconds
      // At raceT, wall clock time = raceT * max(eA, eB) (A finishes first if faster)
      const maxElapsed = Math.max(eA.elapsedSeconds, eB.elapsedSeconds)
      const wallTime = raceT * maxElapsed
      const aElapsed = Math.min(wallTime, eA.elapsedSeconds)
      const bElapsed = Math.min(wallTime, eB.elapsedSeconds)
      const aDistPct = aElapsed / eA.elapsedSeconds
      const bDistPct = bElapsed / eB.elapsedSeconds

      // Gap: positive = A is ahead on the road, negative = B is ahead
      const roadGap = (aDistPct - bDistPct) * eA.segment.distanceMetres

      // Track bar
      const trackY = gapY + 12
      ctx.fillStyle = BORDER
      roundRect(gapPad, trackY, gapW, 6, 3)
      ctx.fill()

      // A dot on track
      const aDotX = gapPad + aDistPct * gapW
      const glowTA = ctx.createRadialGradient(aDotX, trackY + 3, 0, aDotX, trackY + 3, 10)
      glowTA.addColorStop(0, 'rgba(96,165,250,0.4)'); glowTA.addColorStop(1, 'rgba(96,165,250,0)')
      ctx.fillStyle = glowTA; ctx.beginPath(); ctx.arc(aDotX, trackY + 3, 10, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = BLUE; ctx.beginPath(); ctx.arc(aDotX, trackY + 3, 5, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = WHITE; ctx.lineWidth = 1.5; ctx.stroke()

      // B dot on track
      const bDotX = gapPad + bDistPct * gapW
      const glowTB = ctx.createRadialGradient(bDotX, trackY + 3, 0, bDotX, trackY + 3, 10)
      glowTB.addColorStop(0, 'rgba(252,76,2,0.4)'); glowTB.addColorStop(1, 'rgba(252,76,2,0)')
      ctx.fillStyle = glowTB; ctx.beginPath(); ctx.arc(bDotX, trackY + 3, 10, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = ORANGE; ctx.beginPath(); ctx.arc(bDotX, trackY + 3, 5, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = WHITE; ctx.lineWidth = 1.5; ctx.stroke()

      // Gap line between dots
      if (Math.abs(aDotX - bDotX) > 4) {
        const gapLineColour = aDotX > bDotX ? GREEN : RED
        ctx.strokeStyle = gapLineColour
        ctx.lineWidth = 2
        ctx.setLineDash([3, 2])
        ctx.beginPath()
        ctx.moveTo(Math.min(aDotX, bDotX) + 6, trackY + 3)
        ctx.lineTo(Math.max(aDotX, bDotX) - 6, trackY + 3)
        ctx.stroke()
        ctx.setLineDash([])
      }

      // Gap label
      const timeDiffNow = aElapsed - bElapsed
      const gapLabel = timeDiffNow === 0 ? 'Level'
        : `${Math.abs(timeDiffNow).toFixed(0)}s ${timeDiffNow < 0 ? 'B leads' : 'A leads'}`
      const gapLabelColour = timeDiffNow > 0 ? GREEN : timeDiffNow < 0 ? RED : WHITE
      ctx.fillStyle = gapLabelColour
      ctx.font = 'bold 12px -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(gapLabel, W / 2, trackY + 28)

      // A / B labels at ends
      ctx.fillStyle = BLUE
      ctx.font = 'bold 9px -apple-system, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText('START', gapPad, trackY + 28)
      ctx.fillStyle = DIM
      ctx.textAlign = 'right'
      ctx.fillText('FINISH', W - gapPad, trackY + 28)

      ctx.globalAlpha = 1
    }

    // ─── Stat bars ────────────────────────────────────────────────────────────
    const barsStartY = gapY + gapH + 8
    const barW = W - 40
    const barMid = W / 2
    const barAlpha = raceT > 0 ? Math.min(raceT * 4, 1) : 0

    ctx.globalAlpha = barAlpha

    const avgHrA = raceT > 0 ? avgUpTo(eA, tA, p => p.heartRate) : null
    const avgHrB = raceT > 0 && eB ? avgUpTo(eB, tB, p => p.heartRate) : null
    const avgSpeedA = raceT > 0 ? avgUpTo(eA, tA, p => p.speedKph) : null
    const avgSpeedB = raceT > 0 && eB ? avgUpTo(eB, tB, p => p.speedKph) : null
    const avgPowerA = raceT > 0 ? avgUpTo(eA, tA, p => p.powerWatts) : null
    const avgPowerB = raceT > 0 && eB ? avgUpTo(eB, tB, p => p.powerWatts) : null
    const npA = raceT > 0 ? normalisedPowerUpTo(eA, tA) : null
    const npB = raceT > 0 && eB ? normalisedPowerUpTo(eB, tB) : null

    let bY = barsStartY

    function drawAnimBar(
      label: string,
      valA: number | null, valB: number | null,
      fmtA: string, fmtB: string,
      subA?: string, subB?: string,
    ) {
      if (valA == null && valB == null) return

      ctx.fillStyle = DIM
      ctx.font = '400 10px -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(label, barMid, bY)

      ctx.fillStyle = BLUE
      ctx.font = '500 13px -apple-system, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(valA != null ? fmtA : '—', 20, bY + 16)
      if (subA) {
        ctx.fillStyle = '#444'
        ctx.font = '400 9px -apple-system, sans-serif'
        ctx.fillText(subA, 20, bY + 27)
      }

      ctx.fillStyle = ORANGE
      ctx.font = '500 13px -apple-system, sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(valB != null ? fmtB : '—', W - 20, bY + 16)
      if (subB) {
        ctx.fillStyle = '#444'
        ctx.font = '400 9px -apple-system, sans-serif'
        ctx.textAlign = 'right'
        ctx.fillText(subB, W - 20, bY + 27)
      }

      const trackY2 = bY + (subA || subB ? 33 : 22)
      ctx.fillStyle = BORDER
      roundRect(20, trackY2, barW, 5, 3)
      ctx.fill()

      const maxVal = Math.max(valA ?? 0, valB ?? 0)
      const halfBar = barW / 2 - 2

      if (valA != null && maxVal > 0) {
        const wA = easeInOut(Math.min(raceT * 1.5, 1)) * (valA / maxVal) * halfBar
        ctx.fillStyle = BLUE
        roundRect(barMid - wA - 2, trackY2, wA, 5, 2)
        ctx.fill()
      }
      if (valB != null && maxVal > 0) {
        const wB = easeInOut(Math.min(raceT * 1.5, 1)) * (valB / maxVal) * halfBar
        ctx.fillStyle = ORANGE
        roundRect(barMid + 2, trackY2, wB, 5, 2)
        ctx.fill()
      }

      bY += (subA || subB ? 48 : 36)
      ctx.strokeStyle = BORDER; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(20, bY - 4); ctx.lineTo(W - 20, bY - 4); ctx.stroke()
    }

    drawAnimBar('AVG HR', avgHrA, avgHrB,
      avgHrA != null ? `${Math.round(avgHrA)} bpm` : '—',
      avgHrB != null ? `${Math.round(avgHrB)} bpm` : '—')
    drawAnimBar('AVG SPEED', avgSpeedA, avgSpeedB,
      avgSpeedA != null ? `${avgSpeedA.toFixed(1)} km/h` : '—',
      avgSpeedB != null ? `${avgSpeedB.toFixed(1)} km/h` : '—')

    if (avgPowerA != null || avgPowerB != null) {
      drawAnimBar('AVG POWER', avgPowerA, avgPowerB,
        avgPowerA != null ? `${Math.round(avgPowerA)}W${!sA.device_watts ? ' est.' : ''}` : '—',
        avgPowerB != null ? `${Math.round(avgPowerB)}W${!sB?.device_watts ? ' est.' : ''}` : '—',
        npA != null ? `NP ${npA}W${!sA.device_watts ? ' est.' : ''}` : undefined,
        npB != null ? `NP ${npB}W${!sB?.device_watts ? ' est.' : ''}` : undefined,
      )
    }

    ctx.globalAlpha = 1

    // ─── Footer ───────────────────────────────────────────────────────────────
    const footAlpha = holdT > 0 ? easeInOut(holdT) : (raceT > 0.8 ? (raceT - 0.8) / 0.2 : 0)
    ctx.globalAlpha = footAlpha
    ctx.strokeStyle = BORDER; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, H - 34); ctx.lineTo(W, H - 34); ctx.stroke()
    ctx.fillStyle = DIMMER
    ctx.font = '600 11px -apple-system, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText('SEGMENTIQ', 20, H - 14)
    ctx.fillStyle = DIMMER
    ctx.font = '400 10px -apple-system, sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText('segmentiq.vercel.app', W - 20, H - 14)
    ctx.globalAlpha = 1

  }, [])
  const animate = useCallback((duration: number, startProgress: number, onComplete?: () => void) => {
    const startTime = performance.now()
    const startT = startProgress

    function frame(now: number) {
      const elapsed = now - startTime
      const t = Math.min(startT + elapsed / duration, 1)
      progressRef.current = t
      setProgress(t)
      drawFrame(t)
      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(frame)
      } else {
        setPlaying(false)
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
    animate(remainingDuration, currentT)
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
    drawFrame(t)
  }

  function restart() {
    cancelAnimationFrame(animFrameRef.current)
    progressRef.current = 0
    setProgress(0)
    drawFrame(0)
    setPlaying(false)
  }

  useEffect(() => { drawFrame(0) }, [drawFrame])
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

    const stream = canvas.captureStream(30)
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 6000000 })
    const chunks: Blob[] = []
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'segmentiq-replay.webm'
      a.click()
      URL.revokeObjectURL(url)
      setExporting(false)
      drawFrame(progressRef.current)
    }
    recorder.start()
    animate(EXPORT_DURATION, 0, () => { recorder.stop() })
  }

  const progressPct = Math.round(progress * 100)

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 mb-6">
      <div className="text-xs text-text-muted mb-3">Segment replay</div>
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
          {exporting ? 'Recording… animation will complete automatically' : '⬇ Export replay video'}
        </button>
        <button onClick={restart} className="w-10 h-10 rounded-xl border border-border text-text-muted hover:text-white transition-colors text-sm">↺</button>
      </div>
      {exportError && <div className="mt-2 text-xs text-red-400">{exportError}</div>}
      <div className="mt-2 text-xs text-text-muted">Preview plays at 15s · Export records full 30s portrait video</div>
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
  const BLUE = '#60A5FA'
  const WHITE = '#ffffff'
  const MUTED = '#888888'
  const DIM = '#444444'
  const DIMMER = '#2a2a2a'
  const GREEN = '#22C55E'
  const RED = '#EF4444'
  const GOLD = '#EAB308'

  function roundRect(x: number, y: number, w: number, h: number, r: number) {
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

  ctx.fillStyle = SURFACE; ctx.fillRect(0, 0, W, 58)
  ctx.strokeStyle = BORDER; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, 58); ctx.lineTo(W, 58); ctx.stroke()

  ctx.fillStyle = MUTED
  ctx.font = '400 11px -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(effortA.segment.name.toUpperCase(), 20, 26)
  ctx.fillStyle = WHITE
  ctx.font = '600 14px -apple-system, sans-serif'
  ctx.fillText(
    `${effortA.segment.distanceMetres >= 1000
      ? (effortA.segment.distanceMetres / 1000).toFixed(1) + 'km'
      : Math.round(effortA.segment.distanceMetres) + 'm'} · ${effortA.segment.averageGradePct}% avg grade`,
    20, 44
  )
  ctx.fillStyle = DIM; ctx.font = '600 11px -apple-system, sans-serif'; ctx.textAlign = 'right'
  ctx.fillText('SEGMENTIQ', W - 20, 35)

  const timesY = 58
  const halfW = W / 2
  ctx.strokeStyle = BORDER; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(halfW, timesY); ctx.lineTo(halfW, timesY + 110); ctx.stroke()

  ctx.fillStyle = BLUE; ctx.font = '500 10px -apple-system, sans-serif'; ctx.textAlign = 'left'
  ctx.fillText('EFFORT A', 20, timesY + 20)
  ctx.fillStyle = BLUE; ctx.font = '700 36px -apple-system, sans-serif'
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

  ctx.fillStyle = ORANGE; ctx.font = '500 10px -apple-system, sans-serif'; ctx.textAlign = 'left'
  ctx.fillText('EFFORT B', halfW + 20, timesY + 20)
  ctx.fillStyle = ORANGE; ctx.font = '700 36px -apple-system, sans-serif'
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
    ctx.fillStyle = BLUE; ctx.font = '500 12px -apple-system, sans-serif'; ctx.textAlign = 'left'
    ctx.fillText(valA != null ? formatA : '—', 20, mY)
    ctx.fillStyle = DIM; ctx.font = '400 10px -apple-system, sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(label, barMid, mY)
    ctx.fillStyle = ORANGE; ctx.font = '500 12px -apple-system, sans-serif'; ctx.textAlign = 'right'
    ctx.fillText(valB != null ? formatB : '—', W - 20, mY)
    ctx.fillStyle = BORDER; roundRect(20, mY + 5, barW, 5, 3); ctx.fill()
    const maxVal = Math.max(valA ?? 0, valB ?? 0)
    const halfBar = barW / 2 - 2
    if (valA != null && maxVal > 0) {
      ctx.fillStyle = BLUE; roundRect(barMid - (valA / maxVal) * halfBar - 2, mY + 5, (valA / maxVal) * halfBar, 5, 2); ctx.fill()
    }
    if (valB != null && maxVal > 0) {
      ctx.fillStyle = ORANGE; roundRect(barMid + 2, mY + 5, (valB / maxVal) * halfBar, 5, 2); ctx.fill()
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
  ctx.fillStyle = DIMMER; ctx.font = '600 11px -apple-system, sans-serif'; ctx.textAlign = 'left'
  ctx.fillText('SEGMENTIQ', 20, footY + 22)
  ctx.fillStyle = DIMMER; ctx.font = '400 10px -apple-system, sans-serif'; ctx.textAlign = 'right'
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
