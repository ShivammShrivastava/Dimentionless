import { useEffect, useRef, useState } from 'react'
import { CLASS_LABELS, PALETTE_CB, PALETTE_DEFAULT } from '../../lib/colors'
import type { DenseRing } from '../../lib/decode'
import { fmtInt } from '../../lib/format'
import { CELL_LABELS, EMPTY_CM, cellCenter, worldToCell, type CellRef } from '../../lib/grid'
import { actions, useApp } from '../../store/app'
import { RingPainter, drawCellHighlight, drawEgo, drawGrid, drawRingOutlines, drawSweep, screenToWorld, type View } from './render'

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
      {hover && (
        <div className="tooltip" style={{ left: tipLeft, top: tipTop }}>
          <div className="tooltip__title">
            <span className="swatch" style={{ background: hover.count ? palette[hover.label] : 'transparent', boxShadow: hover.count ? 'none' : 'inset 0 0 0 1.5px rgba(233,238,248,0.5)' }} />
            {hover.count ? CLASS_LABELS[hover.label] : 'Empty cell'}
          </div>
          <div className="tooltip__grid">
            <span>ring</span>
            <b>
              {hover.cell.ring} · {CELL_LABELS[hover.cell.ring]}
            </b>
            <span>cell (i, j)</span>
            <b>
              {hover.cell.i}, {hover.cell.j}
            </b>
            <span>world x, y</span>
            <b>
              {hover.x.toFixed(2)}, {hover.y.toFixed(2)} m
            </b>
            {hover.count > 0 && (
              <>
                <span>height max / min</span>
                <b>
                  {hover.zMax === EMPTY_CM ? '–' : (hover.zMax / 100).toFixed(2)} / {hover.zMin === EMPTY_CM ? '–' : (hover.zMin / 100).toFixed(2)} m
                </b>
                <span>points</span>
                <b>{fmtInt(hover.count)}</b>
                <span>confidence</span>
                <b>{Math.round((hover.conf / 255) * 100)}%</b>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
