function ActivityReplay({ activity }: { activity: NormalisedActivity }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animFrameRef = useRef<number>(0)
  const progressRef = useRef<number>(0)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const activityRef = useRef(activity)
  useEffect(() => { activityRef.current = activity }, [activity])

  const allElev = activity.points.map(p => p.elevationMetres)
  const minElevRef = useRef(Math.min(...allElev))
  const elevRangeRef = useRef(Math.max(...allElev) - Math.min(...allElev) || 1)

  const PREVIEW_DURATION = 15000
  const EXPORT_DURATION = 30000
  const PREVIEW_W = 390
  const PREVIEW_H = 700
  const EXPORT_W = 1080
  const EXPORT_H = 1920
  const EXPORT_SCALE = 1080 / 390
  const EXPORT_SAFE_TOP = 250

  const drawFrame = useCallback((t: number, exportMode = false) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const act = activityRef.current
    const minElev = minElevRef.current
    const elevRange = elevRangeRef.current

    if (exportMode) {
      canvas.width = EXPORT_W
      canvas.height = EXPORT_H
    } else {
      canvas.width = PREVIEW_W
      canvas.height = PREVIEW_H
    }

    const W = canvas.width
    const H = canvas.height
    const s = exportMode ? EXPORT_SCALE : 1
    const safeTop = exportMode ? EXPORT_SAFE_TOP : 0

    ctx.fillStyle = '#0a0a0a'
    ctx.fillRect(0, 0, W, H)

    if (exportMode) {
      const topGrad = ctx.createLinearGradient(0, 0, 0, 250)
      topGrad.addColorStop(0, 'rgba(0,0,0,0)')
      topGrad.addColorStop(1, '#0a0a0a')
      ctx.fillStyle = topGrad
      ctx.fillRect(0, 0, W, 250)

      const botGrad = ctx.createLinearGradient(0, H - 250, 0, H)
      botGrad.addColorStop(0, '#0a0a0a')
      botGrad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = botGrad
      ctx.fillRect(0, H - 250, W, 250)
    }

    drawActivityCard(ctx, t, act, minElev, elevRange, s, W, H, safeTop)
  }, [])

  const animate = useCallback((duration: number, startProgress: number, exportMode = false, onComplete?: () => void) => {
    const startTime = performance.now()
    const startT = startProgress

    function frame(now: number) {
      const elapsed = now - startTime
      const t = Math.min(startT + elapsed / duration, 1)
      progressRef.current = t
      if (!exportMode) setProgress(t)
      drawFrame(t, exportMode)
      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(frame)
      } else {
        if (!exportMode) setPlaying(false)
        progressRef.current = 0
        onComplete?.()
      }
    }

    animFrameRef.current = requestAnimationFrame(frame)
  }, [drawFrame])

  function play() {
    cancelAnimationFrame(animFrameRef.current)
    const currentT = progressRef.current >= 1 ? 0 : progressRef.current
    progressRef.current = currentT
    setPlaying(true)
    animate(PREVIEW_DURATION * (1 - currentT), currentT, false)
  }

  function pause() {
    cancelAnimationFrame(animFrameRef.current)
    setPlaying(false)
  }

  function seek(t: number) {
    cancelAnimationFrame(animFrameRef.current)
    setPlaying(false)
    progressRef.current = t
    setProgress(t)
    drawFrame(t, false)
  }

  function restart() {
    cancelAnimationFrame(animFrameRef.current)
    progressRef.current = 0
    setProgress(0)
    drawFrame(0, false)
    setPlaying(false)
  }

  useEffect(() => { drawFrame(0, false) }, [drawFrame])
  useEffect(() => { return () => cancelAnimationFrame(animFrameRef.current) }, [])

  async function exportVideo() {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
      setExportError('Video export requires Chrome or Firefox.')
      return
    }
    setExporting(true)
    setExportError(null)
    cancelAnimationFrame(animFrameRef.current)
    progressRef.current = 0
    drawFrame(0, true)

    const stream = canvas.captureStream(30)
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp8',
      videoBitsPerSecond: 12000000,
    })
    const chunks: Blob[] = []
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `segmentiq-${activity.name.replace(/\s+/g, '-').toLowerCase()}.webm`
      a.click()
      URL.revokeObjectURL(url)
      setExporting(false)
      drawFrame(progressRef.current, false)
    }
    recorder.start()
    animate(EXPORT_DURATION, 0, true, () => { recorder.stop() })
  }

  const progressPct = Math.round(progress * 100)

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-text-muted">Activity replay</div>
        <div className="text-xs text-text-muted">1080×1920 Instagram Story</div>
      </div>
      <canvas
        ref={canvasRef}
        width={390}
        height={700}
        style={{ borderRadius: '8px', maxWidth: '100%', display: 'block', margin: '0 auto' }}
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={playing ? pause : play}
          className="w-8 h-8 rounded-full bg-strava flex items-center justify-center text-white text-xs flex-shrink-0"
        >
          {playing ? '⏸' : '▶'}
        </button>
        <input
          type="range" min={0} max={100} value={progressPct}
          onChange={e => seek(parseInt(e.target.value) / 100)}
          className="flex-1 accent-strava"
        />
        <span className="text-text-muted text-xs w-8 text-right">{Math.round(progress * 15)}s</span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={exporting ? undefined : exportVideo}
          disabled={exporting}
          className={`flex-1 text-sm font-medium py-2.5 rounded-xl transition-colors ${
            exporting
              ? 'bg-surface border border-border text-text-muted cursor-not-allowed'
              : 'bg-strava hover:bg-strava-dark text-white'
          }`}
        >
          {exporting ? 'Recording story…' : '⬇ Export Instagram Story (1080×1920)'}
        </button>
        <button
          onClick={restart}
          className="w-10 h-10 rounded-xl border border-border text-text-muted hover:text-white transition-colors text-sm"
        >
          ↺
        </button>
      </div>
      {exportError && <div className="mt-2 text-xs text-red-400">{exportError}</div>}
      <div className="mt-2 text-xs text-text-muted">
        Preview at 390×700 · Export records full 30s at 1080×1920 for Instagram Stories
      </div>
    </div>
  )
}
