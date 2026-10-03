import { motion } from 'framer-motion'
import { useState } from 'react'
import { CLASS_NAMES, CLASS_SHORT, PALETTE_DEFAULT, STAGE_COLORS } from '../lib/colors'
import { fmtInt } from '../lib/format'
import { useApp } from '../store/app'

const ease = [0.16, 1, 0.3, 1] as const

const D = {
  iou: { drivable: 0.8572, terrain_nondrivable: 0.5263, static_obstacle: 0.8724, dynamic_object: 0.7304 } as Record<string, number>,
  miou: 0.7466,
  cellAcc: 0.8724,
  retained: 0.9099,
  stages: { range_proj: 7.884, inference: 18.89, unproject: 0.432, projection: 11.322, encode: 2.169 } as Record<string, number>,
  p50: 41.16,
  p95: 46.8,
  fps: 24.3,
  points: 34_721,
  frames: 81,
}

export default function Evidence() {
  const m = useApp(s => s.metrics)
  const iou = m?.iou_per_class ?? D.iou
  const miou = m?.miou ?? D.miou
  const cellAcc = m?.cell_label_accuracy ?? D.cellAcc
  const retained = m?.obstacle_cells_retained_within_10m ?? D.retained
  const stages = m ? Object.fromEntries(Object.keys(D.stages).map(k => [k, (m.latency_ms as any)[k].p50 as number])) : D.stages
  const p50 = m?.latency_ms.p50 ?? D.p50
  const p95 = m?.latency_ms.p95 ?? D.p95
  const fps = m?.fps.total ?? D.fps
  const frames = m?.num_frames ?? D.frames
  const [hover, setHover] = useState<string | null>(null)
  const totalStage = Object.values(stages).reduce((a, b) => a + b, 0)

  return (
    <section
      id="evidence"
      className="section section--light"
      data-theme="light"
      style={{ padding: 'clamp(16px, 2.5vh, 32px) 0', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
    >
      <div className="container">
        {/* Compact header */}
        <motion.div
          className="section__head"
          style={{ marginBottom: 'clamp(10px, 1.5vh, 18px)' }}
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.7, ease }}
        >
          <span className="eyebrow">Evidence</span>
          <h2 className="h2" style={{ fontSize: 'clamp(1.35rem, 2.2vw, 1.9rem)' }}>
            Measured on <em>{frames} unseen frames</em>.
          </h2>
          <p className="lead" style={{ fontSize: '0.82rem', marginTop: 4 }}>
            Latency, accuracy and memory from the benchmark run, not estimates.
          </p>
        </motion.div>

        {/* Two-column charts */}
        <div className="charts" style={{ gap: 14 }}>
          {/* Segmentation quality */}
          <motion.div
            className="card chart"
            style={{ padding: '12px 16px' }}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.7, ease, delay: 0.05 }}
          >
            <div className="chart__head">
              <div>
                <div className="chart__title" style={{ fontSize: '0.9rem' }}>Segmentation quality</div>
                <div className="chart__sub">IoU per class, validation split.</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="chart__big num" style={{ fontSize: '1.6rem' }}>{(miou * 100).toFixed(1)}%</div>
                <div className="chart__sub">mean IoU</div>
              </div>
            </div>

            {/* Smaller SVG capped with clamp height */}
            <svg viewBox="0 0 420 160" role="img" aria-label="IoU per class" style={{ marginTop: 6, height: 'clamp(90px, 13vh, 120px)', width: '100%' }}>
              {CLASS_NAMES.slice(1).map((k, i) => {
                const v = iou[k] ?? 0
                const x = 20 + i * 100
                const h = 110 * v
                return (
                  <g key={k}>
                    <motion.rect
                      className="bar-rect"
                      x={x} y={110 - h} width={64} height={h} rx={5}
                      fill={PALETTE_DEFAULT[i + 1]}
                      initial={{ scaleY: 0 }}
                      whileInView={{ scaleY: 1 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.9, ease, delay: i * 0.08 }}
                      style={{ transformBox: 'fill-box' as const, transformOrigin: 'bottom' as const }}
                    >
                      <title>{`${CLASS_SHORT[i + 1]}: IoU ${(v * 100).toFixed(1)}%`}</title>
                    </motion.rect>
                    <text x={x + 32} y={110 - h - 7} textAnchor="middle" className="val">
                      {(v * 100).toFixed(0)}%
                    </text>
                    <text x={x + 32} y={132} textAnchor="middle" className="lbl">
                      {CLASS_SHORT[i + 1]}
                    </text>
                  </g>
                )
              })}
              <line x1={14} x2={406} y1={110.5} y2={110.5} stroke="rgba(255,255,255,0.15)" />
            </svg>

            <div className="kpis" style={{ marginTop: 8, gap: 6 }}>
              <div className="kpi kpi--flat" style={{ padding: '7px 10px' }}>
                <div className="kpi__v num" style={{ color: 'var(--ink)', fontSize: '1.25rem' }}>
                  {(cellAcc * 100).toFixed(1)}<small style={{ color: 'var(--ink-3)' }}>%</small>
                </div>
                <div className="kpi__l" style={{ color: 'var(--ink-2)', fontSize: '10.5px' }}>cell label accuracy</div>
              </div>
              <div className="kpi kpi--flat" style={{ padding: '7px 10px' }}>
                <div className="kpi__v num" style={{ color: 'var(--ink)', fontSize: '1.25rem' }}>
                  {(retained * 100).toFixed(0)}<small style={{ color: 'var(--ink-3)' }}>%</small>
                </div>
                <div className="kpi__l" style={{ color: 'var(--ink-2)', fontSize: '10.5px' }}>obstacle cells within 10 m</div>
              </div>
            </div>
          </motion.div>

          {/* Latency */}
          <motion.div
            className="card chart"
            style={{ padding: '12px 16px' }}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.7, ease, delay: 0.1 }}
          >
            <div className="chart__head">
              <div>
                <div className="chart__title" style={{ fontSize: '0.9rem' }}>Latency</div>
                <div className="chart__sub">Median per stage on GPU.</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="chart__big num" style={{ fontSize: '1.6rem' }}>{fps.toFixed(1)}</div>
                <div className="chart__sub">frames / sec</div>
              </div>
            </div>

            <div className="stack" style={{ height: 14, marginTop: 12, background: 'rgba(255,255,255,0.08)' }}>
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

            <div className="chart-legend" style={{ marginTop: 8, fontSize: '10.5px', gap: '2px 8px' }}>
              {Object.entries(stages).map(([k, v]) => (
                <span key={k} style={{ opacity: hover && hover !== k ? 0.4 : 1, transition: 'opacity 180ms' }} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)}>
                  <i style={{ background: STAGE_COLORS[k] }} />
                  {k.replace('_', ' ')} <b className="num">{v.toFixed(1)} ms</b>
                </span>
              ))}
            </div>

            <div className="kpis" style={{ marginTop: 10, gap: 6 }}>
              {[
                [p50.toFixed(1), 'ms', 'median (p50)'],
                [p95.toFixed(1), 'ms', '95th pct'],
                [totalStage.toFixed(1), 'ms', 'stage sum'],
                [fmtInt(D.points), 'pts', 'pts / sweep'],
              ].map(([v, u, l]) => (
                <div key={l} className="kpi kpi--flat" style={{ padding: '7px 10px' }}>
                  <div className="kpi__v num" style={{ color: 'var(--ink)', fontSize: '1.25rem' }}>
                    {v}<small style={{ color: 'var(--ink-3)' }}>{u}</small>
                  </div>
                  <div className="kpi__l" style={{ color: 'var(--ink-2)', fontSize: '10.5px' }}>{l}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
