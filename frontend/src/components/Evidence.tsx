import { motion } from 'framer-motion'
import { useState } from 'react'
import { CLASS_NAMES, CLASS_SHORT, PALETTE_DEFAULT, STAGE_COLORS } from '../lib/colors'
import { fmtBytes, fmtInt } from '../lib/format'
import { CELL_LABELS } from '../lib/grid'
import { useApp } from '../store/app'

const ease = [0.16, 1, 0.3, 1] as const
const BANDS = ['0-10', '10-20', '20-40', '40-100']

/** Fallbacks are the real numbers from results/metrics.json (validation split). */
const D = {
  acc: { '0-10': 0.9006, '10-20': 0.8494, '20-40': 0.8932, '40-100': 0.9245 } as Record<string, number>,
  accClass: {
    '0-10': { drivable: 0.9249, terrain_nondrivable: 0.8083, static_obstacle: 0.804, dynamic_object: 0.9499 },
    '10-20': { drivable: 0.8845, terrain_nondrivable: 0.593, static_obstacle: 0.8958, dynamic_object: 0.8617 },
    '20-40': { drivable: 0.7003, terrain_nondrivable: 0.5825, static_obstacle: 0.9453, dynamic_object: 0.6833 },
    '40-100': { drivable: 0.0457, terrain_nondrivable: 0.0531, static_obstacle: 0.983, dynamic_object: 0.4799 },
  } as Record<string, Record<string, number | null>>,
  iou: { drivable: 0.8572, terrain_nondrivable: 0.5263, static_obstacle: 0.8724, dynamic_object: 0.7304 } as Record<string, number>,
  miou: 0.7466,
  cellAcc: 0.8724,
  retained: 0.9099,
  stages: { range_proj: 7.884, inference: 18.89, unproject: 0.432, projection: 11.322, encode: 2.169 } as Record<string, number>,
  p50: 41.16,
  p95: 46.8,
  fps: 24.3,
  mem: { varres: 4_275_200, u2d: 128_000_000, u3d: 1_920_000_000, r2d: 29.9, r3d: 449.1, wire: 245_467 },
  cells: { varres: 534_400, u2d: 16_000_000, occupied: 17_969 },
  points: 34_721,
  frames: 81,
}

const barMotion = (delay: number) => ({
  initial: { scaleY: 0 },
  whileInView: { scaleY: 1 },
  viewport: { once: true },
  transition: { duration: 0.9, ease, delay },
  style: { transformBox: 'fill-box' as const, transformOrigin: 'bottom' as const },
})

interface Tip {
  x: number
  y: number
  title: string
  value: string
}

function AccuracyChart({ acc, accClass }: { acc: Record<string, number>; accClass: Record<string, Record<string, number | null>> }) {
  const [tip, setTip] = useState<Tip | null>(null)
  const W = 900
  const H = 300
  const padL = 40
  const padB = 52
  const padT = 14
  const plotW = W - padL - 16
  const plotH = H - padB - padT
  const groupW = plotW / BANDS.length
  const series = ['all', ...CLASS_NAMES.slice(1)]
  const barW = (groupW * 0.72) / series.length
  const color = (k: string) => (k === 'all' ? '#D4FC79' : PALETTE_DEFAULT[CLASS_NAMES.indexOf(k as never)])
  const y = (v: number) => padT + plotH * (1 - v)

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Point accuracy by distance band and class">
        {[0, 0.25, 0.5, 0.75, 1].map(t => (
          <g key={t}>
            <line x1={padL} x2={W - 16} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.08)" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="axis">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {BANDS.map((b, bi) => {
          const gx = padL + bi * groupW + groupW * 0.14
          return (
            <g key={b}>
              {series.map((k, si) => {
                const v = k === 'all' ? acc[b] : (accClass[b]?.[k] ?? 0) || 0
                const x = gx + si * barW
                const label = k === 'all' ? 'All classes' : CLASS_SHORT[CLASS_NAMES.indexOf(k as never)]
                return (
                  <motion.rect
                    key={k}
                    className="bar-rect"
                    x={x + 1.5}
                    width={barW - 3}
                    y={y(v)}
                    height={Math.max(1.5, plotH * v)}
                    rx={3}
                    fill={color(k)}
                    opacity={tip && tip.title !== `${label} · ${b} m` ? 0.45 : 1}
                    onMouseEnter={() => setTip({ x: x + barW / 2, y: y(v), title: `${label} · ${b} m`, value: `${(v * 100).toFixed(1)}% accuracy` })}
                    onMouseLeave={() => setTip(null)}
                    {...barMotion(bi * 0.08 + si * 0.03)}
                  />
                )
              })}
              <text x={padL + bi * groupW + groupW / 2} y={H - 30} textAnchor="middle" className="lbl">
                {b} m
              </text>
              <text x={padL + bi * groupW + groupW / 2} y={H - 14} textAnchor="middle" className="axis">
                {CELL_LABELS[bi]} cells
              </text>
            </g>
          )
        })}
      </svg>
      {tip && (
        <div className="tooltip" style={{ left: `${(tip.x / W) * 100}%`, top: `${(tip.y / H) * 100}%`, transform: 'translate(-50%, -110%)', minWidth: 0 }}>
          <div className="tooltip__title">{tip.title}</div>
          <div style={{ color: '#D4FC79', fontWeight: 600 }}>{tip.value}</div>
        </div>
      )}
      <div className="chart-legend">
        {series.map(k => (
          <span key={k}>
            <i style={{ background: color(k) }} />
            {k === 'all' ? 'All classes' : CLASS_SHORT[CLASS_NAMES.indexOf(k as never)]}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function Evidence() {
  const m = useApp(s => s.metrics)
  const acc = m?.accuracy_by_distance ?? D.acc
  const accClass = m?.accuracy_by_distance_per_class ?? D.accClass
  const iou = m?.iou_per_class ?? D.iou
  const miou = m?.miou ?? D.miou
  const cellAcc = m?.cell_label_accuracy ?? D.cellAcc
  const retained = m?.obstacle_cells_retained_within_10m ?? D.retained
  const stages = m ? Object.fromEntries(Object.keys(D.stages).map(k => [k, (m.latency_ms as any)[k].p50 as number])) : D.stages
  const p50 = m?.latency_ms.p50 ?? D.p50
  const p95 = m?.latency_ms.p95 ?? D.p95
  const fps = m?.fps.total ?? D.fps
  const mem = m ? { varres: m.memory.varres_bytes, u2d: m.memory.uniform_2d_5cm_bytes, u3d: m.memory.uniform_3d_5cm_bytes, r2d: m.memory.reduction_2d, r3d: m.memory.reduction_3d, wire: m.memory.wire_bytes_msgpack } : D.mem
  const cells = m ? { varres: m.cells.varres, u2d: m.cells.uniform_2d_5cm, occupied: m.cells.occupied_mean } : D.cells
  const frames = m?.num_frames ?? D.frames
  const [hover, setHover] = useState<string | null>(null)
  const totalStage = Object.values(stages).reduce((a, b) => a + b, 0)

  const memRows: [string, number, string][] = [
    ['Adaptive 2.5D map', mem.varres, '#FF6B9D'],
    ['Uniform 2D · 5 cm', mem.u2d, '#9AA8BF'],
    ['Uniform 3D · 5 cm voxels', mem.u3d, '#6E6E74'],
  ]
  const lo = Math.log10(mem.varres) - 0.35
  const hi = Math.log10(mem.u3d)

  return (
    <section id="evidence" className="section section--light" data-theme="light">
      <div className="container">
        <motion.div className="section__head" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.4 }} transition={{ duration: 0.8, ease }}>
          <span className="eyebrow">Evidence</span>
          <h2 className="h2">
            Measured on <em>{frames} unseen frames</em>.
          </h2>
          <p className="lead">Latency, accuracy and memory from the benchmark run, not estimates.</p>
        </motion.div>

        <div className="charts">
          <motion.div className="card chart chart--wide" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }} transition={{ duration: 0.8, ease }}>
            <div className="chart__head">
              <div>
                <div className="chart__title">Accuracy across distance</div>
                <div className="chart__sub">Per distance band and class. Far rings can afford coarse cells.</div>
              </div>
              <span className="callout">{(acc['0-10'] * 100).toFixed(0)}% within 10 m</span>
            </div>
            <AccuracyChart acc={acc} accClass={accClass} />
          </motion.div>

          <motion.div className="card chart" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.8, ease, delay: 0.05 }}>
            <div className="chart__head">
              <div>
                <div className="chart__title">Segmentation quality</div>
                <div className="chart__sub">IoU per class, validation split.</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="chart__big num">{(miou * 100).toFixed(1)}%</div>
                <div className="chart__sub">mean IoU</div>
              </div>
            </div>
            <svg viewBox="0 0 420 200" role="img" aria-label="IoU per class">
              {CLASS_NAMES.slice(1).map((k, i) => {
                const v = iou[k] ?? 0
                const x = 20 + i * 100
                const h = 140 * v
                return (
                  <g key={k}>
                    <motion.rect className="bar-rect" x={x} y={150 - h} width={64} height={h} rx={6} fill={PALETTE_DEFAULT[i + 1]} {...barMotion(i * 0.08)}>
                      <title>{`${CLASS_SHORT[i + 1]}: IoU ${(v * 100).toFixed(1)}%`}</title>
                    </motion.rect>
                    <text x={x + 32} y={150 - h - 8} textAnchor="middle" className="val">
                      {(v * 100).toFixed(0)}%
                    </text>
                    <text x={x + 32} y={172} textAnchor="middle" className="lbl">
                      {CLASS_SHORT[i + 1]}
                    </text>
                  </g>
                )
              })}
              <line x1={14} x2={406} y1={150.5} y2={150.5} stroke="rgba(255,255,255,0.15)" />
            </svg>
            <div className="kpis" style={{ marginTop: 14 }}>
              <div className="kpi kpi--flat">
                <div className="kpi__v num" style={{ color: 'var(--ink)' }}>
                  {(cellAcc * 100).toFixed(1)}
                  <small style={{ color: 'var(--ink-3)' }}>%</small>
                </div>
                <div className="kpi__l" style={{ color: 'var(--ink-2)' }}>cell label accuracy after majority vote</div>
              </div>
              <div className="kpi kpi--flat">
                <div className="kpi__v num" style={{ color: 'var(--ink)' }}>
                  {(retained * 100).toFixed(0)}
                  <small style={{ color: 'var(--ink-3)' }}>%</small>
                </div>
                <div className="kpi__l" style={{ color: 'var(--ink-2)' }}>obstacle cells within 10 m preserved</div>
              </div>
            </div>
          </motion.div>

          <motion.div className="card chart" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.8, ease, delay: 0.1 }}>
            <div className="chart__head">
              <div>
                <div className="chart__title">Latency</div>
                <div className="chart__sub">Median per stage on a laptop GPU. Hover a segment.</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="chart__big num">{fps.toFixed(1)}</div>
                <div className="chart__sub">frames per second</div>
              </div>
            </div>
            <div className="stack" style={{ height: 22, marginTop: 22, background: 'rgba(255,255,255,0.08)' }}>
              {Object.entries(stages).map(([k, v], i) => (
                <motion.div
                  key={k}
                  style={{ background: STAGE_COLORS[k], flex: v, opacity: hover && hover !== k ? 0.35 : 1, cursor: 'help' }}
                  onMouseEnter={() => setHover(k)}
                  onMouseLeave={() => setHover(null)}
                  initial={{ scaleX: 0 }}
                  whileInView={{ scaleX: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.9, ease, delay: i * 0.05 }}
                  title={`${k.replace('_', ' ')}: ${v.toFixed(1)} ms`}
                />
              ))}
            </div>
            <div className="chart-legend">
              {Object.entries(stages).map(([k, v]) => (
                <span key={k} style={{ opacity: hover && hover !== k ? 0.4 : 1, transition: 'opacity 180ms' }} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)}>
                  <i style={{ background: STAGE_COLORS[k] }} />
                  {k.replace('_', ' ')} <b className="num">{v.toFixed(1)} ms</b>
                </span>
              ))}
            </div>
            <div className="kpis" style={{ marginTop: 18 }}>
              {[
                [p50.toFixed(1), 'ms', 'median latency (p50)'],
                [p95.toFixed(1), 'ms', '95th percentile'],
                [totalStage.toFixed(1), 'ms', 'sum of stage medians'],
                [fmtInt(D.points), 'pts', 'points per sweep'],
              ].map(([v, u, l]) => (
                <div key={l} className="kpi kpi--flat">
                  <div className="kpi__v num" style={{ color: 'var(--ink)' }}>
                    {v}
                    <small style={{ color: 'var(--ink-3)' }}>{u}</small>
                  </div>
                  <div className="kpi__l" style={{ color: 'var(--ink-2)' }}>{l}</div>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div className="card chart chart--wide" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.8, ease, delay: 0.1 }}>
            <div className="chart__head">
              <div>
                <div className="chart__title">Memory for the same 200 m × 200 m map</div>
                <div className="chart__sub">Bytes per frame, log scale. {fmtInt(cells.varres)} cells versus {fmtInt(cells.u2d)}.</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <span className="callout">{mem.r2d.toFixed(1)}× less than 2D</span>
                <span className="callout">{Math.round(mem.r3d)}× less than 3D</span>
              </div>
            </div>
            <div className="bars" style={{ marginTop: 22 }}>
              {memRows.map(([label, v, color], i) => {
                const pct = Math.max(5, ((Math.log10(v) - lo) / (hi - lo)) * 100)
                return (
                  <div className="bar" key={label} style={{ gridTemplateColumns: '190px 1fr auto' }}>
                    <span style={{ color: 'var(--ink-2)' }}>{label}</span>
                    <div className="bar__track" style={{ height: 14 }}>
                      <motion.div className="bar__fill" style={{ background: color, width: `${pct}%` }} initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ duration: 1, ease, delay: i * 0.1 }} />
                    </div>
                    <span className="bar__val">{fmtBytes(v, v > 1e9 ? 2 : v > 1e7 ? 0 : 2)}</span>
                  </div>
                )
              })}
            </div>
            <div className="chart-legend" style={{ marginTop: 16 }}>
              <span>
                <i style={{ background: '#D4FC79' }} />
                On the wire: {fmtBytes(mem.wire, 0)} per frame, only the ~{fmtInt(cells.occupied)} occupied cells
              </span>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
