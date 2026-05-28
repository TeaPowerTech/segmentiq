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
