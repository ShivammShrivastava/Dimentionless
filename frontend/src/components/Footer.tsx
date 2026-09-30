import { API_URL } from '../lib/api'
import { useApp } from '../store/app'
import { Logo } from './Nav'

export default function Footer() {
  const mode = useApp(s => s.mode)
  return (
    <footer className="footer" data-theme="dark">
      <div className="container footer__row">
        <div className="nav__brand" style={{ color: '#E9EEF8' }}>
          <Logo />
          <span>Foveated Lidar</span>
          <span style={{ opacity: 0.5, fontWeight: 400 }}>· Adaptive variable-resolution 2.5D mapping</span>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <span>nuScenes-mini · SalsaNext-lite · FastAPI · React</span>
          {mode === 'live' && (
            <a href={`${API_URL}/docs`} target="_blank" rel="noreferrer">
              API docs
            </a>
          )}
          <a href="#top">Back to top</a>
        </div>
      </div>
    </footer>
  )
}
