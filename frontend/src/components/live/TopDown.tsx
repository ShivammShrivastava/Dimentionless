import { useEffect, useRef, useState } from 'react'
import { CLASS_LABELS, PALETTE_CB, PALETTE_DEFAULT } from '../../lib/colors'
import type { DenseRing } from '../../lib/decode'
import { fmtInt } from '../../lib/format'
import { CELL_LABELS, EMPTY_CM, cellCenter, worldToCell, type CellRef } from '../../lib/grid'
import { actions, useApp } from '../../store/app'
import { RingPainter, drawCellHighlight, drawEgo, drawGrid, drawRingOutlines, drawSweep, screenToWorld, type View } from './render'

/** Infer a specific object sub-type from label + height for richer tooltip display */
function inferSubtype(label: number, zMaxCm: number, zMinCm: number, pointCount: number): { name: string; desc: string; icon: string } {
  const heightM = zMaxCm === EMPTY_CM ? 0 : (zMaxCm - Math.max(zMinCm, -20)) / 100
  switch (label) {
    case 1: // drivable
      return { name: 'Road / Lane', desc: 'Drivable ground surface — safe for navigation.', icon: '🛣️' }
    case 2: // terrain_nondrivable
      return heightM > 0.15
        ? { name: 'Raised Terrain', desc: 'Elevated non-drivable ground — curb or embankment.', icon: '⛰️' }
        : { name: 'Non-drivable Terrain', desc: 'Sidewalk, grass or off-road surface.', icon: '🌿' }
    case 3: // static_obstacle
      if (heightM > 3.5) return { name: 'Building / Facade', desc: 'Tall static structure — building wall or facade.', icon: '🏢' }
      if (heightM > 1.5) return { name: 'Wall / Barrier', desc: 'Vertical static obstacle — wall, fence or barrier.', icon: '🧱' }
      if (heightM > 0.8 && pointCount < 25) return { name: 'Pole / Sign', desc: 'Narrow vertical object — lamppost, traffic sign or pole.', icon: '🚦' }
      return { name: 'Static Obstacle', desc: 'Stationary object blocking the path.', icon: '⛔' }
    case 4: // dynamic_object
      if (heightM > 1.2) return { name: 'Vehicle', desc: 'Moving vehicle detected — car, truck or bus.', icon: '🚗' }
      return { name: 'Pedestrian / Cyclist', desc: 'Moving person or cyclist in the scene.', icon: '🚶' }
    default:
      return { name: 'Unknown', desc: 'No classification available.', icon: '❓' }
  }
}

export interface FitRequest {
  radius: number
  nonce: number
}

export interface HoverInfo {
  sx: number
  sy: number
  x: number
  y: number
  cell: CellRef
  label: number
  zMax: number
  zMin: number
  conf: number
  count: number
}

export function readCell(dense: DenseRing[], cell: CellRef) {
  const d = dense[cell.ring]
  const p = cell.i * d.size + cell.j
  return { label: d.label[p], zMax: d.zMax[p], zMin: d.zMin[p], conf: d.conf[p], count: d.count[p] }
}

export default function TopDown({ fit }: { fit: FitRequest }) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frame = useApp(s => s.frame)
  const dense = useApp(s => s.dense)
  const settings = useApp(s => s.settings)
  const rings = useApp(s => s.rings)
  const pinned = useApp(s => s.pinned)
  const playing = useApp(s => s.player?.playing ?? false)

  const painter = useRef(new RingPainter())
  const view = useRef<View>({ scale: 8, cx: 0, cy: 0 })
  const size = useRef({ w: 0, h: 0, dpr: 1 })
  const dirty = useRef(true)
  const sweep = useRef(0)
  const denseRef = useRef<DenseRing[] | null>(null)
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const hoverRef = useRef<HoverInfo | null>(null)
  const [grabbing, setGrabbing] = useState(false)
  const initialised = useRef(false)

  denseRef.current = dense

  const fitTo = (radius: number) => {
    const { w, h } = size.current
    if (!w || !h) return
    view.current = { scale: (Math.min(w, h) / 2 / radius) * 0.94, cx: w / 2, cy: h / 2 }
    dirty.current = true
  }

  // raster pass: only when data or paint settings change
  useEffect(() => {
    if (frame && dense) {
      painter.current.paint(frame, dense, settings)
      dirty.current = true
    }
  }, [frame, dense, settings.layers, settings.confMin, settings.heightShade, settings.cbPalette])

  useEffect(() => {
    dirty.current = true
  }, [settings.showRings, pinned, hover])

  useEffect(() => {
    if (fit.nonce) fitTo(fit.radius)
  }, [fit])

  // resize
  useEffect(() => {
    const el = wrap.current!
    const canvas = canvasRef.current!
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const prev = { ...size.current }
      size.current = { w: r.width, h: r.height, dpr }
      canvas.width = Math.round(r.width * dpr)
      canvas.height = Math.round(r.height * dpr)
      if (!initialised.current) {
        initialised.current = true
        fitTo(45)
      } else if (prev.w) {
        // keep the world origin at the same relative position
        view.current.cx *= r.width / prev.w
        view.current.cy *= r.height / prev.h
      }
      dirty.current = true
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // composite loop
  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let last = performance.now()
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (t - last) / 1000)
      last = t
      if (playing) {
        sweep.current = (sweep.current + dt * 1.6) % (Math.PI * 2)
        dirty.current = true
      }
      if (!dirty.current) return
      dirty.current = false
      const { w, h, dpr } = size.current
      const v = view.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      drawGrid(ctx, v, w, h, v.scale > 20 ? 5 : 10)
      painter.current.draw(ctx, v, rings)
      if (playing) drawSweep(ctx, v, sweep.current, w, h)
      if (settings.showRings) drawRingOutlines(ctx, v, rings)
      drawEgo(ctx, v)
      const hv = hoverRef.current
      if (hv) {
        const [cx, cy] = cellCenter(hv.cell, rings)
        drawCellHighlight(ctx, v, cx, cy, rings[hv.cell.ring].cell_m, 'rgba(212,252,121,0.95)')
      }
      if (pinned) {
        const [cx, cy] = cellCenter(pinned, rings)
        drawCellHighlight(ctx, v, cx, cy, rings[pinned.ring].cell_m, '#FF6B9D')
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing, rings, settings.showRings, pinned])

  // pointer interactions
  useEffect(() => {
    const el = wrap.current!
    let drag: { x: number; y: number; moved: boolean } | null = null

    const local = (e: PointerEvent | WheelEvent) => {
      const r = el.getBoundingClientRect()
      return [e.clientX - r.left, e.clientY - r.top] as const
    }
    const updateHover = (sx: number, sy: number) => {
      const [x, y] = screenToWorld(view.current, sx, sy)
      const cell = worldToCell(x, y, rings)
      const d = denseRef.current
      if (!cell || !d) {
        hoverRef.current = null
        setHover(null)
        return
      }
      const c = readCell(d, cell)
      const info: HoverInfo = { sx, sy, x, y, cell, ...c }
      hoverRef.current = info
      setHover(info)
      dirty.current = true
    }
    const onDown = (e: PointerEvent) => {
      const [sx, sy] = local(e)
      drag = { x: sx, y: sy, moved: false }
      el.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      const [sx, sy] = local(e)
      if (drag) {
        const dx = sx - drag.x
        const dy = sy - drag.y
        if (Math.abs(dx) + Math.abs(dy) > 3) {
          drag.moved = true
          setGrabbing(true)
        }
        if (drag.moved) {
          view.current.cx += dx
          view.current.cy += dy
          drag.x = sx
          drag.y = sy
          dirty.current = true
          hoverRef.current = null
          setHover(null)
          return
        }
      }
      updateHover(sx, sy)
    }
    const onUp = (e: PointerEvent) => {
      if (drag && !drag.moved) {
        const [sx, sy] = local(e)
        const [x, y] = screenToWorld(view.current, sx, sy)
        const cell = worldToCell(x, y, rings)
        const d = denseRef.current
        if (cell && d && readCell(d, cell).count > 0) actions.pin(cell)
        else actions.pin(null)
      }
      drag = null
      setGrabbing(false)
    }
    const onLeave = () => {
      hoverRef.current = null
      setHover(null)
      dirty.current = true
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const [sx, sy] = local(e)
      const v = view.current
      const { w, h } = size.current
      const minScale = (Math.min(w, h) / 2 / 100) * 0.9
      const f = Math.exp(-e.deltaY * 0.0016)
      const ns = Math.min(420, Math.max(minScale, v.scale * f))
      const k = ns / v.scale
      v.cx = sx - (sx - v.cx) * k
      v.cy = sy - (sy - v.cy) * k
      v.scale = ns
      dirty.current = true
      updateHover(sx, sy)
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('wheel', onWheel)
    }
  }, [rings])

  const palette = settings.cbPalette ? PALETTE_CB : PALETTE_DEFAULT
  const tipLeft = hover ? (hover.sx > size.current.w - 240 ? hover.sx - 214 : hover.sx + 16) : 0
  const tipTop = hover ? (hover.sy > size.current.h - 170 ? hover.sy - 150 : hover.sy + 16) : 0

  return (
    <div ref={wrap} className={`dash__view ${grabbing ? 'is-grabbing' : ''}`} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} />
      {hover && (() => {
        const sub = hover.count > 0 ? inferSubtype(hover.label, hover.zMax, hover.zMin, hover.count) : null
        const color = hover.count ? palette[hover.label] : 'rgba(233,238,248,0.3)'
        const confPct = Math.round((hover.conf / 255) * 100)
        const heightM = hover.zMax !== EMPTY_CM ? (hover.zMax / 100).toFixed(2) : null
        return (
          <div className="tooltip tooltip--rich" style={{ left: tipLeft, top: tipTop, minWidth: 224 }}>
            {/* Class badge */}
            <div className="tooltip__badge" style={{ borderColor: color }}>
              <span className="tooltip__badge-icon">{sub?.icon ?? '○'}</span>
              <div>
                <div className="tooltip__badge-name" style={{ color }}>
                  {sub?.name ?? 'Open Road'}
                </div>
                <div className="tooltip__badge-cat">
                  {hover.count ? CLASS_LABELS[hover.label] : 'No obstacles detected'}
                </div>
              </div>
            </div>

            {/* Description */}
            {sub && (
              <p className="tooltip__desc">{sub.desc}</p>
            )}

            {/* Confidence bar */}
            {hover.count > 0 && (
              <div className="tooltip__conf">
                <div className="tooltip__conf-label">
                  <span>Confidence</span>
                  <b style={{ color }}>{confPct}%</b>
                </div>
                <div className="tooltip__conf-track">
                  <div className="tooltip__conf-fill" style={{ width: `${confPct}%`, background: color }} />
                </div>
              </div>
            )}

            {/* Stats grid */}
            <div className="tooltip__grid" style={{ marginTop: 8 }}>
              <span>Distance</span>
              <b>{Math.hypot(hover.x, hover.y).toFixed(1)} m from ego</b>
              {heightM && (
                <>
                  <span>Height</span>
                  <b>{heightM} m</b>
                </>
              )}
              <span>Resolution</span>
              <b>Ring {hover.cell.ring} · {CELL_LABELS[hover.cell.ring]}</b>
              {hover.count > 0 && (
                <>
                  <span>Points</span>
                  <b>{fmtInt(hover.count)} in cell</b>
                </>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
