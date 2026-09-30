import { describe, expect, it } from 'vitest'
import { DEFAULT_RINGS, cellCenter, flatIndex, isHole, ringOf, totalCells, uniformCells, uniform3dVoxels, worldToCell } from '../src/lib/grid'

describe('ring geometry', () => {
  it('matches the backend spec', () => {
    expect(totalCells()).toBe(534_400)
    expect(uniformCells(0.05)).toBe(16_000_000)
    expect(uniform3dVoxels(0.05)).toBe(16_000_000 * 120)
    expect(DEFAULT_RINGS.map(r => r.inner_hole)).toEqual([0, 200, 200, 160])
  })

  it('ring boundaries are half-open on Chebyshev distance', () => {
    expect(ringOf(9.999, 0)).toBe(0)
    expect(ringOf(10, 0)).toBe(1)
    expect(ringOf(0, -19.999)).toBe(1)
    expect(ringOf(20, 0)).toBe(2)
    expect(ringOf(39.99, 39.99)).toBe(2)
    expect(ringOf(40, 0)).toBe(3)
    expect(ringOf(99.99, 0)).toBe(3)
    expect(ringOf(100, 0)).toBe(-1)
    // (9, 9) is 12.7 m away in Euclidean terms but stays in ring 0
    expect(ringOf(9, 9)).toBe(0)
  })

  it('world -> cell -> centre -> cell round-trips', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 199.8 - 99.9
    for (let k = 0; k < 20000; k++) {
      const x = rnd()
      const y = rnd()
      const c = worldToCell(x, y)!
      expect(c).not.toBeNull()
      const [cx, cy] = cellCenter(c)
      const c2 = worldToCell(cx, cy)!
      expect(c2).toEqual(c)
      const half = DEFAULT_RINGS[c.ring].cell_m / 2 + 1e-6
      expect(Math.abs(cx - x)).toBeLessThanOrEqual(half)
      expect(Math.abs(cy - y)).toBeLessThanOrEqual(half)
    }
  })

  it('hole detection and flat index', () => {
    const r1 = DEFAULT_RINGS[1]
    expect(isHole(r1, 200, 200)).toBe(true)
    expect(isHole(r1, 99, 200)).toBe(false)
    expect(isHole(r1, 100, 100)).toBe(true)
    expect(isHole(r1, 300, 300)).toBe(false)
    expect(isHole(DEFAULT_RINGS[0], 200, 200)).toBe(false)
    expect(flatIndex(r1, 3, 7)).toBe(3 * 400 + 7)
    // a point at 5 m lands in ring 0, never in ring 1's hole
    const c = worldToCell(5, 5)!
    expect(c.ring).toBe(0)
  })
})
