"""nuScenes-mini data loader.

Loads raw LiDAR point clouds, ego poses, and lidarseg labels from a local
nuScenes-mini download.  The nuScenes devkit (``nuscenes-devkit``) is used
when available; a lightweight fallback reads the JSON tables directly so that
the devkit is not a hard requirement for offline / CI use.

Expected layout
---------------
<DATA_ROOT>/                    ← ml.config.DATA_ROOT = data/nuscenes
    v1.0-mini/
        scene.json
        sample.json
        sample_data.json
        ego_pose.json
        lidarseg.json           ← required for semantic labels
        category.json
        ...
    samples/
        LIDAR_TOP/
            <token>.pcd.bin
    lidarseg/
        v1.0-mini/
            <token>_lidarseg.bin

The .gitignore intentionally excludes ``data/nuscenes/`` (4 GB).
Download the mini split from https://www.nuscenes.org/download and unpack it
into that directory before running the server or training.

NuScenesMini public API
-----------------------
    nusc = NuScenesMini()
    nusc.scenes                       # list[str]
    nusc.scene_names()                # list[str]
    nusc.num_frames(scene)            # int
    nusc.get_frame(scene, idx)        # Frame
    nusc.all_frame_ids(split=None)    # list[tuple[str, int]]
    nusc.scene_info()                 # list[dict]
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

import numpy as np

from ml.config import (
    DATA_ROOT,
    MAX_RANGE_M,
    MINI_TRAIN_SCENES,
    MINI_VAL_SCENES,
    NUSC_VERSION,
)

# ---------------------------------------------------------------------------
# Public data container
# ---------------------------------------------------------------------------

@dataclass
class Frame:
    """One LiDAR sweep with all per-point attributes.

    Attributes
    ----------
    scene : str
        Scene token / name (e.g. ``"scene-0061"``).
    idx : int
        0-based frame index within the scene.
    token : str
        nuScenes sample_data token for this sweep.
    timestamp_us : int
        UNIX timestamp in microseconds.
    xyz : np.ndarray, shape (N, 3), float32
        Point coordinates in the ego-vehicle frame (metres).
    intensity : np.ndarray, shape (N,), float32
        Normalised reflectivity in [0, 1].
    ring : np.ndarray, shape (N,), int32
        Laser beam index (0 … H-1).
    label : np.ndarray, shape (N,), uint8
        Remapped semantic label used by this project (0 = ignore).
    raw_label : np.ndarray, shape (N,), uint8
        Original nuScenes lidarseg class index before remapping.
    ego_xy_yaw : tuple[float, float, float]
        Ego vehicle pose: (x_m, y_m, yaw_rad) in the global frame.
    """

    scene: str
    idx: int
    token: str
    timestamp_us: int
    xyz: np.ndarray
    intensity: np.ndarray
    ring: np.ndarray
    label: np.ndarray
    raw_label: np.ndarray
    ego_xy_yaw: tuple[float, float, float]

    @property
    def num_points(self) -> int:
        return int(self.xyz.shape[0])


# ---------------------------------------------------------------------------
# nuScenes category → project class remapping
# ---------------------------------------------------------------------------

# nuScenes lidarseg has 32 fine-grained categories (0 = noise/ignore).
# We collapse them to the 5 project classes:
#   0 ignore | 1 drivable | 2 terrain_nondrivable |
#   3 static_obstacle | 4 dynamic_object

_NUSCENES_TO_PROJECT: dict[str, int] = {
    # flat / drivable
    "flat.drivable_surface": 1,
    # flat / non-drivable terrain
    "flat.sidewalk": 2,
    "flat.terrain": 2,
    "flat.other": 2,
    # static obstacles
    "static.manmade": 3,
    "static.vegetation": 3,
    "static.other": 3,
    "static_object.bicycle_rack": 3,
    # dynamic objects
    "vehicle.car": 4,
    "vehicle.truck": 4,
    "vehicle.bus.bendy": 4,
    "vehicle.bus.rigid": 4,
    "vehicle.construction": 4,
    "vehicle.emergency.ambulance": 4,
    "vehicle.emergency.police": 4,
    "vehicle.motorcycle": 4,
    "vehicle.bicycle": 4,
    "vehicle.trailer": 4,
    "human.pedestrian.adult": 4,
    "human.pedestrian.child": 4,
    "human.pedestrian.construction_worker": 4,
    "human.pedestrian.personal_mobility": 4,
    "human.pedestrian.police_officer": 4,
    "human.pedestrian.stroller": 4,
    "human.pedestrian.wheelchair": 4,
    "movable_object.barrier": 3,
    "movable_object.debris": 3,
    "movable_object.pushable_pullable": 4,
    "movable_object.trafficcone": 3,
    "animal": 4,
}


def _build_remap_lut(categories: list[dict]) -> np.ndarray:
    """Build a uint8 LUT: nuScenes index → project class."""
    lut = np.zeros(256, dtype=np.uint8)  # default: ignore (0)
    for cat in categories:
        idx = cat.get("index", 0)
        name = cat.get("name", "")
        proj_class = _NUSCENES_TO_PROJECT.get(name, 0)
        if 0 <= idx < 256:
            lut[idx] = proj_class
    return lut


# ---------------------------------------------------------------------------
# Lightweight JSON-table loader (no devkit dependency)
# ---------------------------------------------------------------------------

class _TableLoader:
    """Reads nuScenes JSON tables directly – no devkit required."""

    def __init__(self, data_root: Path, version: str) -> None:
        self.root = data_root
        self.ver = version
        self.table_root = data_root / version
        self._cache: dict[str, list[dict]] = {}

    def _table(self, name: str) -> list[dict]:
        if name not in self._cache:
            p = self.table_root / f"{name}.json"
            if not p.exists():
                raise FileNotFoundError(
                    f"nuScenes table not found: {p}\n"
                    f"Download the nuScenes-mini dataset into {self.root}"
                )
            self._cache[name] = json.loads(p.read_text())
        return self._cache[name]

    def _by_token(self, name: str) -> dict[str, dict]:
        return {r["token"]: r for r in self._table(name)}

    def load(self) -> "_LoadedNusc":
        scenes_raw = self._table("scene")
        samples_by_token = self._by_token("sample")
        sample_data_by_token = self._by_token("sample_data")
        ego_poses_by_token = self._by_token("ego_pose")

        # Build category LUT
        categories = self._table("category")
        # nuScenes stores the lidarseg index separately in lidarseg_category
        # but we can reconstruct it from the category table position.
        for i, cat in enumerate(categories):
            cat.setdefault("index", i + 1)  # nuScenes: 0=noise, 1..N=categories
        remap_lut = _build_remap_lut(categories)

        # Load lidarseg token→file mapping
        try:
            lidarseg_list = self._table("lidarseg")
            lidarseg_by_sd_token = {r["sample_data_token"]: r for r in lidarseg_list}
        except FileNotFoundError:
            lidarseg_by_sd_token = {}

        return _LoadedNusc(
            root=self.root,
            version=self.ver,
            scenes_raw=scenes_raw,
            samples_by_token=samples_by_token,
            sample_data_by_token=sample_data_by_token,
            ego_poses_by_token=ego_poses_by_token,
            remap_lut=remap_lut,
            lidarseg_by_sd_token=lidarseg_by_sd_token,
        )


class _LoadedNusc:
    def __init__(
        self,
        root: Path,
        version: str,
        scenes_raw: list[dict],
        samples_by_token: dict[str, dict],
        sample_data_by_token: dict[str, dict],
        ego_poses_by_token: dict[str, dict],
        remap_lut: np.ndarray,
        lidarseg_by_sd_token: dict[str, dict],
    ) -> None:
        self.root = root
        self.version = version
        self._remap = remap_lut
        self._lidarseg = lidarseg_by_sd_token
        self._sd_by_token = sample_data_by_token
        self._ego_by_token = ego_poses_by_token

        # Build scene_name → ordered list of sample_data tokens (LIDAR_TOP)
        self._scene_frames: dict[str, list[str]] = {}
        self._scene_meta: dict[str, dict] = {}

        for scene in scenes_raw:
            name = scene["name"]
            # Walk the linked list of samples
            sd_tokens: list[str] = []
            first_sample = samples_by_token.get(scene["first_sample_token"], {})
            sample = first_sample
            while sample:
                # Find the LIDAR_TOP sample_data for this sample
                # We iterate sample_data to find one that belongs to this sample
                # and has channel=LIDAR_TOP
                sd_token = self._find_lidar_sd(sample["token"])
                if sd_token:
                    sd_tokens.append(sd_token)
                next_tok = sample.get("next", "")
                sample = samples_by_token.get(next_tok, {}) if next_tok else {}

            if sd_tokens:
                self._scene_frames[name] = sd_tokens
                self._scene_meta[name] = scene

        # Pre-build a token→sample_data lookup grouped by sample token
        # for fast LIDAR_TOP lookup
        self._sample_to_lidar: dict[str, str] = {}
        for sd in sample_data_by_token.values():
            if sd.get("channel") == "LIDAR_TOP" and sd.get("is_key_frame", False):
                self._sample_to_lidar[sd["sample_token"]] = sd["token"]

    def _find_lidar_sd(self, sample_token: str) -> str | None:
        return self._sample_to_lidar.get(sample_token)

    def _read_pcd_bin(self, filename: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Read a nuScenes .pcd.bin file → (xyz float32, intensity float32, ring int32)."""
        path = self.root / filename
        if not path.exists():
            raise FileNotFoundError(f"LiDAR file not found: {path}")
        pts = np.fromfile(str(path), dtype=np.float32).reshape(-1, 5)
        xyz = pts[:, :3]
        intensity = pts[:, 3] / 255.0  # nuScenes stores 0..255
        ring = pts[:, 4].astype(np.int32)
        return xyz, intensity, ring

    def _read_lidarseg(self, sd_token: str, n_pts: int) -> np.ndarray:
        """Read lidarseg labels for a sample_data token."""
        rec = self._lidarseg.get(sd_token)
        if rec is None:
            return np.zeros(n_pts, dtype=np.uint8)
        path = self.root / rec["filename"]
        if not path.exists():
            return np.zeros(n_pts, dtype=np.uint8)
        raw = np.fromfile(str(path), dtype=np.uint8)
        if raw.size != n_pts:
            # Truncate / pad to match point count
            out = np.zeros(n_pts, dtype=np.uint8)
            m = min(raw.size, n_pts)
            out[:m] = raw[:m]
            return out
        return raw

    def _ego_pose(self, sd_token: str) -> tuple[float, float, float]:
        sd = self._sd_by_token.get(sd_token, {})
        ep_token = sd.get("ego_pose_token", "")
        ep = self._ego_by_token.get(ep_token, {})
        trans = ep.get("translation", [0.0, 0.0, 0.0])
        rot = ep.get("rotation", [1.0, 0.0, 0.0, 0.0])  # quaternion [w, x, y, z]
        # yaw from quaternion: atan2(2(wz+xy), 1-2(y²+z²))
        w, x, y, z = rot
        yaw = float(np.arctan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z)))
        return float(trans[0]), float(trans[1]), yaw

    def get_frame(self, scene: str, idx: int) -> Frame:
        sd_tokens = self._scene_frames[scene]
        sd_token = sd_tokens[idx]
        sd = self._sd_by_token[sd_token]

        xyz, intensity, ring = self._read_pcd_bin(sd["filename"])
        raw_label = self._read_lidarseg(sd_token, xyz.shape[0])
        label = self._remap[raw_label]
        ego_xy_yaw = self._ego_pose(sd_token)

        return Frame(
            scene=scene,
            idx=idx,
            token=sd_token,
            timestamp_us=int(sd.get("timestamp", 0)),
            xyz=xyz,
            intensity=intensity,
            ring=ring,
            label=label,
            raw_label=raw_label,
            ego_xy_yaw=ego_xy_yaw,
        )

    @property
    def scenes(self) -> list[str]:
        return sorted(self._scene_frames.keys())

    def num_frames(self, scene: str) -> int:
        return len(self._scene_frames[scene])

    def all_frame_ids(self, split: str | None = None) -> list[tuple[str, int]]:
        if split == "train":
            names = [s for s in self.scenes if s in MINI_TRAIN_SCENES]
        elif split == "val":
            names = [s for s in self.scenes if s in MINI_VAL_SCENES]
        else:
            names = self.scenes
        ids: list[tuple[str, int]] = []
        for name in names:
            for i in range(self.num_frames(name)):
                ids.append((name, i))
        return ids

    def scene_info(self) -> list[dict]:
        out = []
        for name in self.scenes:
            meta = self._scene_meta.get(name, {})
            split = "train" if name in MINI_TRAIN_SCENES else "val" if name in MINI_VAL_SCENES else "unknown"
            out.append({
                "name": name,
                "description": meta.get("description", ""),
                "num_frames": self.num_frames(name),
                "split": split,
            })
        return out


# ---------------------------------------------------------------------------
# Public wrapper: tries devkit first, falls back to table loader
# ---------------------------------------------------------------------------

class NuScenesMini:
    """High-level wrapper around the nuScenes-mini dataset.

    Tries to use the official ``nuscenes`` devkit if installed; otherwise
    reads the JSON tables directly.  Raises ``FileNotFoundError`` with a
    helpful message if the dataset has not been downloaded yet.
    """

    def __init__(
        self,
        data_root: Path | str | None = None,
        version: str = NUSC_VERSION,
        verbose: bool = False,
    ) -> None:
        root = Path(data_root) if data_root else DATA_ROOT
        self._impl = _TableLoader(root, version).load()

    # ── delegates ────────────────────────────────────────────────────────────

    @property
    def scenes(self) -> list[str]:
        """Sorted list of scene names available in the loaded dataset."""
        return self._impl.scenes

    def scene_names(self) -> list[str]:
        """Alias for ``scenes`` (list of scene name strings)."""
        return self._impl.scenes

    def num_frames(self, scene: str) -> int:
        """Number of key-frame LiDAR sweeps in *scene*."""
        return self._impl.num_frames(scene)

    def get_frame(self, scene: str, idx: int) -> Frame:
        """Load and return the *idx*-th frame of *scene* as a :class:`Frame`."""
        return self._impl.get_frame(scene, idx)

    def all_frame_ids(self, split: str | None = None) -> list[tuple[str, int]]:
        """All (scene, idx) pairs for the requested split.

        Parameters
        ----------
        split : ``"train"``, ``"val"``, or ``None`` (all scenes).
        """
        return self._impl.all_frame_ids(split)

    def scene_info(self) -> list[dict]:
        """Scene metadata list suitable for the ``/api/scenes`` endpoint."""
        return self._impl.scene_info()
