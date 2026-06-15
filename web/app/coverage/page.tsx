'use client'

import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TileHit {
  x: number
  y: number
  date: string
  count: number
}

interface CoverageData {
  tiles: TileHit[]
  activityCount: number
  computedAt: string | null
  status: 'empty' | 'fresh' | 'stale'
  inProgress: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

// UK + Ireland bounding box at zoom 14
const ZOOM = 14
const UK_X1 = 7818
const UK_X2 = 8273
const UK_Y1 = 4674
const UK_Y2 = 5570
// Total zoom-14 tiles covering UK+Ireland land mass (approximate)
const UK_LAND_TILES = 81536

// ─── Tile math ────────────────────────────────────────────────────────────────

function tileToPixel(
  tileX: number,
  tileY: number,
  canvasW: number,
  canvasH: number,
  padX: number,
  padY: number,
): { px: number; py: number; tileSize: number } {
  const usableW = canvasW - padX * 2
  const usableH = canvasH - padY * 2
  const xRange = UK_X2 - UK_X1
  const yRange = UK_Y2 - UK_Y1
  const scaleX = usableW / xRange
  const scaleY = usableH / yRange
  const scale = Math.min(scaleX, scaleY)
  const renderedW = xRange * scale
  const renderedH = yRange * scale
  const offsetX = padX + (usableW - renderedW) / 2
  const offsetY = padY + (usableH - renderedH) / 2
  return {
    px: offsetX + (tileX - UK_X1) * scale,
    py: offsetY + (tileY - UK_Y1) * scale,
    tileSize: scale,
  }
}

function heatmapColor(count: number, maxCount: number): string {
  // Low visits: dim orange, high visits: bright orange
  const intensity = Math.min(count / Math.max(maxCount, 1), 1)
  const alpha = 0.3 + intensity * 0.7
  return `rgba(252, 76, 2, ${alpha.toFixed(2)})`
}

// ─── Map Component (dynamic import — no SSR) ──────────────────────────────────

const CoverageMap = dynamic(() => import('./CoverageMapInner'), { ssr: false })

// ─── Export canvas renderer ───────────────────────────────────────────────────

function renderExportFrame(
  ctx: CanvasRenderingContext2D,
  tiles: TileHit[],
  visibleTiles: Set<string>,
  dateLabel: string,
  totalTiles: number,
  pctCovered: string,
  W: number,
  H: number,
) {
  const ORANGE = '#FC4C02'
  const WHITE = '#ffffff'
  const MUTED = '#888888'
  const DIMMER = '#555555'
  const BORDER = '#1e1e1e'
  const BG = '#0a0a0a'

  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)

  // Top gradient fade
  const topGrad = ctx.createLinearGradient(0, 0, 0, 200)
  topGrad.addColorStop(0, 'rgba(0,0,0,0)')
  topGrad.addColorStop(1, BG)
  ctx.fillStyle = topGrad
  ctx.fillRect(0, 0, W, 200)

  // Bottom gradient fade
  const botGrad = ctx.createLinearGradient(0, H - 200, 0, H)
  botGrad.addColorStop(0, BG)
  botGrad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = botGrad
  ctx.fillRect(0, H - 200, W, 200)

  // Orange left accent
  ctx.fillStyle = ORANGE
  ctx.fillRect(0, 0, 4, H)

  // Header
  ctx.fillStyle = '#111111'
  ctx.fillRect(0, 0, W, 140)
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, 140)
  ctx.lineTo(W, 140)
  ctx.stroke()

  ctx.fillStyle = MUTED
  ctx.font = `500 28px -apple-system, sans-serif`
  ctx.textAlign = 'left'
  ctx.fillText('COVERAGE MAP', 40, 48)
  ctx.fillStyle = WHITE
  ctx.font = `700 52px -apple-system, sans-serif`
  ctx.fillText(dateLabel, 40, 112)
  ctx.fillStyle = DIMMER
  ctx.font = `700 32px -apple-system, sans-serif`
  ctx.textAlign = 'right'
  ctx.fillText('SEGMENTIQ', W - 40, 80)

  // Map area: between header and stats
  const MAP_TOP = 160
  const MAP_BOT = H - 280
  const MAP_H = MAP_BOT - MAP_TOP
  const MAP_W = W

  // Find max count for heatmap scaling
  let maxCount = 1
  for (const tile of tiles) {
    if (visibleTiles.has(`${tile.x},${tile.y}`) && tile.count > maxCount) {
      maxCount = tile.count
    }
  }

  // Draw tiles
  const xRange = UK_X2 - UK_X1
  const yRange = UK_Y2 - UK_Y1
  const scaleX = MAP_W / xRange
  const scaleY = MAP_H / yRange
  const scale = Math.min(scaleX, scaleY)
  const renderedW = xRange * scale
  const renderedH = yRange * scale
  const offsetX = (MAP_W - renderedW) / 2
  const offsetY = MAP_TOP + (MAP_H - renderedH) / 2
  const tileSize = Math.max(scale, 1.5)

  for (const tile of tiles) {
    if (!visibleTiles.has(`${tile.x},${tile.y}`)) continue
    const px = offsetX + (tile.x - UK_X1) * scale
    const py = offsetY + (tile.y - UK_Y1) * scale
    ctx.fillStyle = heatmapColor(tile.count, maxCount)
    ctx.fillRect(px, py, tileSize, tileSize)
  }

  // Stats bar at bottom
  ctx.fillStyle = '#111111'
  ctx.fillRect(0, H - 260, W, 260)
  ctx.strokeStyle = BORDER
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, H - 260)
  ctx.lineTo(W, H - 260)
  ctx.stroke()

  // Divider between stats
  ctx.beginPath()
  ctx.moveTo(W / 2, H - 240)
  ctx.lineTo(W / 2, H - 60)
  ctx.stroke()

  // Tiles stat
  ctx.textAlign = 'center'
  ctx.fillStyle = MUTED
  ctx.font = `400 28px -apple-system, sans-serif`
  ctx.fillText('TILES COVERED', W / 4, H - 200)
  ctx.fillStyle = ORANGE
  ctx.font = `700 72px -apple-system, sans-serif`
  ctx.fillText(totalTiles.toLocaleString(), W / 4, H - 120)

  // Percentage stat
  ctx.fillStyle = MUTED
  ctx.font = `400 28px -apple-system, sans-serif`
  ctx.fillText('UK + IRELAND', W * 3 / 4, H - 200)
  ctx.fillStyle = WHITE
  ctx.font = `700 72px -apple-system, sans-serif`
  ctx.fillText(pctCovered + '%', W * 3 / 4, H - 120)

  // Footer
  ctx.fillStyle = '#888888'
  ctx.font = `700 28px -apple-system, sans-serif`
  ctx.textAlign = 'left'
  ctx.fillText('SEGMENTIQ', 40, H - 40)
  ctx.fillStyle = '#666666'
  ctx.font = `400 26px -apple-system, sans-serif`
  ctx.textAlign = 'right'
  ctx.fillText('segmentiq.vercel.app', W - 40, H - 40)
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CoveragePage() {
  const router = useRouter()
  const [coverage, setCoverage] = useState<CoverageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Date filter
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Animation
  const [playing, setPlaying] = useState(false)
  const [animProgress, setAnimProgress] = useState(1) // 0→1
  const animFrameRef = useRef<number>(0)
  const animStartRef = useRef<number>(0)
  const ANIM_DURATION = 20000 // 20s for full timeline

  // Export
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const exportCanvasRef = useRef<HTMLCanvasElement>(null)

  // Poll interval for refresh status
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  const session = typeof window !== 'undefined' ? localStorage.getItem('session') : null

  // ─── Load coverage data ────────────────────────────────────────────────────

  const loadCoverage = useCallback(async () => {
    const s = localStorage.getItem('session')
    if (!s) { router.push('/'); return }
    try {
      const res = await fetch('/api/coverage', { headers: { 'x-session': s } })
      if (res.status === 401) { localStorage.removeItem('session'); router.push('/'); return }
      if (!res.ok) throw new Error('Failed to load coverage')
      const data: CoverageData = await res.json()
      setCoverage(data)
      setRefreshing(data.inProgress)
    } catch {
      setError('Failed to load coverage data')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    loadCoverage()
  }, [loadCoverage])

  // Poll while refresh in progress
  useEffect(() => {
    if (refreshing) {
      pollRef.current = setInterval(async () => {
        await loadCoverage()
      }, 5000)
    } else {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [refreshing, loadCoverage])

  // ─── Trigger refresh ───────────────────────────────────────────────────────

  async function triggerRefresh() {
    const s = localStorage.getItem('session')
    if (!s) return
    setRefreshing(true)
    try {
      await fetch('/api/coverage/refresh', {
        method: 'POST',
        headers: { 'x-session': s },
      })
    } catch {
      setRefreshing(false)
      setError('Failed to start refresh')
    }
  }

  // ─── Filtered tiles ────────────────────────────────────────────────────────

  const filteredTiles = useMemo(() => {
    if (!coverage?.tiles) return []
    return coverage.tiles.filter(tile => {
      if (dateFrom && tile.date < dateFrom) return false
      if (dateTo && tile.date > dateTo) return false
      return true
    })
  }, [coverage, dateFrom, dateTo])

  // Sorted unique dates for animation timeline
  const sortedDates = useMemo(() => {
    const dates = new Set(filteredTiles.map(t => t.date))
    return Array.from(dates).sort()
  }, [filteredTiles])

  // Tiles visible at current animation progress
  const visibleTiles = useMemo(() => {
    const set = new Set<string>()
    if (sortedDates.length === 0) return set
    const cutoffIdx = Math.floor(animProgress * (sortedDates.length - 1))
    const cutoffDate = sortedDates[cutoffIdx] ?? sortedDates[sortedDates.length - 1]
    for (const tile of filteredTiles) {
      if (tile.date <= cutoffDate) set.add(`${tile.x},${tile.y}`)
    }
    return set
  }, [filteredTiles, sortedDates, animProgress])

  const totalVisible = visibleTiles.size
  const pctCovered = ((totalVisible / UK_LAND_TILES) * 100).toFixed(2)

  // Date label for current animation frame
  const currentDateLabel = useMemo(() => {
    if (sortedDates.length === 0) return 'No data'
    const idx = Math.floor(animProgress * (sortedDates.length - 1))
    return sortedDates[idx] ?? sortedDates[sortedDates.length - 1]
  }, [sortedDates, animProgress])

  // ─── Animation ────────────────────────────────────────────────────────────

  function playAnimation() {
    cancelAnimationFrame(animFrameRef.current)
    const startT = animProgress >= 1 ? 0 : animProgress
    setAnimProgress(startT)
    animStartRef.current = performance.now() - startT * ANIM_DURATION
    setPlaying(true)

    function frame(now: number) {
      const elapsed = now - animStartRef.current
      const t = Math.min(elapsed / ANIM_DURATION, 1)
      setAnimProgress(t)
      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(frame)
      } else {
        setPlaying(false)
      }
    }
    animFrameRef.current = requestAnimationFrame(frame)
  }

  function pauseAnimation() {
    cancelAnimationFrame(animFrameRef.current)
    setPlaying(false)
  }

  function resetAnimation() {
    cancelAnimationFrame(animFrameRef.current)
    setPlaying(false)
    setAnimProgress(0)
  }

  useEffect(() => () => cancelAnimationFrame(animFrameRef.current), [])

  // ─── Export MP4 ───────────────────────────────────────────────────────────

  async function exportVideo() {
    if (!coverage?.tiles || exporting) return
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
      setExportError('Video export requires Chrome or Firefox.')
      return
    }

    setExporting(true)
    setExportError(null)

    const EXPORT_W = 1080
    const EXPORT_H = 1920
    const EXPORT_DURATION = 30000
    const FPS = 30

    const canvas = document.createElement('canvas')
    canvas.width = EXPORT_W
    canvas.height = EXPORT_H
    const ctx = canvas.getContext('2d')!

    // Silent audio for Instagram
    const audioCtx = new AudioContext()
    const silentDest = audioCtx.createMediaStreamDestination()
    const oscillator = audioCtx.createOscillator()
    const gainNode = audioCtx.createGain()
    gainNode.gain.value = 0
    oscillator.connect(gainNode)
    gainNode.connect(silentDest)
    oscillator.start()

    const videoStream = canvas.captureStream(FPS)
    videoStream.addTrack(silentDest.stream.getAudioTracks()[0])

    const recorder = new MediaRecorder(videoStream, {
      mimeType: 'video/webm;codecs=vp8',
      videoBitsPerSecond: 12000000,
    })
    const chunks: Blob[] = []
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }

    recorder.onstop = async () => {
      oscillator.stop()
      audioCtx.close()
      const webmBlob = new Blob(chunks, { type: 'video/webm' })
      try {
        const res = await fetch('/api/convert', {
          method: 'POST',
          headers: { 'Content-Type': 'video/webm' },
          body: webmBlob,
        })
        if (!res.ok) throw new Error('Conversion failed')
        const mp4Blob = await res.blob()
        const url = URL.createObjectURL(mp4Blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `segmentiq-coverage.mp4`
        a.click()
        URL.revokeObjectURL(url)
      } catch {
        setExportError('MP4 conversion failed — please try again.')
      } finally {
        setExporting(false)
      }
    }

    recorder.start()

    const startTime = performance.now()
    let maxCount = 1
    for (const tile of filteredTiles) {
      if (tile.count > maxCount) maxCount = tile.count
    }

    function exportFrame(now: number) {
      const elapsed = now - startTime
      const t = Math.min(elapsed / EXPORT_DURATION, 1)

      // Compute visible tiles at this t
      const cutoffIdx = Math.floor(t * (sortedDates.length - 1))
      const cutoffDate = sortedDates[cutoffIdx] ?? sortedDates[sortedDates.length - 1]
      const visible = new Set<string>()
      for (const tile of filteredTiles) {
        if (tile.date <= cutoffDate) visible.add(`${tile.x},${tile.y}`)
      }

      const total = visible.size
      const pct = ((total / UK_LAND_TILES) * 100).toFixed(2)

      renderExportFrame(ctx, filteredTiles, visible, cutoffDate, total, pct, EXPORT_W, EXPORT_H)

      if (t < 1) {
        requestAnimationFrame(exportFrame)
      } else {
        recorder.stop()
      }
    }

    requestAnimationFrame(exportFrame)
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-text-muted text-sm">Loading coverage data...</div>
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 gap-4">
      <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-red-400 text-sm">{error}</div>
      <button onClick={() => router.back()} className="text-text-secondary text-sm hover:text-white">← Go back</button>
    </div>
  )

  return (
    <div className="min-h-screen bg-background">

      {/* Header */}
      <div className="border-b border-border px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/home')}
            className="text-text-secondary hover:text-white transition-colors text-lg">←</button>
          <div>
            <h1 className="font-semibold text-sm">Coverage Map</h1>
            <p className="text-text-muted text-xs">
              {coverage?.computedAt
                ? `Updated ${new Date(coverage.computedAt).toLocaleDateString('en-GB')}`
                : 'No data yet'}
            </p>
          </div>
        </div>
        <button
          onClick={triggerRefresh}
          disabled={refreshing}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
            refreshing
              ? 'border-border text-text-muted cursor-not-allowed'
              : 'border-strava text-strava hover:bg-strava hover:text-white'
          }`}
        >
          {refreshing ? '⟳ Computing...' : '↺ Refresh data'}
        </button>
      </div>

      {/* Stats bar */}
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-6">
          <div>
            <div className="text-text-muted text-xs">Tiles covered</div>
            <div className="text-white font-semibold text-lg">{totalVisible.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-text-muted text-xs">UK + Ireland</div>
            <div className="text-strava font-semibold text-lg">{pctCovered}%</div>
          </div>
          {coverage?.activityCount ? (
            <div>
              <div className="text-text-muted text-xs">Activities</div>
              <div className="text-white font-semibold text-lg">{coverage.activityCount.toLocaleString()}</div>
            </div>
          ) : null}
          <div className="ml-auto text-right">
            <div className="text-text-muted text-xs">Date</div>
            <div className="text-white text-sm font-medium">{currentDateLabel}</div>
          </div>
        </div>
      </div>

      {/* Date filter */}
      <div className="border-b border-border px-4 py-3 flex items-center gap-3">
        <span className="text-text-muted text-xs flex-shrink-0">Filter:</span>
        <input
          type="date"
          value={dateFrom}
          onChange={e => { setDateFrom(e.target.value); setAnimProgress(1) }}
          className="bg-surface border border-border rounded-lg px-2 py-1 text-xs text-white"
        />
        <span className="text-text-muted text-xs">to</span>
        <input
          type="date"
          value={dateTo}
          onChange={e => { setDateTo(e.target.value); setAnimProgress(1) }}
          className="bg-surface border border-border rounded-lg px-2 py-1 text-xs text-white"
        />
        {(dateFrom || dateTo) && (
          <button
            onClick={() => { setDateFrom(''); setDateTo(''); setAnimProgress(1) }}
            className="text-xs text-text-muted hover:text-white transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Map */}
      {coverage?.tiles && coverage.tiles.length > 0 ? (
        <div className="relative" style={{ height: 'calc(100vh - 280px)', minHeight: '400px' }}>
          <CoverageMap
            tiles={filteredTiles}
            visibleTiles={visibleTiles}
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 px-4 gap-4">
          <div className="text-6xl">🗺️</div>
          <div className="text-white font-semibold text-center">No coverage data yet</div>
          <div className="text-text-muted text-sm text-center max-w-xs">
            Click "Refresh data" to compute your coverage map from your Strava activities.
            This may take a few minutes for large accounts.
          </div>
          <button
            onClick={triggerRefresh}
            disabled={refreshing}
            className="bg-strava text-white text-sm font-medium px-6 py-3 rounded-xl hover:bg-strava-dark transition-colors disabled:opacity-50"
          >
            {refreshing ? '⟳ Computing coverage...' : 'Compute my coverage'}
          </button>
        </div>
      )}

      {/* Animation + export controls */}
      {coverage?.tiles && coverage.tiles.length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={playing ? pauseAnimation : playAnimation}
              className="w-9 h-9 rounded-full bg-strava flex items-center justify-center text-white text-sm flex-shrink-0"
            >
              {playing ? '⏸' : '▶'}
            </button>
            <input
              type="range" min={0} max={100} value={Math.round(animProgress * 100)}
              onChange={e => {
                cancelAnimationFrame(animFrameRef.current)
                setPlaying(false)
                setAnimProgress(parseInt(e.target.value) / 100)
              }}
              className="flex-1 accent-strava"
            />
            <button
              onClick={resetAnimation}
              className="w-9 h-9 rounded-xl border border-border text-text-muted hover:text-white transition-colors text-sm"
            >↺</button>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={exporting ? undefined : exportVideo}
              disabled={exporting}
              className={`flex-1 text-sm font-medium py-2.5 rounded-xl transition-colors ${
                exporting
                  ? 'bg-surface border border-border text-text-muted cursor-not-allowed'
                  : 'bg-strava hover:bg-strava-dark text-white'
              }`}
            >
              {exporting ? 'Recording then converting to MP4…' : '⬇ Export animation MP4 (1080×1920)'}
            </button>
          </div>
          {exportError && <div className="mt-2 text-xs text-red-400">{exportError}</div>}
        </div>
      )}

      {/* Refresh in-progress banner */}
      {refreshing && (
        <div className="fixed bottom-4 left-4 right-4 bg-surface border border-strava rounded-2xl px-4 py-3 flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-strava border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <div>
            <div className="text-white text-sm font-medium">Computing coverage...</div>
            <div className="text-text-muted text-xs">Fetching GPS traces from Strava. This may take several minutes.</div>
          </div>
        </div>
      )}
    </div>
  )
}
