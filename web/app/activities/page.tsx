'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import ActivityCard, { type Activity } from './ActivityCard'

export default function ActivitiesPage() {
  const router = useRouter()
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const session = localStorage.getItem('session')
      if (!session) { router.push('/'); return }
      try {
        const res = await fetch('/api/activities', {
          headers: { 'x-session': session },
        })
        if (res.status === 401) { localStorage.removeItem('session'); router.push('/'); return }
        if (!res.ok) throw new Error('Failed to fetch activities')
        const json = await res.json()
        setActivities(json.data)
      } catch {
        setError('Failed to load activities')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-text-muted text-sm">Loading activities...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-red-400 text-sm">{error}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border px-4 py-4 flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-sm">Activities</h1>
          <p className="text-text-muted text-xs">Tap an activity to export a summary card</p>
        </div>
        <button
          onClick={() => router.push('/dashboard')}
          className="text-text-secondary text-xs hover:text-white transition-colors"
        >
          Segments →
        </button>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4">
        {activities.length === 0 && (
          <div className="text-text-muted text-sm text-center py-12">No activities found</div>
        )}
        <div className="flex flex-col gap-3">
          {activities.map(activity => (
            <ActivityCard
              key={activity.id}
              activity={activity}
              onClick={() => router.push(`/activities/${activity.id}`)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
