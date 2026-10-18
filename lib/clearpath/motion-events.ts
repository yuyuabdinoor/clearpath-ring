export type MotionEvent = {
  event_type: string
  timestamp: string
  device_id?: string | null
}

/** Only recent motion from the selected camera can invalidate its visual assessment. */
export function isRelevantMotionEvent(
  event: MotionEvent,
  deviceId: string,
  pageOpenedAt: number,
  now = Date.now(),
): boolean {
  if (event.event_type !== 'motion_detected' && event.event_type !== 'person_detected') return false
  if (event.device_id !== deviceId) return false
  const eventAt = Date.parse(event.timestamp)
  return Number.isFinite(eventAt) && eventAt >= pageOpenedAt && eventAt <= now + 5_000
}
