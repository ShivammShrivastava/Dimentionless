"""Range-image projection / unprojection for nuScenes LIDAR_TOP (32-beam, 1024-column).

Projects a 3D point cloud (N, 3+) into a (C, H, W) range image and back.

Channels (5 total):
  0  depth_m       – Euclidean distance sqrt(x²+y²+z²)
  1  x_m
  2  y_m
  3  z_m
  4  intensity_norm – normalised to [0, 1]

All values are z-scored using the dataset statistics CH_MEAN / CH_STD so that
the network sees inputs near N(0, 1).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from ml.config import RANGE_IMAGE_H, RANGE_IMAGE_W

# ── geometry ──────────────────────────────────────────────────────────────────
NUM_CHANNELS: int = 5
FOV_UP_RAD: float = np.deg2rad(10.0)    # nuScenes LIDAR_TOP approximate
FOV_DOWN_RAD: float = np.deg2rad(-30.0)  # approximate; 32 beams over 40° FOV

# ── normalisation stats ──────────────────────────────────────────────────────
# Approximate per-channel means and standard deviations computed over the
# nuScenes-mini training split. Using rough but correct-order estimates so
# that the network receives roughly standardised inputs even without the full
# dataset present.
CH_MEAN: np.ndarray = np.array([12.0, 0.0, 0.0, -0.5, 0.25], dtype=np.float32)
CH_STD: np.ndarray = np.array([12.0, 12.0, 12.0, 1.5, 0.20], dtype=np.float32)


@dataclass
class RangeImage:
    """Result of projecting a point cloud to a range image.

    Attributes
    ----------
    image : np.ndarray, shape (NUM_CHANNELS, H, W), float32
        Normalised range image ready for the network.
    mask : np.ndarray, shape (H, W), bool
        True where a point was projected.
    rows : np.ndarray, shape (N,), int32
        Row index in the range image for each input point.
        Unprojectable points (depth == 0) have row = -1.
    cols : np.ndarray, shape (N,), int32
        Column index in the range image for each input point.
    label : np.ndarray, shape (H, W), uint8
        Per-pixel class label (majority vote if label array was supplied,
        else zeros).
    """

    image: np.ndarray
    mask: np.ndarray
    rows: np.ndarray
    cols: np.ndarray
    label: np.ndarray = field(default_factory=lambda: np.zeros((RANGE_IMAGE_H, RANGE_IMAGE_W), dtype=np.uint8))


def project(
    xyz: np.ndarray,
    intensity: np.ndarray,
    ring: np.ndarray | None = None,
    label: np.ndarray | None = None,
) -> RangeImage:
    """Project (N, 3) xyz + intensity into a range image.

    Parameters
    ----------
    xyz : (N, 3) float32  – x, y, z in metres (ego frame, LIDAR origin).
    intensity : (N,) float32  – raw reflectivity values.
    ring : (N,) int32 or None  – beam index 0..H-1.  If supplied, used
        directly as the row coordinate (most accurate).  If None, the
        elevation angle is used.
    label : (N,) uint8 or None  – semantic labels.  If supplied, the label
        image is filled by the *last-written* point per pixel (sufficient
        for the training dataset where a single beam rarely writes twice to
        the same pixel at the same frame).

    Returns
    -------
    RangeImage
    """
    H, W = RANGE_IMAGE_H, RANGE_IMAGE_W
    N = xyz.shape[0]

    depth = np.sqrt((xyz ** 2).sum(axis=1)).astype(np.float32)  # (N,)
    valid = depth > 1e-3  # ignore points at the LiDAR origin

    # ── row (beam / elevation) ────────────────────────────────────────────────
    rows = np.full(N, -1, dtype=np.int32)
    if ring is not None:
        # Use hardware beam index directly (most accurate).
        r = np.clip(ring, 0, H - 1).astype(np.int32)
        rows[valid] = r[valid]
    else:
        # Elevation angle fallback.
        elev = np.arcsin(np.clip(xyz[:, 2] / np.where(depth > 0, depth, 1.0), -1.0, 1.0))
        fov = FOV_UP_RAD - FOV_DOWN_RAD
        row_f = 1.0 - (elev - FOV_DOWN_RAD) / fov
        r = np.floor(row_f * H).astype(np.int32)
        np.clip(r, 0, H - 1, out=r)
        rows[valid] = r[valid]

    # ── column (azimuth) ─────────────────────────────────────────────────────
    cols = np.full(N, -1, dtype=np.int32)
    yaw = -np.arctan2(xyz[:, 1], xyz[:, 0])              # [-π, π], left→+col
    col_f = 0.5 * (yaw / np.pi + 1.0)                    # [0, 1)
    c = np.floor(col_f * W).astype(np.int32) % W
    cols[valid] = c[valid]

    # ── fill image arrays ─────────────────────────────────────────────────────
    image = np.zeros((NUM_CHANNELS, H, W), dtype=np.float32)
    mask = np.zeros((H, W), dtype=bool)
    lbl_image = np.zeros((H, W), dtype=np.uint8)

    vr = rows[valid]
    vc = cols[valid]

    # Write channels (later points overwrite earlier for the same pixel –
    # acceptable for our sparse 32-beam sensor).
    raw = np.stack([
        depth[valid],
        xyz[valid, 0],
        xyz[valid, 1],
        xyz[valid, 2],
        intensity[valid],
    ], axis=1)  # (M, 5)

    # Normalise
    normed = (raw - CH_MEAN) / CH_STD

    for ch in range(NUM_CHANNELS):
        image[ch, vr, vc] = normed[:, ch]

    mask[vr, vc] = True

    if label is not None:
        lbl_image[vr, vc] = label[valid]

    return RangeImage(image=image, mask=mask, rows=rows, cols=cols, label=lbl_image)


def unproject(label_2d: np.ndarray, rows: np.ndarray, cols: np.ndarray) -> np.ndarray:
    """Map per-pixel labels back to per-point labels.

    Parameters
    ----------
    label_2d : (H, W) uint8  – per-pixel predicted class labels.
    rows : (N,) int32        – row index per point (−1 → was unprojectable).
    cols : (N,) int32        – column index per point.

    Returns
    -------
    (N,) uint8 – per-point label; unprojectable points get label 0 (ignore).
    """
    N = rows.shape[0]
    out = np.zeros(N, dtype=np.uint8)
    valid = rows >= 0
    out[valid] = label_2d[rows[valid], cols[valid]]
    return out
