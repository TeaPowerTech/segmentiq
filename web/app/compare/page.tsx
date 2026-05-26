'use client'

import React, { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

interface EffortPoint {
  distancePct: number
  heartRate: number | null
  speedKph: number
  powerWatts: number | null
  wPerKg: number | null
  elevationGainMetres: number
}

interface NormalisedEffort {
  effortId: string
  startDate: string
  elapsedSeconds: number
  averageHeartRate: number | null
  averagePowerWatts: number | null
  averageSpeedKph: number
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
  const colour = positive
    ? 'text-green-400'
    : delta === 0
    ? 'text-text-muted'
    : 'text-red-400'
  const sign = delta > 0 ? '+' : ''
  return (
    <span className={`text-xs font-medium ${colour}`}>
      {sign}{delta.toFixed(1)}{unit}
    </span>
  )
}

function MetricRow({
  label,
  valueA,
  valueB,
  delta,
  unit,
  invert = false,
}: {
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

function CompareContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const effortIdA = searchParams.get('a')
  const effortIdB = searchParams.get('b')

  const [data, setData] = useState<CompareData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadComparison() {
      const session = localStorage.getItem('session')
      if (!session) { router.push('/'); return }

      if (!effortIdA || !effortIdB) {
        setError('Missing effort IDs')
        setLoading(false)
        return
      }

      try {
        const res = await fetch(
          `/api/efforts/compare?a=${effortIdA}&b=${effortIdB}`,
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
        setError('Failed to load comparison')
      } finally {
        setLoading(false)
      }
    }
    loadComparison()
  }, [effortIdA, effortIdB])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-text-muted text-sm">Loading comparison...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-red-400 text-sm">
          {error ?? 'Something went wrong'}
        </div>
      </div>
    )
  }

  const { effortA, effortB, deltas } = data
  const timeDelta = deltas.totalTimeDeltaSeconds

  return (
    <main className="min-h-screen bg-background">

      {/* Header */}
      <div className="border-b border-border px-4 py-4 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="text-text-secondary hover:text-white transition-colors text-lg"
        >
          ←
        </button>
        <div>
          <h1 className="font-semibold text-sm">{effortA.segment.name}</h1>
          <p className="text-text-muted text-xs">Effort comparison</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">

        {/* Effort headers */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-surface border-t-2 border-blue-400 border-x border-b border-border rounded-2xl p-4">
            <div className="text-blue-400 text-xs font-medium mb-1">Effort A</div>
            <div className="text-white font-semibold text-lg">{formatTime(effortA.elapsedSeconds)}</div>
            <div className="text-text-muted text-xs mt-1">{formatDate(effortA.startDate)}</div>
            {effortA.prRank === 1 && (
              <span className="inline-block mt-2 text-xs font-medium px-2 py-0.5 rounded-full border bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                PR
              </span>
            )}
          </div>
          <div className="bg-surface border-t-2 border-strava border-x border-b border-border rounded-2xl p-4">
            <div className="text-strava text-xs font-medium mb-1">Effort B</div>
            <div className="text-white font-semibold text-lg">{formatTime(effortB.elapsedSeconds)}</div>
            <div className="text-text-muted text-xs mt-1">{formatDate(effortB.startDate)}</div>
            {effortB.prRank === 1 && (
              <span className="inline-block mt-2 text-xs font-medium px-2 py-0.5 rounded-full border bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                PR
              </span>
            )}
          </div>
        </div>

        {/* Time delta banner */}
        <div className={`rounded-2xl p-4 mb-6 text-center border ${
          timeDelta < 0
            ? 'bg-green-500/10 border-green-500/20'
            : timeDelta > 0
            ? 'bg-red-500/10 border-red-500/20'
            : 'bg-surface border-border'
        }`}>
          <div className="text-xs text-text-muted mb-1">Time difference</div>
          <div className={`text-2xl font-semibold ${
            timeDelta < 0 ? 'text-green-400' : timeDelta > 0 ? 'text-red-400' : 'text-white'
          }`}>
            {timeDelta < 0 ? '▲ ' : timeDelta > 0 ? '▼ ' : ''}
            {Math.abs(timeDelta)}s
          </div>
          <div className="text-xs text-text-muted mt-1">
            {timeDelta < 0
              ? 'Effort A was faster'
              : timeDelta > 0
              ? 'Effort B was faster'
              : 'Dead heat'}
          </div>
        </div>

        {/* Metrics comparison */}
        <div className="bg-surface border border-border rounded-2xl px-4 mb-6">

          {/* Column labels */}
          <div className="grid grid-cols-3 items-center py-2 border-b border-border">
            <div className="text-blue-400 text-xs font-medium">A</div>
            <div className="text-center text-text-muted text-xs">Metric</div>
            <div className="text-strava text-xs font-medium text-right">B</div>
          </div>

          <MetricRow
            label="Avg HR"
            valueA={effortA.averageHeartRate ? `${Math.round(effortA.averageHeartRate)} bpm` : null}
            valueB={effortB.averageHeartRate ? `${Math.round(effortB.averageHeartRate)} bpm` : null}
            delta={effortA.averageHeartRate && effortB.averageHeartRate
              ? effortA.averageHeartRate - effortB.averageHeartRate
              : null}
            unit=" bpm"
            invert={true}
          />

          <MetricRow
            label="Avg speed"
            valueA={`${effortA.averageSpeedKph.toFixed(1)} km/h`}
            valueB={`${effortB.averageSpeedKph.toFixed(1)} km/h`}
            delta={effortA.averageSpeedKph - effortB.averageSpeedKph}
            unit=" km/h"
          />

          {(effortA.hasPower || effortB.hasPower) && (
            <MetricRow
              label="Avg power"
              valueA={effortA.averagePowerWatts ? `${Math.round(effortA.averagePowerWatts)}W` : null}
              valueB={effortB.averagePowerWatts ? `${Math.round(effortB.averagePowerWatts)}W` : null}
              delta={effortA.averagePowerWatts && effortB.averagePowerWatts
                ? effortA.averagePowerWatts - effortB.averagePowerWatts
                : null}
              unit="W"
            />
          )}

          <MetricRow
            label="Elevation"
            valueA={`${effortA.segment.averageGradePct}% grade`}
            valueB={`${effortB.segment.averageGradePct}% grade`}
            delta={null}
            unit=""
          />
        </div>

        {/* Point by point speed chart placeholder */}
        <div className="bg-surface border border-border rounded-2xl p-4 mb-6">
          <div className="text-xs text-text-muted mb-3">Speed across segment</div>
          <div className="relative h-24">
            <svg width="100%" height="100%" viewBox="0 0 200 60" preserveAspectRatio="none">
              {/* Effort A speed line */}
              <polyline
                points={effortA.points
                  .filter((_, i) => i % 4 === 0)
                  .map((p, i) => `${i * (200 / 50)},${60 - (p.speedKph / 40) * 60}`)
                  .join(' ')}
                fill="none"
                stroke="#60A5FA"
                strokeWidth="1.5"
              />
              {/* Effort B speed line */}
              <polyline
                points={effortB.points
                  .filter((_, i) => i % 4 === 0)
                  .map((p, i) => `${i * (200 / 50)},${60 - (p.speedKph / 40) * 60}`)
                  .join(' ')}
                fill="none"
                stroke="#FC4C02"
                strokeWidth="1.5"
                strokeDasharray="4 2"
              />
            </svg>
          </div>
          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-2">
              <div className="w-4 h-0.5 bg-blue-400" />
              <span className="text-text-muted text-xs">Effort A</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-0.5 bg-strava" style={{ borderTop: '1px dashed #FC4C02' }} />
              <span className="text-text-muted text-xs">Effort B</span>
            </div>
          </div>
        </div>

        {/* HR chart if available */}
        {effortA.averageHeartRate && effortB.averageHeartRate && (
          <div className="bg-surface border border-border rounded-2xl p-4 mb-6">
            <div className="text-xs text-text-muted mb-3">Heart rate across segment</div>
            <div className="relative h-24">
              <svg width="100%" height="100%" viewBox="0 0 200 60" preserveAspectRatio="none">
                <polyline
                  points={effortA.points
                    .filter((_, i) => i % 4 === 0)
                    .map((p, i) => `${i * (200 / 50)},${60 - ((p.heartRate ?? 0) / 200) * 60}`)
                    .join(' ')}
                  fill="none"
                  stroke="#60A5FA"
                  strokeWidth="1.5"
                />
                <polyline
                  points={effortB.points
                    .filter((_, i) => i % 4 === 0)
                    .map((p, i) => `${i * (200 / 50)},${60 - ((p.heartRate ?? 0) / 200) * 60}`)
                    .join(' ')}
                  fill="none"
                  stroke="#FC4C02"
                  strokeWidth="1.5"
                  strokeDasharray="4 2"
                />
              </svg>
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

      </div>
    </main>
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
