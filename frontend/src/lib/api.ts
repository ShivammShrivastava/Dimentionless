/**
 * Backend client. Mirrors avr_lidar/server/app.py.
 * Live mode talks to the FastAPI server; mock mode reads the files exported by
 * scripts/export_mock_frames.py from /mock (public/mock).
 */
import type { RingSpec } from './grid'
import { decodePoints, type PointsPayload } from './decode'

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://127.0.0.1:8000'
export const WS_URL = API_URL.replace(/^http/, 'ws')
export const FORCE_MOCK = (import.meta.env.VITE_MOCK as string | undefined) === 'true'

export type Mode = 'live' | 'mock'

export interface SceneInfo {
  name: string
  description: string
  num_frames: number
  split: 'train' | 'val'
  exported_indices?: number[]
}

export interface Health {
  ok?: boolean
  mode: 'gt' | 'model'
  device?: string
  encoding?: string
  rings: RingSpec[]
}

interface Stat {
  mean: number
  p50: number
  p95: number
}

export interface Metrics {
  split: string
  num_frames: number
  checkpoint_epoch: number
  device: string
  fps: { total: number; inference: number; projection: number; encode: number }
  latency_ms: {
    range_proj: Stat
    inference: Stat
    unproject: Stat
    projection: Stat
    encode: Stat
    total: Stat
    p50: number
    p95: number
  }
  miou: number
  point_accuracy: number
  iou_per_class: Record<string, number>
  accuracy_by_distance: Record<string, number>
  accuracy_by_distance_per_class: Record<string, Record<string, number | null>>
  points_by_distance: Record<string, number>
  cell_label_accuracy: number
  cell_iou_per_class: Record<string, number>
  obstacle_cells_retained_within_10m: number | null
  memory: {
    varres_bytes: number
    uniform_2d_5cm_bytes: number
    uniform_3d_5cm_bytes: number
    reduction_2d: number
    reduction_3d: number
    wire_bytes_msgpack: number
  }
  cells: { varres: number; uniform_2d_5cm: number; occupied_mean: number }
  points: { mean_per_frame: number; dropped_beyond_100m_mean: number }
  rings: RingSpec[]
  class_names: string[]
  confusion: number[][]
}

async function getJson<T>(url: string, timeoutMs = 4000): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`${res.status} ${url}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(t)
  }
}

async function getBuffer(url: string, timeoutMs = 8000): Promise<ArrayBuffer> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`${res.status} ${url}`)
    return await res.arrayBuffer()
  } finally {
    clearTimeout(t)
  }
}

/** Returns the live health document, or null when the backend is unreachable. */
export async function probeHealth(timeoutMs = 6000): Promise<Health | null> {
  if (FORCE_MOCK) return null
  try {
    return await getJson<Health>(`${API_URL}/api/health`, timeoutMs)
  } catch {
    return null
  }
}

export const fetchHealth = (mode: Mode) =>
  mode === 'live' ? getJson<Health>(`${API_URL}/api/health`) : getJson<Health>('/mock/health.json')

export const fetchScenes = async (mode: Mode): Promise<SceneInfo[]> => {
  const url = mode === 'live' ? `${API_URL}/api/scenes` : '/mock/scenes.json'
  return (await getJson<{ scenes: SceneInfo[] }>(url)).scenes
}

export const fetchMetrics = async (mode: Mode): Promise<Metrics | null> => {
  try {
    return await getJson<Metrics>(mode === 'live' ? `${API_URL}/api/metrics` : '/mock/metrics.json')
  } catch {
    if (mode === 'live') {
      try {
        return await getJson<Metrics>('/mock/metrics.json')
      } catch {
        return null
      }
    }
    return null
  }
}

export const frameUrl = (mode: Mode, scene: string, idx: number) =>
  mode === 'live' ? `${API_URL}/api/scenes/${scene}/frames/${idx}` : `/mock/frames/${scene}/${idx}.msgpack`

export const fetchFrame = (mode: Mode, scene: string, idx: number) => getBuffer(frameUrl(mode, scene, idx))

export async function fetchPoints(scene: string, idx: number, max = 20000): Promise<PointsPayload> {
  return decodePoints(await getBuffer(`${API_URL}/api/scenes/${scene}/frames/${idx}/points?max=${max}`))
}

export async function uploadPointCloud(file: File): Promise<ArrayBuffer> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_URL}/api/upload`, { method: 'POST', body: form })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text || `Upload failed (${res.status})`)
  }
  return await res.arrayBuffer()
}

export const streamUrl = (scene: string, fps: number) =>
  `${WS_URL}/ws/stream?scene=${encodeURIComponent(scene)}&fps=${fps}`
