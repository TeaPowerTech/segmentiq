import type {
  NormalisedEffort,
  EffortPoint,
  StravaStreamSet,
  StravaEffortSummary,
} from './types'

import { NORMALISED_POINT_COUNT } from './types'

export class NormaliseError extends Error {
  constructor(message: string) {
    super(`normalise: ${message}`)
    this.name = 'NormaliseError'
  }
}

export function normaliseEffort(
  effort: StravaEffortSummary,
  streams: StravaStreamSet,
  athleteWeightKg: number | null
): NormalisedEffort {
  validateStreams(streams)
  const rawPoints = buildRawPoints(streams)
  const interpolated = interpolateToFixedPoints(rawPoints, NORMALISED_POINT_COUNT)
  const points = computeDerivedFields(interpolated, athleteWeightKg)
  const hasPower = streams.watts != null &&
    streams.watts.data.some((w: any) => w != null && w > 0)

  return {
    effortId: String(effort.id),
    segmentId: String(effort.segment.id),
    athleteId: 0,
    startDate: effort.start_date,
    elapsedSeconds: effort.elapsed_time,
    movingSeconds: effort.moving_time,
    totalDistanceMetres: effort.distance,
    averageHeartRate: effort.average_heartrate ?? null,
    averagePowerWatts: effort.average_watts ?? null,
    averageSpeedKph: effort.distance / effort.elapsed_time * 3.6,
    prRank: effort.pr_rank ?? null,
    hasPower,
    points,
    segment: {
      segmentId: String(effort.segment.id),
      name: effort.segment.name,
      distanceMetres: effort.segment.distance,
      averageGradePct: effort.segment.average_grade,
      totalElevationGainMetres: effort.segment.total_elevation_gain ?? 0,
      climbCategory: effort.segment.climb_category,
    },
  }
}

export function computeComparison(
  effortA: NormalisedEffort,
  effortB: NormalisedEffort
): {
  heartRate: (number | null)[];
  speedKph: number[];
  powerWatts: (number | null)[];
  totalTimeDeltaSeconds: number;
} {
  if (
    effortA.points.length !== NORMALISED_POINT_COUNT ||
    effortB.points.length !== NORMALISED_POINT_COUNT
  ) {
    throw new NormaliseError(
      `both efforts must have ${NORMALISED_POINT_COUNT} points`
    )
  }

  const heartRate = effortA.points.map((a: any, i: number) => {
    const b = effortB.points[i]
    if (a.heartRate == null || b.heartRate == null) return null
    return a.heartRate - b.heartRate
  })

  const speedKph = effortA.points.map((a: any, i: number) =>
    Math.round((a.speedKph - effortB.points[i].speedKph) * 10) / 10
  )

  const powerWatts = effortA.points.map((a: any, i: number) => {
    const b = effortB.points[i]
    if (a.powerWatts == null || b.powerWatts == null) return null
    return a.powerWatts - b.powerWatts
  })

  return {
    heartRate,
    speedKph,
    powerWatts,
    totalTimeDeltaSeconds: effortA.elapsedSeconds - effortB.elapsedSeconds,
  }
}

function validateStreams(streams: StravaStreamSet): void {
  if (!streams.latlng?.data?.length)
    throw new NormaliseError('latlng stream is required and must not be empty')
  if (!streams.distance?.data?.length)
    throw new NormaliseError('distance stream is required and must not be empty')
  if (!streams.velocity_smooth?.data?.length)
    throw new NormaliseError('velocity_smooth stream is required and must not be empty')
  if (!streams.altitude?.data?.length)
    throw new NormaliseError('altitude stream is required and must not be empty')

  const baseLen = streams.latlng.data.length
  const checks: [string, number][] = [
    ['distance', streams.distance.data.length],
    ['velocity_smooth', streams.velocity_smooth.data.length],
    ['altitude', streams.altitude.data.length],
  ]
  if (streams.heartrate) checks.push(['heartrate', streams.heartrate.data.length])
  if (streams.watts) checks.push(['watts', streams.watts.data.length])

  for (const [name, len] of checks) {
    if (len !== baseLen)
      throw new NormaliseError(
        `stream length mismatch: latlng has ${baseLen} points but ${name} has ${len} points`
      )
  }

  if (baseLen < 2)
    throw new NormaliseError('streams must have at least 2 data points')
}

interface RawPoint {
  distanceMetres: number;
  lat: number;
  lng: number;
  speedMs: number;
  altitudeMetres: number;
  heartRate: number | null;
  powerWatts: number | null;
}

function buildRawPoints(streams: StravaStreamSet): RawPoint[] {
  // Offset distance by the first point so distance starts at 0.
  // The stream is sliced from start_index to end_index of the full activity,
  // so absolute distances start at whatever offset that segment begins at
  // in the activity. Without this offset the interpolator spreads 200 points
  // across the full activity distance range, placing most points before the
  // segment even starts.
  const distanceOffset = streams.distance!.data[0]

  return Array.from({ length: streams.latlng!.data.length }, (_, i) => ({
    distanceMetres: streams.distance!.data[i] - distanceOffset,
    lat: streams.latlng!.data[i][0],
    lng: streams.latlng!.data[i][1],
    speedMs: streams.velocity_smooth!.data[i],
    altitudeMetres: streams.altitude!.data[i],
    heartRate: streams.heartrate?.data[i] ?? null,
    powerWatts: streams.watts?.data[i] ?? null,
  }))
}

function interpolateToFixedPoints(
  rawPoints: RawPoint[],
  targetCount: number
): RawPoint[] {
  const totalDistance = rawPoints[rawPoints.length - 1].distanceMetres
  if (totalDistance <= 0)
    throw new NormaliseError('total distance must be greater than 0')

  const result: RawPoint[] = []

  for (let i = 0; i < targetCount; i++) {
    const targetDist = (i / (targetCount - 1)) * totalDistance
    const { lower, upper, t } = findBracket(rawPoints, targetDist)
    result.push({
      distanceMetres: targetDist,
      lat: lerp(lower.lat, upper.lat, t),
      lng: lerp(lower.lng, upper.lng, t),
      speedMs: lerp(lower.speedMs, upper.speedMs, t),
      altitudeMetres: lerp(lower.altitudeMetres, upper.altitudeMetres, t),
      heartRate: lerpNullable(lower.heartRate, upper.heartRate, t),
      powerWatts: lerpNullable(lower.powerWatts, upper.powerWatts, t),
    })
  }

  return result
}

interface Bracket {
  lower: RawPoint;
  upper: RawPoint;
  t: number;
}

function findBracket(points: RawPoint[], targetDist: number): Bracket {
  if (targetDist <= points[0].distanceMetres)
    return { lower: points[0], upper: points[0], t: 0 }
  if (targetDist >= points[points.length - 1].distanceMetres) {
    const last = points[points.length - 1]
    return { lower: last, upper: last, t: 0 }
  }

  let lo = 0
  let hi = points.length - 1

  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1
    if (points[mid].distanceMetres <= targetDist) lo = mid
    else hi = mid
  }

  const lower = points[lo]
  const upper = points[hi]
  const span = upper.distanceMetres - lower.distanceMetres
  const t = span === 0 ? 0 : (targetDist - lower.distanceMetres) / span

  return { lower, upper, t }
}

function computeDerivedFields(
  points: RawPoint[],
  athleteWeightKg: number | null
): EffortPoint[] {
  const baseAltitude = points[0].altitudeMetres

  return points.map((p, i) => {
    const distancePct = i / (NORMALISED_POINT_COUNT - 1)
    const elevationGainMetres = Math.max(0, p.altitudeMetres - baseAltitude)
    const speedKph = p.speedMs * 3.6
    const wPerKg =
      p.powerWatts != null && athleteWeightKg != null && athleteWeightKg > 0
        ? p.powerWatts / athleteWeightKg
        : null

    return {
      distancePct,
      distanceMetres: p.distanceMetres,
      lat: p.lat,
      lng: p.lng,
      heartRate: p.heartRate != null ? Math.round(p.heartRate) : null,
      speedKph: Math.round(speedKph * 10) / 10,
      powerWatts: p.powerWatts != null ? Math.round(p.powerWatts) : null,
      wPerKg: wPerKg != null ? Math.round(wPerKg * 100) / 100 : null,
      elevationGainMetres: Math.round(elevationGainMetres * 10) / 10,
      elevationMetres: Math.round(p.altitudeMetres * 10) / 10,
    }
  })
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpNullable(
  a: number | null,
  b: number | null,
  t: number
): number | null {
  if (a == null || b == null) return null
  return lerp(a, b, t)
}
// ─── Activity normalisation ───────────────────────────────────────────────────

export interface ActivityPoint {
  distancePct: number
  distanceMetres: number
  elevationMetres: number
  elevationGainMetres: number
  heartRate: number | null
  speedKph: number
  powerWatts: number | null
  cadence: number | null
}

export interface NormalisedActivity {
  activityId: string
  name: string
  startDate: string
  movingTimeSeconds: number
  elapsedTimeSeconds: number
  distanceMetres: number
  totalElevationGain: number
  averageHeartRate: number | null
  maxHeartRate: number | null
  averageSpeedKph: number | null
  maxSpeedKph: number | null
  averagePowerWatts: number | null
  normalisedPowerWatts: number | null
  averageCadence: number | null
  hasPower: boolean
  type: string
  points: ActivityPoint[]
}

const ACTIVITY_POINTS = 200

export function normaliseActivity(
  activity: any,
  streams: any,
  athleteWeightKg: number | null
): NormalisedActivity {
  const distance = streams.distance?.data ?? []
  const altitude = streams.altitude?.data ?? []
  const heartrate = streams.heartrate?.data ?? []
  const watts = streams.watts?.data ?? []
  const velocity = streams.velocity_smooth?.data ?? []
  const cadence = streams.cadence?.data ?? []

  const totalDist = distance[distance.length - 1] ?? activity.distance ?? 0
  const n = distance.length

  if (n < 2) throw new NormaliseError('Insufficient stream data for activity')

  const points: ActivityPoint[] = []
  let elevGainSoFar = 0

  for (let i = 0; i < ACTIVITY_POINTS; i++) {
    const idx = Math.min(Math.floor((i / (ACTIVITY_POINTS - 1)) * (n - 1)), n - 2)
    const prevIdx = i === 0 ? 0 : Math.floor(((i - 1) / (ACTIVITY_POINTS - 1)) * (n - 1))

    const distM = distance[idx] ?? 0
    const elevM = altitude[idx] ?? 0

    if (i > 0 && altitude[idx] != null && altitude[prevIdx] != null) {
      const elevDiff = (altitude[idx] ?? 0) - (altitude[prevIdx] ?? 0)
      if (elevDiff > 0) elevGainSoFar += elevDiff
    }

    const speedMs = velocity[idx] ?? 0
    const hr = heartrate[idx] != null ? Math.round(heartrate[idx]) : null
    const pw = watts[idx] != null ? Math.round(watts[idx]) : null
    const cad = cadence[idx] != null ? Math.round(cadence[idx]) : null

    points.push({
      distancePct: totalDist > 0 ? distM / totalDist : i / (ACTIVITY_POINTS - 1),
      distanceMetres: distM,
      elevationMetres: elevM,
      elevationGainMetres: elevGainSoFar,
      heartRate: hr,
      speedKph: speedMs * 3.6,
      powerWatts: pw,
      cadence: cad,
    })
  }

  // Normalised power
  let normalisedPower: number | null = null
  if (watts.length > 30) {
    const windowSize = Math.min(30, Math.floor(watts.length / 10))
    const rolling: number[] = []
    for (let i = windowSize - 1; i < watts.length; i++) {
      const window = watts.slice(i - windowSize + 1, i + 1)
      rolling.push(window.reduce((s: number, v: number) => s + v, 0) / window.length)
    }
    if (rolling.length > 0) {
      const mean4th = rolling.reduce((s, v) => s + Math.pow(v, 4), 0) / rolling.length
      normalisedPower = Math.round(Math.pow(mean4th, 0.25))
    }
  }

  return {
    activityId: String(activity.id),
    name: activity.name,
    startDate: activity.start_date,
    movingTimeSeconds: activity.moving_time,
    elapsedTimeSeconds: activity.elapsed_time,
    distanceMetres: activity.distance,
    totalElevationGain: activity.total_elevation_gain,
    averageHeartRate: activity.average_heartrate ?? null,
    maxHeartRate: activity.max_heartrate ?? null,
    averageSpeedKph: activity.average_speed != null ? activity.average_speed * 3.6 : null,
    maxSpeedKph: activity.max_speed != null ? activity.max_speed * 3.6 : null,
    averagePowerWatts: activity.average_watts ?? null,
    normalisedPowerWatts: normalisedPower,
    averageCadence: activity.average_cadence ?? null,
    hasPower: activity.device_watts === true,
    type: activity.type ?? 'Ride',
    points,
  }
}
