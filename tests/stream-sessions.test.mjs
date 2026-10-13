import assert from 'node:assert/strict'
import test from 'node:test'
import { registerStreamSession, takeStreamSession } from '../lib/ring/stream-sessions.ts'

const endpoint = 'https://api.amazonvision.com/v1/devices/camera-1/media/streaming/whep/sessions'

test('Ring WHEP locations become one-use opaque session IDs', () => {
  const ringUrl = `${endpoint}/session-1`
  const id = registerStreamSession(ringUrl, endpoint)
  assert.match(id, /^[0-9a-f-]{36}$/)
  assert.notEqual(id, ringUrl)
  assert.equal(takeStreamSession(id), ringUrl)
  assert.equal(takeStreamSession(id), null)
})

test('a relative WHEP location stays on the Ring session endpoint', () => {
  const id = registerStreamSession('sessions/session-2', endpoint)
  assert.ok(id)
  assert.equal(takeStreamSession(id), `${endpoint}/session-2`)
})

test('external and unrelated URLs never enter the session store', () => {
  for (const location of [
    'https://attacker.example/collect',
    'https://api.amazonvision.com.attacker.example/collect',
    'http://api.amazonvision.com/v1/devices/camera-1/media/streaming/whep/sessions/session-1',
    'https://api.amazonvision.com/v1/users/me',
    `${endpoint}/../other`,
  ]) {
    assert.equal(registerStreamSession(location, endpoint), null, location)
  }
  assert.equal(takeStreamSession('https://attacker.example/collect'), null)
})
