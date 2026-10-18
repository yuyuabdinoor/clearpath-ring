export type AccessState =
  | 'zone_clear'
  | 'obstruction_detected'
  | 'review_needed'
  | 'camera_unavailable'

export type NormalizedRect = {
  x: number
  y: number
  width: number
  height: number
}

export type VisualEvidence = {
  observedAt: number
  cameraAvailable: boolean
  object: NormalizedRect | null
  objectConfidence: number
  occluded: boolean
  zoneClearVerified?: boolean
}

export type AccessPolicy = {
  protectedZone: NormalizedRect
  minimumObjectConfidence: number
  minimumOverlapRatio: number
  maximumEvidenceAgeMs: number
}

export type AccessDecision = {
  state: AccessState
  overlapRatio: number | null
  reason: string
  observedAt: number
}

function area(rect: NormalizedRect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height)
}

export function intersectionArea(a: NormalizedRect, b: NormalizedRect): number {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)

  return Math.max(0, right - left) * Math.max(0, bottom - top)
}

export function decideAccessState(
  evidence: VisualEvidence,
  policy: AccessPolicy,
  now = Date.now(),
): AccessDecision {
  if (!evidence.cameraAvailable) {
    return {
      state: 'camera_unavailable',
      overlapRatio: null,
      reason: 'The Ring camera cannot currently provide usable evidence.',
      observedAt: evidence.observedAt,
    }
  }

  if (now - evidence.observedAt > policy.maximumEvidenceAgeMs) {
    return {
      state: 'review_needed',
      overlapRatio: null,
      reason: evidence.observedAt === 0
        ? 'Capture and analyze a Ring frame before assessing the access zone.'
        : 'The latest usable Ring view is too old to describe the current entrance state.',
      observedAt: evidence.observedAt,
    }
  }

  if (evidence.occluded) {
    return {
      state: 'review_needed',
      overlapRatio: null,
      reason: 'The protected zone is occluded in the latest view.',
      observedAt: evidence.observedAt,
    }
  }

  if (!evidence.object) {
    if (evidence.objectConfidence < policy.minimumObjectConfidence) {
      return {
        state: 'review_needed', overlapRatio: null,
        reason: 'No obstruction was localized, but confidence is too low to confirm the zone is clear.',
        observedAt: evidence.observedAt,
      }
    }
    if (!evidence.zoneClearVerified) {
      return {
        state: 'review_needed', overlapRatio: null,
        reason: 'The entire protected zone has not been verified clear.',
        observedAt: evidence.observedAt,
      }
    }
    return {
      state: 'zone_clear',
      overlapRatio: 0,
      reason: 'No movable obstruction is visible inside the protected zone in the latest usable view.',
      observedAt: evidence.observedAt,
    }
  }

  if (evidence.objectConfidence < policy.minimumObjectConfidence) {
    return {
      state: 'review_needed',
      overlapRatio: null,
      reason: 'An object may be present, but the visual evidence is not reliable enough for an automatic decision.',
      observedAt: evidence.observedAt,
    }
  }

  const objectArea = area(evidence.object)
  const overlapRatio = objectArea === 0
    ? 0
    : intersectionArea(evidence.object, policy.protectedZone) / objectArea

  if (overlapRatio >= policy.minimumOverlapRatio) {
    return {
      state: 'obstruction_detected',
      overlapRatio,
      reason: 'A newly visible object materially overlaps the resident-defined access zone.',
      observedAt: evidence.observedAt,
    }
  }

  if (overlapRatio > 0) {
    return {
      state: 'review_needed', overlapRatio,
      reason: 'An object partly overlaps the access zone, below the obstruction threshold.',
      observedAt: evidence.observedAt,
    }
  }

  if (!evidence.zoneClearVerified) {
    return {
      state: 'review_needed', overlapRatio,
      reason: 'This object is outside the zone, but the entire zone has not been verified clear.',
      observedAt: evidence.observedAt,
    }
  }

  return {
    state: 'zone_clear',
    overlapRatio,
    reason: 'The detected object remains outside the protected access zone.',
    observedAt: evidence.observedAt,
  }
}
