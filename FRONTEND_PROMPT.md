# Frontend prompt — Adaptive Variable-Resolution 2.5D Lidar Dashboard

Copy everything below the line into the other model/device. It is self-contained: it describes the product, the exact backend API contract, a mock-data mode so the frontend can be built with no backend running, and acceptance criteria.

---

## 1. What you are building

Build a **real-time visualization dashboard** for a Lidar perception system. The backend (Python, FastAPI) takes raw Lidar point clouds from the nuScenes dataset, runs a deep-learning semantic segmentation model, and projects the classified points into a **variable-resolution 2.5D grid**: an elevation map whose cell size grows with distance from the sensor (5 cm cells within 10 m, up to 50 cm cells out to 100 m), like human foveated vision. The dashboard must show this map live, color-coded by semantic class, and make the **memory savings and real-time performance** obvious to a viewer.

The dashboard is a **single-page web app**. Stack: **React 18 + TypeScript + Vite**, **Tailwind CSS**, **Three.js** (via `@react-three/fiber` + `@react-three/drei`) for the 3D view, **Canvas 2D** for the top-down view, **Recharts** for charts, **msgpackr** for decoding binary frames, **pako** for zlib inflate, `zustand` for state. No backend code; the backend already exists. Dark theme by default.

## 2. Domain facts you must encode

### 2.1 Semantic classes and colors (fixed, use exactly)

| id | name | color | meaning |
|---|---|---|---|
| 0 | `ignore` / empty | `#1a1a1a` (transparent in 3D) | no points / noise / ego vehicle |
| 1 | `drivable` | `#3b82f6` blue | drivable road surface |
| 2 | `terrain_nondrivable` | `#22c55e` green | sidewalk, grass, other flat non-drivable |
| 3 | `static_obstacle` | `#a3a3a3` grey (or `#f59e0b` amber for high-contrast toggle) | walls, poles, vegetation, barriers, cones |
| 4 | `dynamic_object` | `#ef4444` red | pedestrians, vehicles, bicycles |

### 2.2 Grid geometry (fixed)

Coordinates are in the **ego frame**: origin at the Lidar sensor, +x forward, +y left, z up, metres. The map covers 200 m × 200 m (−100…+100 on each axis).

The grid is **four square annular rings** keyed on Chebyshev distance `d = max(|x|,|y|)`:

| ring | d range (m) | cell size (m) | cells per side | stored as |
|---|---|---|---|---|
| 0 | 0 – 10 | 0.05 | 400 | dense 400×400 |
| 1 | 10 – 20 | 0.10 | 400 | dense 400×400, inner 200×200 hole masked |
| 2 | 20 – 40 | 0.20 | 400 | dense 400×400, inner 200×200 hole masked |
| 3 | 40 – 100 | 0.50 | 400 | dense 400×400, inner 160×160 hole masked |

Every ring is a 400×400 array. Cell `(i, j)` in ring `r` with size `s_r` and half-extent `R_r = 200 * s_r` covers world `x ∈ [-R_r + i*s_r, -R_r + (i+1)*s_r)`, `y ∈ [-R_r + j*s_r, -R_r + (j+1)*s_r)`. Cells inside the ring's inner hole are always class 0 and must **not** be drawn (the inner ring draws there). Provide `cellToWorld(ring,i,j)` and `worldToCell(x,y)` utilities and unit-test them.

Total occupied capacity: ~534,400 cells. Uniform 5 cm baseline: 16,000,000 cells. Uniform 5 cm 3D voxel baseline: ~1.9 billion voxels.

## 3. Backend API contract

Base URL configurable via `VITE_API_URL` (default `http://localhost:8000`). WebSocket at same host, `ws://`.

### 3.0 Encoding (important)

Every binary GridFrame (REST frame endpoint and WebSocket) is **msgpack with SPARSE rings**: only occupied cells are sent (typically 12k–20k of 534k), as a flat index array plus one value array per layer. A frame is ~200 KB and needs no compression. The frontend **densifies** each ring into `size*size` typed arrays (fill: label 0, z_max_cm and z_min_cm `-32768` = empty sentinel, confidence 0, count 0) and then renders as before. Reuse the dense buffers across frames (clear + scatter) instead of reallocating.

Optional zlib: pass `?compress=true` (REST) or `&compress=true` (WS) to receive zlib-deflated msgpack; detect by first byte `0x78` and inflate with `pako.inflate` before unpacking. The REST response carries header `X-Content-Compression: zlib|none`. The `/points` endpoint is never compressed.

`GET /api/health` → `{ "ok": true, "mode": "model" | "gt", "device": "cuda", "encoding": "...", "rings": [ { "ring": 0, "inner_m": 0, "outer_m": 10, "cell_m": 0.05, "size": 400, "inner_hole": 0, "cells": 160000 }, ... ] }` — use `rings` as the source of truth for the geometry table in 2.2 instead of hard-coding it.

`GET /api/classes` → `{ "names": [...5 names...], "colors": [...5 hex...] }`

### 3.1 REST

`GET /api/scenes`
```json
{ "scenes": [ { "name": "scene-0061", "description": "Parked truck, ...", "num_frames": 39 }, ... ] }
```

`GET /api/scenes/{scene}/frames/{idx}` → `application/x-msgpack`, one **GridFrame** (schema in 3.3).

`GET /api/metrics` → JSON:
```json
{
  "fps": { "total": 62.4, "inference": 118.0, "projection": 410.0, "encode": 800.0 },
  "latency_ms": { "p50": 15.1, "p95": 21.8 },
  "miou": 0.74,
  "iou_per_class": { "drivable": 0.96, "terrain_nondrivable": 0.61, "static_obstacle": 0.82, "dynamic_object": 0.68 },
  "accuracy_by_distance": { "0-10": 0.95, "10-20": 0.91, "20-40": 0.86, "40-100": 0.74 },
  "memory": {
    "varres_bytes": 2137600,
    "uniform_2d_5cm_bytes": 64000000,
    "uniform_3d_5cm_bytes": 1920000000,
    "reduction_2d": 29.9,
    "reduction_3d": 898.0
  },
  "cells": { "varres": 534400, "uniform_2d_5cm": 16000000 }
}
```

`GET /api/scenes/{scene}/frames/{idx}/points?max=20000` → msgpack `{ "xyz": Float32Array(N*3) bytes, "label": Uint8Array(N) bytes }` — subsampled labeled point cloud for the optional 3D point overlay.

### 3.2 WebSocket

`WS /ws/stream?scene={name}&fps={n}`
- Server → client: binary messages, each one msgpack-encoded **GridFrame**.
- Client → server: JSON text `{"cmd":"play"}`, `{"cmd":"pause"}`, `{"cmd":"seek","idx":12}`, `{"cmd":"fps","value":5}`, `{"cmd":"scene","name":"scene-0103"}`.
- On reconnect the client resends the current scene/idx.

### 3.3 GridFrame schema (msgpack map)

```ts
interface GridFrame {
  scene: string;
  idx: number;                 // frame index in scene
  timestamp_us: number;
  ego_pose: { x: number; y: number; yaw: number };   // global, for the minimap trail
  rings: RingLayer[];          // length 4, index = ring id
  stats: {
    num_points: number;
    points_dropped_beyond_range: number;
    latency_ms: { inference: number; projection: number; encode: number; total: number };
    memory_bytes: number;      // this frame's actual grid storage
    occupied_cells: number;
    class_counts: number[];    // length 5, cells per class
    compressed: boolean;       // true when the payload was zlib-deflated (see 3.0)
  };
}

interface RingLayer {
  ring: number;                // 0..3
  size: number;                // 400
  cell_m: number;              // 0.05 | 0.10 | 0.20 | 0.50
  inner_hole: number;          // cells per side of the masked centre (0, 200, 200, 160)
  n: number;                   // number of occupied cells in this ring
  idx: Uint32Array;            // n flat indices, row-major i*size + j, strictly increasing
  label: Uint8Array;           // n class ids 0..4 (aligned with idx)
  z_max_cm: Int16Array;        // n heights in cm
  z_min_cm: Int16Array;        // n
  confidence: Uint8Array;      // n, 0..255 majority fraction
  count: Uint16Array;          // n, points in the cell
}
// Densify: dense[k] = fill; for (let t = 0; t < n; t++) dense[idx[t]] = value[t];
// cell (i, j) = (Math.floor(idx / size), idx % size)
```
Binary arrays arrive as msgpack `bin` and must be wrapped in typed arrays without copying (`new Uint32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)` etc.). If `byteOffset` is not a multiple of the element size, copy into an aligned buffer first. The server sends **little-endian**, which matches every mainstream browser.

## 4. Mock mode (build with this first)

Provide `VITE_MOCK=true`. In mock mode:
- Load `public/mock/scenes.json`, `public/mock/classes.json`, `public/mock/health.json`, `public/mock/metrics.json`, and `public/mock/frames/{scene}/{idx}.msgpack` if present. These files are produced by the backend's `scripts/export_mock_frames.py` and follow the schemas above exactly (frames are sparse msgpack, see 3.0). `scenes.json` entries carry an extra `exported_indices: number[]` listing which frame indices exist on disk; step playback through that list.
- If those files are absent, **synthesize** frames procedurally: a straight blue road 8 m wide along +x with green sidewalks, grey walls at y = ±12 m, 6–10 red dynamic boxes that move each frame, random heights (road ≈ 0 cm, sidewalk 15 cm, walls 200–300 cm, cars 150 cm), decreasing point density with distance, and a fake `stats` block with plausible latency numbers. Playback in mock mode must loop at the selected FPS.

## 5. Layout and components

Responsive 3-column layout at ≥1440 px, stacking below. Left rail 280 px, centre flexible, right rail 340 px.

### 5.1 Header
Project title "Adaptive Variable-Resolution 2.5D Lidar Mapping", scene selector (dropdown), connection status pill (Live / Reconnecting / Mock), current FPS badge, dark/light toggle.

### 5.2 Centre — Map viewer (the hero)
Tabs: **Top-down 2.5D**, **3D Height Map**, **Side-by-side (uniform vs adaptive)**.

**Top-down 2.5D (Canvas 2D):**
- Draw rings from outermost (3) to innermost (0) so finer rings paint over coarser ones. Skip cells in the inner hole and class 0.
- Colour = class colour; **brightness modulated by height** (`z_max_cm`) within a class so curbs/poles read as lighter. Toggle: "Height shading".
- Overlay: thin white square outlines at 10 / 20 / 40 / 100 m ring boundaries with labels "5 cm", "10 cm", "20 cm", "50 cm". Toggle.
- Overlay: ego vehicle icon at the origin pointing +x. Optional grid lines every 10 m.
- Pan (drag), zoom (wheel, 0.5×–40×), "Reset view" button, "Follow ego" (always on since frame is ego-centric; keep for temporal-fusion later).
- Hover → **cell inspector tooltip**: ring, cell size, world (x, y), class name, z_max/z_min in m, count, confidence. Clicking pins the inspector in the right rail.
- Layer toggles per class (checkboxes) and a "Confidence ≥" slider that greys out low-confidence cells.
- Render must stay ≥ 30 FPS at 1× zoom. Use an offscreen canvas per ring updated only on new frame, then composite; use `ImageData` writes, not `fillRect` per cell.

**3D Height Map (react-three-fiber):**
- One `THREE.Mesh` per ring: a 400×400 plane geometry with vertex z displaced from `z_max_cm/100`, vertex colour from class, holes made transparent via a per-vertex alpha or by discarding in a shader. Update geometry attributes in place on new frame (no re-allocation).
- Orbit controls, default camera behind and above the ego looking forward. Height exaggeration slider (1×–5×). Optional labelled point-cloud overlay from `/points` (`THREE.Points`, 20k points).
- Wireframe toggle so viewers can literally see the cells getting bigger with distance — this is the key visual for the "foveated" claim.

**Side-by-side:**
- Left: the adaptive map. Right: the same frame resampled to a **uniform 50 cm** grid (nearest-neighbour from the adaptive rings) so viewers see detail lost near the ego. Under each: cell count and bytes. A centre badge shows "×N less memory than uniform 5 cm".

### 5.3 Left rail — Playback & controls
- Play / Pause, frame slider with index and timestamp, step ±1, FPS selector (1/5/10/20).
- Scene list with thumbnails (first frame rendered to a tiny canvas) and frame counts.
- Ring configuration display (read-only table from 2.2) — later editable if the backend supports it.
- Minimap: ego trajectory from `ego_pose` for the scene, current frame highlighted.

### 5.4 Right rail — Metrics
Top: **live per-frame stats** (updated every frame, sparkline history of last 100 frames):
- Total latency ms and FPS (large numbers), stacked bar of inference / projection / encode.
- Points in frame, dropped beyond range, occupied cells.
- Class distribution (horizontal stacked bar, class colours).

Below: **benchmark panel** from `/api/metrics`:
- Memory comparison: horizontal bar chart, log scale, three bars (Adaptive / Uniform 2D 5 cm / Uniform 3D 5 cm), with the reduction factors as annotations.
- Accuracy by distance: bar or line chart for bins 0–10, 10–20, 20–40, 40–100 m; x-axis also shows the cell size used in that band.
- Per-class IoU: 4 bars in class colours, mIoU as a headline number.
- Latency p50 / p95.

Bottom: pinned **cell inspector** (from 5.2 click).

### 5.5 Legend
Persistent floating legend on the map with the 4 class colours and ring-size key.

## 6. Non-functional requirements
- TypeScript strict, ESLint, Prettier. Vitest unit tests for `worldToCell/cellToWorld`, msgpack decoding, and the uniform-resampling function.
- Densify + drawing of a frame must complete in < 16 ms on a mid-range laptop; do heavy decode in a Web Worker if needed.
- WebSocket auto-reconnect with exponential backoff; never crash on a malformed frame — log and skip.
- Keyboard: space = play/pause, ←/→ = step, 1–4 toggle class layers, R = reset view, W = wireframe.
- Accessible colours: the class palette must remain distinguishable with deuteranopia; include a "colour-blind safe" palette toggle (`#0072B2`, `#009E73`, `#999999`, `#D55E00`).
- Export buttons: PNG of current map view, CSV of the metrics panel.

## 7. Deliverables
- `frontend/` folder with `README.md` (run, env vars, mock mode), `npm run dev`, `npm run build`, `npm run test`.
- Works fully in `VITE_MOCK=true` with synthesized data and with exported mock frames.
- Switches to live WebSocket when `VITE_MOCK=false` and `VITE_API_URL` points at the backend.

## 8. Acceptance checklist
- [ ] Rings are visibly nested; wireframe in 3D shows cell size growing at 10/20/40 m.
- [ ] Hovering a 5 cm cell near the ego and a 50 cm cell far away shows the correct cell size and world coordinates.
- [ ] Memory panel shows the ~30× (2D) and ~900× (3D) reduction with correct units.
- [ ] Accuracy-by-distance chart labels each band with its cell size.
- [ ] Playback at 10 FPS with no dropped renders in mock mode.
- [ ] All four class layers can be toggled independently; dynamic objects are clearly red.
- [ ] Unit tests for grid maths pass.
