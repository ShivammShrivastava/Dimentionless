import { useEffect, useMemo, useRef } from 'react'
import { fmtBytes, fmtInt } from '../../lib/format'
import { BYTES_PER_CELL, SAME_BUDGET_CELL_M, totalCells } from '../../lib/grid'
import { useApp } from '../../store/app'
import { RingPainter, UniformPainter, drawEgo, drawGrid, drawRingOutlines, type View } from './render'

export { SAME_BUDGET_CELL_M }

export default function Compare() {
  const wrap = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLCanvasElement>(null)
  const rightRef = useRef<HTMLCanvasElement>(null)
  const frame = useApp(s => s.frame)
  const dense = useApp(s => s.dense)
  const settings = useApp(s => s.settings)
  const rings = useApp(s => s.rings)

  const ringPainter = useRef(new RingPainter())
  const uniform = useMemo(() => new UniformPainter(settings.compareCell, rings), [settings.compareCell, rings])
  const view = useRef<View>({ scale: 6, cx: 0, cy: 0 })
  const size = useRef({ w: 0, h: 0, dpr: 1 })
  const dirty = useRef(true)

  useEffect(() => {
    if (!frame || !dense) return
    ringPainter.current.paint(frame, dense, settings)
    uniform.paint(frame, dense, settings)
    dirty.current = true
  }, [frame, dense, settings, uniform])

  useEffect(() => {
    const el = wrap.current!
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const w = r.width / 2
      const h = r.height
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      size.current = { w, h, dpr }
      for (const c of [leftRef.current!, rightRef.current!]) {
        c.width = Math.round(w * dpr)
        c.height = Math.round(h * dpr)
      }
      view.current = { scale: (Math.min(w, h) / 2 / 22) * 0.94, cx: w / 2, cy: h / 2 }
      dirty.current = true
    })
    ro.observe(el)

    let drag: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY }
      el.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (!drag) return
      view.current.cx += e.clientX - drag.x
      view.current.cy += e.clientY - drag.y
      drag = { x: e.clientX, y: e.clientY }
      dirty.current = true
    }
    const onUp = () => (drag = null)
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const sx = ((e.clientX - r.left) % size.current.w + size.current.w) % size.current.w
      const sy = e.clientY - r.top
      const v = view.current
      const f = Math.exp(-e.deltaY * 0.0016)
      const ns = Math.min(420, Math.max(1.5, v.scale * f))
      const k = ns / v.scale
      v.cx = sx - (sx - v.cx) * k
      v.cy = sy - (sy - v.cy) * k
      v.scale = ns
      dirty.current = true
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })

    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (!dirty.current) return
      dirty.current = false
      const { w, h, dpr } = size.current
      const v = view.current
      const L = leftRef.current!.getContext('2d')!
      const R = rightRef.current!.getContext('2d')!
      for (const ctx of [L, R]) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, w, h)
        drawGrid(ctx, v, w, h, 10)
      }
      ringPainter.current.draw(L, v, rings)
      drawRingOutlines(L, v, rings, true)
      drawEgo(L, v)
      uniform.draw(R, v)
      drawEgo(R, v)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('wheel', onWheel)
    }
  }, [rings, uniform])

  const uCells = uniform.U * uniform.U
  const adaptiveCells = totalCells(rings)
  const sameBudget = Math.abs(settings.compareCell - SAME_BUDGET_CELL_M) < 1e-6

  return (
    <div ref={wrap} className="dash__view" style={{ cursor: 'grab' }}>
      <div className="compare">
        <div>
          <canvas ref={leftRef} />
          <div className="compare__label">
            <b>Adaptive rings</b>
            {fmtInt(adaptiveCells)} cells · {fmtBytes(adaptiveCells * BYTES_PER_CELL, 2)} · <i>5 cm near the car</i>
          </div>
        </div>
        <div>
          <canvas ref={rightRef} />
          <div className="compare__label">
            <b>Uniform {Math.round(settings.compareCell * 100)} cm everywhere</b>
            {fmtInt(uCells)} cells · {fmtBytes(uCells * BYTES_PER_CELL, 2)} · <i>{sameBudget ? 'same memory budget' : `${(adaptiveCells / uCells).toFixed(1)}× fewer cells`}</i>
          </div>
        </div>
      </div>
      <div className="compare__badge">
        {sameBudget ? 'Same memory, same coverage. Compare the lane edges next to the car.' : 'A uniform grid must choose: coarse everywhere, or 16,000,000 cells at 5 cm.'}
      </div>
    </div>
  )
}
