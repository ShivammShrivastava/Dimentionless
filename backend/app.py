"""FastAPI backend: REST + WebSocket streaming of 2.5D grid frames.

Run:  python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000
Env:  AVR_USE_GT=1 to serve ground-truth labels instead of model predictions.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # backend → root

from ml.config import CHECKPOINT_PATH, CLASS_COLORS_HEX, CLASS_NAMES, METRICS_PATH  # noqa: E402
from ml.data.nuscenes_loader import NuScenesMini  # noqa: E402
from pipeline.infer import Pipeline  # noqa: E402
from backend.codec import encode, encode_points  # noqa: E402
from backend.upload import router as upload_router, set_pipe as upload_set_pipe  # noqa: E402

app = FastAPI(title="Adaptive Variable-Resolution 2.5D Lidar Mapping", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(upload_router)

_nusc: NuScenesMini | None = None
_pipe: Pipeline | None = None
_lock = asyncio.Lock()  # one GPU, serialise inference


def nusc() -> NuScenesMini:
    global _nusc
    if _nusc is None:
        _nusc = NuScenesMini()
    return _nusc


def pipe() -> Pipeline:
    global _pipe
    if _pipe is None:
        use_gt = os.environ.get("AVR_USE_GT", "0") == "1" or not CHECKPOINT_PATH.exists()
        _pipe = Pipeline(use_gt=use_gt)
        upload_set_pipe(_pipe)
    return _pipe


@lru_cache(maxsize=512)
def _frame_bytes(scene: str, idx: int, compress: bool = False) -> bytes:
    out = pipe().run(nusc().get_frame(scene, idx))
    return encode(out, compress=compress)


def _check(scene: str, idx: int) -> None:
    n = nusc()
    if scene not in n.scenes:
        raise HTTPException(404, f"unknown scene {scene}")
    if not 0 <= idx < n.num_frames(scene):
        raise HTTPException(404, f"frame {idx} out of range for {scene}")


# ---------------------------------------------------------------------- REST
@app.get("/api/health")
def health():
    p = pipe()
    return {
        "ok": True,
        "mode": "gt" if p.use_gt else "model",
        "device": str(p.device),
        "encoding": "sparse msgpack (occupied cells only); pass compress=true for zlib",
        "rings": p.grid.spec(),
    }


@app.get("/api/scenes")
def scenes():
    return {"scenes": nusc().scene_info()}


@app.get("/api/classes")
def classes():
    return {"names": CLASS_NAMES, "colors": CLASS_COLORS_HEX}


@app.get("/api/scenes/{scene}/frames/{idx}")
async def frame(scene: str, idx: int, compress: bool = False):
    _check(scene, idx)
    async with _lock:
        buf = await asyncio.to_thread(_frame_bytes, scene, idx, compress)
    return Response(
        content=buf,
        media_type="application/x-msgpack",
        headers={"X-Content-Compression": "zlib" if compress else "none"},
    )


@app.get("/api/scenes/{scene}/frames/{idx}/points")
async def points(scene: str, idx: int, max: int = Query(20000, ge=100, le=200000)):
    _check(scene, idx)
    f = nusc().get_frame(scene, idx)
    p = pipe()
    async with _lock:
        labels = f.label if p.use_gt else (await asyncio.to_thread(p.segment, f))[0]
    return Response(content=encode_points(f.xyz, labels, max), media_type="application/x-msgpack")


@app.get("/api/metrics")
def metrics():
    if not METRICS_PATH.exists():
        raise HTTPException(404, "metrics.json not found; run python -m ml.eval.benchmark")
    return JSONResponse(json.loads(METRICS_PATH.read_text()))


# ----------------------------------------------------------------- WebSocket
@app.websocket("/ws/stream")
async def stream(ws: WebSocket, scene: str = "scene-0061", fps: float = 10.0, compress: bool = False):
    await ws.accept()
    n = nusc()
    if scene not in n.scenes:
        await ws.close(code=4004, reason=f"unknown scene {scene}")
        return
    state = {"scene": scene, "idx": 0, "playing": True, "fps": max(0.5, min(fps, 30.0))}

    async def reader():
        try:
            while True:
                msg = json.loads(await ws.receive_text())
                cmd = msg.get("cmd")
                if cmd == "play":
                    state["playing"] = True
                elif cmd == "pause":
                    state["playing"] = False
                elif cmd == "seek":
                    state["idx"] = int(msg.get("idx", 0)) % n.num_frames(state["scene"])
                    state["force"] = True
                elif cmd == "fps":
                    state["fps"] = max(0.5, min(float(msg.get("value", 10)), 30.0))
                elif cmd == "scene" and msg.get("name") in n.scenes:
                    state["scene"], state["idx"], state["force"] = msg["name"], 0, True
        except (WebSocketDisconnect, RuntimeError):
            state["closed"] = True

    reader_task = asyncio.create_task(reader())
    try:
        loop = asyncio.get_running_loop()
        while not state.get("closed"):
            t0 = loop.time()
            if state["playing"] or state.pop("force", False):
                async with _lock:
                    buf = await asyncio.to_thread(_frame_bytes, state["scene"], state["idx"], compress)
                await ws.send_bytes(buf)
                if state["playing"]:
                    state["idx"] = (state["idx"] + 1) % n.num_frames(state["scene"])
            # pace to the requested fps, accounting for compute time
            await asyncio.sleep(max(0.005, 1.0 / state["fps"] - (loop.time() - t0)))
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        reader_task.cancel()
