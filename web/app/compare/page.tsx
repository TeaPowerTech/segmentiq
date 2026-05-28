'use client'

import React, { useEffect, useState, Suspense, useRef } from 'react'
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
  device_watts?: boolean
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
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function DeltaBadge({ delta, unit, invert = false }: {
  delta: number
  unit: string
  invert?: boolean
}) {
  const positive = invert ? delta < 0 : delta > 0
  const colour = positive ? 'text-green-400' : delta === 0 ? 'text-text-muted' : 'text-red-400'
  const sign = delta > 0 ? '+' : ''
  return (
    <span className={`text-xs font-medium ${colour}`}>
      {sign}{delta.toFixed(1)}{unit}
    </span>
  )
}

function MetricRow({ label, valueA, valueB, delta, unit, invert = false }: {
  label: string
  valueA: string | null
  valueB: string | null
  delta: number | null
  unit: string
  invert?: boolean
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

function ScaledChart({ pointsA, pointsB, getValue, maxVal }: {
  pointsA: EffortPoint[]
  pointsB: EffortPoint[]
  getValue: (p: EffortPoint) => number | null
  maxVal?: number
}) {
  const valsA = pointsA.map(getValue).filter((v): v is number => v != null)
  const valsB = pointsB.map(getValue).filter((v): v is number => v != null)
  const allVals = [...valsA, ...valsB]
  if (allVals.length === 0) return null

  const min = Math.min(...allVals)
  const max = maxVal ?? Math.max(...allVals)
  const range = max - min || 1
  const pad = 4

  const toY = (v: number) => 60 - pad - ((v - min) / range) * (60 - pad * 2)

  const lineA = pointsA
    .filter((_, i) => i % 4 === 0)
    .map((p, i) => {
      const v = getValue(p)
      return v != null ? `${i * (200 / 50)},${toY(v)}` : null
    })
    .filter(Boolean)
    .join(' ')

  const lineB = pointsB
    .filter((_, i) => i % 4 === 0)
    .map((p, i) => {
      const v = getValue(p)
      return v != null ? `${i * (200 / 50)},${toY(v)}` : null
    })
    .filter(Boolean)
    .join(' ')

  return (
    <svg width="100%" height="100%" viewBox="0 0 200 60" preserveAspectRatio="none">
      {lineA && (
        <polyline points={lineA} fill="none" stroke="#60A5FA" strokeWidth="1.5" />
      )}
      {lineB && (
        <polyline points={lineB} fill="none" stroke="#FC4C02" strokeWidth="1.5" strokeDasharray="4 2" />
      )}
    </svg>
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

  const W = 390
  const H = 640
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

  // Background
  roundRect(0, 0, W, H, 16)
  ctx.fillStyle = BG
  ctx.fill()
  roundRect(0, 0, W, H, 16)
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.stroke()

  // Orange left accent
  ctx.fillStyle = ORANGE
  ctx.fillRect(0, 0, 4, H)

  // Header
  ctx.fillStyle = SURFACE
  ctx.fillRect(0, 0, W, 56)
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, 56)
  ctx.lineTo(W, 56)
  ctx.stroke()

  ctx.fillStyle = WHITE
  ctx.font = '500 15px -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(`${effortA.segment.name}`, 20, 34)

  ctx.fillStyle = DIM
  ctx.font = '400 11px -apple-system, sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText('SegmentIQ', W - 20, 34)

  // Delta hero
  const deltaColour = timeDelta < 0 ? GREEN : timeDelta > 0 ? RED : WHITE
  const deltaText = timeDelta === 0 ? 'Dead heat' : `${timeDelta < 0 ? '▲' : '▼'} ${Math.abs(timeDelta)}s`
  ctx.fillStyle = deltaColour
  ctx.font = '700 44px -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(deltaText, W / 2, 116)

  ctx.fillStyle = MUTED
  ctx.font = '400 12px -apple-system, sans-serif'
  ctx.fillText(
    timeDelta < 0 ? 'Effort A was faster' : timeDelta > 0 ? 'Effort B was faster' : 'Both efforts equal',
    W / 2, 136
  )

  // Elevation profile
  const elY = 154
  const elH = 88
  const elPad = 20
  const elW = W - elPad * 2

  const elevPoints = effortA.points.map(p => p.elevationMetres)
  const minEl = Math.min(...elevPoints)
  const maxEl = Math.max(...elevPoints)
  const elRange = maxEl - minEl || 1

  const pts = elevPoints.map((v, i) => ({
    x: elPad + (i / (elevPoints.length - 1)) * elW,
    y: elY + elH - 8 - ((v - minEl) / elRange) * (elH - 20),
  }))

  // Fill
  ctx.beginPath()
  ctx.moveTo(pts[0].x, elY + elH)
  pts.forEach(p => ctx.lineTo(p.x, p.y))
  ctx.lineTo(pts[pts.length - 1].x, elY + elH)
  ctx.closePath()
  const grad = ctx.createLinearGradient(0, elY, 0, elY + elH)
  grad.addColorStop(0, 'rgba(252, 76, 2, 0.3)')
  grad.addColorStop(1, 'rgba(252, 76, 2, 0)')
  ctx.fillStyle = grad
  ctx.fill()

  // Line
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  pts.forEach(p => ctx.lineTo(p.x, p.y))
  ctx.strokeStyle = ORANGE
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.stroke()

  // Baseline
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(elPad, elY + elH)
  ctx.lineTo(W - elPad, elY + elH)
  ctx.stroke()

  ctx.fillStyle = DIM
  ctx.font = '400 10px -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('Elevation profile', elPad, elY - 5)

  // Divider
  const div1Y = elY + elH + 14
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, div1Y)
  ctx.lineTo(W, div1Y)
  ctx.stroke()

  // Efforts side by side
  const efY = div1Y + 18
  const halfW = W / 2

  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(halfW, div1Y)
  ctx.lineTo(halfW, div1Y + 120)
  ctx.stroke()

  // Effort A
  ctx.fillStyle = BLUE
  ctx.font = '500 10px -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('EFFORT A', 20, efY)

  ctx.fillStyle = BLUE
  ctx.font = '700 34px -apple-system, sans-serif'
  ctx.fillText(formatTime(effortA.elapsedSeconds), 20, efY + 36)

  ctx.fillStyle = DIM
  ctx.font = '400 11px -apple-system, sans-serif'
  ctx.fillText(formatDate(effortA.startDate), 20, efY + 54)

  if (effortA.prRank === 1) {
    roundRect(20, efY + 62, 28, 16, 8)
    ctx.fillStyle = 'rgba(234,179,8,0.15)'
    ctx.fill()
    roundRect(20, efY + 62, 28, 16, 8)
    ctx.strokeStyle = 'rgba(234,179,8,0.3)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = GOLD
    ctx.font = '600 9px -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('PR', 34, efY + 74)
  }

  // Effort B
  ctx.fillStyle = ORANGE
  ctx.font = '500 10px -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('EFFORT B', halfW + 20, efY)

  ctx.fillStyle = ORANGE
  ctx.font = '700 34px -apple-system, sans-serif'
  ctx.fillText(formatTime(effortB.elapsedSeconds), halfW + 20, efY + 36)

  ctx.fillStyle = DIM
  ctx.font = '400 11px -apple-system, sans-serif'
  ctx.fillText(formatDate(effortB.startDate), halfW + 20, efY + 54)

  if (effortB.prRank === 1) {
    roundRect(halfW + 20, efY + 62, 28, 16, 8)
    ctx.fillStyle = 'rgba(234,179,8,0.15)'
    ctx.fill()
    roundRect(halfW + 20, efY + 62, 28, 16, 8)
    ctx.strokeStyle = 'rgba(234,179,8,0.3)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = GOLD
    ctx.font = '600 9px -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('PR', halfW + 34, efY + 74)
  }

  // Divider
  const div2Y = div1Y + 120
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, div2Y)
  ctx.lineTo(W, div2Y)
  ctx.stroke()

  // Metrics
  const metY = div2Y + 18
  const colW = W / 3

  const hasPowerA = summaryA.device_watts && effortA.averagePowerWatts != null
  const hasPowerB = summaryB.device_watts && effortB.averagePowerWatts != null
  const powerA = effortA.averagePowerWatts != null
    ? `${Math.round(effortA.averagePowerWatts)}W${!summaryA.device_watts ? ' est.' : ''}`
    : '—'
  const powerB = effortB.averagePowerWatts != null
    ? `${Math.round(effortB.averagePowerWatts)}W${!summaryB.device_watts ? ' est.' : ''}`
    : '—'

  const metrics = [
    {
      label: 'AVG HR',
      a: effortA.averageHeartRate != null ? `${Math.round(effortA.averageHeartRate)} bpm` : '—',
      b: effortB.averageHeartRate != null ? `${Math.round(effortB.averageHeartRate)} bpm` : '—',
    },
    { label: 'POWER', a: powerA, b: powerB },
    {
      label: 'DISTANCE',
      a: effortA.segment.distanceMetres >= 1000
        ? `${(effortA.segment.distanceMetres / 1000).toFixed(1)}km`
        : `${Math.round(effortA.segment.distanceMetres)}m`,
      b: null,
    },
  ]

  metrics.forEach((m, i) => {
    const cx = colW * i + colW / 2

    ctx.fillStyle = DIM
    ctx.font = '400 10px -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(m.label, cx, metY)

    ctx.fillStyle = BLUE
    ctx.font = '500 12px -apple-system, sans-serif'
    ctx.fillText(m.a, cx, metY + 18)

    if (m.b) {
      ctx.fillStyle = ORANGE
      ctx.font = '500 12px -apple-system, sans-serif'
      ctx.fillText(m.b, cx, metY + 34)
    }

    if (i < 2) {
      ctx.strokeStyle = BORDER
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(colW * (i + 1), div2Y)
      ctx.lineTo(colW * (i + 1), div2Y + 68)
      ctx.stroke()
    }
  })

  // Divider
  const div3Y = div2Y + 68
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, div3Y)
  ctx.lineTo(W, div3Y)
  ctx.stroke()

  // Footer
  ctx.fillStyle = DIMMER
  ctx.font = '600 11px -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('SEGMENTIQ', 20, div3Y + 24)

  ctx.fillStyle = DIMMER
  ctx.font = '400 10px -apple-system, sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText('segmentiq.vercel.app', W - 20, div3Y + 24)
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
        if (res.status === 401) {
          localStorage.removeItem('session')
          router.push('/')
          return
        }
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
      drawExportCard(
        canvasRef.current,
        data.effortA,
        data.effortB,
        summaryA,
        summaryB,
        data.deltas.totalTimeDeltaSeconds
      )
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

      {/* Header */}
      <div className="border-b border-border px-4 py-4 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-text-secondary hover:text-white transition-colors text-lg">
          ←
        </button>
        <div>
          <h1 className="font-semibold text-sm">{effortA.segment.name}</h1>
          <p className="text-text-muted text-xs">Effort comparison</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">

        {/* Effort headers — neutral borders, colour in labels only */}
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

        {/* Time delta banner */}
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

        {/* Metrics */}
        <div className="bg-surface border border-border rounded-2xl px-4 mb-6">
          <div className="grid grid-cols-3 items-center py-2 border-b border-border">
            <div className="text-blue-400 text-xs font-medium">A</div>
            <div className="text-center text-text-muted text-xs">Metric</div>
            <div className="text-strava text-xs font-medium text-right">B</div>
          </div>

          <MetricRow
            label="Avg HR"
            valueA={effortA.averageHeartRate != null ? `${Math.round(effortA.averageHeartRate)} bpm` : null}
            valueB={effortB.averageHeartRate != null ? `${Math.round(effortB.averageHeartRate)} bpm` : null}
            delta={effortA.averageHeartRate != null && effortB.averageHeartRate != null
              ? effortA.averageHeartRate - effortB.averageHeartRate : null}
            unit=" bpm"
            invert={true}
          />

          <MetricRow
            label="Avg speed"
            valueA={effortA.averageSpeedKph != null ? `${effortA.averageSpeedKph.toFixed(1)} km/h` : null}
            valueB={effortB.averageSpeedKph != null ? `${effortB.averageSpeedKph.toFixed(1)} km/h` : null}
            delta={effortA.averageSpeedKph != null && effortB.averageSpeedKph != null
              ? effortA.averageSpeedKph - effortB.averageSpeedKph : null}
            unit=" km/h"
          />

          {(effortA.hasPower || effortB.hasPower) && (
            <MetricRow
              label="Avg power"
              valueA={effortA.averagePowerWatts != null
                ? `${Math.round(effortA.averagePowerWatts)}W${!summaryA.device_watts ? ' est.' : ''}` : null}
              valueB={effortB.averagePowerWatts != null
                ? `${Math.round(effortB.averagePowerWatts)}W${!summaryB.device_watts ? ' est.' : ''}` : null}
              delta={effortA.averagePowerWatts != null && effortB.averagePowerWatts != null
                ? effortA.averagePowerWatts - effortB.averagePowerWatts : null}
              unit="W"
            />
          )}
        </div>

        {/* Speed chart — dynamic scaling */}
        {effortA.points?.length > 0 && effortB.points?.length > 0 && (
          <div className="bg-surface border border-border rounded-2xl p-4 mb-6">
            <div className="text-xs text-text-muted mb-3">Speed across segment</div>
            <div className="relative h-24">
              <ScaledChart
                pointsA={effortA.points}
                pointsB={effortB.points}
                getValue={p => p.speedKph}
              />
            </div>
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 bg-blue-400" />
                <span className="text-text-muted text-xs">Effort A</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 bg-strava" />
                <span className="text-text-muted text-xs">Effort B</span>
              </div>
            </div>
          </div>
        )}

        {/* HR chart — dynamic scaling */}
        {effortA.averageHeartRate != null && effortB.averageHeartRate != null &&
          effortA.points?.length > 0 && effortB.points?.length > 0 && (
          <div className="bg-surface border border-border rounded-2xl p-4 mb-6">
            <div className="text-xs text-text-muted mb-3">Heart rate across segment</div>
            <div className="relative h-24">
              <ScaledChart
                pointsA={effortA.points}
                pointsB={effortB.points}
                getValue={p => p.heartRate}
              />
            </div>
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 bg-blue-400" />
                <span className="text-text-muted text-xs">Effort A</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 bg-strava" />
                <span className="text-text-muted text-xs">Effort B</span>
              </div>
            </div>
          </div>
        )}

        {/* Export card */}
        {data && (
          <div className="bg-surface border border-border rounded-2xl p-4 mb-6">
            <div className="text-xs text-text-muted mb-3">Export card</div>
            <canvas
              ref={canvasRef}
              width={390}
              height={640}
              style={{ borderRadius: '12px', maxWidth: '100%' }}
            />
            <button
              onClick={handleDownload}
              className="w-full mt-4 bg-strava hover:bg-strava-dark transition-colors text-white text-sm font-medium py-3 rounded-xl"
            >
              Download PNG
            </button>
          </div>
        )}

      </div>

      {/* Hidden canvas not needed — using inline canvas above */}
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
