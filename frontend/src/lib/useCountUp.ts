import { useEffect, useRef, useState } from 'react'

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t))

/** Animates from the previous value to `target` when `active` is true. */
export function useCountUp(target: number, active = true, duration = 1400): number {
  const [value, setValue] = useState(0)
  const fromRef = useRef(0)
  const raf = useRef(0)

  useEffect(() => {
    if (!active) return
    const from = fromRef.current
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const v = from + (target - from) * easeOutExpo(t)
      setValue(v)
      if (t < 1) raf.current = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [target, active, duration])

  return value
}
