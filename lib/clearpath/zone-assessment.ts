import type { NormalizedRect } from './decision'

export type ZoneAssessment<T> = { zone: NormalizedRect; result: T }
export type ProtectedZones = { sample: NormalizedRect; ring: NormalizedRect }

export function withZone(zones: ProtectedZones, source: keyof ProtectedZones, zone: NormalizedRect): ProtectedZones {
  return { ...zones, [source]: zone }
}

export function assessmentForZone<T>(assessment: ZoneAssessment<T> | null, zone: NormalizedRect): T | null {
  if (!assessment) return null
  const analyzedZone = assessment.zone
  return analyzedZone.x === zone.x && analyzedZone.y === zone.y
    && analyzedZone.width === zone.width && analyzedZone.height === zone.height
    ? assessment.result : null
}
