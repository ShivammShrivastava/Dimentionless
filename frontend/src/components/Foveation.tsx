import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { PALETTE_DEFAULT, hexToRgb } from '../lib/colors'
import { fmtBytes, fmtInt } from '../lib/format'
import { CELL_LABELS, DEFAULT_RINGS, ringOf } from '../lib/grid'
import { useApp } from '../store/app'

const ease = [0.16, 1, 0.3, 1] as const

/* ---------------------------------------------------------- lens canvas */
function LensCanvas({ dist, onDist }: { dist: number; onDist: (d: number, fromMouse: boolean) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const target = useRef<{ x: number; y: number } | null>(null)
  const lens = useRef({ x: 0, y: 0 })
  const distRef = useRef(dist)
  const onDistRef = useRef(onDist)
  distRef.current = dist
  onDistRef.current = onDist

  useEffect(() => {
    const onDist = (d: number, m: boolean) => onDistRef.current(d, m)
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const rgb = PALETTE_DEFAULT.map(hexToRgb)
    let w = 0
    let h = 0
    let raf = 0
    const wrap = canvas.parentElement!
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const r = wrap.getBoundingClientRect()
      if (Math.abs(r.width - w) < 0.5 && Math.abs(r.height - h) < 0.5 && canvas.width === Math.round(r.width * dpr)) return
      w = r.width
      h = r.height
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    const hash = (a: number, b: number) => {
      let x = (a * 73856093) ^ (b * 19349663)
      x = ((x >>> 13) ^ x) * 1274126177
      return ((x >>> 16) & 0xffff) / 65535
    }

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const ppm = (Math.min(w, h) * 0.9) / 200
      const cx = w / 2
      const cy = h / 2
      const toS = (x: number, y: number) => [cx - y * ppm, cy - x * ppm] as const
      ctx.clearRect(0, 0, w, h)

      // ring fills and outlines
      const alphas = [0.09, 0.065, 0.045, 0.028]
      for (let r = DEFAULT_RINGS.length - 1; r >= 0; r--) {
        const s = DEFAULT_RINGS[r].outer_m * ppm
        ctx.fillStyle = `rgba(212,252,121,${alphas[r]})`
        ctx.fillRect(cx - s, cy - s, 2 * s, 2 * s)
      }
      ctx.lineWidth = 1
      ctx.font = '600 11px Inter, system-ui, sans-serif'
      ctx.textBaseline = 'top'
      for (let r = 0; r < DEFAULT_RINGS.length; r++) {
        const s = DEFAULT_RINGS[r].outer_m * ppm
        ctx.strokeStyle = `rgba(212,252,121,${0.5 - r * 0.1})`
        ctx.strokeRect(cx - s, cy - s, 2 * s, 2 * s)
        ctx.fillStyle = 'rgba(233,238,248,0.7)'
        ctx.fillText(`${DEFAULT_RINGS[r].outer_m} m · ${CELL_LABELS[r]}`, cx - s + 6, cy - s + 5)
      }
      // ego
      const [ex, ey] = toS(0, 0)
      ctx.fillStyle = '#FFFFFF'
      ctx.beginPath()
      ctx.roundRect(ex - 3, ey - 6, 6, 12, 2)
      ctx.fill()

      // probe point: mouse or on the forward axis at `dist`
      const p = target.current ?? { x: Math.min(distRef.current, 99.5), y: 0 }
      const [px, py] = toS(p.x, p.y)
      const ring = Math.max(0, ringOf(p.x, p.y))
      const cell = DEFAULT_RINGS[ring].cell_m

      // lens eases toward the probe, offset to keep it visible
      const R = Math.min(w, h) * 0.17
      const tx = px + (px > w / 2 ? -R - 26 : R + 26)
      const ty = py + (py > h / 2 ? -R * 0.4 : R * 0.4)
      lens.current.x += (tx - lens.current.x) * 0.18
      lens.current.y += (ty - lens.current.y) * 0.18
      const lx = lens.current.x
      const ly = lens.current.y

      // connector + probe marker
      ctx.strokeStyle = 'rgba(255,107,157,0.7)'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(lx, ly)
      ctx.stroke()
      ctx.fillStyle = '#FF6B9D'
      ctx.beginPath()
      ctx.arc(px, py, 4, 0, Math.PI * 2)
      ctx.fill()

      // lens: a 3 m window drawn at true cell size
      const windowM = 3
      const zoom = (2 * R) / windowM // px per metre inside the lens
      ctx.save()
      ctx.beginPath()
      ctx.arc(lx, ly, R, 0, Math.PI * 2)
      ctx.clip()
      ctx.fillStyle = '#0B1223'
      ctx.fillRect(lx - R, ly - R, 2 * R, 2 * R)
      const cellsAcross = Math.ceil(windowM / cell) + 2
      const x0 = Math.floor((p.x - windowM / 2) / cell)
      const y0 = Math.floor((p.y - windowM / 2) / cell)
      for (let a = 0; a < cellsAcross; a++) {
        for (let b = 0; b < cellsAcross; b++) {
          const ci = x0 + a
          const cj = y0 + b
          const hsh = hash(ci, cj)
          // synthetic occupancy: road near the axis, terrain further out, occasional obstacle
          const wy = (cj + 0.5) * cell
          let cls = 0
          if (Math.abs(wy) < 7 && hsh < 0.7) cls = 1
          else if (Math.abs(wy) >= 7 && Math.abs(wy) < 12 && hsh < 0.5) cls = 2
          else if (hsh > 0.93) cls = 3
          if (hsh > 0.985) cls = 4
          if (!cls) continue
          const c = rgb[cls]
          const sx = lx + ((cj + 0.5) * cell - p.y) * -zoom - (cell * zoom) / 2
          const sy = ly + ((ci + 0.5) * cell - p.x) * -zoom - (cell * zoom) / 2
          ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.85)`
          ctx.fillRect(sx, sy, cell * zoom, cell * zoom)
        }
      }
      // grid lines
      ctx.strokeStyle = 'rgba(212,252,121,0.35)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let a = 0; a <= cellsAcross; a++) {
        const gx = lx + ((y0 + a) * cell - p.y) * -zoom
        const gy = ly + ((x0 + a) * cell - p.x) * -zoom
        ctx.moveTo(gx, ly - R)
        ctx.lineTo(gx, ly + R)
        ctx.moveTo(lx - R, gy)
        ctx.lineTo(lx + R, gy)
      }
      ctx.stroke()
      ctx.restore()
      ctx.strokeStyle = 'rgba(212,252,121,0.9)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(lx, ly, R, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = 'rgba(233,238,248,0.9)'
      ctx.font = '600 11px Inter, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(`${CELL_LABELS[ring]} cells · 3 m window`, lx, ly + R + 8)
      ctx.textAlign = 'left'
    }
    raf = requestAnimationFrame(draw)

    const toWorld = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      const ppm = (Math.min(r.width, r.height) * 0.9) / 200
      const x = (r.height / 2 - (e.clientY - r.top)) / ppm
      const y = (r.width / 2 - (e.clientX - r.left)) / ppm
      return { x, y }
    }
    const onMove = (e: PointerEvent) => {
      const p = toWorld(e)
      if (Math.max(Math.abs(p.x), Math.abs(p.y)) >= 100) return
      target.current = p
      onDist(Math.max(Math.abs(p.x), Math.abs(p.y)), true)
    }
    const onLeave = () => (target.current = null)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return <canvas ref={ref} className="fov__canvas" />
}

/* ---------------------------------------------------------- section */
export default function Foveation() {
  const metrics = useApp(s => s.metrics)
  const [dist, setDist] = useState(6)
  const [metric, setMetric] = useState<'cells' | 'memory'>('memory')
  const ring = Math.max(0, ringOf(dist, 0))
  const spec = DEFAULT_RINGS[ring]
  const perM2 = Math.round(1 / (spec.cell_m * spec.cell_m))

  const varres = metrics?.memory.varres_bytes ?? 4_275_200
  const u2d = metrics?.memory.uniform_2d_5cm_bytes ?? 128_000_000
  const u3d = metrics?.memory.uniform_3d_5cm_bytes ?? 1_920_000_000
  const rows =
    metric === 'memory'
      ? [
          ['Adaptive 2.5D (this work)', varres, fmtBytes(varres, 2), '#FF6B9D'],
          ['Uniform 2D, 5 cm', u2d, fmtBytes(u2d, 0), '#9AA8BF'],
          ['Uniform 3D, 5 cm voxels', u3d, fmtBytes(u3d, 2), '#1E293B'],
        ]
      : [
          ['Adaptive 2.5D (this work)', 534_400, `${fmtInt(534_400)} cells`, '#FF6B9D'],
          ['Uniform 2D, 5 cm', 16_000_000, `${fmtInt(16_000_000)} cells`, '#9AA8BF'],
          ['Uniform 3D, 5 cm voxels', 1_920_000_000, `${fmtInt(1_920_000_000)} voxels`, '#1E293B'],
        ]
  const lo = Math.log10(rows[0][1] as number) - 0.4
  const hi = Math.log10(rows[2][1] as number)

  return (
    <section id="foveation" className="section section--light" data-theme="light">
      <div className="container grid-2">
        <div>
          <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.4 }} transition={{ duration: 0.8, ease }}>
            <span className="eyebrow">Why foveation</span>
            <h2 className="h2">
              Resolution that follows <em>distance</em>, like your own eyes.
            </h2>
            <p className="lead">
              A full 3D point cloud is too heavy to process every frame, and a flat 2D occupancy grid throws away the height that tells a curb from a road. The map here keeps both
              in balance: 5 cm cells within 10 m for safety, 50 cm cells out to 100 m for range, with an elevation column and a semantic label in every cell.
            </p>
          </motion.div>
          <motion.ul className="list" initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }} variants={{ hidden: {}, show: { transition: { staggerChildren: 0.1 } } }}>
            {[
              ['Terrain analysis', 'Drivable surface versus non-drivable terrain, per cell, with a confidence score from the majority vote.'],
              ['Object detection', 'Static obstacles such as walls, poles and vegetation, and dynamic objects such as pedestrians and vehicles, in coral.'],
              ['Adaptive spatial representation', 'Four square rings keyed on Chebyshev distance. Boundaries are multiples of every cell size, so nothing straddles or is lost.'],
            ].map(([t, d], i) => (
              <motion.li key={t} variants={{ hidden: { opacity: 0, x: -18 }, show: { opacity: 1, x: 0, transition: { duration: 0.6, ease } } }}>
                <span className="list__num">{i + 1}</span>
                <div>
                  <b>{t}</b>
                  <span>{d}</span>
                </div>
              </motion.li>
            ))}
          </motion.ul>
        </div>

        <motion.div className="fov" initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.9, ease, delay: 0.1 }}>
          <div className="fov__canvas-wrap">
            <LensCanvas dist={dist} onDist={d => setDist(d)} />
            <div className="fov__tip">
              Move over the map or drag the slider · lens shows <b>true cell size</b>
            </div>
          </div>
          <div className="fov__controls">
            <input className="range" type="range" min={0} max={99.5} step={0.5} value={dist} onChange={e => setDist(parseFloat(e.target.value))} aria-label="Distance from sensor" />
            <div className="readout">
              <span>
                Distance <b className="num">{dist.toFixed(1)} m</b>
              </span>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={ring} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3, ease }}>
                  Ring {ring} · <b className="num">{CELL_LABELS[ring]}</b> cells · {fmtInt(perM2)} per m²
                </motion.span>
              </AnimatePresence>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 6 }}>
              <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>Same 200 m × 200 m coverage</span>
              <div className="segmented" role="tablist">
                {(['memory', 'cells'] as const).map(m => (
                  <button key={m} className={metric === m ? 'is-active' : ''} onClick={() => setMetric(m)} role="tab" aria-selected={metric === m}>
                    {metric === m && <motion.span layoutId="fov-seg" className="seg-bg" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
                    <span>{m === 'memory' ? 'Memory' : 'Cells'}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="bars">
              {rows.map(([label, v, txt, color]) => {
                const pct = Math.max(6, ((Math.log10(v as number) - lo) / (hi - lo)) * 100)
                return (
                  <div className="bar" key={label as string}>
                    <span style={{ color: 'var(--ink-2)' }}>{label}</span>
                    <div className="bar__track">
                      <motion.div
                        className="bar__fill"
                        style={{ background: color as string, width: `${pct}%` }}
                        initial={{ scaleX: 0 }}
                        whileInView={{ scaleX: 1 }}
                        viewport={{ once: true }}
                        transition={{ duration: 1, ease }}
                        layout
                      />
                    </div>
                    <span className="bar__val">{txt}</span>
                  </div>
                )
              })}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                <span className="callout">
                  {(metrics?.memory.reduction_2d ?? 29.9).toFixed(1)}× <span style={{ color: '#E9EEF8', fontWeight: 500 }}>vs uniform 2D</span>
                </span>
                <span className="callout">
                  {Math.round(metrics?.memory.reduction_3d ?? 449)}× <span style={{ color: '#E9EEF8', fontWeight: 500 }}>vs uniform 3D</span>
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
