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
import { LocalizationResult, validateLocalization } from '@/lib/clearpath/localization'
import { assessmentForZone, withZone, ProtectedZones, ZoneAssessment } from '@/lib/clearpath/zone-assessment'
import { isRelevantMotionEvent } from '@/lib/clearpath/motion-events'

type RightPanelTab = 'events' | 'processors'
type AuthMode = 'access_token' | 'refresh_token' | null
type DrawMode = 'zone' | 'object'
type SourceMode = 'sample' | 'ring'
type SampleCase = 'clear' | 'obstructed' | 'review' | 'unavailable' | 'removed'
type CapturedFrame = {
  url: string
  blob: Blob
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

const sampleObject: NormalizedRect = { x: 0.55, y: 0.61, width: 0.18, height: 0.2 }
const clearZone: NormalizedRect = { x: 0.25, y: 0.55, width: 0.25, height: 0.35 }
const obstructedZone: NormalizedRect = { x: 0.5, y: 0.55, width: 0.3, height: 0.35 }

export default function Dashboard() {
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('events')
  const [sourceMode, setSourceMode] = useState<SourceMode>('sample')
  const [sampleCase, setSampleCase] = useState<SampleCase>('obstructed')
  const [sampleObservedAt, setSampleObservedAt] = useState(Date.now())
  const [webhookUrl, setWebhookUrl] = useState('')
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [authMode, setAuthMode] = useState<AuthMode>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [drawMode, setDrawMode] = useState<DrawMode>('zone')
  const [zones, setZones] = useState<ProtectedZones>({
    sample: obstructedZone,
    ring: { x: 0.18, y: 0.5, width: 0.38, height: 0.42 },
  })
  const [objectBox, setObjectBox] = useState<NormalizedRect | null>(null)
  const [objectConfidence, setObjectConfidence] = useState(0.92)
  const [occluded, setOccluded] = useState(false)
  const [cameraAvailable, setCameraAvailable] = useState(true)
  const [observedAt, setObservedAt] = useState(Date.now())
  const [capturedFrame, setCapturedFrame] = useState<CapturedFrame | null>(null)
  const [liveAssessment, setLiveAssessment] = useState<ZoneAssessment<LocalizationResult> | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [rechecking, setRechecking] = useState(false)
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)
  const [alertStatus, setAlertStatus] = useState<string | null>(null)
  const [motionEvent, setMotionEvent] = useState<{ receivedAt: number; simulated: boolean } | null>(null)
  const [now, setNow] = useState(Date.now())
  const [videoViewport, setVideoViewport] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const analysisGenerationRef = useRef(0)
  const obstructionObservedAtRef = useRef<number | null>(null)
  const lastAlertedFrameRef = useRef(0)
  const pageOpenedAtRef = useRef(Date.now())
  const seenEventIdsRef = useRef(new Set<string>())

  const videoRef = useRef<HTMLVideoElement>(null)
  const videoContainerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    const container = videoContainerRef.current
    if (!video || !container) return
    const update = () => {
      if (sourceMode === 'sample') {
        const scale = Math.min(container.clientWidth / 1280, container.clientHeight / 720)
        const width = 1280 * scale
        const height = 720 * scale
        setVideoViewport({ left: (container.clientWidth - width) / 2, top: (container.clientHeight - height) / 2, width, height })
        return
      }
      if (!video.videoWidth || !video.videoHeight) {
        setVideoViewport(null)
        return
      }
      const scale = Math.min(container.clientWidth / video.videoWidth, container.clientHeight / video.videoHeight)
      const width = video.videoWidth * scale
      const height = video.videoHeight * scale
      setVideoViewport({ left: (container.clientWidth - width) / 2, top: (container.clientHeight - height) / 2, width, height })
    }
    const observer = new ResizeObserver(update)
    observer.observe(container)
    video.addEventListener('loadedmetadata', update)
    update()
    return () => { observer.disconnect(); video.removeEventListener('loadedmetadata', update) }
  }, [loading, authError, sourceMode])

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

  useEffect(() => {
    if (!deviceId) return
    for (const event of events) {
      if (seenEventIdsRef.current.has(event.event_id)) continue
      seenEventIdsRef.current.add(event.event_id)
      if (isRelevantMotionEvent(event, deviceId, pageOpenedAtRef.current)) {
        setMotionEvent({ receivedAt: Date.now(), simulated: event.metadata?.simulated === true })
      }
    }
  }, [deviceId, events])
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
  const { sample: sampleZone, ring: ringZone } = zones
  const protectedZone = sourceMode === 'sample' ? sampleZone : ringZone
  const localization = assessmentForZone(liveAssessment, ringZone)

  const decision = useMemo(() => {
    if (cameraAvailable && streamActive && motionEvent && (!localization || localization.frameTimestamp <= motionEvent.receivedAt)) {
      return {
        state: 'review_needed' as const,
        overlapRatio: null,
        reason: 'New entrance activity occurred after the last analysis. Capture and analyze a fresh frame before relying on the route state.',
        observedAt: localization?.frameTimestamp ?? 0,
      }
    }
    return decideAccessState({
    observedAt: localization?.frameTimestamp ?? 0,
    cameraAvailable: cameraAvailable && streamActive,
    object: localization?.status === 'object' ? localization.bounds : null,
    objectConfidence: localization?.status === 'uncertain' || localization?.category === 'unknown' ? 0 : localization?.confidence ?? 0,
    occluded: occluded || localization?.occluded === true,
    zoneClearVerified: localization?.zoneClearVerified === true,
  }, {
    protectedZone: ringZone,
    minimumObjectConfidence: 0.7,
    minimumOverlapRatio: 0.1,
    maximumEvidenceAgeMs: 60_000,
  }, now)
  }, [cameraAvailable, localization, motionEvent, now, occluded, ringZone, streamActive])

  const debugDecision = useMemo(() => decideAccessState({
    observedAt, cameraAvailable: cameraAvailable && streamActive, object: objectBox,
    objectConfidence, occluded,
    zoneClearVerified: true,
  }, {
    protectedZone: ringZone, minimumObjectConfidence: 0.7, minimumOverlapRatio: 0.1, maximumEvidenceAgeMs: 60_000,
  }, now), [cameraAvailable, objectBox, objectConfidence, observedAt, occluded, ringZone, streamActive, now])

  const sampleDecision = useMemo(() => decideAccessState({
    observedAt: sampleObservedAt,
    cameraAvailable: sampleCase !== 'unavailable',
    object: sampleCase === 'removed' ? null : sampleObject,
    objectConfidence: sampleCase === 'review' ? 0.45 : 0.95,
    occluded: false,
    zoneClearVerified: true,
  }, {
    protectedZone: sampleZone, minimumObjectConfidence: 0.7, minimumOverlapRatio: 0.1, maximumEvidenceAgeMs: 60_000,
  }, now), [sampleObservedAt, sampleCase, sampleZone, now])
  const activeDecision = sourceMode === 'sample' ? sampleDecision : decision
  const presentation = statePresentation[activeDecision.state]

  useEffect(() => {
    if (sourceMode !== 'ring' || !localization || decision.observedAt <= lastAlertedFrameRef.current) return
    if (decision.state === 'obstruction_detected') {
      lastAlertedFrameRef.current = decision.observedAt
      if (obstructionObservedAtRef.current !== null) return
      obstructionObservedAtRef.current = decision.observedAt
      setAlertStatus(`An object was detected in your access zone at ${new Date(decision.observedAt).toLocaleTimeString()}. Check the live view and arrange help if needed.`)
      if (notificationsEnabled && Notification.permission === 'granted') {
        new Notification('Entry access may be blocked', { body: 'A fresh Ring frame shows an object overlapping your access zone.' })
      }
    } else if (decision.state === 'zone_clear' && obstructionObservedAtRef.current !== null && decision.observedAt > obstructionObservedAtRef.current) {
      lastAlertedFrameRef.current = decision.observedAt
      obstructionObservedAtRef.current = null
      setAlertStatus('A fresh recheck shows no material obstruction in the access zone. This does not certify the route is safe.')
      if (notificationsEnabled && Notification.permission === 'granted') {
        new Notification('Entry zone looks clear on recheck', { body: 'A newer Ring frame shows no material obstruction in the defined zone.' })
      }
    }
  }, [decision, localization, notificationsEnabled, sourceMode])

  const enableNotifications = async () => {
    if (!('Notification' in window)) {
      setAlertStatus('This browser does not support desktop notifications. In-app alerts will still appear here.')
      return
    }
    const permission = await Notification.requestPermission()
    setNotificationsEnabled(permission === 'granted')
    if (permission !== 'granted') setAlertStatus('Desktop notifications were not enabled. In-app alerts will still appear here.')
  }

  const selectSampleCase = (next: SampleCase) => {
    setSampleCase(next)
    setSampleObservedAt(Date.now())
    setZones(current => withZone(current, 'sample', next === 'clear' ? clearZone : obstructedZone))
  }

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
    if (drawMode === 'zone') {
      if (sourceMode === 'sample') {
        setZones(current => withZone(current, 'sample', rect))
        setSampleObservedAt(Date.now())
      } else {
        analysisGenerationRef.current += 1
        setLiveAssessment(null)
        obstructionObservedAtRef.current = null
        setAlertStatus(null)
        setMotionEvent(null)
        setZones(current => withZone(current, 'ring', rect))
      }
    }
    else {
      setObjectBox(rect)
      setObservedAt(Date.now())
    }
  }

  const captureFreshFrame = async (): Promise<CapturedFrame | null> => {
    const video = videoRef.current
    if (!streamActive || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
      setCaptureError('Start the Ring stream and wait for a usable video frame.')
      return null
    }

    if (!video.requestVideoFrameCallback) {
      setCaptureError('This browser cannot verify that a new Ring frame arrived. Try a browser with video-frame callbacks.')
      return null
    }

    // A capture is fresh only after the video element actually presents another frame.
    const capturedAt = await new Promise<number | null>((resolve) => {
      let handle = 0
      const timeout = window.setTimeout(() => {
        video.cancelVideoFrameCallback(handle)
        resolve(null)
      }, 3_000)
      handle = video.requestVideoFrameCallback(() => {
        window.clearTimeout(timeout)
        resolve(Date.now())
      })
    })
    if (capturedAt === null || videoRef.current !== video || !streamActive) {
      setCaptureError('No new Ring video frame arrived. The stream may be stalled; restart it and retry.')
      return null
    }

    const captureCanvas = document.createElement('canvas')
    captureCanvas.width = video.videoWidth
    captureCanvas.height = video.videoHeight
    const context = captureCanvas.getContext('2d')
    if (!context) {
      setCaptureError('The browser could not create a frame-capture context.')
      return null
    }

    context.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height)
    const blob = await new Promise<Blob | null>((resolve) => captureCanvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob) {
      setCaptureError('The current Ring frame could not be captured.')
      return null
    }
    return { url: URL.createObjectURL(blob), blob, capturedAt, width: captureCanvas.width, height: captureCanvas.height }
  }

  const storeFrame = (frame: CapturedFrame) => {
    setCapturedFrame((previous) => {
      if (previous) URL.revokeObjectURL(previous.url)
      return frame
    })
    analysisGenerationRef.current += 1
    setLiveAssessment(null)
    setAnalysisError(null)
    setObservedAt(frame.capturedAt)
    setCaptureError(null)
  }

  const captureFrame = async () => {
    const frame = await captureFreshFrame()
    if (frame) storeFrame(frame)
  }

  const analyzeFrame = async (frame: CapturedFrame | null = capturedFrame) => {
    if (!frame || analyzing) return
    if (Date.now() - frame.capturedAt > 60_000) {
      setAnalysisError('This frame is older than 60 seconds. Capture a fresh frame.')
      return
    }
    setAnalyzing(true)
    setAnalysisError(null)
    const generation = ++analysisGenerationRef.current
    const form = new FormData()
    form.append('frame', frame.blob, 'ring-frame.jpg')
    form.append('capturedAt', String(frame.capturedAt))
    form.append('zone', JSON.stringify(ringZone))
    try {
      const response = await fetch('/api/clearpath/localize', { method: 'POST', body: form })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Frame analysis failed.')
      const validated = validateLocalization(data)
      if (!validated.valid) throw new Error('The localization result failed validation.')
      if (generation !== analysisGenerationRef.current) return
      setLiveAssessment({ zone: ringZone, result: validated.result })
    } catch (error) {
      if (generation !== analysisGenerationRef.current) return
      setLiveAssessment(null)
      setAnalysisError(error instanceof Error ? error.message : 'Frame analysis failed.')
    } finally {
      setAnalyzing(false)
    }
  }

  const recheckFrame = async () => {
    if (rechecking || analyzing) return
    setRechecking(true)
    try {
      const frame = await captureFreshFrame()
      if (!frame) return
      storeFrame(frame)
      await analyzeFrame(frame)
    } finally {
      setRechecking(false)
    }
  }

  useEffect(() => () => {
    if (capturedFrame) URL.revokeObjectURL(capturedFrame.url)
  }, [capturedFrame])

  return (
    <div className="h-screen flex flex-col">
      <Header
        connected={isSimpleMode ? false : connected}
        enabledCount={isSimpleMode ? 0 : enabledCount}
        simpleMode={isSimpleMode}
      />

      <div className="flex items-center gap-2 border-b border-slate-700 bg-slate-950 px-4 py-2 text-sm">
        <button onClick={() => setSourceMode('sample')} className={`rounded-lg px-3 py-1.5 ${sourceMode === 'sample' ? 'bg-cyan-300 font-semibold text-slate-950' : 'bg-slate-800 text-slate-300'}`}>Sample test · no hardware</button>
        <button onClick={() => setSourceMode('ring')} className={`rounded-lg px-3 py-1.5 ${sourceMode === 'ring' ? 'bg-cyan-300 font-semibold text-slate-950' : 'bg-slate-800 text-slate-300'}`}>Live Ring</button>
        <span className="ml-auto text-xs text-slate-400">{sourceMode === 'sample' ? 'Synthetic frame + supplied object bounds; no AI or Ring claim' : 'Live Ring evidence'}</span>
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        <div className="w-[66%] p-4 flex flex-col">
          <div ref={videoContainerRef} className="relative flex-1 bg-black rounded-xl overflow-hidden">
            <video ref={videoRef} autoPlay playsInline muted className={`w-full h-full object-contain ${sourceMode === 'sample' ? 'invisible' : ''}`} />
            <canvas ref={canvasRef} className={`absolute inset-0 w-full h-full pointer-events-none ${sourceMode === 'sample' ? 'hidden' : ''}`} />
            {sourceMode === 'sample' && <div className="absolute bg-black" style={videoViewport ? { left: videoViewport.left, top: videoViewport.top, width: videoViewport.width, height: videoViewport.height } : { inset: 0 }}>
              {sampleCase === 'unavailable' ? <div className="flex h-full items-center justify-center text-sm text-slate-300">Synthetic camera unavailable</div> : <img src="/sample-entrance.svg" alt="Synthetic test entrance, not Ring footage" className="h-full w-full" />}
              {sampleCase !== 'removed' && sampleCase !== 'unavailable' && <div className="absolute border border-amber-950 bg-amber-700 shadow-xl" style={{ left: '55%', top: '61%', width: '18%', height: '20%', transform: 'skewY(-4deg)' }}><div className="h-full w-full border-l-[12px] border-t-[10px] border-amber-500/80"><span className="absolute bottom-2 left-3 text-xs font-bold text-amber-100">PARCEL</span></div></div>}
            </div>}

            <div
              className="absolute cursor-crosshair touch-none"
              style={videoViewport ? { left: videoViewport.left, top: videoViewport.top, width: videoViewport.width, height: videoViewport.height } : { inset: 0 }}
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

              {sourceMode === 'ring' && objectBox && (
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
              {sourceMode === 'ring' && localization?.status === 'object' && localization.bounds && (
                <div className="absolute border-2 border-rose-300 bg-rose-300/15" style={{
                  left: `${localization.bounds.x * 100}%`, top: `${localization.bounds.y * 100}%`,
                  width: `${localization.bounds.width * 100}%`, height: `${localization.bounds.height * 100}%`,
                }}>
                  <span className="absolute -bottom-7 left-0 rounded bg-rose-950/90 px-2 py-1 text-[11px] font-semibold text-rose-100">Model: {localization.category} · {Math.round(localization.confidence * 100)}%</span>
                </div>
              )}
              {sourceMode === 'sample' && sampleCase !== 'removed' && sampleCase !== 'unavailable' && (
                <div className="absolute border-2 border-amber-300 bg-amber-300/10" style={{ left: '55%', top: '61%', width: '18%', height: '20%' }}>
                  <span className="absolute -bottom-7 left-0 rounded bg-amber-950/90 px-2 py-1 text-[11px] font-semibold text-amber-100">Supplied test box · not AI</span>
                </div>
              )}
            </div>

            {sourceMode === 'ring' && !streamActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                {loading && <p className="text-slate-300">Checking Ring configuration…</p>}
                {authError && <p className="max-w-md text-center text-sm text-rose-300">Ring configuration: {authError}. Sample test mode remains available.</p>}
                <button
                  onClick={startStream}
                  disabled={!deviceId || Boolean(authError)}
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

            {sourceMode === 'ring' && streamActive && (
              <button
                onClick={stopStream}
                className="absolute top-3 right-3 px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-500"
              >
                ■ Stop
              </button>
            )}
          </div>

          {/* Webhook URL helper — only in full mode */}
          {sourceMode === 'ring' && !isSimpleMode && (
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
            <p className="mt-2 text-sm leading-6 text-slate-400">{sourceMode === 'sample' ? 'Try the decision engine on a synthetic entrance. No Ring device or AI key is needed.' : 'Draw normalized evidence regions over the real Ring stream. Manual object boxes are visibly labeled debug instrumentation.'}</p>
          </div>

          {sourceMode === 'sample' && <section className="mb-4 rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-4">
            <p className="text-sm font-semibold text-cyan-100">Sample test cases</p>
            <p className="mt-1 text-xs text-slate-300">Preset zones and supplied boxes are disclosed test inputs. Draw a different access zone to test the geometry yourself.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {([['clear', 'Clear route'], ['obstructed', 'Obstructed'], ['review', 'Low confidence'], ['unavailable', 'No camera'], ['removed', 'Removed']] as const).map(([value, label]) => (
                <button key={value} onClick={() => selectSampleCase(value)} className={`rounded-md px-3 py-1.5 text-xs ${sampleCase === value ? 'bg-cyan-300 font-semibold text-slate-950' : 'bg-slate-800 text-slate-200'}`}>{label}</button>
              ))}
            </div>
            <button onClick={() => setSampleObservedAt(Date.now())} className="mt-3 text-xs text-cyan-200 underline">Refresh simulated observation</button>
          </section>}

          <section className={`rounded-xl border p-4 ${presentation.background}`}>
            <p className={`text-lg font-bold ${presentation.color}`}>{presentation.label}</p>
            <p className="mt-2 text-sm leading-5 text-slate-200">{activeDecision.reason}</p>
            <div className="mt-3 flex justify-between text-xs text-slate-400">
              <span>Latest evidence</span>
              <span>{sourceMode === 'sample' ? `${new Date(sampleObservedAt).toLocaleTimeString()} · simulated` : localization ? new Date(decision.observedAt).toLocaleTimeString() : 'Not analyzed'}</span>
            </div>
            {activeDecision.overlapRatio !== null && (
              <div className="mt-1 flex justify-between text-xs text-slate-400">
                <span>Object overlap</span>
                <span>{Math.round(activeDecision.overlapRatio * 100)}%</span>
              </div>
            )}
          </section>

          {sourceMode === 'sample' && (sampleDecision.state === 'obstruction_detected' || (sampleCase === 'removed' && sampleDecision.state === 'zone_clear')) && <section className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">Synthetic alert preview · not sent</p>
            <p className="mt-2 text-sm text-slate-100">{sampleCase === 'removed' ? 'Fresh example frame: the defined access zone looks clear. A real removal update would require a newer Ring frame.' : 'An object appears to block your access zone. Check the entrance and arrange help if needed.'}</p>
          </section>}

          {sourceMode === 'ring' && <section className="mt-4 rounded-xl border border-slate-700 bg-slate-900/70 p-4">
            <p className="text-sm font-semibold text-white">Resident alert and recheck</p>
            <p className="mt-1 text-xs leading-5 text-slate-400">After a manual analysis, a confirmed obstruction appears here. Desktop alerts work only while this page is open and you opt in; they do not contact the courier.</p>
            {motionEvent && (!localization || localization.frameTimestamp <= motionEvent.receivedAt) && <p role="status" className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">{motionEvent.simulated ? 'Simulated motion event' : 'New camera motion event'}: the earlier assessment is no longer current. Use a fresh recheck.</p>}
            {alertStatus && <p role="status" className="mt-3 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100">{alertStatus}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={enableNotifications} disabled={notificationsEnabled} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200 disabled:text-slate-400">{notificationsEnabled ? 'Desktop alerts enabled' : 'Enable desktop alerts'}</button>
              <button onClick={recheckFrame} disabled={!streamActive || analyzing || rechecking} className="rounded-lg bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:bg-slate-700 disabled:text-slate-400">{rechecking ? 'Rechecking…' : 'Recheck with fresh frame'}</button>
            </div>
            <p className="mt-2 text-xs text-slate-400">A clear recheck updates the alert only when a newer frame supports it. Uncertain or unavailable evidence cannot confirm removal.</p>
          </section>}

          {sourceMode === 'ring' && <section className="mt-4 rounded-xl border border-slate-700 bg-slate-900/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">Ring evidence</p>
                <p className="mt-1 text-xs text-slate-400">Captured locally from the active WHEP video element.</p>
              </div>
              <button onClick={captureFrame} disabled={!streamActive || analyzing || rechecking} className="rounded-lg bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500">Capture frame</button>
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
            {capturedFrame && <button onClick={() => void analyzeFrame()} disabled={analyzing || rechecking || !streamActive} className="mt-3 rounded-lg bg-emerald-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500">{analyzing ? 'Analyzing…' : 'Analyze captured frame'}</button>}
            {analysisError && <p className="mt-2 text-xs text-amber-300">{analysisError}</p>}
            {localization && <p className="mt-2 text-xs text-slate-300">Model result: {localization.status} · {Math.round(localization.confidence * 100)}% confidence. Frame sent for analysis; raw image is not saved by ClearPath.</p>}
          </section>}

          {sourceMode === 'ring' && <section className="mt-4 rounded-xl border border-slate-700 bg-slate-900/70 p-4">
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
            <p className="mt-3 text-xs text-slate-400">Debug simulation only: {statePresentation[debugDecision.state].label}. It does not set the live assessment.</p>
          </section>}

          {sourceMode === 'sample' && <section className="mt-4 rounded-xl border border-slate-700 bg-slate-900/70 p-4">
            <p className="text-sm font-semibold text-white">Draw your own access zone</p>
            <p className="mt-2 text-xs leading-5 text-slate-400">Drag across the synthetic entrance. Blue is the resident-defined zone; amber is the supplied parcel boundary. A parcel outside the zone should remain clear.</p>
            <button onClick={() => setDrawMode('zone')} className="mt-3 rounded-lg bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950">Draw access zone</button>
          </section>}

          <p className="mt-4 text-xs leading-5 text-slate-500">{sourceMode === 'sample' ? 'This synthetic test validates UI and decision geometry only. It does not test Ring capture or AI detection.' : 'This view reports visible overlap in the latest Ring evidence. It does not certify accessibility, safety, or legal clearance.'}</p>

          {sourceMode === 'ring' && !isSimpleMode && (
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
