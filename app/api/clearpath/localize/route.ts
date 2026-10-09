import { NextRequest, NextResponse } from 'next/server'
import { validateLocalization } from '@/lib/clearpath/localization'

export const runtime = 'nodejs'

const responseFormat = {
  type: 'json_schema',
  name: 'clearpath_localization',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      status: { type: 'string', enum: ['object', 'none', 'uncertain'] },
      category: { type: 'string', enum: ['parcel', 'movable_object', 'unknown'] },
      bounds: { anyOf: [
        { type: 'object', additionalProperties: false, properties: {
          x: { type: 'number' }, y: { type: 'number' },
          width: { type: 'number' }, height: { type: 'number' },
        }, required: ['x', 'y', 'width', 'height'] },
        { type: 'null' },
      ] },
      confidence: { type: 'number' },
      occluded: { type: 'boolean' },
    },
    required: ['status', 'category', 'bounds', 'confidence', 'occluded'],
  },
} as const

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  const key = process.env.OPENAI_API_KEY
  if (!key) return error('Object localization is not configured. Add OPENAI_API_KEY to the server environment.', 503)

  let form: FormData
  try { form = await request.formData() } catch { return error('Invalid frame upload.', 400) }
  const frame = form.get('frame')
  const capturedAt = Number(form.get('capturedAt'))
  const zone = String(form.get('zone') ?? '')
  if (!(frame instanceof File) || frame.type !== 'image/jpeg' || frame.size < 100 || frame.size > 4_000_000) {
    return error('Supply a JPEG frame smaller than 4 MB.', 400)
  }
  if (!Number.isSafeInteger(capturedAt) || capturedAt > Date.now() + 5_000 || Date.now() - capturedAt > 60_000) {
    return error('The captured frame is stale or has an invalid timestamp.', 400)
  }
  let zoneValue: unknown
  try { zoneValue = JSON.parse(zone) } catch { return error('Invalid protected zone.', 400) }
  if (!zoneValue || typeof zoneValue !== 'object') return error('Invalid protected zone.', 400)
  const z = zoneValue as Record<string, unknown>
  if (!(['x', 'y', 'width', 'height'] as const).every(k => typeof z[k] === 'number' && Number.isFinite(z[k]) && (z[k] as number) >= 0 && (z[k] as number) <= 1)
    || (z.x as number) + (z.width as number) > 1 || (z.y as number) + (z.height as number) > 1
    || (z.width as number) === 0 || (z.height as number) === 0) return error('Invalid protected zone.', 400)

  const base64 = Buffer.from(await frame.arrayBuffer()).toString('base64')
  let provider: Response
  try {
    provider = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.CLEARPATH_VISION_MODEL || 'gpt-4o',
        store: false,
        input: [{ role: 'user', content: [
          { type: 'input_text', text: `Inspect this Ring entrance frame. Protected zone in normalized full-frame coordinates: ${zone}. Localize the most relevant visible parcel or movable obstruction, even if outside the zone. Return status "object" and one tight normalized box if reliably visible. Return "none" only if the entire protected zone is visible and you can confidently see no movable obstruction there. Return "uncertain" for occlusion, poor image quality, ambiguity, or incomplete visibility. Confidence expresses your certainty in this classification, not a calibrated probability. Do not identify people or infer accessibility compliance.` },
          { type: 'input_image', image_url: `data:image/jpeg;base64,${base64}`, detail: 'high' },
        ] }],
        text: { format: responseFormat },
      }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch { return error('The localization service could not be reached.', 502) }
  if (!provider.ok) return error('The localization service rejected the frame.', 502)

  let response: unknown
  try { response = await provider.json() } catch { return error('The localization service returned invalid data.', 502) }
  const output = response as { status?: string; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> }
  if (output.status !== 'completed') return error('The localization service did not finish analyzing the frame.', 502)
  const text = output.output?.flatMap(item => item.content ?? []).find(item => item.type === 'output_text')?.text
  if (!text) return error('The localization service did not return a usable localization.', 502)
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return error('The localization service returned invalid localization JSON.', 502) }
  const validated = validateLocalization({ ...(parsed as object), frameTimestamp: capturedAt })
  if (!validated.valid) return error('The localization service returned unsafe coordinates or classification.', 502)
  return NextResponse.json(validated.result, { headers: { 'Cache-Control': 'no-store' } })
}
