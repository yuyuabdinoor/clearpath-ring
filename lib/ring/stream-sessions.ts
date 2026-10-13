import { randomUUID } from 'node:crypto'

const sessions = new Map<string, string>()

// Only retain session URLs returned beneath the Ring WHEP endpoint used to create them.
export function registerStreamSession(location: string | null, endpoint: string): string | null {
  if (!location) return null

  try {
    const base = new URL(endpoint)
    const session = new URL(location, base)
    if (base.protocol !== 'https:' || base.origin !== 'https://api.amazonvision.com'
      || session.origin !== base.origin
      || !session.pathname.startsWith(`${base.pathname}/`)) return null

    const id = randomUUID()
    sessions.set(id, session.toString())
    return id
  } catch {
    return null
  }
}

export function takeStreamSession(id: unknown): string | null {
  if (typeof id !== 'string') return null
  const url = sessions.get(id) ?? null
  sessions.delete(id)
  return url
}
