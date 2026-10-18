import assert from 'node:assert/strict'
import test from 'node:test'
import { isRelevantMotionEvent } from '../lib/clearpath/motion-events.ts'

const openedAt = Date.parse('2026-10-17T12:00:00.000Z')
const now = openedAt + 20_000
const event = { event_type: 'motion_detected', device_id: 'front-door', timestamp: new Date(openedAt + 10_000).toISOString() }

test('recent motion from the selected camera invalidates earlier evidence', () => {
  assert.equal(isRelevantMotionEvent(event, 'front-door', openedAt, now), true)
  assert.equal(isRelevantMotionEvent({ ...event, event_type: 'person_detected' }, 'front-door', openedAt, now), true)
})

test('replayed, unrelated, and malformed events do not invalidate evidence', () => {
  assert.equal(isRelevantMotionEvent({ ...event, timestamp: new Date(openedAt - 1).toISOString() }, 'front-door', openedAt, now), false)
  assert.equal(isRelevantMotionEvent({ ...event, device_id: 'back-door' }, 'front-door', openedAt, now), false)
  assert.equal(isRelevantMotionEvent({ ...event, event_type: 'on_demand' }, 'front-door', openedAt, now), false)
  assert.equal(isRelevantMotionEvent({ ...event, timestamp: 'not-a-date' }, 'front-door', openedAt, now), false)
  assert.equal(isRelevantMotionEvent({ ...event, timestamp: new Date(now + 10_000).toISOString() }, 'front-door', openedAt, now), false)
})
