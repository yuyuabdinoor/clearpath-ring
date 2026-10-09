'use client'

import { useState, useEffect, useMemo, useRef, PointerEvent } from 'react'
import { useVideoProcessing } from '@/lib/video-processors/useVideoProcessing'
import '@/lib/video-processors' // Register built-in processors

import { Header } from './components/Header'
import { EventPanel } from './components/EventPanel'
import { ProcessorPanel } from './components/ProcessorPanel'
import { useWebRTCStream } from './hooks/useWebRTCStream'
import { useEventStream } from './hooks/useEventStream'
import { useCanvasOverlay } from './hooks/useCanvasOverlay'
import {
  AccessState,
  NormalizedRect,
  decideAccessState,
} from '@/lib/clearpath/decision'

type RightPanelTab = 'events' | 'processors'
type AuthMode = 'access_token' | 'refresh_token' | null
type DrawMode = 'zone' | 'object'
type CapturedFrame = {
  url: string
  capturedAt: number
  width: number
  height: number
}

const statePresentation: Record<AccessState, { label: string; color: string; background: string }> = {
  zone_clear: { label: 'ZONE CLEAR', color: 'text-emerald-200', background: 'bg-emerald-500/15 border-emerald-400/40' },
  obstruction_detected: { label: 'OBSTRUCTION DETECTED', color: 'text-rose-200', background: 'bg-rose-500/15 border-rose-400/40' },
  review_needed: { label: 'REVIEW NEEDED', color: 'text-amber-200', background: 'bg-amber-500/15 border-amber-400/40' },
  camera_unavailable: { label: 'CAMERA UNAVAILABLE', color: 'text-slate-200', background: 'bg-slate-500/15 border-slate-400/40' },
}

export default function Dashboard() {
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('events')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [authMode, setAuthMode] = useState<AuthMode>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [drawMode, setDrawMode] = useState<DrawMode>('zone')
  const [protectedZone, setProtectedZone] = useState<NormalizedRect>({ x: 0.18, y: 0.5, width: 0.38, height: 0.42 })
  const [objectBox, setObjectBox] = useState<NormalizedRect | null>(null)
  const [objectConfidence, setObjectConfidence] = useState(0.92)
  const [occluded, setOccluded] = useState(false)
  const [cameraAvailable, setCameraAvailable] = useState(true)
  const [observedAt, setObservedAt] = useState(Date.now())
  const [capturedFrame, setCapturedFrame] = useState<CapturedFrame | null>(null)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Fetch auth mode on mount
  useEffect(() => {
    fetch('/api/ring/config')
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setAuthError(data.error)
        } else {
          setAuthMode(data.mode)
        }
      })
      .catch(err => setAuthError(err.message))
      .finally(() => setLoading(false))
  }, [])

  // Auto-discover device on mount (after auth mode is confirmed)
  useEffect(() => {
    if (!authMode) return
    fetch('/api/ring/devices')
      .then(res => res.json())
      .then(data => {
        if (data.devices && data.devices.length > 0) {
          setDeviceId(data.devices[0].id)
        } else {
          setDeviceError(data.error || 'No devices found')
        }
      })
      .catch(err => setDeviceError(err.message))
  }, [authMode])

  // Custom hooks
  const { streamActive, streamError, startStream, stopStream } = useWebRTCStream({ videoRef, deviceId })
  const { events, connected } = useEventStream({})
  const { processors, results, toggleProcessor, enabledCount } = useVideoProcessing({
    video: videoRef.current,
    canvas: canvasRef.current,
    enabled: streamActive,
    fps: 10,
  })

  // Canvas overlay rendering
  useCanvasOverlay({ videoRef, canvasRef, events, results })

  // Set webhook URL on mount
  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/webhook`)
  }, [])

  const isSimpleMode = authMode === 'access_token'

  const decision = useMemo(() => decideAccessState({
    observedAt,
    cameraAvailable: cameraAvailable && streamActive,
    object: objectBox,
    objectConfidence,
    occluded,
  }, {
    protectedZone,
    minimumObjectConfidence: 0.7,
    minimumOverlapRatio: 0.1,
    maximumEvidenceAgeMs: 60_000,
  }), [cameraAvailable, objectBox, objectConfidence, observedAt, occluded, protectedZone, streamActive])

  const presentation = statePresentation[decision.state]

  const normalizedPoint = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    }
  }

  const beginDrawing = (event: PointerEvent<HTMLDivElement>) => {
    dragStartRef.current = normalizedPoint(event)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const finishDrawing = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current
    if (!start) return
    const end = normalizedPoint(event)
    const rect = {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    }
    dragStartRef.current = null
    if (rect.width < 0.015 || rect.height < 0.015) return
    if (drawMode === 'zone') setProtectedZone(rect)
    else {
      setObjectBox(rect)
      setObservedAt(Date.now())
    }
  }

  const captureFrame = () => {
    const video = videoRef.current
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
      setCaptureError('Start the Ring stream and wait for a usable video frame.')
      return
    }

    const captureCanvas = document.createElement('canvas')
    captureCanvas.width = video.videoWidth
    captureCanvas.height = video.videoHeight
    const context = captureCanvas.getContext('2d')
    if (!context) {
      setCaptureError('The browser could not create a frame-capture context.')
      return
    }

    context.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height)
    captureCanvas.toBlob((blob) => {
      if (!blob) {
        setCaptureError('The current Ring frame could not be captured.')
        return
      }

      const capturedAt = Date.now()
      const url = URL.createObjectURL(blob)
      setCapturedFrame((previous) => {
        if (previous) URL.revokeObjectURL(previous.url)
        return { url, capturedAt, width: captureCanvas.width, height: captureCanvas.height }
      })
      setObservedAt(capturedAt)
      setCaptureError(null)
    }, 'image/jpeg', 0.9)
  }

  useEffect(() => () => {
    if (capturedFrame) URL.revokeObjectURL(capturedFrame.url)
  }, [capturedFrame])

  // Loading state
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-dash-bg">
        <p className="text-slate-400">Loading...</p>
      </div>
    )
  }

  // Auth error state
  if (authError) {
    return (
      <div className="h-screen flex items-center justify-center bg-dash-bg">
        <div className="text-center max-w-md">
          <p className="text-red-400 text-lg font-medium mb-2">Configuration Error</p>
          <p className="text-slate-400">{authError}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col">
      <Header
        connected={isSimpleMode ? false : connected}
        enabledCount={isSimpleMode ? 0 : enabledCount}
        simpleMode={isSimpleMode}
      />

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        <div className="w-[66%] p-4 flex flex-col">
          <div className="relative flex-1 bg-black rounded-xl overflow-hidden">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

            <div
              className="absolute inset-0 cursor-crosshair touch-none"
              onPointerDown={beginDrawing}
              onPointerUp={finishDrawing}
              aria-label={`Draw ${drawMode === 'zone' ? 'protected zone' : 'debug object box'}`}
            >
              <div
                className="absolute border-2 border-cyan-300 bg-cyan-300/15"
                style={{
                  left: `${protectedZone.x * 100}%`,
                  top: `${protectedZone.y * 100}%`,
                  width: `${protectedZone.width * 100}%`,
                  height: `${protectedZone.height * 100}%`,
                }}
              >
                <span className="absolute -top-7 left-0 rounded bg-cyan-950/90 px-2 py-1 text-[11px] font-semibold text-cyan-100">
                  Resident-defined access zone
                </span>
              </div>

              {objectBox && (
                <div
                  className="absolute border-2 border-amber-300 bg-amber-300/15"
                  style={{
                    left: `${objectBox.x * 100}%`,
                    top: `${objectBox.y * 100}%`,
                    width: `${objectBox.width * 100}%`,
                    height: `${objectBox.height * 100}%`,
                  }}
                >
                  <span className="absolute -top-7 right-0 rounded bg-amber-950/90 px-2 py-1 text-[11px] font-semibold text-amber-100">
                    Debug object · {Math.round(objectConfidence * 100)}%
                  </span>
                </div>
              )}
            </div>

            {!streamActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <button
                  onClick={startStream}
                  disabled={!deviceId}
                  className={`px-6 py-3 font-bold rounded-lg transition ${deviceId ? 'bg-dash-cyan text-black hover:bg-cyan-300' : 'bg-slate-600 text-slate-400 cursor-not-allowed'}`}
                >
                  {deviceId ? '▶ Start Live Stream' : '⏳ Discovering device...'}
                </button>
                {streamError && (
                  <p className="text-red-400 text-sm">{streamError}</p>
                )}
                {deviceError && (
                  <p className="text-red-400 text-sm">{deviceError}</p>
                )}
              </div>
            )}

            {streamActive && (
              <button
                onClick={stopStream}
                className="absolute top-3 right-3 px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-500"
              >
                ■ Stop
              </button>
            )}
          </div>

          {/* Webhook URL helper — only in full mode */}
          {!isSimpleMode && (
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
              <span>Webhook URL:</span>
              <code className="bg-dash-card px-2 py-1 rounded text-slate-300 flex-1 truncate">{webhookUrl}</code>
              <button
                onClick={() => navigator.clipboard.writeText(webhookUrl)}
                className="px-2 py-1 bg-dash-card rounded hover:bg-slate-600 text-slate-400"
              >
                Copy
              </button>
            </div>
          )}
        </div>

        <aside className="w-[34%] border-l border-slate-700 bg-slate-950/45 p-5 overflow-y-auto">
          <div className="mb-5">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">ClearPath calibration</p>
            <h1 className="mt-1 text-2xl font-semibold text-white">Is the resident&apos;s route clear?</h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">Draw normalized evidence regions over the real Ring stream. Manual object boxes are visibly labeled debug instrumentation.</p>
          </div>

          <section className={`rounded-xl border p-4 ${presentation.background}`}>
            <p className={`text-lg font-bold ${presentation.color}`}>{presentation.label}</p>
            <p className="mt-2 text-sm leading-5 text-slate-200">{decision.reason}</p>
            <div className="mt-3 flex justify-between text-xs text-slate-400">
              <span>Latest evidence</span>
              <span>{new Date(decision.observedAt).toLocaleTimeString()}</span>
            </div>
            {decision.overlapRatio !== null && (
              <div className="mt-1 flex justify-between text-xs text-slate-400">
                <span>Object overlap</span>
                <span>{Math.round(decision.overlapRatio * 100)}%</span>
              </div>
            )}
          </section>

          <section className="mt-4 rounded-xl border border-slate-700 bg-slate-900/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">Ring evidence</p>
                <p className="mt-1 text-xs text-slate-400">Captured locally from the active WHEP video element.</p>
              </div>
              <button onClick={captureFrame} disabled={!streamActive} className="rounded-lg bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500">Capture frame</button>
            </div>
            {captureError && <p className="mt-3 text-xs text-rose-300">{captureError}</p>}
            {capturedFrame && (
              <div className="mt-3 overflow-hidden rounded-lg border border-slate-700 bg-black">
                {/* Blob URL exists only in this browser session and is revoked when replaced. */}
                <img src={capturedFrame.url} alt="Latest transient Ring evidence frame" className="aspect-video w-full object-contain" />
                <div className="flex justify-between px-3 py-2 text-[11px] text-slate-400">
                  <span>{capturedFrame.width} × {capturedFrame.height}</span>
                  <span>{new Date(capturedFrame.capturedAt).toLocaleTimeString()}</span>
                </div>
              </div>
            )}
          </section>

          <section className="mt-4 rounded-xl border border-slate-700 bg-slate-900/70 p-4">
            <p className="text-sm font-semibold text-white">Calibration tools</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={() => setDrawMode('zone')} className={`rounded-lg px-3 py-2 text-sm ${drawMode === 'zone' ? 'bg-cyan-300 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>Draw access zone</button>
              <button onClick={() => setDrawMode('object')} className={`rounded-lg px-3 py-2 text-sm ${drawMode === 'object' ? 'bg-amber-300 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>Draw debug object</button>
            </div>
            <label className="mt-4 block text-xs text-slate-400">Debug object confidence: {Math.round(objectConfidence * 100)}%</label>
            <input className="mt-2 w-full accent-cyan-300" type="range" min="0" max="1" step="0.01" value={objectConfidence} onChange={(event) => { setObjectConfidence(Number(event.target.value)); setObservedAt(Date.now()) }} />
            <div className="mt-4 flex flex-col gap-2 text-sm text-slate-300">
              <label className="flex items-center justify-between"><span>Camera evidence available</span><input type="checkbox" checked={cameraAvailable} onChange={(event) => setCameraAvailable(event.target.checked)} /></label>
              <label className="flex items-center justify-between"><span>Protected zone occluded</span><input type="checkbox" checked={occluded} onChange={(event) => { setOccluded(event.target.checked); setObservedAt(Date.now()) }} /></label>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => { setObjectBox(null); setObservedAt(Date.now()) }} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700">No object visible</button>
              <button onClick={() => setObservedAt(Date.now())} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700">Refresh evidence</button>
            </div>
          </section>

          <p className="mt-4 text-xs leading-5 text-slate-500">This view reports visible overlap in the latest Ring evidence. It does not certify accessibility, safety, or legal clearance.</p>

          {!isSimpleMode && (
            <div className="mt-5 border-t border-slate-700 pt-4">
            {/* Tab switcher */}
            <div className="p-3 border-b border-slate-700 flex gap-2">
              <button
                onClick={() => setRightPanelTab('events')}
                className={`text-xs px-3 py-1 rounded-full ${rightPanelTab === 'events' ? 'bg-dash-cyan text-black font-medium' : 'bg-dash-card text-slate-400 hover:bg-slate-600'}`}
              >
                Events
              </button>
              <button
                onClick={() => setRightPanelTab('processors')}
                className={`text-xs px-3 py-1 rounded-full ${rightPanelTab === 'processors' ? 'bg-dash-cyan text-black font-medium' : 'bg-dash-card text-slate-400 hover:bg-slate-600'}`}
              >
                Processors {enabledCount > 0 && `(${enabledCount})`}
              </button>
            </div>

            {rightPanelTab === 'events' ? (
              <EventPanel events={events} webhookUrl={webhookUrl} />
            ) : (
              <ProcessorPanel processors={processors} results={results} onToggle={toggleProcessor} />
            )}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
