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
    averageSpeedKph: effort.average_speed * 3.6,
    prRank: effort.pr_rank ?? null,
    hasPower,
    points,
    segment: {
      segmentId: String(effort.segment.id),
      name: effort.segment.name,
      distanceMetres: effort.segment.distance,
      averageGradePct: effort.segment.average_grade,
      totalElevationGainMetres: effort.segment.total_elevation_gain,
      climbCategory: effort.segment.climb_category,
    },
  }
}

export function computeComparison(
  effortA: NormalisedEffort,
  effortB: NormalisedEffort
): {
  heartRate: (number | null)[]
  speedKph: number[]
  powerWatts: (number | null)[]
  totalTimeDeltaSeconds: number
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
  distanceMetres: number
  lat: number
  lng: number
  speedMs: number
  altitudeMetres: number
  heartRate: number | null
  powerWatts: number | null
}

function buildRawPoint
