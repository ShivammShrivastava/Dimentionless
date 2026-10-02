/**
 * Canvas 2D painting of the ring stack. Each ring is rasterised once per frame into an
 * offscreen canvas (one pixel per cell) and composited with the current view transform.
 * Screen frame: +x (forward) is up, +y (left) is left.
 */
import type { DenseRing, GridFrame } from '../../lib/decode'
import { PALETTE_CB, PALETTE_DEFAULT, heightFactor, paletteRgb, type Rgb } from '../../lib/colors'
import { CELL_LABELS, type RingSpec } from '../../lib/grid'
import { drawCar } from '../../lib/car'

export interface View {
  scale: number // px per metre
  cx: number // screen x of the world origin
  cy: number // screen y of the world origin
}

export const worldToScreen = (v: View, x: number, y: number): [number, number] => [v.cx - y * v.scale, v.cy - x * v.scale]
export const screenToWorld = (v: View, sx: number, sy: number): [number, number] => [(v.cy - sy) / v.scale, (v.cx - sx) / v.scale]

export interface PaintOptions {
  layers: boolean[]
  confMin: number
  heightShade: boolean
  cbPalette: boolean
}

function makeCanvas(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  return c
}

/** Pack rgba into the little-endian ABGR uint32 that ImageData uses in memory. */
const pack = (r: number, g: number, b: number, a: number) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0

function shadeRgb(c: Rgb, zCm: number, on: boolean): Rgb {
  if (!on) return c
  const f = heightFactor(zCm)
  return [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)]
}

export class RingPainter {
  private canvases: HTMLCanvasElement[] = []
  private images: ImageData[] = []
  private buf32: Uint32Array[] = []
  private lastIdx: Uint32Array[] = []

  paint(frame: GridFrame, dense: DenseRing[], o: PaintOptions) {
    const palette = paletteRgb(o.cbPalette ? PALETTE_CB : PALETTE_DEFAULT)
    frame.rings.forEach((r, k) => {
      const S = r.size
      if (!this.canvases[k] || this.canvases[k].width !== S) {
        this.canvases[k] = makeCanvas(S)
        this.images[k] = new ImageData(S, S)
        this.buf32[k] = new Uint32Array(this.images[k].data.buffer)
        this.lastIdx[k] = new Uint32Array(0)
      }
      const b = this.buf32[k]
      const d = dense[k]
      // clear the pixels the previous frame touched, then write this frame's cells
      const prev = this.lastIdx[k]
      for (let t = 0; t < prev.length; t++) {
        const p = prev[t]
        b[(S - 1 - ((p / S) | 0)) * S + (S - 1 - (p % S))] = 0
      }
      for (let t = 0; t < r.n; t++) {
        const p = r.idx[t]
        const label = d.label[p]
        if (label === 0 || !o.layers[label]) continue
        const i = (p / S) | 0
        const j = p - i * S
        const px = S - 1 - j
        const py = S - 1 - i
        const c = shadeRgb(palette[label], d.zMax[p], o.heightShade)
        const a = d.conf[p] < o.confMin ? 80 : 255
        b[py * S + px] = pack(c[0] | 0, c[1] | 0, c[2] | 0, a)
      }
      this.lastIdx[k] = r.idx
      this.canvases[k].getContext('2d')!.putImageData(this.images[k], 0, 0)
    })
  }

  /** Composite rings outermost first so finer rings paint over coarser ones. */
  draw(ctx: CanvasRenderingContext2D, v: View, rings: RingSpec[]) {
    ctx.imageSmoothingEnabled = false
    for (let k = this.canvases.length - 1; k >= 0; k--) {
      const half = rings[k]?.outer_m ?? (this.canvases[k].width * (rings[k]?.cell_m ?? 0.05)) / 2
      const [sx, sy] = worldToScreen(v, half, half)
      const size = 2 * half * v.scale
      ctx.drawImage(this.canvases[k], sx, sy, size, size)
    }
  }
}

/**
 * What a UNIFORM grid of `cellM` would hold, derived from the ring stack:
 *  - rings with cells finer than cellM are aggregated into the uniform cell (any hit occupies it,
 *    the most populated class wins, height is the max), exactly like projecting the points coarsely;
 *  - rings with cells coarser than cellM are sampled by nearest lookup.
 */
export class UniformPainter {
  readonly U: number
  private canvas: HTMLCanvasElement
  private image: ImageData
  private buf32: Uint32Array
  private fwdRing: Uint8Array // 255 = outside range, 254 = handled by aggregation
  private fwdFlat: Uint32Array
  private inv: (Int32Array | null)[] // per ring: adaptive flat index -> uniform index
  private accCount: Uint16Array
  private accLabel: Uint8Array
  private accZ: Int16Array
  private touched: Uint32Array
  private nTouched = 0

  constructor(
    public cellM: number,
    rings: RingSpec[],
    rangeM = 100,
  ) {
    this.U = Math.round((2 * rangeM) / cellM)
    const U = this.U
    this.canvas = makeCanvas(U)
    this.image = new ImageData(U, U)
    this.buf32 = new Uint32Array(this.image.data.buffer)
    this.fwdRing = new Uint8Array(U * U)
    this.fwdFlat = new Uint32Array(U * U)
    this.accCount = new Uint16Array(U * U)
    this.accLabel = new Uint8Array(U * U)
    this.accZ = new Int16Array(U * U)
    this.touched = new Uint32Array(U * U)
    // forward map (uniform cell centre -> ring cell), only used where the ring is coarser
    for (let ui = 0; ui < U; ui++) {
      const x = -rangeM + (ui + 0.5) * cellM
      for (let uj = 0; uj < U; uj++) {
        const y = -rangeM + (uj + 0.5) * cellM
        const d = Math.max(Math.abs(x), Math.abs(y))
        let r = -1
        for (let k = 0; k < rings.length; k++) if (d < rings[k].outer_m) { r = k; break }
        const q = ui * U + uj
        if (r < 0) {
          this.fwdRing[q] = 255
          continue
        }
        const spec = rings[r]
        if (spec.cell_m < cellM - 1e-9) {
          this.fwdRing[q] = 254
          continue
        }
        const half = spec.outer_m
        const i = Math.min(spec.size - 1, Math.max(0, Math.floor((x + half) / spec.cell_m + 1e-9)))
        const j = Math.min(spec.size - 1, Math.max(0, Math.floor((y + half) / spec.cell_m + 1e-9)))
        this.fwdRing[q] = r
        this.fwdFlat[q] = i * spec.size + j
      }
    }
    // inverse map (ring cell centre -> uniform cell) for rings finer than cellM
    this.inv = rings.map(spec => {
      if (spec.cell_m >= cellM - 1e-9) return null
      const S = spec.size
      const half = spec.outer_m
      const m = new Int32Array(S * S)
      for (let i = 0; i < S; i++) {
        const x = -half + (i + 0.5) * spec.cell_m
        const ui = Math.min(U - 1, Math.max(0, Math.floor((x + rangeM) / cellM)))
        for (let j = 0; j < S; j++) {
          const y = -half + (j + 0.5) * spec.cell_m
          const uj = Math.min(U - 1, Math.max(0, Math.floor((y + rangeM) / cellM)))
          m[i * S + j] = ui * U + uj
        }
      }
      return m
    })
  }

  paint(frame: GridFrame, dense: DenseRing[], o: PaintOptions) {
    const palette = paletteRgb(o.cbPalette ? PALETTE_CB : PALETTE_DEFAULT)
    const U = this.U
    const b = this.buf32
    b.fill(0)
    // reset accumulators touched last frame
    for (let t = 0; t < this.nTouched; t++) {
      const q = this.touched[t]
      this.accCount[q] = 0
      this.accLabel[q] = 0
      this.accZ[q] = -32768
    }
    this.nTouched = 0
    const write = (q: number, label: number, zCm: number) => {
      const ui = (q / U) | 0
      const uj = q - ui * U
      const c = shadeRgb(palette[label], zCm, o.heightShade)
      b[(U - 1 - ui) * U + (U - 1 - uj)] = pack(c[0] | 0, c[1] | 0, c[2] | 0, 255)
    }
    // 1) aggregate finer rings
    frame.rings.forEach((r, k) => {
      const m = this.inv[k]
      if (!m) return
      const d = dense[k]
      for (let t = 0; t < r.n; t++) {
        const p = r.idx[t]
        const label = d.label[p]
        if (label === 0 || !o.layers[label]) continue
        const q = m[p]
        const cnt = d.count[p]
        if (this.accCount[q] === 0) this.touched[this.nTouched++] = q
        if (cnt >= this.accCount[q]) {
          this.accCount[q] = cnt
          this.accLabel[q] = label
        }
        if (d.zMax[p] > this.accZ[q]) this.accZ[q] = d.zMax[p]
      }
    })
    for (let t = 0; t < this.nTouched; t++) {
      const q = this.touched[t]
      write(q, this.accLabel[q], this.accZ[q])
    }
    // 2) sample coarser rings
    for (let q = 0; q < U * U; q++) {
      const r = this.fwdRing[q]
      if (r >= 254) continue
      const d = dense[r]
      if (!d) continue
      const p = this.fwdFlat[q]
      const label = d.label[p]
      if (label === 0 || !o.layers[label]) continue
      write(q, label, d.zMax[p])
    }
    this.canvas.getContext('2d')!.putImageData(this.image, 0, 0)
  }

  draw(ctx: CanvasRenderingContext2D, v: View, rangeM = 100) {
    ctx.imageSmoothingEnabled = false
    const [sx, sy] = worldToScreen(v, rangeM, rangeM)
    const size = 2 * rangeM * v.scale
    ctx.drawImage(this.canvas, sx, sy, size, size)
  }
}

export function drawGrid(ctx: CanvasRenderingContext2D, v: View, w: number, h: number, stepM = 10) {
  ctx.strokeStyle = 'rgba(255,255,255,0.045)'
  ctx.lineWidth = 1
  ctx.beginPath()
  const [x0, y0] = screenToWorld(v, w, h)
  const [x1, y1] = screenToWorld(v, 0, 0)
  for (let x = Math.ceil(x0 / stepM) * stepM; x <= x1; x += stepM) {
    const sy = v.cy - x * v.scale
    ctx.moveTo(0, sy)
    ctx.lineTo(w, sy)
  }
  for (let y = Math.ceil(y0 / stepM) * stepM; y <= y1; y += stepM) {
    const sx = v.cx - y * v.scale
    ctx.moveTo(sx, 0)
    ctx.lineTo(sx, h)
  }
  ctx.stroke()
}

export function drawRingOutlines(ctx: CanvasRenderingContext2D, v: View, rings: RingSpec[], labels = true) {
  ctx.lineWidth = 1
  ctx.font = '600 11px Inter, system-ui, sans-serif'
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'left'
  rings.forEach((r, k) => {
    const s = r.outer_m * v.scale
    ctx.strokeStyle = `rgba(212,252,121,${0.55 - k * 0.11})`
    ctx.setLineDash(k === rings.length - 1 ? [6, 6] : [])
    ctx.strokeRect(v.cx - s, v.cy - s, 2 * s, 2 * s)
    if (labels && 2 * s > 90) {
      const text = `${r.outer_m} m · ${CELL_LABELS[k]} cells`
      const tw = ctx.measureText(text).width
      // label sits inside the square's top-right corner so it never collides with the overlay chips
      const lx = v.cx + s - tw - 18
      const ly = v.cy - s + 24
      ctx.fillStyle = 'rgba(11,18,35,0.78)'
      ctx.fillRect(lx - 6, ly - 18, tw + 12, 18)
      ctx.fillStyle = 'rgba(212,252,121,0.95)'
      ctx.fillText(text, lx, ly - 4)
    }
  })
  ctx.setLineDash([])
}

export function drawEgo(ctx: CanvasRenderingContext2D, v: View) {
  // nuScenes ego: lidar sits ~0.9 m behind the front axle; draw the body centred slightly behind the origin
  const L = Math.max(20, 6.5 * v.scale)
  const W = Math.max(10, 2.7 * v.scale)
  drawCar(ctx, v.cx, v.cy + L * 0.05, L, W)
}

export function drawSweep(ctx: CanvasRenderingContext2D, v: View, theta: number, w: number, h: number) {
  const R = Math.hypot(w, h)
  const a0 = -theta - Math.PI / 2
  const grad = ctx.createRadialGradient(v.cx, v.cy, 0, v.cx, v.cy, R * 0.7)
  grad.addColorStop(0, 'rgba(212,252,121,0.13)')
  grad.addColorStop(1, 'rgba(212,252,121,0)')
  ctx.beginPath()
  ctx.moveTo(v.cx, v.cy)
  ctx.arc(v.cx, v.cy, R, a0 - 0.5, a0)
  ctx.closePath()
  ctx.fillStyle = grad
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(v.cx, v.cy)
  ctx.lineTo(v.cx + Math.cos(a0) * R, v.cy + Math.sin(a0) * R)
  ctx.strokeStyle = 'rgba(212,252,121,0.35)'
  ctx.lineWidth = 1
  ctx.stroke()
}

export function drawCellHighlight(ctx: CanvasRenderingContext2D, v: View, cx: number, cy: number, cellM: number, color: string) {
  const s = Math.max(6, cellM * v.scale)
  const [sx, sy] = worldToScreen(v, cx, cy)
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.strokeRect(sx - s / 2, sy - s / 2, s, s)
}
