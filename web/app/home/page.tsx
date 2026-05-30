'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function HomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [name, setName] = useState<string>('')

  useEffect(() => {
    const session = localStorage.getItem('session')
    if (!session) { router.push('/'); return }
    const nameParam = searchParams.get('name')
    if (nameParam) setName(nameParam)
  }, [])

  function handleSignOut() {
    localStorage.removeItem('session')
    router.push('/')
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border px-4 py-4 flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-sm">SegmentIQ</h1>
          {name && <p className="text-text-muted text-xs">Welcome back, {name}</p>}
        </div>
        <button
          onClick={handleSignOut}
          className="text-text-secondary text-xs hover:text-white transition-colors"
        >
          Sign out
        </button>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">

        <div className="mb-8">
          <h2 className="text-white text-lg font-semibold mb-1">What would you like to do?</h2>
          <p className="text-text-muted text-sm">Choose a feature to get started</p>
        </div>

        <div className="flex flex-col gap-4">

          {/* Segments */}
          <button
            onClick={() => router.push('/segments')}
            className="bg-surface border border-border rounded-2xl p-6 text-left hover:border-strava transition-colors group"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl bg-strava/10 border border-strava/20 flex items-center justify-center text-2xl">
                🏁
              </div>
              <svg className="w-5 h-5 text-text-muted group-hover:text-white transition-colors mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <h3 className="text-white font-semibold text-base mb-1">Segment Comparison</h3>
            <p className="text-text-muted text-sm leading-relaxed">
              Compare two efforts on the same segment. Watch them race side by side, see live stats, and export an Instagram Story.
            </p>
            <div className="flex gap-2 mt-4">
              <span className="text-xs px-2 py-1 rounded-lg bg-surface border border-border text-text-muted">Side by side replay</span>
              <span className="text-xs px-2 py-1 rounded-lg bg-surface border border-border text-text-muted">Tug of war stats</span>
              <span className="text-xs px-2 py-1 rounded-lg bg-surface border border-border text-text-muted">Story export</span>
            </div>
          </button>

          {/* Activities */}
          <button
            onClick={() => router.push('/activities')}
            className="bg-surface border border-border rounded-2xl p-6 text-left hover:border-strava transition-colors group"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl bg-strava/10 border border-strava/20 flex items-center justify-center text-2xl">
                🚴
              </div>
              <svg className="w-5 h-5 text-text-muted group-hover:text-white transition-colors mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <h3 className="text-white font-semibold text-base mb-1">Activity Summary</h3>
            <p className="text-text-muted text-sm leading-relaxed">
              Turn any ride into a shareable story card. Animated elevation replay, live stats, and a full 1080×1920 Instagram Story export.
            </p>
            <div className="flex gap-2 mt-4">
              <span className="text-xs px-2 py-1 rounded-lg bg-surface border border-border text-text-muted">Elevation replay</span>
              <span className="text-xs px-2 py-1 rounded-lg bg-surface border border-border text-text-muted">Live metrics</span>
              <span className="text-xs px-2 py-1 rounded-lg bg-surface border border-border text-text-muted">Story export</span>
            </div>
          </button>

        </div>
      </div>
    </div>
  )
}

export default function HomePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-text-muted text-sm">Loading...</div>
      </div>
    }>
      <HomeContent />
    </Suspense>
  )
}
