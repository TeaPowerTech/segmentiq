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

function ScaledChart({ pointsA, pointsB, getValue }: {
  pointsA: EffortPoint[]
  pointsB: EffortPoint[]
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

  const lineA = pointsA
    .filter((_, i) => i % 4 === 0)
    .map((p, i) => { const v = getValue(p); return v != null ? `${i * (200 / 50)},${toY(v)}` : null })
    .filter(Boolean).join(' ')

  const lineB = pointsB
    .filter((_, i) => i % 4 === 0)
    .map((p, i) => { const v = getValue(p); return v != null ? `${i * (200 / 50)},${toY(v)}` : null })
    .filter(Boolean).join(' ')

  return (
    <svg width="100%" height="100%" viewBox="0 0 200 60" preserveAspectRatio="none">
      {lineA && <polyline points={lineA} fill="none" stroke="#60A5FA" strokeWidth="1.5" />}
      {lineB && <polyline points={lineB} fill="none" stroke="#FC4C02" strokeWidth="1.5" strokeDasharray="4 2" />}
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

  const W = 390, H = 680
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

  // Times row
  const timesY = 58
  const halfW = W / 2

  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(halfW, timesY)
  ctx.lineTo(halfW, timesY + 110)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(0, timesY + 110)
  ctx.lineTo(W, timesY + 110)
  ctx.stroke()

  // Effort A
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

  // Delta in centre — compact, no overlap
  ctx.fillStyle = deltaColour
  ctx.font = '600 13px -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(
    timeDelta === 0 ? 'dead heat' : `${timeDelta < 0 ? '▲' : '▼'} ${Math.abs(timeDelta)}s`,
    halfW, timesY + 48
  )
  ctx.fillStyle = DIM
  ctx.font = '400 10px -apple-system, sans-serif'
  ctx.fillText(
    timeDelta < 0 ? 'A faster' : timeDelta > 0 ? 'B faster' : '',
    halfW, timesY + 62
  )

  // Effort B
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

  // Metrics section
  const metY = timesY + 110
  const barW = W - 40
  const barMid = W / 2

  ctx.fillStyle = DIM
  ctx.font = '400 10px -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('METRICS', 20, metY + 20)

  let mY = metY + 34

  function drawStatBar(
    label: string,
    valA: number | null,
    valB: number | null,
    formatA: string,
    formatB: string,
  ) {
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

    // Bar track
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

  drawStatBar(
    'AVG HR',
    effortA.averageHeartRate,
    effortB.averageHeartRate,
    effortA.averageHeartRate != null ? `${Math.round(effortA.averageHeartRate)} bpm` : '—',
    effortB.averageHeartRate != null ? `${Math.round(effortB.averageHeartRate)} bpm` : '—',
  )

  drawStatBar(
    'AVG S
