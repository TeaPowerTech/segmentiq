interface Activity {
  id: string
  name: string
  type: string
  start_date: string
  distance: number
  moving_time: number
  total_elevation_gain: number
  average_speed: number
  average_heartrate: number | null
  average_watts: number | null
  device_watts: boolean
  achievement_count: number
  pr_count: number
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDistance(metres: number): string {
  return metres >= 1000
    ? `${(metres / 1000).toFixed(1)}km`
    : `${Math.round(metres)}m`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function activityIcon(type: string): string {
  switch (type.toLowerCase()) {
    case 'ride': case 'virtualride': return '🚴'
    case 'run': case 'virtualrun': return '🏃'
    case 'swim': return '🏊'
    case 'hike': return '🥾'
    case 'walk': return '🚶'
    default: return '⚡'
  }
}

export type { Activity }

export default function ActivityCard({ activity, onClick }: { activity: Activity; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="bg-surface border border-border rounded-2xl p-4 text-left hover:border-strava transition-colors w-full"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{activityIcon(activity.type)}</span>
          <div>
            <div className="text-white text-sm font-medium">{activity.name}</div>
            <div className="text-text-muted text-xs">{formatDate(activity.start_date)}</div>
          </div>
        </div>
        <div className="flex gap-2">
          {activity.pr_count > 0 && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
              {activity.pr_count} PR
            </span>
          )}
          {activity.achievement_count > 0 && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-strava/20 text-strava border border-strava/30">
              {activity.achievement_count} 🏆
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 mt-3">
        <div>
          <div className="text-text-muted text-xs mb-0.5">Distance</div>
          <div className="text-white text-sm font-medium">{formatDistance(activity.distance)}</div>
        </div>
        <div>
          <div className="text-text-muted text-xs mb-0.5">Time</div>
          <div className="text-white text-sm font-medium">{formatTime(activity.moving_time)}</div>
        </div>
        <div>
          <div className="text-text-muted text-xs mb-0.5">Elevation</div>
          <div className="text-white text-sm font-medium">{Math.round(activity.total_elevation_gain)}m</div>
        </div>
        <div>
          <div className="text-text-muted text-xs mb-0.5">Avg speed</div>
          <div className="text-white text-sm font-medium">{(activity.average_speed * 3.6).toFixed(1)} km/h</div>
        </div>
      </div>

      {(activity.average_heartrate || activity.average_watts) && (
        <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-border">
          {activity.average_heartrate && (
            <div className="text-text-muted text-xs">
              ♥ <span className="text-white">{Math.round(activity.average_heartrate)} bpm</span>
            </div>
          )}
          {activity.average_watts && (
            <div className="text-text-muted text-xs">
              ⚡ <span className="text-white">{Math.round(activity.average_watts)}W{!activity.device_watts ? ' est.' : ''}</span>
            </div>
          )}
        </div>
      )}
    </button>
  )
}
