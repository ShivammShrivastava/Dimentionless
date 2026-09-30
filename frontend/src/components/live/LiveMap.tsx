import { AnimatePresence, motion } from 'framer-motion'
import { Suspense, lazy, useEffect, useState } from 'react'
import { CLASS_SHORT, PALETTE_CB, PALETTE_DEFAULT } from '../../lib/colors'
import { actions, useApp, type ViewTab } from '../../store/app'
import Compare from './Compare'
import Rail from './Rail'
import TopDown, { type FitRequest } from './TopDown'

// three.js is only loaded when the 3D tab is opened
const HeightMap3D = lazy(() => import('./HeightMap3D'))

const ease = [0.16, 1, 0.3, 1] as const
const TABS: [ViewTab, string][] = [
  ['top', 'Top-down 2.5D'],
  ['3d', '3D height map'],
  ['compare', 'Uniform vs adaptive'],
]

export default function LiveMap() {
  const scenes = useApp(s => s.scenes)
  const player = useApp(s => s.player)
  const frame = useApp(s => s.frame)
  const settings = useApp(s => s.settings)
  const mode = useApp(s => s.mode)
  const error = useApp(s => s.error)
  const health = useApp(s => s.health)
  const [fit, setFit] = useState<FitRequest>({ radius: 45, nonce: 0 })
  const palette = settings.cbPalette ? PALETTE_CB : PALETTE_DEFAULT
  const requestFit = (radius: number) => setFit(f => ({ radius, nonce: f.nonce + 1 }))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
      switch (e.key) {
        case ' ':
          e.preventDefault()
          actions.togglePlay()
          break
        case 'ArrowLeft':
          actions.step(-1)
          break
        case 'ArrowRight':
          actions.step(1)
          break
        case '1':
        case '2':
        case '3':
        case '4':
          actions.toggleLayer(parseInt(e.key, 10))
          break
        case 'r':
        case 'R':
          requestFit(45)
          break
        case 'w':
        case 'W':
          actions.setSettings({ wireframe: !settings.wireframe })
          break
        case 't':
        case 'T':
          actions.setSettings({ view: 'top' })
          break
        case 'h':
        case 'H':
          actions.setSettings({ view: '3d' })
          break
        case 'c':
        case 'C':
          actions.setSettings({ view: 'compare' })
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settings.wireframe])

  const scene = scenes.find(s => s.name === player?.scene)

  return (
    <section id="live" className="section section--dark" data-theme="dark" style={{ paddingTop: 'clamp(56px, 7vw, 96px)' }}>
      <div className="container">
        <motion.div className="section__head" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.4 }} transition={{ duration: 0.8, ease }}>
          <span className="eyebrow">Live map</span>
          <h2 className="h2">
            The 2.5D map, <em>streaming</em>.
          </h2>
          <p className="lead">One sweep per frame. Pan, zoom, hover a cell, or switch views.</p>
        </motion.div>

        <motion.div className="dash" initial={{ opacity: 0, y: 40, scale: 0.985 }} whileInView={{ opacity: 1, y: 0, scale: 1 }} viewport={{ once: true, amount: 0.15 }} transition={{ duration: 1, ease }}>
          <div className="dash__toolbar">
            <div className="tabs" role="tablist">
              {TABS.map(([k, label]) => (
                <button key={k} role="tab" aria-selected={settings.view === k} className={`tab ${settings.view === k ? 'is-active' : ''}`} onClick={() => actions.setSettings({ view: k })}>
                  {settings.view === k && <motion.span layoutId="tab-bg" className="tab-bg" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <select className="select" value={player?.scene ?? ''} onChange={e => actions.setScene(e.target.value)} aria-label="Scene">
                {scenes.map(s => (
                  <option key={s.name} value={s.name}>
                    {s.name} · {s.split} · {s.num_frames} frames
                  </option>
                ))}
              </select>
              <span className="hint" title={scene?.description}>
                {mode === 'live' ? `model predictions · ${health?.device ?? 'gpu'}` : mode === 'mock' ? 'model predictions · exported frames' : 'connecting'}
              </span>
            </div>
          </div>

          <div className="dash__body">
            <div style={{ position: 'relative', minHeight: 420 }}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={settings.view} style={{ position: 'absolute', inset: 0 }} initial={{ opacity: 0, scale: 0.99 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.01 }} transition={{ duration: 0.35, ease }}>
                  {settings.view === 'top' && <TopDown fit={fit} />}
                  {settings.view === '3d' && (
                    <Suspense fallback={<div className="empty"><div><div className="spinner" />Loading 3D view…</div></div>}>
                      <HeightMap3D />
                    </Suspense>
                  )}
                  {settings.view === 'compare' && <Compare />}
                </motion.div>
              </AnimatePresence>

              <div className="dash__overlay" style={{ display: settings.view === 'compare' ? 'none' : undefined }}>
                <div className="legend">
                  {[1, 2, 3, 4].map(k => (
                    <button key={k} className={`chip ${settings.layers[k] ? '' : 'is-off'}`} onClick={() => actions.toggleLayer(k)} style={{ color: palette[k], background: 'rgba(15,23,42,0.7)', backdropFilter: 'blur(8px)' }}>
                      <span className="swatch" style={{ background: palette[k] }} />
                      <span style={{ color: 'var(--on-navy)' }}>{CLASS_SHORT[k]}</span>
                    </button>
                  ))}
                </div>
              </div>

              {settings.view === 'top' && (
                <div className="view-btns">
                  {[
                    [10, '10 m'],
                    [22, '20 m'],
                    [45, '40 m'],
                    [100, '100 m'],
                  ].map(([r, l]) => (
                    <button key={l as string} className="mini-btn" onClick={() => requestFit(r as number)}>
                      {l}
                    </button>
                  ))}
                </div>
              )}

              {!frame && (
                <div className="empty">
                  <div>
                    <div className="spinner" />
                    {error ? `Could not load data: ${error}` : mode === 'connecting' ? 'Looking for the backend…' : 'Waiting for the first frame…'}
                  </div>
                </div>
              )}
              {frame && !settings.layers.some((v, i) => i > 0 && v) && (
                <div className="empty" style={{ pointerEvents: 'none' }}>
                  All layers are hidden. Press 1 to 4 to bring them back.
                </div>
              )}
            </div>
            <Rail />
          </div>
        </motion.div>
      </div>
    </section>
  )
}
