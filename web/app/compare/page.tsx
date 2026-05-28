// Animation loop
  const animate = useCallback((duration: number, onComplete?: () => void) => {
    const start = performance.now() - pausedAtRef.current * duration
    startTimeRef.current = start

    function frame(now: number) {
      const elapsed = now - start
      const t = Math.min(elapsed / duration, 1)
      setProgress(t)
      drawFrame(t)

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(frame)
      } else {
        setPlaying(false)
        pausedAtRef.current = 0
        onComplete?.()
      }
    }

    animFrameRef.current = requestAnimationFrame(frame)
  }, [drawFrame])

  function play() {
    cancelAnimationFrame(animFrameRef.current)
    setPlaying(true)
    animate(PREVIEW_DURATION)
  }

  function pause() {
    cancelAnimationFrame(animFrameRef.current)
    setPlaying(false)
  }

  function seek(t: number) {
    cancelAnimationFrame(animFrameRef.current)
    setPlaying(false)
    pausedAtRef.current = t
    setProgress(t)
    drawFrame(t)
  }

  function restart() {
    cancelAnimationFrame(animFrameRef.current)
    pausedAtRef.current = 0
    setProgress(0)
    drawFrame(0)
    setPlaying(false)
  }

  // Draw initial frame on mount
  useEffect(() => {
    drawFrame(0)
  }, [drawFrame])

  // Cleanup on unmount
  useEffect(() => {
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [])

  async function exportMp4() {
    const canvas = canvasRef.current
    if (!canvas) return

    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
      setExportError('MP4 export requires Chrome or Firefox. Safari is not supported.')
      return
    }

    setExporting(true)
    setExportError(null)
    cancelAnimationFrame(animFrameRef.current)
    pausedAtRef.current = 0

    const stream = canvas.captureStream(30)
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 4000000 })
    const chunks: Blob[] = []

    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'segmentiq-replay.webm'
      a.click()
      URL.revokeObjectURL(url)
      setExporting(false)
      drawFrame(progress)
    }

    recorder.start()
    animate(EXPORT_DURATION, () => {
      recorder.stop()
    })
  }

  const progressPct = Math.round(progress * 100)

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 mb-6">
      <div className="text-xs text-text-muted mb-3">Segment replay</div>

      <canvas
        ref={canvasRef}
        width={640}
        height={280}
        style={{ borderRadius: '8px', maxWidth: '100%', display: 'block' }}
      />

      {/* Scrubber */}
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={playing ? pause : play}
          className="w-8 h-8 rounded-full bg-strava flex items-center justify-center text-white text-xs flex-shrink-0"
        >
          {playing ? '⏸' : '▶'}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={progressPct}
          onChange={e => seek(parseInt(e.target.value) / 100)}
          className="flex-1 accent-strava"
        />
        <span className="text-text-muted text-xs w-8 text-right">
          {Math.round(progress * 15)}s
        </span>
      </div>

      {/* Export button */}
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={exporting ? undefined : exportMp4}
          disabled={exporting}
          className={`flex-1 text-sm font-medium py-2.5 rounded-xl transition-colors ${
            exporting
              ? 'bg-surface border border-border text-text-muted cursor-not-allowed'
              : 'bg-strava hover:bg-strava-dark text-white'
          }`}
        >
          {exporting ? 'Recording… play will complete automatically' : '⬇ Export replay video'}
        </button>
        <button
          onClick={restart}
          className="w-10 h-10 rounded-xl border border-border text-text-muted hover:text-white transition-colors text-sm"
        >
          ↺
        </button>
      </div>

      {exportError && (
        <div className="mt-2 text-xs text-red-400">{exportError}</div>
      )}

      <div className="mt-2 text-xs text-text-muted">
        Preview plays at 15s · Export records full 30s replay
      </div>
    </div>
  )
}
// Animation loop
  const animate = useCallback((duration: number, onComplete?: () => void) => {
    const start = performance.now() - pausedAtRef.current * duration
    startTimeRef.current = start

    function frame(now: number) {
      const elapsed = now - start
      const t = Math.min(elapsed / duration, 1)
      setProgress(t)
      drawFrame(t)

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(frame)
      } else {
        setPlaying(false)
        pausedAtRef.current = 0
        onComplete?.()
      }
    }

    animFrameRef.current = requestAnimationFrame(frame)
  }, [drawFrame])

  function play() {
    cancelAnimationFrame(animFrameRef.current)
    setPlaying(true)
    animate(PREVIEW_DURATION)
  }

  function pause() {
    cancelAnimationFrame(animFrameRef.current)
    setPlaying(false)
  }

  function seek(t: number) {
    cancelAnimationFrame(animFrameRef.current)
    setPlaying(false)
    pausedAtRef.current = t
    setProgress(t)
    drawFrame(t)
  }

  function restart() {
    cancelAnimationFrame(animFrameRef.current)
    pausedAtRef.current = 0
    setProgress(0)
    drawFrame(0)
    setPlaying(false)
  }

  // Draw initial frame on mount
  useEffect(() => {
    drawFrame(0)
  }, [drawFrame])

  // Cleanup on unmount
  useEffect(() => {
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [])

  async function exportMp4() {
    const canvas = canvasRef.current
    if (!canvas) return

    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
      setExportError('MP4 export requires Chrome or Firefox. Safari is not supported.')
      return
    }

    setExporting(true)
    setExportError(null)
    cancelAnimationFrame(animFrameRef.current)
    pausedAtRef.current = 0

    const stream = canvas.captureStream(30)
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 4000000 })
    const chunks: Blob[] = []

    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'segmentiq-replay.webm'
      a.click()
      URL.revokeObjectURL(url)
      setExporting(false)
      drawFrame(progress)
    }

    recorder.start()
    animate(EXPORT_DURATION, () => {
      recorder.stop()
    })
  }

  const progressPct = Math.round(progress * 100)

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 mb-6">
      <div className="text-xs text-text-muted mb-3">Segment replay</div>

      <canvas
        ref={canvasRef}
        width={640}
        height={280}
        style={{ borderRadius: '8px', maxWidth: '100%', display: 'block' }}
      />

      {/* Scrubber */}
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={playing ? pause : play}
          className="w-8 h-8 rounded-full bg-strava flex items-center justify-center text-white text-xs flex-shrink-0"
        >
          {playing ? '⏸' : '▶'}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={progressPct}
          onChange={e => seek(parseInt(e.target.value) / 100)}
          className="flex-1 accent-strava"
        />
        <span className="text-text-muted text-xs w-8 text-right">
          {Math.round(progress * 15)}s
        </span>
      </div>

      {/* Export button */}
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={exporting ? undefined : exportMp4}
          disabled={exporting}
          className={`flex-1 text-sm font-medium py-2.5 rounded-xl transition-colors ${
            exporting
              ? 'bg-surface border border-border text-text-muted cursor-not-allowed'
              : 'bg-strava hover:bg-strava-dark text-white'
          }`}
        >
          {exporting ? 'Recording… play will complete automatically' : '⬇ Export replay video'}
        </button>
        <button
          onClick={restart}
          className="w-10 h-10 rounded-xl border border-border text-text-muted hover:text-white transition-colors text-sm"
        >
          ↺
        </button>
      </div>

      {exportError && (
        <div className="mt-2 text-xs text-red-400">{exportError}</div>
      )}

      <div className="mt-2 text-xs text-text-muted">
        Preview plays at 15s · Export records full 30s replay
      </div>
    </div>
  )
}
function drawExportCard(
  canvas: HTMLCanvasElement,
  effortA: NormalisedEffort,
  effortB: NormalisedEffort,
  summaryA: Effort,
  summaryB: Effort,
  timeDelta: number
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const W = 390, H = 700
  canvas.height = H

  const BG = '#0a0a0a'
  const SURFACE = '#111111'
  const BORDER = '#1e1e1e'
  const ORANGE = '#FC4C02'
  const BLUE = '#60A5FA'
  const WHITE = '#ffffff'
  const MUTED = '#888888'
  const DIM = '#444444'
  const DIMMER = '#2a2a2a'
  const GREEN = '#22C55E'
  const RED = '#EF4444'
  const GOLD = '#EAB308'

  function roundRect(x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
  }

  const deltaColour = timeDelta < 0 ? GREEN : timeDelta > 0 ? RED : WHITE

  roundRect(0, 0, W, H, 16)
  ctx.fillStyle = BG
  ctx.fill()
  roundRect(0, 0, W, H, 16)
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.fillStyle = ORANGE
  ctx.fillRect(0, 0, 4, H)

  ctx.fillStyle = SURFACE
  ctx.fillRect(0, 0, W, 58)
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, 58)
  ctx.lineTo(W, 58)
  ctx.stroke()

  ctx.fillStyle = MUTED
  ctx.font = '400 11px -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(effortA.segment.name.toUpperCase(), 20, 26)

  ctx.fillStyle = WHITE
  ctx.font = '600 14px -apple-system, sans-serif'
  ctx.fillText(
    `${effortA.segment.distanceMetres >= 1000
      ? (effortA.segment.distanceMetres / 1000).toFixed(1) + 'km'
      : Math.round(effortA.segment.distanceMetres) + 'm'} · ${effortA.segment.averageGradePct}% avg grade`,
    20, 44
  )

  ctx.fillStyle = DIM
  ctx.font = '600 11px -apple-system, sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText('SEGMENTIQ', W - 20, 35)

  const timesY = 58
  const halfW = W / 2

  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(halfW, timesY)
  ctx.lineTo(halfW, timesY + 110)
  ctx.stroke()

  ctx.fillStyle = BLUE
  ctx.font = '500 10px -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('EFFORT A', 20, timesY + 20)

  ctx.fillStyle = BLUE
  ctx.font = '700 36px -apple-system, sans-serif'
  ctx.fillText(formatTime(effortA.elapsedSeconds), 20, timesY + 58)

  ctx.fillStyle = DIM
  ctx.font = '400 11px -apple-system, sans-serif'
  ctx.fillText(formatDate(effortA.startDate), 20, timesY + 74)

  if (effortA.prRank === 1) {
    roundRect(20, timesY + 82, 28, 16, 8)
    ctx.fillStyle = 'rgba(234,179,8,0.15)'
    ctx.fill()
    roundRect(20, timesY + 82, 28, 16, 8)
    ctx.strokeStyle = 'rgba(234,179,8,0.3)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = GOLD
    ctx.font = '600 9px -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('PR', 34, timesY + 94)
  }

  ctx.fillStyle = ORANGE
  ctx.font = '500 10px -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('EFFORT B', halfW + 20, timesY + 20)

  ctx.fillStyle = ORANGE
  ctx.font = '700 36px -apple-system, sans-serif'
  ctx.fillText(formatTime(effortB.elapsedSeconds), halfW + 20, timesY + 58)

  ctx.fillStyle = DIM
  ctx.font = '400 11px -apple-system, sans-serif'
  ctx.fillText(formatDate(effortB.startDate), halfW + 20, timesY + 74)

  if (effortB.prRank === 1) {
    roundRect(halfW + 20, timesY + 82, 28, 16, 8)
    ctx.fillStyle = 'rgba(234,179,8,0.15)'
    ctx.fill()
    roundRect(halfW + 20, timesY + 82, 28, 16, 8)
    ctx.strokeStyle = 'rgba(234,179,8,0.3)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = GOLD
    ctx.font = '600 9px -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('PR', halfW + 34, timesY + 94)
  }

  const deltaBgColour = timeDelta < 0
    ? 'rgba(34,197,94,0.08)'
    : timeDelta > 0
    ? 'rgba(239,68,68,0.08)'
    : 'rgba(255,255,255,0.04)'
  ctx.fillStyle = deltaBgColour
  ctx.fillRect(0, timesY + 110, W, 36)

  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, timesY + 110)
  ctx.lineTo(W, timesY + 110)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(0, timesY + 146)
  ctx.lineTo(W, timesY + 146)
  ctx.stroke()

  ctx.fillStyle = deltaColour
  ctx.font = '700 16px -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(
    timeDelta === 0
      ? 'Dead heat'
      : `${timeDelta < 0 ? '▲' : '▼'} ${Math.abs(timeDelta)}s ${timeDelta < 0 ? '— A faster' : '— B faster'}`,
    W / 2, timesY + 133
  )

  const metY = timesY + 146
  const barW = W - 40
  const barMid = W / 2

  ctx.fillStyle = DIM
  ctx.font = '400 10px -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('METRICS', 20, metY + 20)

  let mY = metY + 34

  function drawStatBar(label: string, valA: number | null, valB: number | null, formatA: string, formatB: string) {
    if (valA == null && valB == null) return
    ctx.fillStyle = BLUE
    ctx.font = '500 12px -apple-system, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(valA != null ? formatA : '—', 20, mY)
    ctx.fillStyle = DIM
    ctx.font = '400 10px -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(label, barMid, mY)
    ctx.fillStyle = ORANGE
    ctx.font = '500 12px -apple-system, sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(valB != null ? formatB : '—', W - 20, mY)
    ctx.fillStyle = BORDER
    roundRect(20, mY + 5, barW, 5, 3)
    ctx.fill()
    const maxVal = Math.max(valA ?? 0, valB ?? 0)
    const halfBar = barW / 2 - 2
    if (valA != null && maxVal > 0) {
      const wA = (valA / maxVal) * halfBar
      ctx.fillStyle = BLUE
      roundRect(barMid - wA - 2, mY + 5, wA, 5, 2)
      ctx.fill()
    }
    if (valB != null && maxVal > 0) {
      const wB = (valB / maxVal) * halfBar
      ctx.fillStyle = ORANGE
      roundRect(barMid + 2, mY + 5, wB, 5, 2)
      ctx.fill()
    }
    mY += 32
  }

  drawStatBar('AVG HR', effortA.averageHeartRate, effortB.averageHeartRate,
    effortA.averageHeartRate != null ? `${Math.round(effortA.averageHeartRate)} bpm` : '—',
    effortB.averageHeartRate != null ? `${Math.round(effortB.averageHeartRate)} bpm` : '—')

  drawStatBar('AVG SPEED', effortA.averageSpeedKph, effortB.averageSpeedKph,
    effortA.averageSpeedKph != null ? `${effortA.averageSpeedKph.toFixed(1)} km/h` : '—',
    effortB.averageSpeedKph != null ? `${effortB.averageSpeedKph.toFixed(1)} km/h` : '—')

  if (effortA.averagePowerWatts != null || effortB.averagePowerWatts != null) {
    drawStatBar('AVG POWER', effortA.averagePowerWatts, effortB.averagePowerWatts,
      effortA.averagePowerWatts != null ? `${Math.round(effortA.averagePowerWatts)}W${!summaryA.device_watts ? ' est.' : ''}` : '—',
      effortB.averagePowerWatts != null ? `${Math.round(effortB.averagePowerWatts)}W${!summaryB.device_watts ? ' est.' : ''}` : '—')
  }

  const divY = mY + 4
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, divY)
  ctx.lineTo(W, divY)
  ctx.stroke()

  const elY = divY + 14
  const elH = 80
  const elPad = 20
  const elW = W - elPad * 2

  ctx.fillStyle = DIM
  ctx.font = '400 10px -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('ELEVATION PROFILE', elPad, elY - 4)

  const elevPoints = effortA.points.map(p => p.elevationMetres)
  const minEl = Math.min(...elevPoints)
  const maxEl = Math.max(...elevPoints)
  const elRange = maxEl - minEl || 1

  const pts = elevPoints.map((v, i) => ({
    x: elPad + (i / (elevPoints.length - 1)) * elW,
    y: elY + elH - 4 - ((v - minEl) / elRange) * (elH - 14),
  }))

  ctx.beginPath()
  ctx.moveTo(pts[0].x, elY + elH)
  pts.forEach(p => ctx.lineTo(p.x, p.y))
  ctx.lineTo(pts[pts.length - 1].x, elY + elH)
  ctx.closePath()
  const grad = ctx.createLinearGradient(0, elY, 0, elY + elH)
  grad.addColorStop(0, 'rgba(252,76,2,0.35)')
  grad.addColorStop(1, 'rgba(252,76,2,0.05)')
  ctx.fillStyle = grad
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  pts.forEach(p => ctx.lineTo(p.x, p.y))
  ctx.strokeStyle = ORANGE
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.stroke()

  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(elPad, elY + elH)
  ctx.lineTo(W - elPad, elY + elH)
  ctx.stroke()

  const footY = elY + elH + 14
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, footY)
  ctx.lineTo(W, footY)
  ctx.stroke()

  ctx.fillStyle = DIMMER
  ctx.font = '600 11px -apple-system, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('SEGMENTIQ', 20, footY + 22)

  ctx.fillStyle = DIMMER
  ctx.font = '400 10px -apple-system, sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText('segmentiq.vercel.app', W - 20, footY + 22)
}

function CompareContent() {
  const router = useRouter()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [data, setData] = useState<CompareData | null>(null)
  const [summaryA, setSummaryA] = useState<Effort | null>(null)
  const [summaryB, setSummaryB] = useState<Effort | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadComparison() {
      const session = localStorage.getItem('session')
      if (!session) { router.push('/'); return }
      const rawA = localStorage.getItem('compareEffortA')
      const rawB = localStorage.getItem('compareEffortB')
      if (!rawA || !rawB) {
        setError('No efforts selected — please go back and select two efforts')
        setLoading(false)
        return
      }
      const effortA: Effort = JSON.parse(rawA)
      const effortB: Effort = JSON.parse(rawB)
      setSummaryA(effortA)
      setSummaryB(effortB)
      try {
        const res = await fetch(
          `/api/efforts/compare?a=${effortA.id}&b=${effortB.id}`,
          { headers: { 'x-session': session } }
        )
        if (res.status === 401) { localStorage.removeItem('session'); router.push('/'); return }
        if (!res.ok) throw new Error('Failed to fetch comparison')
        const json = await res.json()
        setData(json.data)
      } catch (err) {
        setError('Failed to load comparison data')
      } finally {
        setLoading(false)
      }
    }
    loadComparison()
  }, [])

  useEffect(() => {
    if (data && summaryA && summaryB && canvasRef.current) {
      drawExportCard(canvasRef.current, data.effortA, data.effortB, summaryA, summaryB, data.deltas.totalTimeDeltaSeconds)
    }
  }, [data, summaryA, summaryB])

  function handleDownload() {
    if (!canvasRef.current) return
    const link = document.createElement('a')
    link.download = 'segmentiq-comparison.png'
    link.href = canvasRef.current.toDataURL('image/png')
    link.click()
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-text-muted text-sm">Loading comparison...</div>
      </div>
    )
  }

  if (error || !data || !summaryA || !summaryB) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 gap-4">
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-red-400 text-sm">
          {error ?? 'Something went wrong'}
        </div>
        <button onClick={() => router.back()} className="text-text-secondary text-sm hover:text-white transition-colors">
          ← Go back
        </button>
      </div>
    )
  }

  const { effortA, effortB, deltas } = data
  const timeDelta = deltas.totalTimeDeltaSeconds

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border px-4 py-4 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-text-secondary hover:text-white transition-colors text-lg">←</button>
        <div>
          <h1 className="font-semibold text-sm">{effortA.segment.name}</h1>
          <p className="text-text-muted text-xs">Effort comparison</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">

        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-surface border border-border rounded-2xl p-4">
            <div className="text-blue-400 text-xs font-medium mb-1">Effort A</div>
            <div className="text-white font-semibold text-lg">{formatTime(effortA.elapsedSeconds)}</div>
            <div className="text-text-muted text-xs mt-1">{formatDate(effortA.startDate)}</div>
            {effortA.prRank === 1 && (
              <span className="inline-block mt-2 text-xs font-medium px-2 py-0.5 rounded-full border bg-yellow-500/20 text-yellow-400 border-yellow-500/30">PR</span>
            )}
          </div>
          <div className="bg-surface border border-border rounded-2xl p-4">
            <div className="text-strava text-xs font-medium mb-1">Effort B</div>
            <div className="text-white font-semibold text-lg">{formatTime(effortB.elapsedSeconds)}</div>
            <div className="text-text-muted text-xs mt-1">{formatDate(effortB.startDate)}</div>
            {effortB.prRank === 1 && (
              <span className="inline-block mt-2 text-xs font-medium px-2 py-0.5 rounded-full border bg-yellow-500/20 text-yellow-400 border-yellow-500/30">PR</span>
            )}
          </div>
        </div>

        <div className={`rounded-2xl p-4 mb-6 text-center border ${
          timeDelta < 0 ? 'bg-green-500/10 border-green-500/20' :
          timeDelta > 0 ? 'bg-red-500/10 border-red-500/20' :
          'bg-surface border-border'
        }`}>
          <div className="text-xs text-text-muted mb-1">Time difference</div>
          <div className={`text-2xl font-semibold ${timeDelta < 0 ? 'text-green-400' : timeDelta > 0 ? 'text-red-400' : 'text-white'}`}>
            {timeDelta < 0 ? '▲ ' : timeDelta > 0 ? '▼ ' : ''}{Math.abs(timeDelta)}s
          </div>
          <div className="text-xs text-text-muted mt-1">
            {timeDelta < 0 ? 'Effort A was faster' : timeDelta > 0 ? 'Effort B was faster' : 'Dead heat'}
          </div>
        </div>

        <div className="bg-surface border border-border rounded-2xl px-4 mb-6">
          <div className="grid grid-cols-3 items-center py-2 border-b border-border">
            <div className="text-blue-400 text-xs font-medium">A</div>
            <div className="text-center text-text-muted text-xs">Metric</div>
            <div className="text-strava text-xs font-medium text-right">B</div>
          </div>
          <MetricRow label="Avg HR"
            valueA={effortA.averageHeartRate != null ? `${Math.round(effortA.averageHeartRate)} bpm` : null}
            valueB={effortB.averageHeartRate != null ? `${Math.round(effortB.averageHeartRate)} bpm` : null}
            delta={effortA.averageHeartRate != null && effortB.averageHeartRate != null ? effortA.averageHeartRate - effortB.averageHeartRate : null}
            unit=" bpm" invert={true} />
          <MetricRow label="Avg speed"
            valueA={effortA.averageSpeedKph != null ? `${effortA.averageSpeedKph.toFixed(1)} km/h` : null}
            valueB={effortB.averageSpeedKph != null ? `${effortB.averageSpeedKph.toFixed(1)} km/h` : null}
            delta={effortA.averageSpeedKph != null && effortB.averageSpeedKph != null ? effortA.averageSpeedKph - effortB.averageSpeedKph : null}
            unit=" km/h" />
          {(effortA.hasPower || effortB.hasPower) && (
            <MetricRow label="Avg power"
              valueA={effortA.averagePowerWatts != null ? `${Math.round(effortA.averagePowerWatts)}W${!summaryA.device_watts ? ' est.' : ''}` : null}
              valueB={effortB.averagePowerWatts != null ? `${Math.round(effortB.averagePowerWatts)}W${!summaryB.device_watts ? ' est.' : ''}` : null}
              delta={effortA.averagePowerWatts != null && effortB.averagePowerWatts != null ? effortA.averagePowerWatts - effortB.averagePowerWatts : null}
              unit="W" />
          )}
        </div>

        {effortA.points?.length > 0 && effortB.points?.length > 0 && (
          <div className="bg-surface border border-border rounded-2xl p-4 mb-6">
            <div className="text-xs text-text-muted mb-3">Speed across segment</div>
            <div className="relative h-24">
              <ScaledChart pointsA={effortA.points} pointsB={effortB.points} getValue={p => p.speedKph} />
            </div>
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-2"><div className="w-4 h-0.5 bg-blue-400" /><span className="text-text-muted text-xs">Effort A</span></div>
              <div className="flex items-center gap-2"><div className="w-4 h-0.5 bg-strava" /><span className="text-text-muted text-xs">Effort B</span></div>
            </div>
          </div>
        )}

        {effortA.averageHeartRate != null && effortB.averageHeartRate != null &&
          effortA.points?.length > 0 && effortB.points?.length > 0 && (
          <div className="bg-surface border border-border rounded-2xl p-4 mb-6">
            <div className="text-xs text-text-muted mb-3">Heart rate across segment</div>
            <div className="relative h-24">
              <ScaledChart pointsA={effortA.points} pointsB={effortB.points} getValue={p => p.heartRate} />
            </div>
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-2"><div className="w-4 h-0.5 bg-blue-400" /><span className="text-text-muted text-xs">Effort A</span></div>
              <div className="flex items-center gap-2"><div className="w-4 h-0.5 bg-strava" /><span className="text-text-muted text-xs">Effort B</span></div>
            </div>
          </div>
        )}

        {/* Segment Replay */}
        {data && summaryA && summaryB && (
          <SegmentReplay
            effortA={effortA}
            effortB={effortB}
            summaryA={summaryA}
            summaryB={summaryB}
          />
        )}

        {data && (
          <div className="bg-surface border border-border rounded-2xl p-4 mb-6">
            <div className="text-xs text-text-muted mb-3">Export card</div>
            <canvas ref={canvasRef} width={390} height={700} style={{ borderRadius: '12px', maxWidth: '100%' }} />
            <button onClick={handleDownload} className="w-full mt-4 bg-strava hover:bg-strava-dark transition-colors text-white text-sm font-medium py-3 rounded-xl">
              Download PNG
            </button>
          </div>
        )}

      </div>
    </div>
  )
}

export default function ComparePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-text-muted text-sm">Loading comparison...</div>
      </div>
    }>
      <CompareContent />
    </Suspense>
  )
}
