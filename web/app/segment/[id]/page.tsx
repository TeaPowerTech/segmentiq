'use client'

import React, { useEffect, useState, Suspense } from 'react'
import { useRouter, useParams } from 'next/navigation'

const JSONBig = require('json-bigint')
const JSONBigString = JSONBig({ storeAsString: true })

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

function SegmentContent() {
  const router = useRouter()
  const params = useParams()
  const segmentId = params.id as string

  const [efforts, setEfforts] = useState<Effort[]>([])
  const [segment, setSegment] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])

  useEffect(() => {
    async function loadEfforts() {
      const session = localStorage.getItem('session')
      if (!session) {
        router.push('/')
        return
      }

      try {
        const res = await fetch(`/api/segments/${segmentId}/efforts`, {
          headers: { 'x-session': session },
        })
        if (res.status === 401) {
          localStorage.removeItem('session')
          router.push('/')
          return
        }
        if (!res.ok) throw new Error('Failed to fetch')

        // Use json-bigint to parse — preserves 19-digit Strava IDs as strings
        const text = await res.text()
        const json = JSONBigString.parse(text)

        setEfforts(json.data)
        if (json.data.length > 0) {
          setSegment(json.data[0].segment)
        }
      } catch (err) {
        setError('Failed to load efforts')
      } finally {
        setLoading(false)
      }
    }

    loadEfforts()
  }, [segmentId])

  function toggleSelect(id: string) {
    setSelected(prev => {
      if (prev.includes(id)) return prev.filter(s => s !== id)
      if (prev.length >= 2) return [prev[1], id]
      return [...prev, id]
    })
  }

  function handleCompare() {
    if (selected.length === 2) {
      router.push(`/compare?a=${selected[0]}&b=${selected[1]}`)
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="border-b border-border px-4 py-4 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="text-text-secondary hover:text-white transition-colors text-lg"
        >
          ←
        </button>
        <div>
          <h1 className="font-semibold text-sm">{segment?.name ?? 'Segment'}</h1>
          <p className="text-text-muted text-xs">{efforts.length} effort{efforts.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">

        {selected.length > 0 && (
          <div className="bg-surface border border-strava/30 rounded-2xl p-4 mb-4 flex items-center justify-between">
            <p className="text-sm text-text-secondary">
              {selected.length === 1
                ? 'Select one more effort to compare'
                : 'Ready to compare'}
            </p>
            {selected.length === 2 && (
              <button
                onClick={handleCompare}
                className="bg-strava hover:bg-strava-dark transition-colors text-white text-xs font-medium px-4 py-2 rounded-xl"
              >
                Compare →
              </button>
            )}
          </div>
        )}

        {selected.length === 0 && !loading && (
          <p className="text-text-muted text-xs mb-4">
            Tap an effort to select it, or select two to compare
          </p>
        )}

        {loading && (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-surface border border-border rounded-2xl p-4 animate-pulse">
                <div className="h-4 bg-border rounded w-1/3 mb-2" />
                <div className="h-3 bg-border rounded w-1/4" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-red-400 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && efforts.map((effort, index) => {
          const isSelected = selected.includes(effort.id)
          const selectionIndex = selected.indexOf(effort.id)

          return (
            <div
              key={effort.id}
              className={`bg-surface border rounded-2xl p-4 mb-3 cursor-pointer transition-all ${
                isSelected ? 'border-strava' : 'border-border hover:border-strava/50'
              }`}
              onClick={() => toggleSelect(effort.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-medium transition-all ${
                    isSelected
                      ? selectionIndex === 0
                        ? 'bg-blue-500 border-blue-500 text-white'
                        : 'bg-strava border-strava text-white'
                      : 'border-border text-text-muted'
                  }`}>
                    {isSelected ? (selectionIndex === 0 ? 'A' : 'B') : index + 1}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{formatDate(effort.start_date)}</span>
                      {effort.pr_rank && <PrBadge rank={effort.pr_rank} />}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      {effort.average_heartrate && (
                        <span className="text-text-muted text-xs">
                          ♥ {Math.round(effort.average_heartrate)} bpm
                        </span>
                      )}
                      {effort.average_watts && effort.device_watts && (
                        <span className="text-text-muted text-xs">
                          ⚡ {Math.round(effort.average_watts)}W
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-white font-semibold text-sm">
                    {formatTime(effort.elapsed_time)}
                  </div>
                </div>
              </div>
            </div>
          )
        })}

      </div>
    </main>
  )
}

export default function SegmentPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-text-muted text-sm">Loading...</div>
      </div>
    }>
      <SegmentContent />
    </Suspense>
  )
}
