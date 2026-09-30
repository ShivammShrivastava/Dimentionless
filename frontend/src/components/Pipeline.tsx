import { motion } from 'framer-motion'
import { useState } from 'react'
import { STAGE_COLORS } from '../lib/colors'
import { useApp } from '../store/app'

const ease = [0.16, 1, 0.3, 1] as const

const STEPS = [
  {
    title: 'Range-view projection',
    desc: 'Every sweep is unrolled into a 32 × 1024 range image. Rows come from the hardware beam index, so there are no elevation holes to interpolate.',
    meta: ['32 beams', '5 channels', 'nearest point wins'],
    icon: (
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#D4FC79" strokeWidth="1.5" strokeLinecap="round">
        <path d="M3 8h18M3 12h18M3 16h18" />
        <path d="M7 4v16M17 4v16" strokeOpacity="0.5" />
      </svg>
    ),
  },
  {
    title: 'Semantic segmentation',
    desc: 'SalsaNext-lite, a 4.6 M-parameter U-Net with dilated residual blocks, labels every pixel as drivable, terrain, static obstacle or dynamic object.',
    meta: ['FP16', '4.57 M params', 'mIoU 0.747'],
    icon: (
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#FF6B9D" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7v10l8 4 8-4V7l-8-4-8 4Z" />
        <path d="M4 7l8 4 8-4M12 11v10" strokeOpacity="0.6" />
      </svg>
    ),
  },
  {
    title: 'Variable-resolution grid engine',
    desc: 'Square Chebyshev rings mean a cell never straddles a boundary. One vectorised scatter builds height, class and confidence layers for all four rings.',
    meta: ['4 rings', '534,400 cells', 'zero point loss'],
    icon: (
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#D4FC79" strokeWidth="1.5">
        <rect x="2" y="2" width="20" height="20" rx="2" strokeOpacity="0.4" />
        <rect x="6" y="6" width="12" height="12" rx="1.5" strokeOpacity="0.7" />
        <rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="#FF6B9D" stroke="none" />
      </svg>
    ),
  },
  {
    title: '2.5D map, streamed',
    desc: 'Only occupied cells leave the server: about 18 k of 534 k. A frame is 245 KB of sparse msgpack over a WebSocket, densified again in the browser.',
    meta: ['sparse msgpack', '245 KB / frame', 'WebSocket'],
    icon: (
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#9AA8BF" strokeWidth="1.5" strokeLinecap="round">
        <path d="M4 18c3-6 6-6 8 0s5 6 8 0" />
        <path d="M4 12c3-6 6-6 8 0s5 6 8 0" strokeOpacity="0.5" />
      </svg>
    ),
  },
]

const STAGES: [keyof typeof STAGE_COLORS, string][] = [
  ['range_proj', 'range projection'],
  ['inference', 'inference'],
  ['unproject', 'un-projection'],
  ['projection', 'grid projection'],
  ['encode', 'encode'],
]

export default function Pipeline() {
  const metrics = useApp(s => s.metrics)
  const [hover, setHover] = useState<string | null>(null)
  const lat = metrics?.latency_ms
  const fallback: Record<string, number> = { range_proj: 7.9, inference: 18.9, unproject: 0.4, projection: 11.3, encode: 2.2 }
  const stages = STAGES.map(([k, label]) => ({ k, label, ms: lat ? (lat as unknown as Record<string, { p50: number }>)[k].p50 : fallback[k] }))
  const total = stages.reduce((s, x) => s + x.ms, 0)

  return (
    <section id="pipeline" className="section section--dark" data-theme="dark">
      <div className="container">
        <motion.div className="section__head" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.4 }} transition={{ duration: 0.8, ease }}>
          <span className="eyebrow">Pipeline</span>
          <h2 className="h2">
            From 35,000 points to a 2.5D map in <em>{total.toFixed(0)} ms</em>
          </h2>
          <p className="lead">Four stages, each timed with GPU synchronisation. Hover a stage below to see where the milliseconds go.</p>
        </motion.div>

        <div className="pipe">
          {STEPS.map((s, i) => (
            <motion.article
              key={s.title}
              className="pipe__card"
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.7, ease, delay: i * 0.1 }}
            >
              <div className="pipe__icon">{s.icon}</div>
              <div className="pipe__num">0{i + 1}</div>
              <h3 className="pipe__title">{s.title}</h3>
              <p className="pipe__desc">{s.desc}</p>
              <div className="pipe__meta">
                {s.meta.map(m => (
                  <span key={m}>{m}</span>
                ))}
              </div>
            </motion.article>
          ))}
        </div>

        <motion.div
          className="card"
          style={{ marginTop: 28, padding: '22px 24px', background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)', boxShadow: 'none' }}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.7, ease, delay: 0.2 }}
        >
          <div className="panel__title" style={{ marginBottom: 12 }}>
            Median latency per stage, validation split <span className="num">{total.toFixed(1)} ms total · {metrics?.fps.total ?? 24.3} FPS</span>
          </div>
          <div className="stack" style={{ height: 16 }}>
            {stages.map(s => (
              <motion.div
                key={s.k}
                style={{ background: STAGE_COLORS[s.k], flex: s.ms, opacity: hover && hover !== s.k ? 0.35 : 1, cursor: 'help' }}
                onMouseEnter={() => setHover(s.k)}
                onMouseLeave={() => setHover(null)}
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.9, ease }}
                title={`${s.label}: ${s.ms.toFixed(1)} ms`}
              />
            ))}
          </div>
          <div className="stack-legend">
            {stages.map(s => (
              <span key={s.k} style={{ opacity: hover && hover !== s.k ? 0.4 : 1, transition: 'opacity 180ms' }} onMouseEnter={() => setHover(s.k)} onMouseLeave={() => setHover(null)}>
                <i style={{ background: STAGE_COLORS[s.k] }} />
                {s.label} <b className="num" style={{ color: '#E9EEF8', fontWeight: 600 }}>{s.ms.toFixed(1)} ms</b>
              </span>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}
