import { motion } from 'framer-motion'
import { actions, useApp } from '../store/app'

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1.5" y="1.5" width="29" height="29" rx="4" fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.6" />
      <rect x="7.5" y="7.5" width="17" height="17" rx="2.5" fill="none" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.6" />
      <rect x="12.5" y="12.5" width="7" height="7" rx="1.5" fill="#FF6B9D" />
    </svg>
  )
}

const LINKS = [
  ['Overview', '#top'],
  ['Live map', '#live'],
  ['Upload', '#upload'],
  ['Evidence', '#evidence'],
  ['Foveation', '#foveation'],
  ['Pipeline', '#pipeline'],
]

export default function Nav() {
  const mode = useApp(s => s.mode)
  const ws = useApp(s => s.wsStatus)
  const device = useApp(s => s.health?.device)

  const dot = mode === 'connecting' ? 'dot--connecting' : mode === 'live' ? (ws === 'open' ? 'dot--live' : 'dot--connecting') : 'dot--mock'
  const label = mode === 'connecting' ? 'Connecting' : mode === 'live' ? (ws === 'open' ? `Live · ${device ?? 'gpu'}` : 'Reconnecting') : 'Precomputed'

  return (
    <motion.header className="nav" initial={{ y: -24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
      <div className="nav__pill">
        <a className="nav__brand" href="#top">
          <Logo />
          <span>Foveated Lidar</span>
        </a>
        <nav className="nav__links" aria-label="Sections">
          {LINKS.map(([t, h]) => (
            <a key={h} href={h}>
              {t}
            </a>
          ))}
        </nav>
        <div className="status" title={mode === 'live' ? 'Streaming from the backend' : 'Playing precomputed GPU results'}>
          <span className={`dot ${dot}`} />
          <span>{label}</span>
          {mode === 'mock' && <button onClick={actions.retry}>retry</button>}
          {mode === 'live' && <button onClick={() => actions.switchMode('mock')}>demo</button>}
        </div>
      </div>
    </motion.header>
  )
}
