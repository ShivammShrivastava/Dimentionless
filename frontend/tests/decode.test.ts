import { existsSync, readFileSync } from 'node:fs'
import { pack } from 'msgpackr'
import { describe, expect, it } from 'vitest'
import { DensePool, decodeFrame, view } from '../src/lib/decode'
import { EMPTY_CM } from '../src/lib/grid'

const bin = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength)

function syntheticFrame() {
  const S = 400
  const cells = [
    { i: 200, j: 200, label: 1, zmax: 3, zmin: -2, conf: 255, count: 12 },
    { i: 210, j: 190, label: 4, zmax: 150, zmin: 20, conf: 200, count: 7 },
    { i: 399, j: 399, label: 3, zmax: 320, zmin: 0, conf: 128, count: 1 },
  ]
  const ring0 = {
    ring: 0, size: S, cell_m: 0.05, inner_hole: 0, n: cells.length,
    idx: bin(Uint32Array.from(cells.map(c => c.i * S + c.j))),
    label: bin(Uint8Array.from(cells.map(c => c.label))),
    z_max_cm: bin(Int16Array.from(cells.map(c => c.zmax))),
    z_min_cm: bin(Int16Array.from(cells.map(c => c.zmin))),
    confidence: bin(Uint8Array.from(cells.map(c => c.conf))),
    count: bin(Uint16Array.from(cells.map(c => c.count))),
  }
  const empty = (ring: number, cell_m: number, inner_hole: number) => ({
    ring, size: S, cell_m, inner_hole, n: 0,
    idx: new Uint8Array(0), label: new Uint8Array(0), z_max_cm: new Uint8Array(0), z_min_cm: new Uint8Array(0), confidence: new Uint8Array(0), count: new Uint8Array(0),
  })
  return {
    scene: 'scene-test', idx: 3, timestamp_us: 1532402927647951,
    ego_pose: { x: 1, y: 2, yaw: 0.5 },
    rings: [ring0, empty(1, 0.1, 200), empty(2, 0.2, 200), empty(3, 0.5, 160)],
    stats: {
      num_points: 100, points_dropped_beyond_range: 0,
      latency_ms: { inference: 19, projection: 11, encode: 2, total: 32 },
      memory_bytes: 4275200, occupied_cells: 3, class_counts: [0, 1, 0, 1, 1], compressed: false,
    },
  }
}

describe('decoder', () => {
  it('decodes a synthetic sparse frame and densifies it', () => {
    const buf = pack(syntheticFrame())
    const f = decodeFrame(buf)
    expect(f.scene).toBe('scene-test')
    expect(f.rings).toHaveLength(4)
    expect(f.rings[0].n).toBe(3)
    expect(Array.from(f.rings[0].idx)).toEqual([200 * 400 + 200, 210 * 400 + 190, 399 * 400 + 399])
    expect(Array.from(f.rings[0].zMin)).toEqual([-2, 20, 0])
    expect(f.timestamp_us).toBe(1532402927647951)

    const pool = new DensePool()
    const d = pool.densify(f)
    expect(d[0].label[200 * 400 + 200]).toBe(1)
    expect(d[0].zMax[210 * 400 + 190]).toBe(150)
    expect(d[0].conf[399 * 400 + 399]).toBe(128)
    expect(d[0].zMax[0]).toBe(EMPTY_CM)
    expect(d[1].n).toBe(0)

    // a second frame clears only the cells the first one touched
    const f2 = syntheticFrame()
    f2.rings[0] = { ...f2.rings[0], n: 1, idx: bin(Uint32Array.of(5)), label: Uint8Array.of(2), z_max_cm: bin(Int16Array.of(9)), z_min_cm: bin(Int16Array.of(1)), confidence: Uint8Array.of(9), count: bin(Uint16Array.of(2)) }
    const d2 = pool.densify(decodeFrame(pack(f2)))
    expect(d2[0].label[200 * 400 + 200]).toBe(0)
    expect(d2[0].zMax[200 * 400 + 200]).toBe(EMPTY_CM)
    expect(d2[0].label[5]).toBe(2)
  })

  it('view() copies when the byte offset is misaligned', () => {
    const backing = new Uint8Array(9)
    const dv = new DataView(backing.buffer)
    dv.setInt16(1, -32768, true)
    dv.setInt16(3, 150, true)
    const mis = new Uint8Array(backing.buffer, 1, 4)
    const arr = view(mis, Int16Array)
    expect(Array.from(arr)).toEqual([-32768, 150])
  })

  it('decodes a real exported mock frame', () => {
    const p = 'public/mock/frames/scene-0061/0.msgpack'
    if (!existsSync(p)) return
    const f = decodeFrame(readFileSync(p))
    expect(f.scene).toBe('scene-0061')
    expect(f.rings).toHaveLength(4)
    expect(f.rings.map(r => r.cell_m)).toEqual([0.05, 0.1, 0.2, 0.5])
    expect(f.rings.map(r => r.inner_hole)).toEqual([0, 200, 200, 160])
    const total = f.rings.reduce((s, r) => s + r.n, 0)
    expect(total).toBe(f.stats.occupied_cells)
    for (const r of f.rings) {
      for (let t = 1; t < r.n; t++) expect(r.idx[t]).toBeGreaterThan(r.idx[t - 1])
      expect(r.label.length).toBe(r.n)
      expect(r.zMax.length).toBe(r.n)
    }
    expect(f.stats.class_counts).toHaveLength(5)
  })
})
