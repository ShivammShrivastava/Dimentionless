# Adaptive Variable-Resolution 2.5D Lidar Mapping — Implementation Plan

## 0. What you have (verified on this machine)

| Item | Status |
|---|---|
| `C:\Users\Suryansh\Downloads\v1.0-mini.tar` | 3.97 GB — nuScenes v1.0-mini: 10 scenes, 404 annotated keyframes, LIDAR_TOP sweeps, ego poses, calibration, 3D boxes |
| `C:\Users\Suryansh\Downloads\nuScenes-lidarseg-mini-v1.0.tar` | 1.7 MB — per-point semantic labels (`lidarseg/v1.0-mini/*.bin`, one `uint8` label per point) for the same 404 keyframes, 32 classes |
| GPU | RTX 5060 Laptop, 8 GB VRAM |
| Python | 3.13 (torch, numpy, fastapi, uvicorn already installed) |
| Missing | `nuscenes-devkit`, `pyquaternion`, `open3d`. `spconv` has no reliable Python 3.13 wheels |

**Key decision:** do not depend on `spconv` / sparse 3D convolutions. Use a **range-view 2D segmentation network** (SalsaNext-style U-Net, pure PyTorch). It trains in ~20 min on this GPU, runs at 100+ FPS, and satisfies the "deep learning segmentation" requirement. PointNet++ is mentioned as an optional comparison, not the main path.

---

## 1. Target architecture

```
nuScenes keyframe ──► Loader ──► Range-view U-Net ──► per-point class (4)
   (.pcd.bin +          │                                     │
    lidarseg .bin)      │  xyz, intensity                     ▼
                        └──────────────────────────► Variable-Res Grid Engine
                                                          │  (4 rings, 5cm→50cm)
                                                          ▼
                                   2.5D map: height layers + semantic layer + confidence
                                                          │
                                       FastAPI + WebSocket (binary frames + metrics)
                                                          │
                                                          ▼
                                       Dashboard (built on the other device)
```

### 1.1 Semantic classes (map nuScenes 32 → 4 + ignore)

| Output id | Name | nuScenes lidarseg ids |
|---|---|---|
| 0 | `ignore` | 0 noise, 31 vehicle.ego |
| 1 | `drivable` | 24 flat.driveable_surface |
| 2 | `terrain_nondrivable` | 25 flat.other, 26 flat.sidewalk, 27 flat.terrain |
| 3 | `static_obstacle` | 9 barrier, 10 debris, 11 pushable_pullable, 12 trafficcone, 13 bicycle_rack, 28 manmade, 29 static.other, 30 vegetation |
| 4 | `dynamic_object` | 1 animal, 2–8 human.pedestrian.*, 14 bicycle, 15–23 all vehicle.* except ego |

This directly covers the three required tasks: terrain analysis (1 vs 2), static obstacles (3), dynamic objects (4).

### 1.2 Variable-resolution grid ("foveated" rings)

Use **square annular rings** keyed on Chebyshev distance `d = max(|x|, |y|)`, not Euclidean distance. Square rings tile perfectly with square cells, so no cell ever straddles a ring boundary. This is the answer to "no alignment errors or data loss".

| Ring | Range (m) | Cell size | Cells per side | Cells (annulus) |
|---|---|---|---|---|
| 0 | 0 – 10 | 5 cm | 400 | 160,000 |
| 1 | 10 – 20 | 10 cm | 400 | 120,000 |
| 2 | 20 – 40 | 20 cm | 400 | 120,000 |
| 3 | 40 – 100 | 50 cm | 400 | 134,400 |
| **Total** | | | | **~534k** |

Uniform 5 cm grid over the same 200 m × 200 m area = 16,000,000 cells → **~30× fewer cells**. With 3D voxels (5 cm, 6 m height range) the uniform equivalent is 1.9 billion voxels, so the reduction against a "uniform high-res 3D map" is 3–4 orders of magnitude. Report both numbers on the dashboard.

Alignment invariants (enforce with asserts):
- Every ring boundary (10, 20, 40, 100 m) is an integer multiple of every cell size.
- Every ring is stored as a full `400×400` dense tensor; the inner hole is simply masked. Same shape for all rings → trivially batchable on GPU.
- `cell_index(x, y) -> (ring, i, j)` is a pure function; `cell_center(ring, i, j) -> (x, y)` is its inverse. Unit-test round-trip.

Per-cell layers (all rings, dtype chosen for memory):
- `z_max`, `z_min`, `z_mean` — `float16` (or `int16` in cm)
- `count` — `uint16`
- `class_hist[5]` — `uint16`, majority vote → `label` (`uint8`)
- `confidence` — `uint8` (majority fraction × 255)
- `slope` (derived from `z_max` neighbors) — optional, enables curb/pothole detection

Projection is fully vectorized: compute flat index per point, then `np.maximum.at` / `torch.scatter_reduce_(reduce="amax")` for heights and `np.bincount` for class histograms. No Python loops over points.

### 1.3 Model: range-view U-Net (SalsaNext-lite)

- Input: spherical projection of one sweep to `32 × 1024` range image (nuScenes lidar has 32 beams; use the `ring` channel from the `.pcd.bin` for the row index to avoid beam-quantization holes). 5 channels: range, x, y, z, intensity.
- Network: 4-level encoder/decoder with residual dilated blocks, ~6M params. Output 5 logits per pixel.
- Loss: weighted cross-entropy + Lovász-softmax (handles the heavy class imbalance: drivable dominates).
- Un-projection: each 3D point takes the label of its range-image pixel; points that collided into the same pixel get a KNN post-process (k=5, in range-image space) to clean edges.
- Training: 8 `mini_train` scenes (~323 frames), validation on 2 `mini_val` scenes (~81 frames). Augment with random yaw rotation, flip, point dropout. AMP, batch 8, AdamW 1e-3, cosine schedule, 60 epochs ≈ 20–30 min on the 5060.
- Expected: mIoU 0.70–0.80 over the 4 classes on mini_val (drivable > 0.95, dynamic ~0.7, static ~0.8, non-drivable terrain ~0.6).

Optional comparison baseline (only if time allows): PointNet++ SSG on 16k subsampled points. Slower, worse — good for a "why we chose range-view" slide.

---

## 2. Repository layout

```
Lidar/
├─ data/
│  └─ nuscenes/                 # extracted: maps/, samples/, sweeps/, v1.0-mini/, lidarseg/
├─ avr_lidar/                   # python package
│  ├─ config.py                 # ring spec, class map, paths
│  ├─ data/
│  │  ├─ nuscenes_loader.py     # sample → (xyz, intensity, ring, labels, ego_pose)
│  │  ├─ class_map.py           # 32 → 5 lut
│  │  └─ range_projection.py    # points ↔ 32×1024 image
│  ├─ grid/
│  │  ├─ varres_grid.py         # VarResGrid: index, project, layers, to_uniform()
│  │  └─ temporal.py            # ego-motion shift + decay (stretch goal)
│  ├─ model/
│  │  ├─ salsanext_lite.py
│  │  ├─ losses.py              # weighted CE + Lovász
│  │  └─ train.py / infer.py
│  ├─ eval/
│  │  ├─ metrics.py             # IoU, accuracy by distance bin, latency, memory
│  │  └─ benchmark.py           # produces results/metrics.json
│  └─ server/
│     ├─ app.py                 # FastAPI: REST + WebSocket
│     └─ codec.py               # binary frame packing
├─ scripts/
│  ├─ extract_data.ps1
│  ├─ verify_frame.py
│  └─ export_mock_frames.py     # dumps 10 frames as JSON for the frontend dev
├─ tests/
│  └─ test_grid.py              # round-trip index, no point loss, boundary cases
├─ results/
├─ frontend/                    # built on the other device, dropped in here
└─ requirements.txt
```

---

## 3. Phased plan

### Phase 0 — Environment & data (½ day)

1. Create a **Python 3.11 venv** (safest for `nuscenes-devkit`, `open3d`; Python 3.13 works for torch but several geometry libs lag). If you stay on 3.13, skip `open3d` and use matplotlib for debug plots.
2. Install: `torch` (CUDA 12.x build), `numpy`, `nuscenes-devkit`, `pyquaternion`, `scipy`, `fastapi`, `uvicorn[standard]`, `websockets`, `msgpack`, `tqdm`, `pytest`.
3. Extract both tars into `data/nuscenes/` so the tree is:
   ```
   data/nuscenes/maps/
   data/nuscenes/samples/LIDAR_TOP/*.pcd.bin
   data/nuscenes/sweeps/
   data/nuscenes/v1.0-mini/*.json      (from v1.0-mini.tar, plus lidarseg.json + category.json from the lidarseg tar — they overwrite/merge into the same folder)
   data/nuscenes/lidarseg/v1.0-mini/*_lidarseg.bin
   ```
   Extract the lidarseg tar **second**; it adds `lidarseg.json` and an updated `category.json` into `v1.0-mini/`.
4. Verify: `NuScenes(version='v1.0-mini', dataroot='data/nuscenes')` loads, `nusc.lidarseg` has 404 entries, one frame renders with labels.

Exit criterion: `scripts/verify_frame.py` prints point count, label histogram, and saves a top-down PNG colored by the 4 classes.

### Phase 1 — Loader + class mapping (½ day)

- `.pcd.bin` is `float32 × 5` per point: `x, y, z, intensity, ring`. Lidarseg `.bin` is `uint8` per point, same order and count.
- Build the 32→5 lookup table from Section 1.1; apply with `lut[labels]`.
- Transform points from sensor frame to ego frame using `calibrated_sensor` (rotation + translation). Keep ego frame for the grid (sensor at origin, x forward).
- Expose `iter_scene(scene_name) -> Frame(xyz, intensity, ring, gt_label, ego_pose, timestamp)`.

### Phase 2 — Variable-resolution grid engine (1 day) — **do this before the model**

Build and demo the grid with **ground-truth labels first**. This de-risks the project: you have a working end-to-end 2.5D map on day 2, and the model just swaps in later.

- `VarResGrid(spec)` with `spec = [(10, .05), (20, .10), (40, .20), (100, .50)]`.
- `project(xyz, labels) -> GridFrame` (vectorized scatter as in 1.2).
- `to_uniform(cell_size)` — resamples all rings to one uniform grid (nearest) for visual comparison and for computing the memory baseline.
- `memory_bytes()` — real byte count of stored layers; `uniform_equivalent_bytes(cell=0.05, height_bins=120)` — for the 3D-voxel comparison.
- Tests: (a) every point lands in exactly one cell, (b) round-trip index ↔ center, (c) boundary points at exactly 10.0 m go to ring 1 (use `d >= bound`), (d) points beyond 100 m are counted as dropped, not silently lost.
- Throughput target: 35k points projected in < 3 ms on CPU (numpy), < 1 ms on GPU (torch).

### Phase 3 — Segmentation model (1.5 days)

1. Range projection + un-projection, with a unit test that un-project(project(p)) returns labels for 100% of points.
2. SalsaNext-lite, loss, training loop with AMP and checkpointing. Log mIoU per epoch on mini_val.
3. Class weights = inverse log frequency from the training set.
4. Export best checkpoint to `results/salsanext_lite.pt`; also `torch.jit.trace` or `torch.compile` for inference speed. Measure inference at batch 1 in FP16: target < 8 ms.
5. Report per-class IoU **and** accuracy binned by distance: 0–10, 10–20, 20–40, 40–100 m (this is the "accuracy across varying distances" metric the brief asks for).

### Phase 4 — Integration, benchmark, server (1 day)

- `infer.py`: frame → model → labels → `VarResGrid.project` → `GridFrame`. Time every stage with `torch.cuda.synchronize()` guards.
- `benchmark.py` runs all 404 frames and writes `results/metrics.json`:
  ```json
  {
    "fps": {"total": ..., "inference": ..., "projection": ..., "encode": ...},
    "latency_ms": {"p50": ..., "p95": ...},
    "miou": ..., "iou_per_class": {...},
    "accuracy_by_distance": {"0-10": ..., "10-20": ..., "20-40": ..., "40-100": ...},
    "memory": {"varres_bytes": ..., "uniform_2d_5cm_bytes": ..., "uniform_3d_5cm_bytes": ..., "reduction_2d": ..., "reduction_3d": ...},
    "cells": {"varres": 534400, "uniform_2d_5cm": 16000000}
  }
  ```
- FastAPI server (`server/app.py`):
  - `GET /api/scenes` → list of scenes with frame counts
  - `GET /api/scenes/{scene}/frames/{idx}` → one `GridFrame` (binary msgpack)
  - `GET /api/metrics` → `metrics.json`
  - `WS /ws/stream?scene=...&fps=10` → pushes frames continuously; client sends `{"cmd":"pause"|"play"|"seek","idx":n}`
  - `GET /api/frames/{scene}/{idx}/points?max=20000` → raw labeled points (for the optional 3D point overlay)
  - CORS enabled for the frontend origin.
- Frame wire format (msgpack, one message per frame) — this is the contract the frontend is built against, see `FRONTEND_PROMPT.md` Section 3.

### Phase 5 — Frontend (other device, parallel with Phase 3–4)

Use `FRONTEND_PROMPT.md`. Run `scripts/export_mock_frames.py` early (after Phase 2, using GT labels) and send the resulting `mock_frames/` folder to the other device so the frontend can be built against real data shapes without the backend running.

### Phase 6 — Evaluation & write-up (½ day)

- Ablation table: uniform 5 cm vs 10 cm vs variable-res — memory, projection time, and "information retained" (fraction of GT obstacle cells within 10 m preserved).
- Latency table per stage, FPS.
- Per-class IoU and accuracy-by-distance plot (you should see accuracy drop with distance — this justifies coarser cells far away).
- Qualitative figures: 3 frames, GT vs prediction vs 2.5D map.

Total: ~5 working days for one person; Phases 3 and 5 run in parallel if two people.

---

## 4. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Only 404 labeled frames → overfitting | Heavy augmentation, small model, early-stop on mini_val, report honestly. Optionally pre-train on unlabeled `sweeps/` with a self-supervised range-completion task (stretch). |
| Dynamic-object IoU low at range (few points on far pedestrians) | This is expected and is itself a finding; show it in the distance-binned plot. Coarser far cells naturally aggregate sparse hits. |
| 8 GB VRAM | Range image 32×1024 at batch 8 with AMP uses ~3 GB. Fine. |
| Euclidean rings cause partial cells | Fixed by design: Chebyshev (square) rings. State this explicitly in the report. |
| Python 3.13 library gaps | Use a 3.11 venv for the training/serving side. |
| WebSocket payload too large | 534k cells × (uint8 label + int16 height + uint8 conf) ≈ 2.1 MB/frame raw; zlib compresses ~10× because most far cells are empty. At 10 FPS that is fine on localhost/LAN. Send only changed rings if needed. |

---

## 5. Stretch goals (only after Phases 0–6 are solid)

- **Temporal fusion**: shift the grid by ego motion each frame (`ego_pose` deltas), decay `count` for dynamic cells, accumulate static cells → persistent local map.
- **Adaptive ring boundaries**: shrink ring 0 when speed is low (parking) and stretch it at highway speed. Trivial with the ring-spec abstraction.
- **Instance boxes**: use nuScenes 3D boxes to draw dynamic objects as oriented rectangles on the map.
- **ONNX / TensorRT export** for a higher FPS headline number.

---

## 6. Commands to start (PowerShell, from `Lidar/`)

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install torch --index-url https://download.pytorch.org/whl/cu124
pip install numpy scipy nuscenes-devkit pyquaternion fastapi "uvicorn[standard]" websockets msgpack tqdm pytest matplotlib
New-Item -ItemType Directory -Force data\nuscenes
tar -xf "C:\Users\Suryansh\Downloads\v1.0-mini.tar" -C data\nuscenes
tar -xf "C:\Users\Suryansh\Downloads\nuScenes-lidarseg-mini-v1.0.tar" -C data\nuscenes
python -c "from nuscenes.nuscenes import NuScenes; n=NuScenes('v1.0-mini','data/nuscenes',verbose=True); print(len(n.lidarseg))"
```

Expected last line: `404`.

---

## 7. Status (2026-09-30) — Phases 0–4 and 6 done, Phase 5 (frontend) pending

Everything below was run on this machine (RTX 5060 Laptop 8 GB, Python 3.13, torch 2.12 cu128).

| Phase | Status | Evidence |
|---|---|---|
| 0 Environment & data | done | both tars extracted to `data/nuscenes/`; `nuscenes-devkit` deliberately **not** used (it downgrades numpy to 1.26 which has no Python 3.13 wheel) — `avr_lidar/data/nuscenes_loader.py` reads the JSON directly |
| 1 Loader + class map | done | 404 frames, 323 train / 81 val, `scripts/verify_frame.py` |
| 2 Grid engine | done | `avr_lidar/grid/varres_grid.py`, 10 unit tests in `tests/test_grid.py`, ~11 ms/frame CPU projection |
| 3 Model | done | SalsaNext-lite 4.57 M params, 60 epochs in ~12 min, best val mIoU **0.751** (epoch 59) → `results/salsanext_lite.pt` |
| 4 Integration + server | done | `avr_lidar/pipeline/infer.py`, `avr_lidar/server/app.py` (REST + WS verified live), sparse msgpack codec with 5 tests |
| 5 Frontend | **pending** (other device) | use `FRONTEND_PROMPT.md`; offline data exported to `mock_frames/` (40 frames, 8 MB) |
| 6 Evaluation | done | `results/metrics.json`, `results/fig_*.png` |

### Results on mini_val (81 frames, never seen in training)

| Metric | Value |
|---|---|
| mIoU (4 classes, points) | 0.747 |
| IoU drivable / non-drivable terrain / static / dynamic | 0.857 / 0.526 / 0.872 / 0.730 |
| Cell-label accuracy (majority vote vs GT-projected cells) | 0.872 |
| Obstacle cells within 10 m retained by the predicted map | 91 % |
| Latency p50 / p95 (full pipeline incl. encode) | 41 ms / 47 ms → **24 FPS** |
| Stage medians: range-proj / inference / unproject / grid-proj / encode | 7.9 / 18.9 / 0.4 / 11.3 / 2.2 ms |
| Map storage per frame (var-res) | 4.28 MB |
| Uniform 5 cm 2D grid / uniform 5 cm 3D voxels | 128 MB (**29.9×**) / 1.92 GB (**449×**) |
| Wire size per frame (sparse msgpack, ~18k occupied cells) | ~245 KB (65 KB with zlib) |

Accuracy by distance, per class (this is the plot that justifies the foveation):

| band (cell size) | drivable | non-drivable | static | dynamic |
|---|---|---|---|---|
| 0–10 m (5 cm) | 0.92 | 0.81 | 0.80 | **0.95** |
| 10–20 m (10 cm) | 0.88 | 0.59 | 0.90 | 0.86 |
| 20–40 m (20 cm) | 0.70 | 0.58 | 0.95 | 0.68 |
| 40–100 m (50 cm) | 0.05 | 0.05 | 0.98 | 0.48 |

Beyond 40 m the sweep contains almost only building/vegetation returns, so fine cells there would store nothing the model can label reliably anyway. The overall accuracy in the 40–100 m band (0.92) is high only because of that class mix — quote the per-class numbers, not the aggregate.

### Deviations from the original plan
- **Sparse wire format** instead of dense arrays: dense msgpack was 5 MB/frame and zlib on it cost 67 ms (9 FPS). Sending only occupied cells is ~245 KB and 2 ms. `FRONTEND_PROMPT.md` §3.0/3.3 were updated; the frontend densifies on receipt.
- **CPU-side range projection and grid projection** (~19 ms together) are now the largest cost after inference. A torch/GPU scatter path would roughly double FPS; listed under stretch goals.
- The nuScenes lidar frame origin was moved to the sensor's (x, y) so "distance from sensor" is literal.

### How to reproduce
```powershell
python -m pytest tests -q                        # 15 tests
python -m avr_lidar.model.train --epochs 60      # ~12 min
python -m avr_lidar.eval.benchmark --split val   # results/metrics.json
python scripts\make_figures.py                   # results/fig_*.png
python scripts\export_mock_frames.py --scenes scene-0061 scene-0103 --stride 2
python -m uvicorn avr_lidar.server.app:app --host 0.0.0.0 --port 8000
```
