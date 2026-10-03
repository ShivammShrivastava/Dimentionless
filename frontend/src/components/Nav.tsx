import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
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
  const [mobileOpen, setMobileOpen] = useState(false)

  const dot = mode === 'connecting' ? 'dot--connecting' : mode === 'live' ? (ws === 'open' ? 'dot--live' : 'dot--connecting') : 'dot--mock'
  const label = mode === 'connecting' ? 'Connecting' : mode === 'live' ? (ws === 'open' ? `Live · ${device ?? 'gpu'}` : 'Reconnecting') : 'Precomputed'

  // Close mobile menu on resize to desktop
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 880) setMobileOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Close on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <motion.header
      className="nav"
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="nav__pill">
        <a className="nav__brand" href="#top" onClick={() => setMobileOpen(false)}>
          <Logo />
          <span>Foveated Lidar</span>
        </a>

        {/* Desktop links */}
        <nav className="nav__links" aria-label="Sections">
          {LINKS.map(([t, h]) => (
            <a key={h} href={h}>
              {t}
            </a>
          ))}
        </nav>

        {/* Status indicator */}
        <div className="status" title={mode === 'live' ? 'Streaming from the backend' : 'Playing precomputed GPU results'}>
          <span className={`dot ${dot}`} />
          <span>{label}</span>
          {mode === 'mock' && <button onClick={actions.retry}>retry</button>}
          {mode === 'live' && <button onClick={() => actions.switchMode('mock')}>demo</button>}
        </div>

        {/* Mobile menu toggle button */}
        <button
          className="nav__toggle"
          onClick={() => setMobileOpen(o => !o)}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {mobileOpen ? (
              <>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </>
            ) : (
              <>
                <line x1="4" y1="7" x2="20" y2="7" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="17" x2="20" y2="17" />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* Mobile dropdown menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="nav__mobile-menu"
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <nav className="nav__mobile-links" aria-label="Mobile sections">
              {LINKS.map(([t, h]) => (
                <a
                  key={h}
                  href={h}
                  className="nav__mobile-link"
                  onClick={() => setMobileOpen(false)}
                >
                  {t}
                </a>
              ))}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  )
}
