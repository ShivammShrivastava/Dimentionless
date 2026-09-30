import { motion, useInView } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { drawCar } from '../lib/car'
import { PALETTE_DEFAULT, hexToRgb } from '../lib/colors'
import { useCountUp } from '../lib/useCountUp'
import { useApp } from '../store/app'

/* ------------------------------------------------------------------ canvas */
interface Pt {
  x: number
  y: number
  cls: number
  phi: number
  vx: number
}

function lcg(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

function buildScene(): Pt[] {
  const rnd = lcg(42)
  const pts: Pt[] = []
  const push = (x: number, y: number, cls: number, vx = 0) => pts.push({ x, y, cls, phi: Math.atan2(y, x), vx })
  // ground returns: 32 beams hitting the ground in concentric rings
  for (let k = 0; k < 32; k++) {
    const r = 1.9 * Math.pow(1.105, k)
    const n = Math.round(70 + r * 1.6)
    for (let m = 0; m < n; m++) {
      const a = (m / n) * Math.PI * 2 + rnd() * 0.02
      const x = Math.cos(a) * r
      const y = Math.sin(a) * r
      if (Math.abs(x) > 62) continue
      if (Math.abs(y) <= 7.2) push(x, y, 1)
      else if (Math.abs(y) <= 12.5 && rnd() < 0.55) push(x, y, 2)
    }
  }
  // building facades along the street, with gaps
  for (const side of [-1, 1]) {
    for (let x = -58; x <= 58; x += 0.32) {
      if (Math.abs(x) > 8 && Math.abs(x) < 12) continue // side street
      if (rnd() < 0.08) continue
      push(x + rnd() * 0.1, side * (14 + rnd() * 0.5), 3)
    }
    // side street walls
    for (let y = 14; y <= 45; y += 0.4) {
      push(-12.4 + rnd() * 0.2, side * y, 3)
      push(8.4 + rnd() * 0.2, side * y, 3)
    }
    // poles
    for (let x = -50; x <= 50; x += 12.5) for (let q = 0; q < 6; q++) push(x + rnd() * 0.25, side * (9.2 + rnd() * 0.25), 3)
  }
  // vegetation clusters behind the buildings
  for (let c = 0; c < 26; c++) {
    const cx = (rnd() - 0.5) * 120
    const cy = (rnd() < 0.5 ? -1 : 1) * (17 + rnd() * 20)
    const rad = 1.2 + rnd() * 2.2
    for (let q = 0; q < 22; q++) {
      const a = rnd() * Math.PI * 2
      const rr = Math.sqrt(rnd()) * rad
      push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 3)
    }
  }
  // vehicles on the two lanes, drifting
  for (let c = 0; c < 8; c++) {
    const lane = c % 2 === 0 ? 3.4 : -3.4
    const cx = -46 + c * 12.5 + rnd() * 4
    const vx = lane > 0 ? 0.9 + rnd() * 0.5 : -(0.9 + rnd() * 0.5)
    for (let q = 0; q < 46; q++) {
      const t = rnd()
      const u = rnd()
      const x = cx + (t - 0.5) * 4.5
      const y = lane + (u - 0.5) * 1.9
      push(x, y, 4, vx)
    }
  }
  // pedestrians on the terrain strip
  for (let c = 0; c < 7; c++) {
    const cx = (rnd() - 0.5) * 90
    const cy = (rnd() < 0.5 ? -1 : 1) * (8.2 + rnd() * 3.5)
    for (let q = 0; q < 8; q++) push(cx + (rnd() - 0.5) * 0.6, cy + (rnd() - 0.5) * 0.6, 4)
  }
  return pts
}

function HeroCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const rgb = PALETTE_DEFAULT.map(hexToRgb)
    const pts = buildScene()
    let w = 0
    let h = 0
    let raf = 0
    let visible = true
    let last = performance.now()
    let theta = 0
    const mouse = { x: 0, y: 0 }
    const par = { x: 0, y: 0 }

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const r = canvas.getBoundingClientRect()
      w = r.width
      h = r.height
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const onMove = (e: MouseEvent) => {
      mouse.x = e.clientX / window.innerWidth - 0.5
      mouse.y = e.clientY / window.innerHeight - 0.5
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    const io = new IntersectionObserver(([en]) => (visible = en.isIntersecting), { threshold: 0.02 })
    io.observe(canvas)

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      if (!visible || document.hidden) {
        last = now
        return
      }
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (!reduce) theta = (theta + dt * 0.55) % (Math.PI * 2)
      par.x += (mouse.x * 18 - par.x) * 0.05
      par.y += (mouse.y * 12 - par.y) * 0.05

      const ppm = (Math.min(w, h) * 0.92) / 80 // 40 m ring spans 92% of the short side
      const cx = w / 2 + par.x
      const cy = h * 0.52 + par.y
      const toScreen = (x: number, y: number) => [cx - y * ppm, cy - x * ppm] as const

      ctx.clearRect(0, 0, w, h)

      // rings (square, Chebyshev)
      const rings: [number, string, number][] = [
        [10, '5 cm cells', 0.3],
        [20, '10 cm cells', 0.22],
        [40, '20 cm cells', 0.15],
        [100, '50 cm cells', 0.1],
      ]
      ctx.lineWidth = 1
      ctx.font = '500 11px Inter, system-ui, sans-serif'
      ctx.textBaseline = 'bottom'
      for (const [d, label, a] of rings) {
        const s = d * ppm
        ctx.strokeStyle = `rgba(212,252,121,${a})`
        ctx.strokeRect(cx - s, cy - s, 2 * s, 2 * s)
        ctx.fillStyle = `rgba(233,238,248,${Math.min(0.5, a + 0.12)})`
        ctx.fillText(label, cx - s + 8, cy - s - 6)
      }

      // sweep wedge
      if (!reduce) {
        const R = Math.hypot(w, h)
        const a0 = -theta // screen angle: theta measured from +x (forward = up)
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.8)
        grad.addColorStop(0, 'rgba(212,252,121,0.16)')
        grad.addColorStop(1, 'rgba(212,252,121,0)')
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.arc(cx, cy, R, a0 - Math.PI / 2 - 0.42, a0 - Math.PI / 2)
        ctx.closePath()
        ctx.fillStyle = grad
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(cx + Math.cos(a0 - Math.PI / 2) * R, cy + Math.sin(a0 - Math.PI / 2) * R)
        ctx.strokeStyle = 'rgba(212,252,121,0.45)'
        ctx.stroke()
      }

      // points, brightness decays since the sweep last passed them
      const TWO_PI = Math.PI * 2
      for (const p of pts) {
        if (p.vx) {
          p.x += p.vx * dt
          if (p.x > 62) p.x -= 124
          if (p.x < -62) p.x += 124
          p.phi = Math.atan2(p.y, p.x)
        }
        let delta = theta - p.phi
        delta = ((delta % TWO_PI) + TWO_PI) % TWO_PI
        const bright = reduce ? 0.6 : 0.16 + 0.84 * Math.exp(-delta * 1.1)
        const [sx, sy] = toScreen(p.x, p.y)
        if (sx < -4 || sy < -4 || sx > w + 4 || sy > h + 4) continue
        const c = rgb[p.cls]
        const size = p.cls === 4 ? 3 : 2.1
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${bright})`
        ctx.fillRect(sx - size / 2, sy - size / 2, size, size)
      }

      // ego
      const [ex, ey] = toScreen(0, 0)
      drawCar(ctx, ex, ey, 4.6 * ppm, 1.9 * ppm, 0.55)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      window.removeEventListener('mousemove', onMove)
    }
  }, [])

  return <canvas ref={ref} className="hero__canvas" aria-hidden="true" />
}

/* ------------------------------------------------------------------ hero */
const ease = [0.16, 1, 0.3, 1] as const
const fadeUp = {
  hidden: { opacity: 0, y: 26 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { duration: 0.8, ease, delay: 0.12 + i * 0.12 } }),
}

function Stat({ value, suffix, label, decimals = 0, active }: { value: number; suffix?: string; label: React.ReactNode; decimals?: number; active: boolean }) {
  const v = useCountUp(value, active)
  return (
    <motion.div className="stat" variants={fadeUp} custom={4}>
      <div className="stat__value num">
        {v.toFixed(decimals)}
        {suffix && <small>{suffix}</small>}
      </div>
      <div className="stat__label">{label}</div>
    </motion.div>
  )
}

export default function Hero() {
  const metrics = useApp(s => s.metrics)
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.3 })
  const fps = metrics?.fps.total ?? 24.3
  const red = metrics?.memory.reduction_2d ?? 29.9
  const miou = (metrics?.miou ?? 0.747) * 100

  return (
    <section id="top" className="hero" data-theme="dark">
      <HeroCanvas />
      <div className="hero__vignette" />
      <motion.div className="hero__content container" initial="hidden" animate="show" ref={ref}>
        <motion.a href="#live" className="badge" variants={fadeUp} custom={0}>
          <span className="badge__tag">LIVE</span>
          Adaptive 2.5D Lidar mapping
        </motion.a>
        <motion.h1 className="hero__title" variants={fadeUp} custom={1}>
          Sharp where it matters.
          <br />
          <em>Light</em> where it doesn&apos;t.
        </motion.h1>
        <motion.p className="hero__sub" variants={fadeUp} custom={2}>
          Lidar sweeps become a foveated 2.5D map: 5 cm cells near the car, 50 cm at 100 m, labelled in real time.
        </motion.p>
        <motion.div className="hero__cta" variants={fadeUp} custom={3}>
          <a className="btn btn--primary" href="#live">
            Open the live map
            <svg className="arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </a>
          <a className="btn btn--ghost" href="#evidence">
            See the numbers
          </a>
        </motion.div>
        <motion.div className="hero__stats" variants={fadeUp} custom={4}>
          <Stat value={fps} suffix="FPS" decimals={1} active={inView} label={<><b>41 ms</b> end to end</>} />
          <Stat value={red} suffix="×" decimals={1} active={inView} label={<>less memory than a <b>5 cm</b> grid</>} />
          <Stat value={miou} suffix="%" decimals={1} active={inView} label={<>mIoU on <b>unseen</b> scenes</>} />
        </motion.div>
      </motion.div>
      <div className="scroll-hint" aria-hidden="true">
        scroll
        <span />
      </div>
    </section>
  )
}
