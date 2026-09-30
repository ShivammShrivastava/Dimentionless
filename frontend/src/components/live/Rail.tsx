import { motion } from 'framer-motion'
import { CLASS_LABELS, CLASS_SHORT, PALETTE_CB, PALETTE_DEFAULT, STAGE_COLORS } from '../../lib/colors'
import { fmtBytes, fmtInt, fmtTimestamp } from '../../lib/format'
import { CELL_LABELS, EMPTY_CM, cellCenter } from '../../lib/grid'
import { actions, useApp } from '../../store/app'
import { SAME_BUDGET_CELL_M } from './Compare'
import { readCell } from './TopDown'

const Icon = {
  play: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 5v14l12-7z" />
    </svg>
  ),
  pause: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  ),
  prev: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 5h2v14H6zm12 0v14L9 12z" />
    </svg>
  ),
  next: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 5h2v14h-2zM6 5v14l9-7z" />
    </svg>
  ),
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="ctrl">
      <label>{label}</label>
      <button className={`switch ${on ? 'is-on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
    </div>
  )
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <svg className="spark" />
  const W = 300
  const H = 44
  const max = Math.max(60, ...values)
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 4 - (Math.min(v, max) / max) * (H - 8)] as const)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const area = `${d} L${W},${H} L0,${H} Z`
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="sparkfill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sparkfill)" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export default function Rail() {
  const player = useApp(s => s.player)
  const frame = useApp(s => s.frame)
  const dense = useApp(s => s.dense)
  const settings = useApp(s => s.settings)
  const history = useApp(s => s.history)
  const pinned = useApp(s => s.pinned)
  const rings = useApp(s => s.rings)
  const mode = useApp(s => s.mode)
  const palette = settings.cbPalette ? PALETTE_CB : PALETTE_DEFAULT

  const frames = player?.frames ?? [0]
  const pos = player ? Math.max(0, frames.indexOf(player.idx)) : 0
  const stats = frame?.stats
  const last = history[history.length - 1]
  const avg = history.length ? history.reduce((a, b) => a + b.total, 0) / history.length : 0
  const classTotal = stats ? stats.class_counts.slice(1).reduce((a, b) => a + b, 0) : 0
  const pinnedInfo = pinned && dense ? readCell(dense, pinned) : null

  return (
    <aside className="dash__rail">
      <div className="panel">
        <div className="panel__title">
          Playback <span className="num">{frame ? fmtTimestamp(frame.timestamp_us) : '–'}</span>
        </div>
        <div className="play">
          <button className="icon-btn" onClick={() => actions.step(-1)} aria-label="Previous frame" title="Previous frame (←)">
            {Icon.prev}
          </button>
          <button className="icon-btn icon-btn--accent" onClick={actions.togglePlay} aria-label={player?.playing ? 'Pause' : 'Play'} title="Play / pause (space)">
            {player?.playing ? Icon.pause : Icon.play}
          </button>
          <button className="icon-btn" onClick={() => actions.step(1)} aria-label="Next frame" title="Next frame (→)">
            {Icon.next}
          </button>
          <input className="range scrub" type="range" min={0} max={frames.length - 1} value={pos} onChange={e => actions.seek(frames[parseInt(e.target.value, 10)])} aria-label="Frame" />
          <span className="time">
            {player ? `${player.idx}` : '–'} / {frames[frames.length - 1] ?? 0}
          </span>
        </div>
        <div className="ctrl" style={{ marginTop: 6 }}>
          <label>Frame rate</label>
          <div className="segmented" style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'var(--line-dark)' }}>
            {[2, 5, 10, 20].map(f => (
              <button key={f} className={player?.fps === f ? 'is-active' : ''} style={{ color: player?.fps === f ? '#0F172A' : 'rgba(233,238,248,0.5)', padding: '5px 9px' }} onClick={() => actions.setFps(f)}>
                {player?.fps === f && <motion.span layoutId="fps-seg" className="seg-bg" style={{ background: '#D4FC79', boxShadow: 'none' }} transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <span>{f}</span>
              </button>
            ))}
          </div>
        </div>
        {mode === 'mock' && <div className="hint" style={{ marginTop: 6 }}>Offline demo: every 2nd keyframe of two scenes, model predictions.</div>}
      </div>

      <div className="panel">
        <div className="panel__title">Layers</div>
        <div className="legend">
          {[1, 2, 3, 4].map(k => (
            <button key={k} className={`chip ${settings.layers[k] ? '' : 'is-off'}`} onClick={() => actions.toggleLayer(k)} title={`Toggle ${CLASS_LABELS[k]} (${k})`} style={{ color: palette[k] }}>
              <span className="swatch" style={{ background: palette[k] }} />
              <span style={{ color: 'var(--on-navy)' }}>{CLASS_SHORT[k]}</span>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 8 }}>
          <Switch on={settings.showRings} onChange={v => actions.setSettings({ showRings: v })} label="Ring outlines" />
          <Switch on={settings.heightShade} onChange={v => actions.setSettings({ heightShade: v })} label="Height shading" />
          <Switch on={settings.cbPalette} onChange={v => actions.setSettings({ cbPalette: v })} label="Colour-blind palette" />
          <div className="ctrl">
            <label>Confidence ≥</label>
            <input className="range" type="range" min={0} max={255} value={settings.confMin} onChange={e => actions.setSettings({ confMin: parseInt(e.target.value, 10) })} aria-label="Minimum confidence" />
            <output className="num">{Math.round((settings.confMin / 255) * 100)}%</output>
          </div>
          {settings.view === '3d' && (
            <>
              <div className="ctrl">
                <label>Exaggeration</label>
                <input className="range" type="range" min={1} max={5} step={0.1} value={settings.exaggeration} onChange={e => actions.setSettings({ exaggeration: parseFloat(e.target.value) })} aria-label="Height exaggeration" />
                <output className="num">{settings.exaggeration.toFixed(1)}×</output>
              </div>
              <Switch on={settings.wireframe} onChange={v => actions.setSettings({ wireframe: v })} label="Wireframe (W)" />
            </>
          )}
          {settings.view === 'compare' && (
            <div className="ctrl">
              <label>Uniform cell</label>
              <div className="segmented" style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'var(--line-dark)' }}>
                {[
                  [SAME_BUDGET_CELL_M, 'same memory'],
                  [0.5, '50 cm'],
                ].map(([c, l]) => (
                  <button key={l as string} className={settings.compareCell === c ? 'is-active' : ''} style={{ color: settings.compareCell === c ? '#0F172A' : 'rgba(233,238,248,0.5)', padding: '5px 9px' }} onClick={() => actions.setSettings({ compareCell: c as number })}>
                    {settings.compareCell === c && <motion.span layoutId="cmp-seg" className="seg-bg" style={{ background: '#D4FC79', boxShadow: 'none' }} transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                    <span>{l}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel__title">
          Live stats <span className="num">{avg ? `${(1000 / avg).toFixed(1)} FPS pipeline capacity` : ''}</span>
        </div>
        <div className="kpis">
          <div className="kpi">
            <div className="kpi__v num">
              {last ? last.total.toFixed(1) : '–'}
              <small>ms</small>
            </div>
            <div className="kpi__l">pipeline time on server</div>
          </div>
          <div className="kpi">
            <div className="kpi__v num">
              {last ? last.decode.toFixed(1) : '–'}
              <small>ms</small>
            </div>
            <div className="kpi__l">decode + densify, browser</div>
          </div>
          <div className="kpi">
            <div className="kpi__v num">{stats ? fmtInt(stats.num_points) : '–'}</div>
            <div className="kpi__l">points in sweep</div>
          </div>
          <div className="kpi">
            <div className="kpi__v num">{stats ? fmtInt(stats.occupied_cells) : '–'}</div>
            <div className="kpi__l">occupied of {fmtInt(534_400)} cells</div>
          </div>
        </div>
        <Sparkline values={history.map(h => h.total)} color="#FF6B9D" />
        {last && (
          <>
            <div className="stack" style={{ marginTop: 8 }}>
              <div style={{ background: STAGE_COLORS.inference, flex: last.inference }} title={`segmentation ${last.inference.toFixed(1)} ms`} />
              <div style={{ background: STAGE_COLORS.projection, flex: last.projection }} title={`grid projection ${last.projection.toFixed(1)} ms`} />
              <div style={{ background: STAGE_COLORS.encode, flex: Math.max(0.3, last.encode) }} title={`encode ${last.encode.toFixed(1)} ms`} />
            </div>
            <div className="stack-legend">
              <span>
                <i style={{ background: STAGE_COLORS.inference }} />
                segmentation {last.inference.toFixed(1)}
              </span>
              <span>
                <i style={{ background: STAGE_COLORS.projection }} />
                grid {last.projection.toFixed(1)}
              </span>
              <span>
                <i style={{ background: STAGE_COLORS.encode }} />
                encode {last.encode.toFixed(1)}
              </span>
            </div>
          </>
        )}
        {stats && classTotal > 0 && (
          <>
            <div className="panel__title" style={{ marginTop: 16, marginBottom: 4 }}>
              Cells by class <span className="num">{fmtBytes(stats.memory_bytes, 2)} stored</span>
            </div>
            <div className="classbar">
              {[1, 2, 3, 4].map(k => (
                <div key={k} style={{ background: palette[k], flex: stats.class_counts[k] }} title={`${CLASS_LABELS[k]}: ${fmtInt(stats.class_counts[k])} cells`} />
              ))}
            </div>
            <div className="stack-legend">
              {[1, 2, 3, 4].map(k => (
                <span key={k}>
                  <i style={{ background: palette[k] }} />
                  {CLASS_SHORT[k]} {Math.round((stats.class_counts[k] / classTotal) * 100)}%
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <div className="panel__title">
          Cell inspector {pinned && <button className="mini-btn" style={{ padding: '3px 8px' }} onClick={() => actions.pin(null)}>clear</button>}
        </div>
        {pinned && pinnedInfo ? (
          <div className="inspector">
            <div className="inspector__row">
              <span>class</span>
              <b style={{ color: palette[pinnedInfo.label] }}>{pinnedInfo.count ? CLASS_LABELS[pinnedInfo.label] : 'empty now'}</b>
            </div>
            <div className="inspector__row">
              <span>ring · cell size</span>
              <b>
                {pinned.ring} · {CELL_LABELS[pinned.ring]}
              </b>
            </div>
            <div className="inspector__row">
              <span>position</span>
              <b>
                {cellCenter(pinned, rings)
                  .map(v => v.toFixed(2))
                  .join(', ')}{' '}
                m
              </b>
            </div>
            <div className="inspector__row">
              <span>height max / min</span>
              <b>
                {pinnedInfo.zMax === EMPTY_CM ? '–' : (pinnedInfo.zMax / 100).toFixed(2)} / {pinnedInfo.zMin === EMPTY_CM ? '–' : (pinnedInfo.zMin / 100).toFixed(2)} m
              </b>
            </div>
            <div className="inspector__row">
              <span>points · confidence</span>
              <b>
                {pinnedInfo.count} · {Math.round((pinnedInfo.conf / 255) * 100)}%
              </b>
            </div>
          </div>
        ) : (
          <div className="hint">Hover the map to inspect a cell, click to pin it here. The pin follows the cell across frames.</div>
        )}
      </div>

      <div className="panel">
        <div className="hint">
          <span>
            <span className="kbd">space</span> play
          </span>
          <span>
            <span className="kbd">←</span>
            <span className="kbd">→</span> step
          </span>
          <span>
            <span className="kbd">1</span>–<span className="kbd">4</span> layers
          </span>
          <span>
            <span className="kbd">R</span> reset view
          </span>
          <span>
            <span className="kbd">T</span>/<span className="kbd">H</span>/<span className="kbd">C</span> views
          </span>
        </div>
      </div>
    </aside>
  )
}
