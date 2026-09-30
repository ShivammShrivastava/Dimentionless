# Adaptive Variable-Resolution 2.5D Lidar Mapping

Deep-learning pipeline that turns raw nuScenes Lidar sweeps into a **foveated 2.5D map**:
5 cm cells within 10 m of the sensor, growing to 50 cm cells at 100 m, with per-cell
elevation, semantic class (drivable / non-drivable terrain / static obstacle / dynamic object)
and confidence. ~30× less memory than a uniform 5 cm 2D grid, ~450× less than uniform 5 cm 3D voxels.

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the design and
[FRONTEND_PROMPT.md](FRONTEND_PROMPT.md) for the dashboard specification / API contract.

## Layout

```
avr_lidar/
  config.py                 ring spec, class names, paths
  data/nuscenes_loader.py   devkit-free nuScenes-mini loader (JSON metadata)
  data/class_map.py         32 nuScenes classes -> 5 project classes
  data/range_projection.py  point cloud <-> 32x1024 range image
  grid/varres_grid.py       VarResGrid: square Chebyshev rings, vectorised projection
  model/salsanext_lite.py   4.6M-param range-view U-Net
  model/losses.py           weighted CE + Lovasz-softmax
  model/dataset.py          cached range-image dataset with augmentation
  model/train.py            training loop (AMP, OneCycle)
  pipeline/infer.py         frame -> labels -> grid, per-stage timing
  eval/metrics.py           IoU, accuracy by distance
  eval/benchmark.py         writes results/metrics.json
  server/app.py             FastAPI REST + WebSocket
  server/codec.py           zlib+msgpack wire format
scripts/verify_frame.py     phase-0 sanity check + PNGs
scripts/export_mock_frames.py  offline frames for frontend dev
tests/                      grid + codec unit tests
```

## Setup

```powershell
pip install torch --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements.txt
New-Item -ItemType Directory -Force data\nuscenes
tar -xf "C:\path\to\v1.0-mini.tar" -C data\nuscenes
tar -xf "C:\path\to\nuScenes-lidarseg-mini-v1.0.tar" -C data\nuscenes   # second: adds lidarseg/ and lidarseg.json
python scripts\verify_frame.py
python -m pytest tests -q
```

## Train, benchmark, serve

```powershell
python -m avr_lidar.model.train --epochs 60 --batch 8          # ~15 min on an 8 GB laptop GPU
python -m avr_lidar.eval.benchmark --split val                  # -> results/metrics.json
python -m uvicorn avr_lidar.server.app:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000/docs` for the REST schema. WebSocket: `ws://localhost:8000/ws/stream?scene=scene-0061&fps=10`.
Set `AVR_USE_GT=1` to serve ground-truth labels (no model needed).

## Frontend offline data

```powershell
python scripts\export_mock_frames.py --scenes scene-0061 scene-0103 --stride 2
```

Copy `mock_frames/` to the frontend's `public/mock/`.

## Coordinate frame

Sensor-centred, ego-oriented: origin at the Lidar's (x, y), +x forward, +y left, z up,
z = 0 at the ego ground plane. Rings are keyed on Chebyshev distance `max(|x|, |y|)`.

## Results (mini_val, RTX 5060 Laptop)

| | |
|---|---|
| mIoU (points, 4 classes) | 0.747 |
| Cell-label accuracy | 0.872 |
| Pipeline latency p50 / p95 | 41 / 47 ms (24 FPS) |
| Memory vs uniform 5 cm 2D / 3D | 29.9× / 449× less |

Figures: `results/fig_qualitative.png`, `results/fig_accuracy_by_distance.png`, `results/fig_memory.png`, `results/fig_latency.png`.
Full numbers: `results/metrics.json`. Details and deviations: IMPLEMENTATION_PLAN.md §7.

## Frontend (dashboard)

`frontend/` is a Vite + React 18 + TypeScript single-page app (framer-motion, three.js, msgpackr, pako; no UI kit).
It streams frames from the backend over the WebSocket and falls back to the exported frames in
`frontend/public/mock/` when the backend is unreachable (and upgrades to live automatically when it appears).

```powershell
python -m uvicorn avr_lidar.server.app:app --host 127.0.0.1 --port 8000   # terminal 1
cd frontend; npm install; npm run dev                                         # terminal 2 -> http://127.0.0.1:5173
```

- `VITE_API_URL` (default `http://127.0.0.1:8000`), `VITE_MOCK=true` forces demo mode.
- `npm run test` (grid maths + sparse decoder, incl. a real exported frame), `npm run build` (type-check + bundle).
- Sections, in order: overview (hero with a procedural lidar sweep), live map (top-down canvas, 3D elevation columns,
  uniform-vs-adaptive comparison at equal memory), evidence charts, foveation explainer with a true-cell-size lens, pipeline latency.
- Palette: warm graphite #111113 / #17171A surfaces, coral #FF6B9D, lime #D4FC79, warm white text #F2EFE9.
  Map classes: drivable stone, terrain amber, static white, dynamic coral (no blue, green or purple by design).
