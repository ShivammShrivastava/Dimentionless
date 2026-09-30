/**
 * Variable-resolution grid geometry. Mirrors avr_lidar/grid/varres_grid.py.
 * Rings are square annuli keyed on Chebyshev distance d = max(|x|, |y|).
 * World frame: sensor-centred, +x forward, +y left, metres.
 */

export interface RingSpec {
  ring: number
  inner_m: number
  outer_m: number
  cell_m: number
  size: number
  inner_hole: number
  cells: number
}

export const DEFAULT_RINGS: RingSpec[] = [
  { ring: 0, inner_m: 0, outer_m: 10, cell_m: 0.05, size: 400, inner_hole: 0, cells: 160_000 },
  { ring: 1, inner_m: 10, outer_m: 20, cell_m: 0.1, size: 400, inner_hole: 200, cells: 120_000 },
  { ring: 2, inner_m: 20, outer_m: 40, cell_m: 0.2, size: 400, inner_hole: 200, cells: 120_000 },
  { ring: 3, inner_m: 40, outer_m: 100, cell_m: 0.5, size: 400, inner_hole: 160, cells: 134_400 },
]

export const EMPTY_CM = -32768
export const MAX_RANGE_M = 100
export const CELL_LABELS = ['5 cm', '10 cm', '20 cm', '50 cm']
export const UNIFORM_2D_5CM_CELLS = 16_000_000
export const BYTES_PER_CELL = 8
/** Uniform cell size that spends the same number of cells as the 534,400-cell adaptive map (~27 cm). */
export const SAME_BUDGET_CELL_M = 200 / Math.sqrt(534_400)

export interface CellRef {
  ring: number
  i: number
  j: number
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

export function halfExtent(r: RingSpec): number {
  return (r.size * r.cell_m) / 2
}

export function ringOf(x: number, y: number, rings: RingSpec[] = DEFAULT_RINGS): number {
  const d = Math.max(Math.abs(x), Math.abs(y))
  for (let r = 0; r < rings.length; r++) if (d < rings[r].outer_m) return r
  return -1
}

export function worldToCell(x: number, y: number, rings: RingSpec[] = DEFAULT_RINGS): CellRef | null {
  const r = ringOf(x, y, rings)
  if (r < 0) return null
  const spec = rings[r]
  const half = spec.outer_m
  const s = spec.cell_m
  const i = clamp(Math.floor((x + half) / s + 1e-9), 0, spec.size - 1)
  const j = clamp(Math.floor((y + half) / s + 1e-9), 0, spec.size - 1)
  return { ring: r, i, j }
}

export function cellCenter(c: CellRef, rings: RingSpec[] = DEFAULT_RINGS): [number, number] {
  const spec = rings[c.ring]
  const half = spec.outer_m
  return [-half + (c.i + 0.5) * spec.cell_m, -half + (c.j + 0.5) * spec.cell_m]
}

export function isHole(spec: RingSpec, i: number, j: number): boolean {
  if (!spec.inner_hole) return false
  const a = (spec.size - spec.inner_hole) / 2
  const b = a + spec.inner_hole
  return i >= a && i < b && j >= a && j < b
}

export function flatIndex(spec: RingSpec, i: number, j: number): number {
  return i * spec.size + j
}

export function totalCells(rings: RingSpec[] = DEFAULT_RINGS): number {
  return rings.reduce((s, r) => s + r.cells, 0)
}

export function uniformCells(cellM: number, rangeM = MAX_RANGE_M): number {
  const u = Math.round((2 * rangeM) / cellM)
  return u * u
}

export function uniform3dVoxels(cellM: number, heightM = 6, rangeM = MAX_RANGE_M): number {
  return uniformCells(cellM, rangeM) * Math.round(heightM / cellM)
}
