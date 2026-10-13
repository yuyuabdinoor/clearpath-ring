import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))

async function availablePort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

test('Ring routes do not expose or forward the bearer token to a caller URL', { timeout: 45_000 }, async () => {
  const port = await availablePort()
  const secret = 'test-ring-secret-never-return-this'
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(port)], {
    cwd: projectRoot,
    env: { ...process.env, RING_ACCESS_TOKEN: secret, RING_REFRESH_TOKEN: '' },
    stdio: 'ignore',
  })

  try {
    const origin = `http://127.0.0.1:${port}`
    let ready = false
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null || server.signalCode !== null) throw new Error('Next.js exited before startup')
      try {
        const response = await fetch(`${origin}/api/ring/config`)
        if (response.ok) { ready = true; break }
      } catch { /* Still starting. */ }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    assert.ok(ready, 'Next.js started')

    const tokenResponse = await fetch(`${origin}/api/ring/token`)
    assert.equal(tokenResponse.status, 404)
    assert.ok(!(await tokenResponse.text()).includes(secret))

    const arbitraryUrl = 'http://127.0.0.1:1/collect'
    const deleteResponse = await fetch(`${origin}/api/ring/stream`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionUrl: arbitraryUrl }),
    })
    assert.equal(deleteResponse.status, 400)
    assert.ok(!(await deleteResponse.text()).includes(secret))

    const unknownSession = await fetch(`${origin}/api/ring/stream`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'unknown-session', sessionUrl: arbitraryUrl }),
    })
    assert.equal(unknownSession.status, 404)
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill()
      await new Promise((resolve) => server.once('exit', resolve))
    }
  }
})
