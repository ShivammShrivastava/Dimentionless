/**
 * Playback engine. Live mode streams over the backend WebSocket and mirrors its
 * JSON command protocol (play / pause / seek / fps / scene). Mock mode pages through
 * the exported frames in public/mock with a prefetching cache and identical semantics.
 */
import { decodeFrame, type GridFrame } from './decode'
import { fetchFrame, streamUrl, type Mode, type SceneInfo } from './api'

export interface PlayerState {
  scene: string
  idx: number
  playing: boolean
  fps: number
  frames: number[] // playable frame indices for the current scene
}

export type WsStatus = 'idle' | 'connecting' | 'open' | 'closed'

interface Handlers {
  onFrame: (f: GridFrame) => void
  onState: (s: PlayerState) => void
  onWs?: (s: WsStatus) => void
}

export class Player {
  private ws: WebSocket | null = null
  private timer: number | null = null
  private cache = new Map<string, ArrayBuffer>()
  private backoff = 500
  private destroyed = false
  private inflight = false
  state: PlayerState

  constructor(
    private mode: Mode,
    private scenes: SceneInfo[],
    private h: Handlers,
    scene: string,
    fps = 10,
  ) {
    this.state = { scene, idx: 0, playing: true, fps, frames: this.framesFor(scene) }
  }

  private framesFor(scene: string): number[] {
    const s = this.scenes.find(x => x.name === scene)
    if (!s) return [0]
    if (this.mode === 'mock' && s.exported_indices?.length) return s.exported_indices
    return Array.from({ length: s.num_frames }, (_, i) => i)
  }

  private emitState() {
    this.h.onState({ ...this.state })
  }

  start() {
    if (this.mode === 'live') this.connect()
    else this.loopMock()
    this.emitState()
  }

  // ------------------------------------------------------------------ live
  private connect() {
    if (this.destroyed) return
    this.h.onWs?.('connecting')
    const ws = new WebSocket(streamUrl(this.state.scene, this.state.fps))
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => {
      this.backoff = 500
      this.h.onWs?.('open')
      // resync the server to our state after a (re)connect
      if (this.state.idx) this.send({ cmd: 'seek', idx: this.state.idx })
      if (!this.state.playing) this.send({ cmd: 'pause' })
    }
    ws.onmessage = ev => {
      try {
        const f = decodeFrame(ev.data as ArrayBuffer)
        this.state.idx = f.idx
        this.state.scene = f.scene
        this.h.onFrame(f)
        this.emitState()
      } catch (e) {
        console.warn('bad frame', e)
      }
    }
    ws.onclose = () => {
      this.h.onWs?.('closed')
      if (this.destroyed) return
      window.setTimeout(() => this.connect(), this.backoff)
      this.backoff = Math.min(8000, this.backoff * 2)
    }
    ws.onerror = () => ws.close()
  }

  private send(msg: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  // ------------------------------------------------------------------ mock
  private key(scene: string, idx: number) {
    return `${scene}/${idx}`
  }

  private async buffer(scene: string, idx: number): Promise<ArrayBuffer> {
    const k = this.key(scene, idx)
    const hit = this.cache.get(k)
    if (hit) return hit
    const buf = await fetchFrame('mock', scene, idx)
    if (this.cache.size > 240) this.cache.delete(this.cache.keys().next().value as string)
    this.cache.set(k, buf)
    return buf
  }

  private prefetch(scene: string, pos: number) {
    const fr = this.state.frames
    for (let k = 1; k <= 3; k++) {
      const idx = fr[(pos + k) % fr.length]
      if (!this.cache.has(this.key(scene, idx))) this.buffer(scene, idx).catch(() => undefined)
    }
  }

  private async showMock(idx: number) {
    if (this.inflight) return
    this.inflight = true
    try {
      const scene = this.state.scene
      const buf = await this.buffer(scene, idx)
      if (this.destroyed || scene !== this.state.scene) return
      const f = decodeFrame(buf)
      this.h.onFrame(f)
      this.prefetch(scene, this.state.frames.indexOf(idx))
    } catch (e) {
      console.warn('mock frame failed', e)
    } finally {
      this.inflight = false
    }
  }

  private loopMock() {
    if (this.timer) window.clearTimeout(this.timer)
    const tick = async () => {
      if (this.destroyed) return
      if (this.state.playing) {
        await this.showMock(this.state.idx)
        const fr = this.state.frames
        const pos = fr.indexOf(this.state.idx)
        this.state.idx = fr[(pos + 1) % fr.length]
        this.emitState()
      }
      this.timer = window.setTimeout(tick, 1000 / this.state.fps)
    }
    // show the first frame immediately
    void this.showMock(this.state.idx)
    this.timer = window.setTimeout(tick, 1000 / this.state.fps)
  }

  // --------------------------------------------------------------- controls
  play() {
    this.state.playing = true
    if (this.mode === 'live') this.send({ cmd: 'play' })
    this.emitState()
  }

  pause() {
    this.state.playing = false
    if (this.mode === 'live') this.send({ cmd: 'pause' })
    this.emitState()
  }

  toggle() {
    this.state.playing ? this.pause() : this.play()
  }

  /** Seek to a frame index; in mock mode snaps to the nearest exported frame. */
  seek(idx: number) {
    const fr = this.state.frames
    let target = idx
    if (!fr.includes(idx)) target = fr.reduce((a, b) => (Math.abs(b - idx) < Math.abs(a - idx) ? b : a), fr[0])
    this.state.idx = target
    if (this.mode === 'live') this.send({ cmd: 'seek', idx: target })
    else void this.showMock(target)
    this.emitState()
  }

  step(delta: number) {
    const fr = this.state.frames
    const pos = fr.indexOf(this.state.idx)
    this.seek(fr[(pos + delta + fr.length) % fr.length])
  }

  setFps(fps: number) {
    this.state.fps = Math.max(0.5, Math.min(30, fps))
    if (this.mode === 'live') this.send({ cmd: 'fps', value: this.state.fps })
    this.emitState()
  }

  setScene(name: string) {
    if (!this.scenes.some(s => s.name === name)) return
    this.state.scene = name
    this.state.frames = this.framesFor(name)
    this.state.idx = this.state.frames[0]
    if (this.mode === 'live') this.send({ cmd: 'scene', name })
    else void this.showMock(this.state.idx)
    this.emitState()
  }

  destroy() {
    this.destroyed = true
    if (this.timer) window.clearTimeout(this.timer)
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
    }
  }
}
