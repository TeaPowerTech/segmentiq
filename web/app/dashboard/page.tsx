'use client'

import React, { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

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

function formatDistance(metres: number): string {
  return metres >= 1000
    ? `${(metres / 1000).toFixed(1)}km`
    : `${Math.round(metres)}m`
}

function PrBadge({ rank }: { rank: number }) {
  const colours: Record<number, string> = {
    1: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    2: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
    3: 'bg-orange-700/20 text-orange-400 border-orange-700/30',
  }
  const labels: Record<number, string> = { 1: 'PR', 2: '2nd', 3: '3rd' }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${colours[rank] ?? ''}`}>
      {labels[rank] ?? `#${rank}`}
    </span>
  )
}

function DashboardContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const name = searchParams.get('name') ?? 'Athlete'
  const [efforts, setEfforts] = useState<Effort[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const SEGMENT_IDS = [37191008]

  useEffect(() => {
    async function loadSegments() {
      try {
        const allEfforts: Effort[] = []
        for (const segmentId of SEGMENT_IDS) {
          const res = await fetch(`/api/segments/${segmentId}/efforts`)
          if (res.status === 401) { router.push('/'); return }
          if (!res.ok) continue
          const json = await res.json()
          allEfforts.push(...json.data)
        }
        setEfforts(allEfforts)
      } catch (err) {
        setError('Failed to load segments')
      } finally {
        setLoading(false)
      }
    }
    loadSegments()
  }, [])

  const bestEffort = efforts[0]

  return (
    <main className="min-h-screen bg-background">
      <div className="border-b border-border px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-strava rounded-lg flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
              <path d="M13.5 3L9 14h3.5L8.5 21l9-11h-4.5z" />
            </svg>
          </div>
          <span className="font-semibold text-sm tracking-tight">SegmentIQ</span>
        </div>
        <span className="text-text-secondary text-sm">Hey, {name}</span>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">Your Segments</h1>
          <p className="text-text-secondary text-sm mt-1">Tap a segment to replay your efforts</p>
        </div>

        {loading && (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-surface border border-border rounded-2xl p-4 animate-pulse">
                <div className="h-4 bg-border rounded w-1/2 mb-3" />
                <div className="h-3 bg-border rounded w-1/3" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-red-400 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && bestEffort && (
          <div
            className="bg-surface border border-border rounded-2xl p-4 mb-3 cursor-pointer hover:border-strava transition-colors"
            onClick={() => router.push(`/segment/${bestEffort.segment.id}`)}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="font-medium text-sm">{bestEffort.segment.name}</h2>
                  {bestEffort.pr_rank === 1 && <PrBadge rank={1} />}
                </div>
                <p className="text-text-muted text-xs">
                  {formatDistance(bestEffort.segment.distance)}
                  {bestEffort.segment.average_grade !== 0 && ` · ${bestEffort.segment.average_grade}% avg grade`}
                  {bestEffort.segment.state && ` · ${bestEffort.segment.state}`}
                </p>
              </div>
              <div className="text-right">
                <div className="text-strava font-semibold text-sm">{formatTime(bestEffort.elapsed_time)}</div>
                <div className="text-text-muted text-xs">Best effort</div>
              </div>
            </div>

            <div className="flex items-center gap-4 pt-3 border-t border-border">
              {bestEffort.average_heartrate && (
                <div className="flex items-center gap-1.5">
                  <span className="text-red-400 text-xs">♥</span>
                  <span className="text-text-secondary text-xs">{Math.round(bestEffort.average_heartrate)} bpm</span>
                </div>
              )}
              {bestEffort.average_watts && bestEffort.device_watts && (
                <div className="flex items-center gap-1.5">
                  <span className="text-yellow-400 text-xs">⚡</span>
                  <span className="text-text-secondary text-xs">{Math.round(bestEffort.average_watts)}W</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-text-muted text-xs">{efforts.length} efforts</span>
                <span className="text-text-muted text-xs">·</span>
                <span className="text-text-muted text-xs">Last {formatDate(efforts[efforts.length - 1].start_date)}</span>
              </div>
            </div>
          </div>
        )}

        {!loading && !error && efforts.length === 0 && (
          <div className="text-center py-16">
            <p className="text-text-secondary text-sm">No segments found.</p>
          </div>
        )}
      </div>
    </main>
  )
}

export default function Dashboard() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-text-muted text-sm">Loading...</div>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  )
}
