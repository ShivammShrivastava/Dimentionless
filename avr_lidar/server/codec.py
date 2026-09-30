"""Binary wire format for GridFrame (msgpack, SPARSE). Matches FRONTEND_PROMPT.md section 3.3.

Only occupied cells are transmitted: per ring a flat cell index array plus one
value array per layer, all little-endian raw bytes inside msgpack `bin`.
~15k occupied cells of 534k -> ~200 KB per frame, encoded in ~2 ms.
Optional zlib (compress=True) is kept for slow links; off by default.
"""

from __future__ import annotations

import time
import zlib

import msgpack
import numpy as np

from avr_lidar.grid.varres_grid import GridFrame, RingLayer
from avr_lidar.pipeline.infer import PipelineOutput


def _le(a: np.ndarray) -> bytes:
    a = np.ascontiguousarray(a)
    if a.dtype.byteorder == ">":
        a = a.byteswap().view(a.dtype.newbyteorder("<"))
    return a.tobytes()


def _ring_sparse(r: RingLayer) -> dict:
    occ = r.count.ravel() > 0
    idx = np.flatnonzero(occ).astype(np.uint32)
    return {
        "ring": r.ring,
        "size": r.size,
        "cell_m": r.cell_m,
        "inner_hole": r.inner_hole,
        "n": int(idx.size),
        "idx": _le(idx),
        "label": _le(r.label.ravel()[idx]),
        "z_max_cm": _le(r.z_max_cm.ravel()[idx]),
        "z_min_cm": _le(r.z_min_cm.ravel()[idx]),
        "confidence": _le(r.confidence.ravel()[idx]),
        "count": _le(r.count.ravel()[idx]),
    }


def grid_frame_to_dict(out: PipelineOutput) -> dict:
    f, g = out.frame, out.grid
    lat = out.latency_ms
    return {
        "scene": f.scene,
        "idx": f.idx,
        "timestamp_us": f.timestamp_us,
        "ego_pose": {"x": f.ego_xy_yaw[0], "y": f.ego_xy_yaw[1], "yaw": f.ego_xy_yaw[2]},
        "rings": [_ring_sparse(r) for r in g.rings],
        "stats": {
            "num_points": g.num_points,
            "points_dropped_beyond_range": g.points_dropped,
            "latency_ms": {
                "inference": round(lat.get("inference", 0.0) + lat.get("range_proj", 0.0) + lat.get("unproject", 0.0), 3),
                "projection": round(lat.get("projection", 0.0), 3),
                "encode": 0.0,
                "total": round(lat.get("total", 0.0), 3),
            },
            "memory_bytes": g.storage_bytes(),
            "occupied_cells": g.occupied_cells(),
            "class_counts": g.class_cell_counts.tolist(),
            "compressed": False,
        },
    }


def encode(out: PipelineOutput, compress: bool = False) -> bytes:
    t0 = time.perf_counter()
    d = grid_frame_to_dict(out)
    enc_ms = (time.perf_counter() - t0) * 1000
    # the sparse gather dominates; packing is ~0.2 ms, so report gather time + one pack estimate
    d["stats"]["latency_ms"]["encode"] = round(enc_ms, 3)
    d["stats"]["latency_ms"]["total"] = round(d["stats"]["latency_ms"]["total"] + enc_ms, 3)
    d["stats"]["compressed"] = compress
    payload = msgpack.packb(d, use_bin_type=True)
    return zlib.compress(payload, level=1) if compress else payload


def encode_points(xyz: np.ndarray, label: np.ndarray, max_points: int, seed: int = 0) -> bytes:
    n = xyz.shape[0]
    if n > max_points:
        idx = np.random.default_rng(seed).choice(n, max_points, replace=False)
        xyz, label = xyz[idx], label[idx]
    return msgpack.packb(
        {"n": int(xyz.shape[0]), "xyz": _le(xyz.astype(np.float32)), "label": _le(label.astype(np.uint8))},
        use_bin_type=True,
    )


def decode(buf: bytes, densify: bool = True) -> dict:
    """Reference decoder (tests, mock exporter). Auto-detects zlib (0x78 header).

    With densify=True each ring gets full (S, S) arrays rebuilt from the sparse data,
    exactly as the frontend should do it.
    """
    if len(buf) > 2 and buf[0] == 0x78:
        buf = zlib.decompress(buf)
    d = msgpack.unpackb(buf, raw=False)
    for r in d["rings"]:
        n = r["n"]
        idx = np.frombuffer(r["idx"], dtype="<u4")
        assert idx.size == n
        sparse = {
            "label": np.frombuffer(r["label"], dtype=np.uint8),
            "z_max_cm": np.frombuffer(r["z_max_cm"], dtype="<i2"),
            "z_min_cm": np.frombuffer(r["z_min_cm"], dtype="<i2"),
            "confidence": np.frombuffer(r["confidence"], dtype=np.uint8),
            "count": np.frombuffer(r["count"], dtype="<u2"),
        }
        r["idx"] = idx
        if densify:
            S = r["size"]
            fill = {"label": 0, "z_max_cm": -32768, "z_min_cm": -32768, "confidence": 0, "count": 0}
            for k, v in sparse.items():
                dense = np.full(S * S, fill[k], dtype=v.dtype)
                dense[idx] = v
                r[k] = dense.reshape(S, S)
        else:
            r.update(sparse)
    return d
