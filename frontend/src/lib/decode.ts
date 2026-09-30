/**
 * Wire format decoder. Mirrors avr_lidar/server/codec.py (sparse msgpack, optional zlib).
 * Every ring ships only its occupied cells: `idx` (uint32 flat index i*size+j) plus one
 * value array per layer aligned with idx. Little-endian throughout.
 */
import { unpack } from 'msgpackr'
import { inflate } from 'pako'
import { EMPTY_CM } from './grid'

export interface RingLayer {
  ring: number
  size: number
  cell_m: number
  inner_hole: number
  n: number
  idx: Uint32Array
  label: Uint8Array
  zMax: Int16Array
  zMin: Int16Array
  conf: Uint8Array
  count: Uint16Array
}

export interface FrameStats {
  num_points: number
  points_dropped_beyond_range: number
  latency_ms: { inference: number; projection: number; encode: number; total: number }
  memory_bytes: number
  occupied_cells: number
  class_counts: number[]
  compressed: boolean
}

export interface GridFrame {
  scene: string
  idx: number
  timestamp_us: number
  ego_pose: { x: number; y: number; yaw: number }
  rings: RingLayer[]
  stats: FrameStats
  /** client-side decode time, ms */
  decode_ms: number
}

export interface DenseRing {
  ring: number
  size: number
  cell_m: number
  inner_hole: number
  n: number
  label: Uint8Array
  zMax: Int16Array
  zMin: Int16Array
  conf: Uint8Array
  count: Uint16Array
}

type TypedCtor<T> = { new (b: ArrayBufferLike, o: number, l: number): T; BYTES_PER_ELEMENT: number }

/** Wrap a msgpack `bin` as a typed array without copying when alignment allows. */
export function view<T>(u8: Uint8Array, Ctor: TypedCtor<T>): T {
  const bpe = Ctor.BYTES_PER_ELEMENT
  let src: Uint8Array = u8
  // Buffer.slice() (Node / msgpackr shim) is a view, not a copy: force a fresh, offset-0 buffer.
  if (u8.byteOffset % bpe !== 0 || u8.byteLength % bpe !== 0) src = new Uint8Array(u8)
  return new Ctor(src.buffer, src.byteOffset, Math.floor(src.byteLength / bpe))
}

export function decodeFrame(input: ArrayBuffer | Uint8Array): GridFrame {
  const t0 = performance.now()
  let u8 = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (u8.length > 2 && u8[0] === 0x78) u8 = inflate(u8)
  const raw = unpack(u8) as any
  const rings: RingLayer[] = raw.rings.map((r: any) => ({
    ring: r.ring,
    size: r.size,
    cell_m: r.cell_m,
    inner_hole: r.inner_hole,
    n: r.n,
    idx: view(r.idx, Uint32Array),
    label: view(r.label, Uint8Array),
    zMax: view(r.z_max_cm, Int16Array),
    zMin: view(r.z_min_cm, Int16Array),
    conf: view(r.confidence, Uint8Array),
    count: view(r.count, Uint16Array),
  }))
  return {
    scene: raw.scene,
    idx: raw.idx,
    timestamp_us: Number(raw.timestamp_us),
    ego_pose: raw.ego_pose,
    rings,
    stats: raw.stats,
    decode_ms: performance.now() - t0,
  }
}

export interface PointsPayload {
  n: number
  xyz: Float32Array
  label: Uint8Array
}

export function decodePoints(input: ArrayBuffer | Uint8Array): PointsPayload {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input)
  const raw = unpack(u8) as any
  return { n: raw.n, xyz: view(raw.xyz, Float32Array), label: view(raw.label, Uint8Array) }
}

/**
 * Reusable dense buffers. Only the cells touched by the previous frame are cleared,
 * so a frame costs ~2 x occupied cells of writes instead of 4 x 160k fills.
 */
export class DensePool {
  private rings: DenseRing[] = []
  private lastIdx: Uint32Array[] = []

  densify(frame: GridFrame): DenseRing[] {
    frame.rings.forEach((r, k) => {
      const N = r.size * r.size
      let d = this.rings[k]
      if (!d || d.label.length !== N) {
        d = {
          ring: r.ring,
          size: r.size,
          cell_m: r.cell_m,
          inner_hole: r.inner_hole,
          n: 0,
          label: new Uint8Array(N),
          zMax: new Int16Array(N).fill(EMPTY_CM),
          zMin: new Int16Array(N).fill(EMPTY_CM),
          conf: new Uint8Array(N),
          count: new Uint16Array(N),
        }
        this.rings[k] = d
        this.lastIdx[k] = new Uint32Array(0)
      }
      const prev = this.lastIdx[k]
      for (let t = 0; t < prev.length; t++) {
        const p = prev[t]
        d.label[p] = 0
        d.zMax[p] = EMPTY_CM
        d.zMin[p] = EMPTY_CM
        d.conf[p] = 0
        d.count[p] = 0
      }
      const idx = r.idx
      for (let t = 0; t < r.n; t++) {
        const p = idx[t]
        d.label[p] = r.label[t]
        d.zMax[p] = r.zMax[t]
        d.zMin[p] = r.zMin[t]
        d.conf[p] = r.conf[t]
        d.count[p] = r.count[t]
      }
      d.n = r.n
      d.cell_m = r.cell_m
      d.inner_hole = r.inner_hole
      this.lastIdx[k] = idx
    })
    return this.rings
  }
}
