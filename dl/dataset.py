"""Range-image dataset with an in-memory cache and range-view augmentations.

All 404 frames as 5x32x1024 float32 images = ~265 MB, so we cache them in RAM
after the first pass. Augmentations operate directly on the image:
  * random yaw rotation  == circular roll along width (and rotate x,y channels)
  * random left/right flip == reverse width and negate y channel
  * random pixel dropout
"""

from __future__ import annotations

import numpy as np
import torch
from torch.utils.data import Dataset

from ml.config import NUM_CLASSES
from ml.data.nuscenes_loader import NuScenesMini
from ml.data.range_projection import CH_MEAN, CH_STD, project

_X, _Y = 1, 2  # channel indices of x and y in the range image


class RangeViewDataset(Dataset):
    def __init__(self, nusc: NuScenesMini, split: str, augment: bool, seed: int = 0):
        self.nusc = nusc
        self.ids = nusc.all_frame_ids(split)
        self.augment = augment
        self.rng = np.random.default_rng(seed)
        self._cache: dict[int, tuple[np.ndarray, np.ndarray, np.ndarray]] = {}

    def __len__(self) -> int:
        return len(self.ids)

    def _load(self, k: int):
        if k not in self._cache:
            scene, idx = self.ids[k]
            f = self.nusc.get_frame(scene, idx)
            ri = project(f.xyz, f.intensity, f.ring, f.label)
            self._cache[k] = (ri.image, ri.mask, ri.label)
        return self._cache[k]

    def class_pixel_counts(self) -> torch.Tensor:
        counts = np.zeros(NUM_CLASSES, dtype=np.int64)
        for k in range(len(self)):
            _, mask, lab = self._load(k)
            counts += np.bincount(lab[mask], minlength=NUM_CLASSES)
        return torch.from_numpy(counts)

    def __getitem__(self, k: int):
        img, mask, lab = self._load(k)
        img = img.copy()
        mask = mask.copy()
        lab = lab.copy()

        if self.augment:
            W = img.shape[-1]
            # yaw rotation: roll columns; rotate the (x, y) channels by the same angle
            shift = int(self.rng.integers(0, W))
            if shift:
                theta = -2.0 * np.pi * shift / W
                img = np.roll(img, shift, axis=-1)
                mask = np.roll(mask, shift, axis=-1)
                lab = np.roll(lab, shift, axis=-1)
                x = img[_X] * CH_STD[_X] + CH_MEAN[_X]
                y = img[_Y] * CH_STD[_Y] + CH_MEAN[_Y]
                xr = np.cos(theta) * x - np.sin(theta) * y
                yr = np.sin(theta) * x + np.cos(theta) * y
                img[_X] = (xr - CH_MEAN[_X]) / CH_STD[_X]
                img[_Y] = (yr - CH_MEAN[_Y]) / CH_STD[_Y]
            if self.rng.random() < 0.5:
                img = img[:, :, ::-1].copy()
                mask = mask[:, ::-1].copy()
                lab = lab[:, ::-1].copy()
                y = img[_Y] * CH_STD[_Y] + CH_MEAN[_Y]
                img[_Y] = (-y - CH_MEAN[_Y]) / CH_STD[_Y]
            if self.rng.random() < 0.5:
                drop = self.rng.random(mask.shape) < 0.05
                mask &= ~drop
            img[:, ~mask] = 0.0

        return (
            torch.from_numpy(np.ascontiguousarray(img)),
            torch.from_numpy(lab.astype(np.int64)),
            torch.from_numpy(mask),
        )
