import assert from 'node:assert/strict'
import test from 'node:test'
import { decideAccessState } from '../lib/clearpath/decision.ts'

const now = 1_700_000_000_000
const object = { x: 0.55, y: 0.61, width: 0.18, height: 0.2 }
const policy = {
  protectedZone: { x: 0.5, y: 0.55, width: 0.3, height: 0.35 },
  minimumObjectConfidence: 0.7,
  minimumOverlapRatio: 0.1,
  maximumEvidenceAgeMs: 60_000,
}
const evidence = { observedAt: now, cameraAvailable: true, object, objectConfidence: 0.95, occluded: false, zoneClearVerified: true }

test('sample parcel inside zone is an obstruction', () => {
  const result = decideAccessState(evidence, policy, now)
  assert.equal(result.state, 'obstruction_detected')
  assert.equal(result.overlapRatio, 1)
})

test('same parcel outside a resident-defined route is clear', () => {
  const result = decideAccessState(evidence, { ...policy, protectedZone: { x: 0.25, y: 0.55, width: 0.25, height: 0.35 } }, now)
  assert.equal(result.state, 'zone_clear')
  assert.equal(result.overlapRatio, 0)
})

test('weak localization requires review', () => {
  assert.equal(decideAccessState({ ...evidence, objectConfidence: 0.45 }, policy, now).state, 'review_needed')
})

test('no camera never claims clear', () => {
  assert.equal(decideAccessState({ ...evidence, cameraAvailable: false }, policy, now).state, 'camera_unavailable')
})

test('simulated removal needs fresh, confident evidence', () => {
  assert.equal(decideAccessState({ ...evidence, object: null }, policy, now).state, 'zone_clear')
  assert.equal(decideAccessState({ ...evidence, object: null, objectConfidence: 0 }, policy, now).state, 'review_needed')
  assert.equal(decideAccessState({ ...evidence, object: null }, policy, now + 60_001).state, 'review_needed')
})

test('outside object cannot prove entire zone clear by itself', () => {
  const outsidePolicy = { ...policy, protectedZone: { x: 0.25, y: 0.55, width: 0.25, height: 0.35 } }
  assert.equal(decideAccessState({ ...evidence, zoneClearVerified: false }, outsidePolicy, now).state, 'review_needed')
  assert.equal(decideAccessState({ ...evidence, object: null, zoneClearVerified: false }, policy, now).state, 'review_needed')
})

test('partial overlap below obstruction threshold requires review', () => {
  const edgePolicy = { ...policy, protectedZone: { x: 0.728, y: 0.55, width: 0.2, height: 0.35 } }
  const result = decideAccessState(evidence, edgePolicy, now)
  assert.equal(result.state, 'review_needed')
  assert.ok(result.overlapRatio > 0 && result.overlapRatio < policy.minimumOverlapRatio)
})
