/**
 * Minimal external store. Components subscribe to single fields through useApp(selector),
 * so a 10 Hz frame stream re-renders only the map and the live stats, not the page.
 */
import { useSyncExternalStore } from 'react'
import { DEFAULT_RINGS, SAME_BUDGET_CELL_M, type CellRef, type RingSpec } from '../lib/grid'
import { DensePool, type DenseRing, type GridFrame } from '../lib/decode'
import { FORCE_MOCK, fetchHealth, fetchMetrics, fetchScenes, probeHealth, type Health, type Metrics, type Mode, type SceneInfo } from '../lib/api'
import { Player, type PlayerState, type WsStatus } from '../lib/player'

export type ViewTab = 'top' | '3d' | 'compare'

export interface Settings {
  layers: boolean[]
  confMin: number // 0..255
  showRings: boolean
  heightShade: boolean
  cbPalette: boolean
  exaggeration: number
  wireframe: boolean
  view: ViewTab
  compareCell: number
}

export interface LatencySample {
  total: number
  inference: number
  projection: number
  encode: number
  decode: number
}

export interface AppState {
  mode: Mode | 'connecting'
  wsStatus: WsStatus
  health: Health | null
  scenes: SceneInfo[]
  metrics: Metrics | null
  rings: RingSpec[]
  player: PlayerState | null
  frame: GridFrame | null
  dense: DenseRing[] | null
  frameSeq: number
  history: LatencySample[]
  settings: Settings
  pinned: CellRef | null
  error: string | null
}

const initial: AppState = {
  mode: 'connecting',
  wsStatus: 'idle',
  health: null,
  scenes: [],
  metrics: null,
  rings: DEFAULT_RINGS,
  player: null,
  frame: null,
  dense: null,
  frameSeq: 0,
  history: [],
  settings: {
    layers: [true, true, true, true, true],
    confMin: 0,
    showRings: true,
    heightShade: true,
    cbPalette: false,
    exaggeration: 1.6,
    wireframe: false,
    view: 'top',
    compareCell: SAME_BUDGET_CELL_M,
  },
  pinned: null,
  error: null,
}

type Listener = () => void

class Store {
  state: AppState = initial
  private listeners = new Set<Listener>()
  subscribe = (l: Listener) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  get = () => this.state
  set(partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
    const p = typeof partial === 'function' ? partial(this.state) : partial
    this.state = { ...this.state, ...p }
    this.listeners.forEach(l => l())
  }
}

export const store = new Store()

export function useApp<S>(selector: (s: AppState) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.state), () => selector(store.state))
}

// ------------------------------------------------------------------ runtime
let player: Player | null = null
const pool = new DensePool()

function onFrame(f: GridFrame) {
  const dense = pool.densify(f)
  const l = f.stats.latency_ms
  const sample: LatencySample = {
    total: l.total,
    inference: l.inference,
    projection: l.projection,
    encode: l.encode,
    decode: f.decode_ms,
  }
  store.set(s => ({
    frame: f,
    dense,
    frameSeq: s.frameSeq + 1,
    history: s.history.length >= 120 ? [...s.history.slice(1), sample] : [...s.history, sample],
  }))
}

function startPlayer(mode: Mode, scenes: SceneInfo[], scene: string, fps = 10) {
  player?.destroy()
  player = new Player(
    mode,
    scenes,
    {
      onFrame,
      onState: p => store.set({ player: p }),
      onWs: w => store.set({ wsStatus: w }),
    },
    scene,
    fps,
  )
  player.start()
}

export async function initApp(force?: Mode) {
  store.set({ mode: 'connecting', error: null })
  try {
    const live = force === 'mock' ? null : await probeHealth()
    const mode: Mode = live ? 'live' : 'mock'
    const health = live ?? (await fetchHealth('mock').catch(() => null))
    const [scenes, metrics] = await Promise.all([fetchScenes(mode), fetchMetrics(mode)])
    const rings = health?.rings ?? metrics?.rings ?? DEFAULT_RINGS
    if (!scenes.length) throw new Error('no scenes available')
    const preferred = scenes.find(s => s.name === 'scene-0103') ?? scenes[0]
    store.set({ mode, health, scenes, metrics, rings, history: [], pinned: null })
    startPlayer(mode, scenes, preferred.name, store.state.player?.fps ?? 10)
  } catch (e) {
    store.set({ mode: 'mock', error: (e as Error).message })
  }
  scheduleUpgradeProbe()
}

/** While in demo mode, quietly re-probe the backend and upgrade to live once when it appears. */
let upgradeTimer: number | null = null
function scheduleUpgradeProbe() {
  if (upgradeTimer) window.clearInterval(upgradeTimer)
  upgradeTimer = null
  if (store.state.mode !== 'mock' || FORCE_MOCK) return
  upgradeTimer = window.setInterval(async () => {
    if (store.state.mode !== 'mock') {
      if (upgradeTimer) window.clearInterval(upgradeTimer)
      upgradeTimer = null
      return
    }
    const h = await probeHealth(3000)
    if (h) {
      if (upgradeTimer) window.clearInterval(upgradeTimer)
      upgradeTimer = null
      void initApp('live')
    }
  }, 15000)
}

if (import.meta.env.DEV) (window as unknown as { __avr: unknown }).__avr = { store, get state() { return store.state } }

export const actions = {
  togglePlay: () => player?.toggle(),
  play: () => player?.play(),
  pause: () => player?.pause(),
  seek: (idx: number) => player?.seek(idx),
  step: (d: number) => player?.step(d),
  setFps: (fps: number) => player?.setFps(fps),
  setScene: (name: string) => {
    store.set({ pinned: null })
    player?.setScene(name)
  },
  setSettings: (p: Partial<Settings>) => store.set(s => ({ settings: { ...s.settings, ...p } })),
  toggleLayer: (k: number) =>
    store.set(s => {
      const layers = s.settings.layers.slice()
      layers[k] = !layers[k]
      return { settings: { ...s.settings, layers } }
    }),
  pin: (c: CellRef | null) => store.set({ pinned: c }),
  switchMode: (m: Mode) => void initApp(m),
  retry: () => void initApp(),
}
