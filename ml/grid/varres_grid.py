"""Variable-resolution 2.5D grid engine.

The map is a set of square annular rings keyed on Chebyshev distance
d = max(|x|, |y|). Ring r covers d in [inner_r, outer_r) with square cells
of side s_r. Because ring boundaries are integer multiples of every cell
size and the rings are square, every 3D point maps to exactly one cell and
no cell straddles a boundary (no alignment error, no data loss).

Every ring is stored as a dense S x S tensor (S = 2*outer_r/s_r, identical
for all rings by construction) with the inner hole masked, which keeps the
structure trivially batchable on GPU.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from ml.config import (
    DEFAULT_RINGS,
    NUM_CLASSES,
    UNIFORM_BASELINE_CELL_M,
    UNIFORM_BASELINE_HEIGHT_M,
)

EMPTY_CM = np.int16(-32768)
_EPS = 1e-9


@dataclass
class RingLayer:
    ring: int
    size: int
    cell_m: float
    inner_hole: int  # cells per side of the masked centre (0 for ring 0)
    label: np.ndarray  # (S, S) uint8
    z_max_cm: np.ndarray  # (S, S) int16, EMPTY_CM where empty
    z_min_cm: np.ndarray  # (S, S) int16
    confidence: np.ndarray  # (S, S) uint8
    count: np.ndarray  # (S, S) uint16

    @property
    def half_extent_m(self) -> float:
        return self.size * self.cell_m / 2.0

    def annulus_mask(self) -> np.ndarray:
        m = np.ones((self.size, self.size), dtype=bool)
        if self.inner_hole > 0:
            a = (self.size - self.inner_hole) // 2
            b = a + self.inner_hole
            m[a:b, a:b] = False
        return m

    def annulus_cells(self) -> int:
        return self.size * self.size - self.inner_hole * self.inner_hole

    def occupied(self) -> np.ndarray:
        return self.count > 0

    def storage_bytes(self) -> int:
        """Bytes needed for the annulus cells only (hole is not stored conceptually)."""
        per_cell = (
            self.label.dtype.itemsize
            + self.z_max_cm.dtype.itemsize
            + self.z_min_cm.dtype.itemsize
            + self.confidence.dtype.itemsize
            + self.count.dtype.itemsize
        )
        return per_cell * self.annulus_cells()


@dataclass
class GridFrame:
    rings: list[RingLayer]
    num_points: int
    points_dropped: int
    class_cell_counts: np.ndarray = field(default_factory=lambda: np.zeros(NUM_CLASSES, dtype=np.int64))

    def storage_bytes(self) -> int:
        return sum(r.storage_bytes() for r in self.rings)

    def occupied_cells(self) -> int:
        return int(sum(r.occupied().sum() for r in self.rings))

    def total_cells(self) -> int:
        return sum(r.annulus_cells() for r in self.rings)


class VarResGrid:
    def __init__(self, rings: list[tuple[float, float]] | None = None):
        spec = rings or DEFAULT_RINGS
        self.outer = np.array([o for o, _ in spec], dtype=np.float64)
        self.cell = np.array([c for _, c in spec], dtype=np.float64)
        self.inner = np.concatenate([[0.0], self.outer[:-1]])
        self.n_rings = len(spec)
        self._validate()
        self.size = int(round(2 * self.outer[0] / self.cell[0]))
        self.inner_hole = np.rint(2 * self.inner / self.cell).astype(int)
        self.max_range = float(self.outer[-1])

    # ------------------------------------------------------------ geometry
    def _validate(self) -> None:
        assert np.all(np.diff(self.outer) > 0), "ring boundaries must increase"
        sizes = 2 * self.outer / self.cell
        assert np.allclose(sizes, np.rint(sizes)), "2*outer must be an integer multiple of cell size"
        assert np.allclose(sizes, sizes[0]), "all rings must have the same dense size (2*outer/cell)"
        holes = 2 * self.inner / self.cell
        assert np.allclose(holes, np.rint(holes)), "inner boundary must align to this ring's cell size"

    def ring_of(self, xy: np.ndarray) -> np.ndarray:
        """Chebyshev distance -> ring index; == n_rings means out of range."""
        d = np.max(np.abs(xy), axis=1)
        return np.searchsorted(self.outer, d, side="right")

    def world_to_cell(self, xy: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """(N,2) -> (ring, i, j). ring == n_rings for dropped points (i, j = -1)."""
        ring = self.ring_of(xy)
        valid = ring < self.n_rings
        i = np.full(xy.shape[0], -1, dtype=np.int64)
        j = np.full(xy.shape[0], -1, dtype=np.int64)
        r = ring[valid]
        s = self.cell[r]
        half = self.outer[r]
        i[valid] = np.floor((xy[valid, 0] + half) / s + _EPS).astype(np.int64)
        j[valid] = np.floor((xy[valid, 1] + half) / s + _EPS).astype(np.int64)
        np.clip(i, 0, self.size - 1, out=i)
        np.clip(j, 0, self.size - 1, out=j)
        return ring, i, j

    def cell_center(self, ring: np.ndarray, i: np.ndarray, j: np.ndarray) -> np.ndarray:
        s = self.cell[ring]
        half = self.outer[ring]
        x = -half + (i + 0.5) * s
        y = -half + (j + 0.5) * s
        return np.stack([x, y], axis=1)

    # ---------------------------------------------------------- projection
    def project(self, xyz: np.ndarray, label: np.ndarray) -> GridFrame:
        """Vectorised scatter of classified points into the ring stack."""
        n = xyz.shape[0]
        ring, i, j = self.world_to_cell(xyz[:, :2])
        z_cm = np.clip(np.rint(xyz[:, 2] * 100.0), -32767, 32767).astype(np.int32)
        S = self.size
        layers: list[RingLayer] = []
        class_cells = np.zeros(NUM_CLASSES, dtype=np.int64)

        for r in range(self.n_rings):
            m = ring == r
            flat = (i[m] * S + j[m]).astype(np.int64)
            zc = z_cm[m]
            lab = label[m].astype(np.int64)

            cell_label = np.zeros(S * S, dtype=np.uint8)
            conf = np.zeros(S * S, dtype=np.uint8)
            count = np.zeros(S * S, dtype=np.uint16)
            z_max16 = np.full(S * S, EMPTY_CM, dtype=np.int16)
            z_min16 = np.full(S * S, EMPTY_CM, dtype=np.int16)

            if flat.size:
                # Sort points by cell; reduce over contiguous runs (much faster than ufunc.at).
                order = np.argsort(flat, kind="stable")
                fs, zs, ls = flat[order], zc[order], lab[order]
                starts = np.flatnonzero(np.r_[True, fs[1:] != fs[:-1]])
                uniq = fs[starts]
                run_len = np.diff(np.r_[starts, fs.size])

                count[uniq] = np.minimum(run_len, 65535).astype(np.uint16)
                z_max16[uniq] = np.maximum.reduceat(zs, starts).astype(np.int16)
                z_min16[uniq] = np.minimum.reduceat(zs, starts).astype(np.int16)

                # Class histogram only over occupied cells (K x NUM_CLASSES, K = #occupied).
                cell_pos = np.repeat(np.arange(uniq.size), run_len)
                hist = np.bincount(cell_pos * NUM_CLASSES + ls, minlength=uniq.size * NUM_CLASSES)
                hist = hist.reshape(uniq.size, NUM_CLASSES)
                # Majority vote ignoring class 0 unless it is the only class present.
                hist[:, 0] = 0
                nonignore = hist.sum(axis=1)
                voted = hist.argmax(axis=1)
                has = nonignore > 0
                voted[~has] = 0
                cell_label[uniq] = voted.astype(np.uint8)
                c = np.zeros(uniq.size, dtype=np.uint8)
                c[has] = np.rint(255.0 * hist[has, voted[has]] / nonignore[has]).astype(np.uint8)
                conf[uniq] = c

            empty = count == 0

            layer = RingLayer(
                ring=r,
                size=S,
                cell_m=float(self.cell[r]),
                inner_hole=int(self.inner_hole[r]),
                label=cell_label.reshape(S, S),
                z_max_cm=z_max16.reshape(S, S),
                z_min_cm=z_min16.reshape(S, S),
                confidence=conf.reshape(S, S),
                count=count.reshape(S, S),
            )
            layers.append(layer)
            class_cells += np.bincount(cell_label[~empty], minlength=NUM_CLASSES)

        dropped = int((ring >= self.n_rings).sum())
        return GridFrame(rings=layers, num_points=n, points_dropped=dropped, class_cell_counts=class_cells)

    # ------------------------------------------------------------ utilities
    def to_uniform(self, frame: GridFrame, cell_m: float) -> tuple[np.ndarray, np.ndarray]:
        """Resample the ring stack to a single uniform grid over [-R, R]^2 (nearest lookup).

        Returns (label uint8 (U,U), z_max_cm int16 (U,U)).
        """
        R = self.max_range
        U = int(round(2 * R / cell_m))
        c = -R + (np.arange(U) + 0.5) * cell_m
        gx, gy = np.meshgrid(c, c, indexing="ij")
        xy = np.stack([gx.ravel(), gy.ravel()], axis=1)
        ring, i, j = self.world_to_cell(xy)
        lab = np.zeros(xy.shape[0], dtype=np.uint8)
        zm = np.full(xy.shape[0], EMPTY_CM, dtype=np.int16)
        for r, layer in enumerate(frame.rings):
            m = ring == r
            lab[m] = layer.label[i[m], j[m]]
            zm[m] = layer.z_max_cm[i[m], j[m]]
        return lab.reshape(U, U), zm.reshape(U, U)

    def uniform_2d_cells(self, cell_m: float = UNIFORM_BASELINE_CELL_M) -> int:
        U = int(round(2 * self.max_range / cell_m))
        return U * U

    def uniform_2d_bytes(self, cell_m: float = UNIFORM_BASELINE_CELL_M, bytes_per_cell: int = 8) -> int:
        return self.uniform_2d_cells(cell_m) * bytes_per_cell

    def uniform_3d_bytes(
        self,
        cell_m: float = UNIFORM_BASELINE_CELL_M,
        height_m: float = UNIFORM_BASELINE_HEIGHT_M,
        bytes_per_voxel: int = 1,
    ) -> int:
        U = int(round(2 * self.max_range / cell_m))
        Hn = int(round(height_m / cell_m))
        return U * U * Hn * bytes_per_voxel

    def total_cells(self) -> int:
        return int(sum(self.size * self.size - h * h for h in self.inner_hole))

    def spec(self) -> list[dict]:
        return [
            {
                "ring": r,
                "inner_m": float(self.inner[r]),
                "outer_m": float(self.outer[r]),
                "cell_m": float(self.cell[r]),
                "size": self.size,
                "inner_hole": int(self.inner_hole[r]),
                "cells": int(self.size * self.size - self.inner_hole[r] ** 2),
            }
            for r in range(self.n_rings)
        ]
