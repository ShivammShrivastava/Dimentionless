# Project Overview

## What the project is and who it is for

Adaptive Variable-Resolution 2.5D Lidar Mapping turns raw nuScenes Lidar sweeps into a foveated 2.5D map. Cells are 5 cm within 10 m of the sensor and grow to 50 cm at 100 m. Each cell holds elevation, a semantic class (drivable, non-drivable terrain, static obstacle, dynamic object) and a confidence value. The README presents it as a deep-learning pipeline plus a dashboard. The apparent audience is autonomous-driving and perception engineers, and reviewers who want to see the results. The exact target users are not determined.

## Tech stack

Backend: Python 3.11+ (developed on 3.13), PyTorch, NumPy, SciPy, FastAPI, Uvicorn, WebSockets, msgpack. The model is a 4.6M-parameter range-view U-Net ("SalsaNext-lite"). Data comes from nuScenes-mini and its lidarseg labels, read directly from the metadata JSON without the devkit.

Frontend: Vite, React 18, TypeScript, framer-motion, three.js, msgpackr and pako. Tests use vitest on the frontend and pytest on the backend.

## Implemented features

- Range-image projection, semantic segmentation, and a variable-resolution ring grid (`VarResGrid`).
- Training with weighted cross-entropy plus Lovasz loss, and a benchmark script that writes `results/metrics.json`.
- REST endpoints and a WebSocket stream, with an optional ground-truth mode.
- A single-page dashboard with these sections: Hero, Foveation explainer, Pipeline, Live map, Evidence charts.
- The live map has a top-down canvas, 3D elevation columns, and a uniform-versus-adaptive comparison.
- Playback controls: play, pause, seek, step, FPS and scene selection.
- Demo mode that reads exported frames from `frontend/public/mock` when the backend is unreachable. It re-probes every 15 seconds and upgrades to live.

## How the backend works

The backend is a FastAPI app in `avr_lidar/server/app.py`, with CORS open to all origins. A Pipeline runs inference for a frame, and the codec encodes the result. Encoded frames are cached (LRU, 512 entries), and a lock serialises GPU inference. The pipeline uses ground-truth labels if `AVR_USE_GT=1` or if no checkpoint exists.

Endpoints:
- `GET /api/health`: mode (gt or model), device, encoding and ring specification.
- `GET /api/scenes`: scene list.
- `GET /api/classes`: class names and colours.
- `GET /api/scenes/{scene}/frames/{idx}`: one frame as msgpack, with optional zlib compression.
- `GET /api/scenes/{scene}/frames/{idx}/points`: a subsampled labelled point cloud.
- `GET /api/metrics`: contents of `metrics.json`.
- `WS /ws/stream`: streams frames. The client sends play, pause, seek, fps and scene commands.

The database is a file-based nuScenes-mini dataset, not a database server. No authentication was found in the backend code.

## How the backend feeds data to the frontend

`frontend/src/lib/api.ts` mirrors these endpoints. At startup, `initApp` in `store/app.ts` calls `/api/health` and then `/api/scenes` and `/api/metrics`. If health fails, it uses the `/mock/*.json` files instead.

The Player in `lib/player.ts` opens `/ws/stream` and decodes each binary message into a frame. A frame holds the ego pose, sparse per-ring arrays (occupied cell indices, label, min and max height, confidence, point count) and stats such as latency and memory. The store densifies the frame in the browser. TopDown, HeightMap3D, Rail and LiveMap read the frame from the store and draw it on canvas or three.js. Pipeline, Foveation, Hero and Evidence read the metrics (latency, mIoU, memory reduction, per-distance accuracy). Nav shows the mode, WebSocket status and device.

`fetchPoints` is defined, but no call site was found. `/api/classes` is not called by the frontend code that was checked.

## How it helps its users

Users can see a scene's map, its class labels and its height data, with the resolution concentrated near the vehicle. They can compare the adaptive grid against a uniform grid at equal memory. The README reports about 30x less memory than a uniform 5 cm 2D grid and about 450x less than 3D voxels. It also reports mIoU 0.747 and about 24 FPS (41 ms median latency) on mini_val. The dashboard shows these figures alongside live frames.

## Slide-Ready Summary

- nuScenes Lidar frames go through range projection and a U-Net that labels each point.
- Labelled points are binned into a foveated ring grid, 5 cm near the sensor and 50 cm at 100 m.
- FastAPI serves each frame as sparse msgpack, sending only occupied cells (about 245 KB per frame, per the Pipeline section text).
- The WebSocket `/ws/stream` pushes frames continuously, and the browser sends play, pause, seek, fps and scene commands.
- REST endpoints supply health, scenes and metrics once at startup.
- The frontend decodes and densifies frames, then renders top-down, 3D and comparison views.
- If the backend is down, the dashboard replays exported frames and switches to live when the backend returns.
