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

  // Store all props in refs so drawFrame never has stale closures
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

    const W = canvas.width
    const H = canvas.height
    const PAD = { top: 20, right: 20, bottom: 80, left: 20 }
    const chartW = W - PAD.left - PAD.right
    const chartH = H - PAD.top - PAD.bottom

    ctx.fillStyle = '#0a0a0a'
    ctx.fillRect(0, 0, W, H)

    ctx.fillStyle = '#FC4C02'
    ctx.fillRect(0, 0, 3, H)

    const elevPts = eA.points.map((p, i) => ({
      x: PAD.left + (i / (eA.points.length - 1)) * chartW,
      y: PAD.top + chartH - ((p.elevationMetres - minElev) / elevRange) * chartH,
    }))

    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + chartH)
    grad.addColorStop(0, 'rgba(252,76,2,0.25)')
    grad.addColorStop(1, 'rgba(252,76,2,0.03)')
    ctx.beginPath()
    ctx.moveTo(elevPts[0].x, PAD.top + chartH)
    elevPts.forEach(p => ctx.lineTo(p.x, p.y))
    ctx.lineTo(elevPts[elevPts.length - 1].x, PAD.top + chartH)
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()

    ctx.beginPath()
    elevPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
    ctx.strokeStyle = '#FC4C02'
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.stroke()

    const tA = Math.min(t, 1)
    const ratioB = eB ? eB.elapsedSeconds / eA.elapsedSeconds : 1
    const tB = eB ? Math.min(t / ratioB, 1) : 1

    function getPointAt(effort: NormalisedEffort, t: number): EffortPoint {
      const idx = Math.min(Math.floor(t * (effort.points.length - 1)), effort.points.length - 2)
      const frac = t * (effort.points.length - 1) - idx
      const a = effort.points[idx]
      const b = effort.points[idx + 1]
      return {
        distancePct: a.distancePct + (b.distancePct - a.distancePct) * frac,
        heartRate: a.heartRate != null && b.heartRate != null
          ? a.heartRate + (b.heartRate - a.heartRate) * frac : null,
        speedKph: a.speedKph + (b.speedKph - a.speedKph) * frac,
        powerWatts: a.powerWatts != null && b.powerWatts != null
          ? a.powerWatts + (b.powerWatts - a.powerWatts) * frac : null,
        elevationMetres: a.elevationMetres + (b.elevationMetres - a.elevationMetres) * frac,
        elevationGainMetres: a.elevationGainMetres + (b.elevationGainMetres - a.elevationGainMetres) * frac,
      }
    }

    function avgSpeedAt(effort: NormalisedEffort, t: number): number {
      const endIdx = Math.floor(t * (effort.points.length - 1))
      const slice = effort.points.slice(0, endIdx + 1)
      if (slice.length === 0) return 0
      return slice.reduce((s, p) => s + p.speedKph, 0) / slice.length
    }

    const trailAEnd = Math.floor(tA * (eA.points.length - 1))
    if (trailAEnd > 0) {
      ctx.beginPath()
      for (let i = 0; i <= trailAEnd; i++) {
        const p = eA.points[i]
        const x = PAD.left + p.distancePct * chartW
        const y = PAD.top + chartH - ((p.elevationMetres - minElev) / elevRange) * chartH
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.strokeStyle = 'rgba(96,165,250,0.5)'
      ctx.lineWidth = 3
      ctx.lineJoin = 'round'
      ctx.stroke()
    }

    if (eB) {
      const trailBEnd = Math.floor(tB * (eB.points.length - 1))
      if (trailBEnd > 0) {
        ctx.beginPath()
        for (let i = 0; i <= trailBEnd; i++) {
          const p = eB.points[i]
          const x = PAD.left + p.distancePct * chartW
          const elevY = PAD.top + chartH - ((p.elevationMetres - minElev) / elevRange) * chartH
          i === 0 ? ctx.moveTo(x, elevY) : ctx.lineTo(x, elevY)
        }
        ctx.strokeStyle = 'rgba(252,76,2,0.5)'
        ctx.lineWidth = 3
        ctx.lineJoin = 'round'
        ctx.stroke()
      }
    }

    const ptA = getPointAt(eA, tA)
    const dotAx = PAD.left + ptA.distancePct * chartW
    const dotAy = PAD.top + chartH - ((ptA.elevationMetres - minElev) / elevRange) * chartH

    const glowA = ctx.createRadialGradient(dotAx, dotAy, 0, dotAx, dotAy, 14)
    glowA.addColorStop(0, 'rgba(96,165,250,0.4)')
    glowA.addColorStop(1, 'rgba(96,165,250,0)')
    ctx.fillStyle = glowA
    ctx.beginPath()
    ctx.arc(dotAx, dotAy, 14, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = '#60A5FA'
    ctx.beginPath()
    ctx.arc(dotAx, dotAy, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.fillStyle = '#60A5FA'
    ctx.font = 'bold 11px -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('A', dotAx, dotAy - 14)

    if (eB) {
      const ptB = getPointAt(eB, tB)
      const dotBx = PAD.left + ptB.distancePct * chartW
      const dotBy = PAD.top + chartH - ((ptB.elevationMetres - minElev) / elevRange) * chartH

      const glowB = ctx.createRadialGradient(dotBx, dotBy, 0, dotBx, dotBy, 14)
      glowB.addColorStop(0, 'rgba(252,76,2,0.4)')
      glowB.addColorStop(1, 'rgba(252,76,2,0)')
      ctx.fillStyle = glowB
      ctx.beginPath()
      ctx.arc(dotBx, dotBy, 14, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = '#FC4C02'
      ctx.beginPath()
      ctx.arc(dotBx, dotBy, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.stroke()

      ctx.fillStyle = '#FC4C02'
      ctx.font = 'bold 11px -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('B', dotBx, dotBy - 14)
    }

    const statsY = PAD.top + chartH + 12
    const colW = W / (eB ? 2 : 1)

    ctx.fillStyle = '#60A5FA'
    ctx.font = 'bold 10px -apple-system, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText('EFFORT A', PAD.left, statsY + 12)

    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 18px -apple-system, sans-serif'
    ctx.fillText(`${ptA.speedKph.toFixed(1)} km/h`, PAD.left, statsY + 32)

    ctx.fillStyle = '#888888'
    ctx.font = '10px -apple-system, sans-serif'
    ctx.fillText(`avg ${avgSpeedAt(eA, tA).toFixed(1)} km/h`, PAD.left, statsY + 46)

    if (ptA.powerWatts != null) {
      ctx.fillStyle = '#EAB308'
      ctx.font = '10px -apple-system, sans-serif'
      ctx.fillText(`${Math.round(ptA.powerWatts)}W${!sA.device_watts ? ' est.' : ''}`, PAD.left, statsY + 60)
    }

    if (eB && sB) {
      const ptB2 = getPointAt(eB, tB)

      ctx.fillStyle = '#FC4C02'
      ctx.font = 'bold 10px -apple-system, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText('EFFORT B', colW + PAD.left, statsY + 12)

      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 18px -apple-system, sans-serif'
      ctx.fillText(`${ptB2.speedKph.toFixed(1)} km/h`, colW + PAD.left, statsY + 32)

      ctx.fillStyle = '#888888'
      ctx.font = '10px -apple-system, sans-serif'
      ctx.fillText(`avg ${avgSpeedAt(eB, tB).toFixed(1)} km/h`, colW + PAD.left, statsY + 46)

      if (ptB2.powerWatts != null) {
        ctx.fillStyle = '#EAB308'
        ctx.font = '10px -apple-system, sans-serif'
        ctx.fillText(`${Math.round(ptB2.powerWatts)}W${!sB.device_watts ? ' est.' : ''}`, colW + PAD.left, statsY + 60)
      }

      ctx.strokeStyle = '#1e1e1e'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(colW, statsY)
      ctx.lineTo(colW, H - 4)
      ctx.stroke()
    }

    ctx.fillStyle = '#333333'
    ctx.font = '10px -apple-system, sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText('SEGMENTIQ', W - PAD.right, statsY + 12)

    ctx.fillStyle = '#2a2a2a'
    ctx.font = '9px -apple-system, sans-serif'
    ctx.fillText(eA.segment.name, W - PAD.right, statsY + 24)

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

  async function exportMp4() {
    const canvas = canvasRef.current
    if (!canvas) return

    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
      setExportError('MP4 export requires Chrome or Firefox. Safari is not supported.')
      return
    }

    setExporting(true)
    setExportError(null)
    cancelAnimationFrame(animFrameRef.current)
    progressRef.current = 0

    const stream = canvas.captureStream(30)
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp8',
      videoBitsPerSecond: 4000000,
    })
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
        width={640}
        height={280}
        style={{ borderRadius: '8px', maxWidth: '100%', display: 'block' }}
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
        <span className="text-text-muted text-xs w-8 text-right">
          {Math.round(progress * 15)}s
        </span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={exporting ? undefined : exportMp4}
          disabled={exporting}
          className={`flex-1 text-sm font-medium py-2.5 rounded-xl transition-colors ${
            exporting
              ? 'bg-surface border border-border text-text-muted cursor-not-allowed'
              : 'bg-strava hover:bg-strava-dark text-white'
          }`}
        >
          {exporting ? 'Recording… play will complete automatically' : '⬇ Export replay video'}
        </button>
        <button
          onClick={restart}
          className="w-10 h-10 rounded-xl border border-border text-text-muted hover:text-white transition-colors text-sm"
        >
          ↺
        </button>
      </div>

      {exportError && (
        <div className="mt-2 text-xs text-red-400">{exportError}</div>
      )}

      <div className="mt-2 text-xs text-text-muted">
        Preview plays at 15s · Export records full 30s replay
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
  ctx.fillStyle = BG
  ctx.fill()
  roundRect(0, 0, W, H, 16)
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.fillStyle = ORANGE
  ctx.fillRect(0, 0, 4, H)

  ctx.fillStyle = SURFACE
  ctx.fillRect(0, 0, W, 58)
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, 58)
  ctx.lineTo(W, 58)
  ctx.stroke()

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

  ctx.fillStyle = DIM
  ctx.font = '600 11px -apple-system, sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText('SEGMENTIQ', W - 20, 35)

  const timesY = 58
  const halfW = W / 2

  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(halfW, timesY)
  ctx.lineTo(halfW, timesY + 110)
  ctx.stroke()

  ctx.fillStyle = BLUE
  ctx.font = '500 10px -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('EFFORT A', 20, timesY + 20)

  ctx.fillStyle = BLUE
  ctx.font = '700 36px -apple-system, sans-serif'
  ctx.fillText(formatTime(effortA.elapsedSeconds), 20, timesY + 58)

  ctx.fillStyle = DIM
  ctx.font = '400 11px -apple-system, sans-serif'
  ctx.fillText(formatDate(effortA.startDate), 20, timesY + 74)

  if (effortA.prRank === 1) {
    roundRect(20, timesY + 82, 28, 16, 8)
    ctx.fillStyle = 'rgba(234,179,8,0.15)'
    ctx.fill()
    roundRect(20, timesY + 82, 28, 16, 8)
    ctx.strokeStyle = 'rgba(234,179,8,0.3)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = GOLD
    ctx.font = '600 9px -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('PR', 34, timesY + 94)
  }

  ctx.fillStyle = ORANGE
  ctx.font = '500 10px -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('EFFORT B', halfW + 20, timesY + 20)

  ctx.fillStyle = ORANGE
  ctx.font = '700 36px -apple-system, sans-serif'
  ctx.fillText(formatTime(effortB.elapsedSeconds), halfW + 20, timesY + 58)

  ctx.fillStyle = DIM
  ctx.font = '400 11px -apple-system, sans-serif'
  ctx.fillText(formatDate(effortB.startDate), halfW + 20, timesY + 74)

  if (effortB.prRank === 1) {
    roundRect(halfW + 20, timesY + 82, 28, 16, 8)
    ctx.fillStyle = 'rgba(234,179,8,0.15)'
    ctx.fill()
    roundRect(halfW + 20, timesY + 82, 28, 16, 8)
    ctx.strokeStyle = 'rgba(234,179,8,0.3)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = GOLD
    ctx.font = '600 9px -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('PR', halfW + 34, timesY + 94)
  }

  const deltaBgColour = timeDelta < 0
    ? 'rgba(34,197,94,0.08)'
    : timeDelta > 0
    ? 'rgba(239,68,68,0.08)'
    : 'rgba(255,255,255,0.04)'
  ctx.fillStyle = deltaBgColour
  ctx.fillRect(0, timesY + 110, W, 36)

  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, timesY + 110)
  ctx.lineTo(W, timesY + 110)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(0, timesY + 146)
  ctx.lineTo(W, timesY + 146)
  ctx.stroke()

  ctx.fillStyle = deltaColour
  ctx.font = '700 16px -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(
    timeDelta === 0
      ? 'Dead heat'
      : `${timeDelta < 0 ? '▲' : '▼'} ${Math.abs(timeDelta)}s ${timeDelta < 0 ? '— A faster' : '— B faster'}`,
    W / 2, timesY + 133
  )

  const metY = timesY + 146
  const barW = W - 40
  const barMid = W / 2

  ctx.fillStyle = DIM
  ctx.font = '400 10px -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('METRICS', 20, metY + 20)

  let mY = metY + 34

  function drawStatBar(label: string, valA: number | null, valB: number | null, formatA: string, formatB: string) {
    if (valA == null && valB == null) return
    ctx.fillStyle = BLUE
    ctx.font = '500 12px -apple-system, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(valA != null ? formatA : '—', 20, mY)
    ctx.fillStyle = DIM
    ctx.font = '400 10px -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(label, barMid, mY)
    ctx.fillStyle = ORANGE
    ctx.font = '500 12px -apple-system, sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(valB != null ? formatB : '—', W - 20, mY)
    ctx.fillStyle = BORDER
    roundRect(20, mY + 5, barW, 5, 3)
    ctx.fill()
    const maxVal = Math.max(valA ?? 0, valB ?? 0)
    const halfBar = barW / 2 - 2
    if (valA != null && maxVal > 0) {
      const wA = (valA / maxVal) * halfBar
      ctx.fillStyle = BLUE
      roundRect(barMid - wA - 2, mY + 5, wA, 5, 2)
      ctx.fill()
    }
    if (valB != null && maxVal > 0) {
      const wB = (valB / maxVal) * halfBar
      ctx.fillStyle = ORANGE
      roundRect(barMid + 2, mY + 5, wB, 5, 2)
      ctx.fill()
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
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, divY)
  ctx.lineTo(W, divY)
  ctx.stroke()

  const elY = divY + 14
  const elH = 80
  const elPad = 20
  const elW = W - elPad * 2

  ctx.fillStyle = DIM
  ctx.font = '400 10px -apple-system, sans-serif'
  ctx.textAlign = 'left'
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
  elGrad.addColorStop(0, 'rgba(252,76,2,0.35)')
  elGrad.addColorStop(1, 'rgba(252,76,2,0.05)')
  ctx.fillStyle = elGrad
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  pts.forEach(p => ctx.lineTo(p.x, p.y))
  ctx.strokeStyle = ORANGE
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.stroke()

  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(elPad, elY + elH)
  ctx.lineTo(W - elPad, elY + elH)
  ctx.stroke()

  const footY = elY + elH + 14
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, footY)
  ctx.lineTo(W, footY)
  ctx.stroke()

  ctx.fillStyle = DIMMER
  ctx.font = '600 11px -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('SEGMENTIQ', 20, footY + 22)

  ctx.fillStyle = DIMMER
  ctx.font = '400 10px -apple-system, sans-serif'
  ctx.textAlign = 'right'
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
          timeDelta > 0 ? 'bg-red-500/10 border-red-500/20' :
          'bg-surface border-border'
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
          <SegmentReplay
            effortA={effortA}
            effortB={effortB}
            summaryA={summaryA}
            summaryB={summaryB}
          />
        )}

        {data && (
          <div className="bg-surface border border-border rounded-2xl p-4 mb-6">
            <div className="text-xs text-text-muted mb-3">Export card</div>
            <canvas ref={canvasRef} width={390} height={700}
              style={{ borderRadius: '12px', maxWidth: '100%' }} />
            <button onClick={handleDownload}
              className="w-full mt-4 bg-strava hover:bg-strava-dark transition-colors text-white text-sm font-medium py-3 rounded-xl">
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
