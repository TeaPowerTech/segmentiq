'use client'

// SSR-disabled component — safe to use browser APIs
import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'

interface TileHit {
  x: number
  y: number
  date: string
  count: number
}

interface Props {
  tiles: TileHit[]
  visibleTiles: Set<string>
}

const ZOOM = 14

function tileToLatLon(x: number, y: number): [number, number] {
  const n = Math.pow(2, ZOOM)
  const lon = x / n * 360 - 180
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)))
  const lat = latRad * 180 / Math.PI
  return [lat, lon]
}

export default function CoverageMapInner({ tiles, visibleTiles }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const canvasLayerRef = useRef<any>(null)
  const tilesRef = useRef(tiles)
  const visibleRef = useRef(visibleTiles)

  tilesRef.current = tiles
  visibleRef.current = visibleTiles

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    // Dynamic require — Leaflet must not run on server
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const L = require('leaflet')
    const map = L.map(containerRef.current, {
      center: [54.5, -3.5],
      zoom: 6,
      minZoom: 5,
      maxZoom: 12,
      zoomControl: true,
      attributionControl: true,
    })

    // CartoDB dark tiles — free, no API key, matches app dark theme
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
    }).addTo(map)

    // Custom canvas overlay for tile rendering
    // Much faster than individual L.rectangle calls for large datasets
    const CanvasLayer = L.Layer.extend({
      onAdd(m: any) {
        this._map = m
        this._canvas = L.DomUtil.create('canvas', 'leaflet-coverage-canvas')
        const size = m.getSize()
        this._canvas.width = size.x
        this._canvas.height = size.y
        Object.assign(this._canvas.style, {
          position: 'absolute',
          top: '0',
          left: '0',
          pointerEvents: 'none',
          zIndex: '400',
        })
        m.getPanes().overlayPane.appendChild(this._canvas)
        m.on('moveend zoomend resize', this._redraw, this)
        this._redraw()
      },
      onRemove(m: any) {
        m.getPanes().overlayPane.removeChild(this._canvas)
        m.off('moveend zoomend resize', this._redraw, this)
      },
      _redraw() {
        const map = this._map
        const canvas = this._canvas
        const size = map.getSize()
        canvas.width = size.x
        canvas.height = size.y
        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, size.x, size.y)

        const tiles = tilesRef.current
        const visible = visibleRef.current
        if (!tiles.length || !visible.size) return

        let maxCount = 1
        for (const t of tiles) {
          if (visible.has(`${t.x},${t.y}`) && t.count > maxCount) maxCount = t.count
        }

        for (const tile of tiles) {
          if (!visible.has(`${tile.x},${tile.y}`)) continue

          // Convert tile NW and SE corners to pixel coords
          const [lat1, lon1] = tileToLatLon(tile.x, tile.y)
          const [lat2, lon2] = tileToLatLon(tile.x + 1, tile.y + 1)

          const p1 = map.latLngToContainerPoint([lat1, lon1])
          const p2 = map.latLngToContainerPoint([lat2, lon2])

          const px = Math.min(p1.x, p2.x)
          const py = Math.min(p1.y, p2.y)
          const pw = Math.abs(p2.x - p1.x)
          const ph = Math.abs(p2.y - p1.y)

          if (pw < 0.5 || ph < 0.5) continue // Skip sub-pixel tiles

          const intensity = Math.min(tile.count / maxCount, 1)
          const alpha = 0.25 + intensity * 0.75
          ctx.fillStyle = `rgba(252, 76, 2, ${alpha.toFixed(2)})`
          ctx.fillRect(px, py, Math.max(pw, 1), Math.max(ph, 1))
        }
      },
      redraw() {
        if (this._map) this._redraw()
      },
    })

    const layer = new CanvasLayer()
    layer.addTo(map)
    canvasLayerRef.current = layer
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      canvasLayerRef.current = null
    }
  }, [])

  // Trigger redraw when tiles or visibility changes
  useEffect(() => {
    if (canvasLayerRef.current) {
      canvasLayerRef.current.redraw()
    }
  }, [tiles, visibleTiles])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', background: '#1a1a2e' }}
    />
  )
}
