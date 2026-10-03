/**
 * HorizontalSlider
 * ----------------
 * Wraps any number of full-screen panels so that vertical scroll is
 * translated into a smooth right-to-left slide of those panels.
 *
 * Layout:
 *   <outer>              — height: N × 100vh  (gives scroll room)
 *     <sticky viewport>  — sticks to the screen while outer scrolls
 *       <track>          — width: N × 100vw, translated by scroll progress
 *         <panel>…
 *
 * Extras:
 *   • Progress dots fixed at the bottom show which panel is active
 *   • A "scroll" hint fades in at the right edge for the first panel
 */

import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'

interface Props {
  /** Each element will occupy exactly one full-screen panel. */
  children: React.ReactNode[]
  /** Accessible labels shown in the progress dot titles. */
  labels?: string[]
}

/** A single progress dot whose colour reacts to scrollYProgress. */
function ProgressDot({
  index,
  total,
  scrollPct,
  label,
}: {
  index: number
  total: number
  scrollPct: ReturnType<typeof useScroll>['scrollYProgress']
  label?: string
}) {
  // input range so this dot is "active" when scrollPct ≈ index/(total-1)
  const target = index / Math.max(total - 1, 1)
  const halfStep = 0.5 / Math.max(total - 1, 1)

  const bg = useTransform(
    scrollPct,
    [target - halfStep, target, target + halfStep],
    ['var(--line-2)', 'var(--lime)', 'var(--line-2)'],
  )
  const scale = useTransform(
    scrollPct,
    [target - halfStep, target, target + halfStep],
    [1, 1.5, 1],
  )

  return <motion.div className="h-slider-progress__dot" style={{ background: bg, scale }} title={label} />
}

export default function HorizontalSlider({ children, labels }: Props) {
  const n = children.length
  const outerRef = useRef<HTMLDivElement>(null)

  const { scrollYProgress } = useScroll({
    target: outerRef,
    offset: ['start start', 'end end'],
  })

  // Translate the track: 0 → -(n-1)*100vw
  const x = useTransform(scrollYProgress, [0, 1], ['0vw', `${-(n - 1) * 100}vw`])

  // "Scroll" hint fades in as the user enters the first panel, then fades out
  const hintOpacity = useTransform(scrollYProgress, [0, 0.04, 0.22], [0, 1, 0])

  return (
    <div ref={outerRef} style={{ height: `${n * 100}vh`, position: 'relative' }}>

      {/* ── Sticky viewport ── */}
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>

        {/* ── Sliding track ── */}
        <motion.div
          style={{
            x,
            display: 'flex',
            width: `${n * 100}vw`,
            height: '100%',
            willChange: 'transform',
          }}
        >
          {children.map((child, i) => (
            <div
              key={i}
              className="h-panel"
              style={{ width: '100vw', height: '100%', flexShrink: 0 }}
            >
              {child}
            </div>
          ))}
        </motion.div>

        {/* ── Progress dots ── */}
        <div className="h-slider-progress" role="tablist" aria-label="Sections">
          {Array.from({ length: n }, (_, i) => (
            <ProgressDot
              key={i}
              index={i}
              total={n}
              scrollPct={scrollYProgress}
              label={labels?.[i] ?? `Panel ${i + 1}`}
            />
          ))}
        </div>

        {/* ── "Scroll" hint ── */}
        <motion.div
          className="h-slider-hint"
          style={{ opacity: hintOpacity }}
          aria-hidden="true"
        >
          scroll
          <span />
        </motion.div>

      </div>
    </div>
  )
}
