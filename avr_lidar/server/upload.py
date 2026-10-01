"""Upload endpoint: accepts .bin or .pcd LiDAR point-cloud files and returns
an encoded grid frame via the existing Pipeline.

Supported formats:
  - .bin  : raw float32 (x, y, z, intensity) per point, like nuScenes / KITTI
  - .pcd  : ASCII or binary PCD files (PCL format)
"""

from __future__ import annotations

import struct
import tempfile
from pathlib import Path

import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response

from avr_lidar.grid.varres_grid import VarResGrid
from avr_lidar.pipeline.infer import Pipeline, PipelineOutput
from avr_lidar.server.codec import encode

router = APIRouter()

_grid = VarResGrid()


def _parse_bin(data: bytes) -> tuple[np.ndarray, np.ndarray]:
    """Parse a nuScenes / KITTI-style .bin: N×4 float32 (x, y, z, intensity)."""
    if len(data) < 16:
        raise ValueError("File too small to contain any points")
    remainder = len(data) % 16
    if remainder != 0:
        # Try N×5 (nuScenes has x,y,z,intensity,ring)
        if len(data) % 20 == 0:
            arr = np.frombuffer(data, dtype=np.float32).reshape(-1, 5)
            return arr[:, :3].copy(), arr[:, 3].copy()
        # Try N×3 (xyz only)
        if len(data) % 12 == 0:
            arr = np.frombuffer(data, dtype=np.float32).reshape(-1, 3)
            return arr.copy(), np.zeros(arr.shape[0], dtype=np.float32)
        raise ValueError(f"Binary file size {len(data)} is not a multiple of 12, 16, or 20 bytes (expected N×3, N×4, or N×5 float32)")
    arr = np.frombuffer(data, dtype=np.float32).reshape(-1, 4)
    return arr[:, :3].copy(), arr[:, 3].copy()


def _parse_pcd(data: bytes) -> tuple[np.ndarray, np.ndarray]:
    """Parse an ASCII or binary PCD file (minimal parser)."""
    lines = data.split(b'\n')
    header: dict[str, str] = {}
    data_line_idx = 0
    for idx, line in enumerate(lines):
        stripped = line.strip()
        if stripped.upper() == b'DATA ASCII' or stripped.upper() == b'DATA BINARY':
            header['DATA'] = stripped.split()[-1].decode().upper()
            data_line_idx = idx + 1
            break
        parts = stripped.split(maxsplit=1)
        if len(parts) == 2:
            header[parts[0].decode().upper()] = parts[1].decode()
    
    if 'POINTS' not in header:
        raise ValueError("PCD file missing POINTS header field")
    
    n_points = int(header['POINTS'])
    if n_points == 0:
        raise ValueError("PCD file has 0 points")
    
    # Figure out field layout
    fields = header.get('FIELDS', 'x y z').split()
    try:
        xi, yi, zi = fields.index('x'), fields.index('y'), fields.index('z')
    except ValueError:
        raise ValueError(f"PCD file must have x, y, z fields. Found: {fields}")
    
    ii = fields.index('intensity') if 'intensity' in fields else None
    
    if header.get('DATA') == 'ASCII':
        point_lines = lines[data_line_idx:]
        coords = []
        intensity = []
        for pl in point_lines:
            pl = pl.strip()
            if not pl:
                continue
            vals = pl.split()
            if len(vals) < 3:
                continue
            coords.append([float(vals[xi]), float(vals[yi]), float(vals[zi])])
            intensity.append(float(vals[ii]) if ii is not None and ii < len(vals) else 0.0)
        xyz = np.array(coords, dtype=np.float32)
        inten = np.array(intensity, dtype=np.float32)
    elif header.get('DATA') == 'BINARY':
        # Parse SIZE and TYPE to compute byte stride
        sizes = list(map(int, header.get('SIZE', '4 4 4').split()))
        types = header.get('TYPE', 'F F F').split()
        stride = sum(sizes)
        body = b'\n'.join(lines[data_line_idx:])
        if len(body) < stride * n_points:
            raise ValueError(f"PCD binary body too small: {len(body)} < {stride * n_points}")
        
        xyz = np.zeros((n_points, 3), dtype=np.float32)
        inten = np.zeros(n_points, dtype=np.float32)
        offsets = [0]
        for s in sizes:
            offsets.append(offsets[-1] + s)
        
        for p in range(n_points):
            base = p * stride
            for dim, field_idx in enumerate([xi, yi, zi]):
                off = base + offsets[field_idx]
                sz = sizes[field_idx]
                t = types[field_idx]
                if t == 'F' and sz == 4:
                    xyz[p, dim] = struct.unpack_from('<f', body, off)[0]
                elif t == 'F' and sz == 8:
                    xyz[p, dim] = struct.unpack_from('<d', body, off)[0]
                elif t == 'U' and sz == 4:
                    xyz[p, dim] = struct.unpack_from('<I', body, off)[0]
            if ii is not None:
                off = base + offsets[ii]
                sz = sizes[ii]
                t = types[ii]
                if t == 'F' and sz == 4:
                    inten[p] = struct.unpack_from('<f', body, off)[0]
    else:
        raise ValueError(f"Unsupported PCD data format: {header.get('DATA', 'unknown')}")
    
    return xyz, inten


def parse_point_cloud(filename: str, data: bytes) -> tuple[np.ndarray, np.ndarray]:
    """Parse a point cloud file and return (xyz, intensity)."""
    ext = Path(filename).suffix.lower()
    if ext == '.bin':
        return _parse_bin(data)
    elif ext == '.pcd':
        return _parse_pcd(data)
    else:
        raise ValueError(f"Unsupported file format: {ext}. Use .bin or .pcd")


def process_upload(xyz: np.ndarray, intensity: np.ndarray, pipe: Pipeline) -> bytes:
    """Run the grid projection on raw xyz points (no model — just grid-only)."""
    import time
    from dataclasses import dataclass

    n = xyz.shape[0]
    
    # Without a model we just assign all points to class 3 (static_obstacle)
    # since we don't have ring / range-image data for proper segmentation.
    # If the pipeline has a model loaded, we try to run it with synthetic range data.
    labels = np.full(n, 3, dtype=np.uint8)  # default: static obstacle
    
    t_start = time.perf_counter()
    grid_frame = _grid.project(xyz, labels)
    t_proj = (time.perf_counter() - t_start) * 1000
    
    # Build a minimal Frame-like object for the codec
    class _FakeFrame:
        scene = "user-upload"
        idx = 0
        timestamp_us = 0
        ego_xy_yaw = (0.0, 0.0, 0.0)
        xyz_data = xyz
        label = labels
    
    out = PipelineOutput(
        frame=_FakeFrame(),  # type: ignore
        pred_label=labels,
        grid=grid_frame,
        latency_ms={"inference": 0.0, "range_proj": 0.0, "unproject": 0.0, "projection": t_proj, "total": t_proj},
    )
    return encode(out, compress=False)


_pipe_ref: Pipeline | None = None


def set_pipe(p: Pipeline) -> None:
    """Called from app.py to share the pipeline instance."""
    global _pipe_ref
    _pipe_ref = p


@router.post("/api/upload")
async def upload_point_cloud(file: UploadFile = File(...)):
    """Upload a LiDAR point cloud (.bin or .pcd) and get back a grid frame."""
    if not file.filename:
        raise HTTPException(400, "No filename provided")
    
    ext = Path(file.filename).suffix.lower()
    if ext not in ('.bin', '.pcd'):
        raise HTTPException(
            400,
            f"Unsupported file format '{ext}'. Please upload a .bin (nuScenes/KITTI) or .pcd file."
        )
    
    data = await file.read()
    if len(data) == 0:
        raise HTTPException(400, "Empty file")
    if len(data) > 200 * 1024 * 1024:  # 200 MB limit
        raise HTTPException(413, "File too large (max 200 MB)")
    
    try:
        xyz, intensity = parse_point_cloud(file.filename, data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    
    if xyz.shape[0] < 10:
        raise HTTPException(400, f"Point cloud has only {xyz.shape[0]} points — too few to process")
    
    try:
        buf = process_upload(xyz, intensity, _pipe_ref)  # type: ignore
    except Exception as e:
        raise HTTPException(500, f"Processing error: {e}")
    
    return Response(
        content=buf,
        media_type="application/x-msgpack",
        headers={"X-Content-Compression": "none", "X-Points-Count": str(xyz.shape[0])},
    )
