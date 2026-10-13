import assert from 'node:assert/strict'
import test from 'node:test'
import { assessmentForZone, withZone } from '../lib/clearpath/zone-assessment.ts'

const ringZone = { x: 0.18, y: 0.5, width: 0.38, height: 0.42 }
const liveAssessment = { zone: ringZone, result: { status: 'none', confidence: 0.95 } }

test('sample preset changes cannot change the Ring assessment zone', () => {
  const zones = { sample: ringZone, ring: ringZone }
  const afterPreset = withZone(zones, 'sample', { x: 0.25, y: 0.55, width: 0.25, height: 0.35 })
  assert.notDeepEqual(afterPreset.sample, afterPreset.ring)
  assert.deepEqual(afterPreset.ring, zones.ring)
  assert.equal(assessmentForZone(liveAssessment, afterPreset.ring), liveAssessment.result)
})

test('a Ring assessment is unusable after the Ring zone changes', () => {
  const zones = { sample: ringZone, ring: ringZone }
  const afterRingRedraw = withZone(zones, 'ring', { x: 0.5, y: 0.55, width: 0.3, height: 0.35 })
  assert.deepEqual(afterRingRedraw.sample, zones.sample)
  assert.equal(assessmentForZone(liveAssessment, afterRingRedraw.ring), null)
  assert.equal(assessmentForZone(null, ringZone), null)
})
