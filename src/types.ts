// ─── Raw Strava API types ─────────────────────────────────────────────────────

export interface StravaStreamSet {
  latlng?: StravaStream<[number, number]>
  distance?: StravaStream<number>
  heartrate?: StravaStream<number>
  watts?: StravaStream<number>
  velocity_smooth?: StravaStream<number>
  altitude?: StravaStream<number>
  cadence?: StravaStream<number>
}

export interface StravaStream<T> {
  data: T[]
  series_type: 'distance' | 'time'
  original_size: number
  resolution: 'low' | 'medium' | 'high'
}

export interface StravaEffortSummary {
  id: number
  name: string
  activity: { id: number }
  elapsed_time: number
  moving_time: number
  start_date: string
  distance: number
  start_index: number
  end_index: number
  segment: StravaSegmentSummary
  average_heartrate?: number
  average_watts?: number
  average_speed: number
  pr_rank?: number | null
  kom_rank?: number | null
}

export interface StravaSegmentSummary {
  id: number
  name: string
  distance: number
  average_grade: number
  maximum_grade: number
  elevation_high: number
  elevation_low: number
  total_elevation_gain: number
  city?: string
  country?: string
  climb_category: 0 | 1 | 2 | 3 | 4
  starred: boolean
}

// ─── Normalised application types ─────────────────────────────────────────────

export const NORMALISED_POINT_COUNT = 200

export interface EffortPoint {
  distancePct: number
  distanceMetres: number
  lat: number
  lng: number
  heartRate: number | null
  speedKph: number
  powerWatts: number | null
  wPerKg: number | null
  elevationGainMetres: number
  elevationMetres: number
}

export interface NormalisedEffort {
  effortId: string
  segmentId: string
  athleteId: number
  startDate: string
  elapsedSeconds: number
  movingSeconds: number
  totalDistanceMetres: number
  averageHeartRate: number | null
  averagePowerWatts: number | null
  averageSpeedKph: number
  prRank: number | null
  points: EffortPoint[]
  segment: NormalisedSegment
  hasPower: boolean
}

export interface NormalisedSegment {
  segmentId: string
  name: string
  distanceMetres: number
  averageGradePct: number
  totalElevationGainMetres: number
  climbCategory: 0 | 1 | 2 | 3 | 4
}

export interface ApiResponse<T> {
  data: T
  cachedAt: number | null
  cacheHit: boolean
}

export interface ApiError {
  error: string
  code: 'STRAVA_RATE_LIMITED' | 'STRAVA_AUTH_EXPIRED' | 'EFFORT_NOT_FOUND' | 'INTERNAL_ERROR'
}

export interface EffortComparison {
  effortA: NormalisedEffort
  effortB: NormalisedEffort
  deltas: ComparisonDeltas
}

export interface ComparisonDeltas {
  heartRate: (number | null)[]
  speedKph: number[]
  powerWatts: (number | null)[]
  totalTimeDeltaSeconds: number
}

export interface AthleteProfile {
  athleteId: number
  firstname: string
  lastname: string
  weightKg: number | null
  profileImageUrl: string | null
}
