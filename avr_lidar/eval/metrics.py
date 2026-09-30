"""Segmentation metrics: confusion matrix, per-class IoU, accuracy by distance."""

from __future__ import annotations

import numpy as np

from avr_lidar.config import CLASS_NAMES, DISTANCE_BINS, IGNORE_INDEX, NUM_CLASSES


class SegmentationMeter:
    def __init__(self):
        self.conf = np.zeros((NUM_CLASSES, NUM_CLASSES), dtype=np.int64)
        self.dist_correct = np.zeros(len(DISTANCE_BINS), dtype=np.int64)
        self.dist_total = np.zeros(len(DISTANCE_BINS), dtype=np.int64)
        # per-class accuracy by distance for the dashboard
        self.dist_class_correct = np.zeros((len(DISTANCE_BINS), NUM_CLASSES), dtype=np.int64)
        self.dist_class_total = np.zeros((len(DISTANCE_BINS), NUM_CLASSES), dtype=np.int64)

    def update(self, pred: np.ndarray, gt: np.ndarray, xy: np.ndarray | None = None) -> None:
        valid = gt != IGNORE_INDEX
        p, g = pred[valid].astype(np.int64), gt[valid].astype(np.int64)
        self.conf += np.bincount(g * NUM_CLASSES + p, minlength=NUM_CLASSES**2).reshape(NUM_CLASSES, NUM_CLASSES)
        if xy is not None:
            d = np.linalg.norm(xy[valid], axis=1)
            correct = p == g
            for b, (lo, hi) in enumerate(DISTANCE_BINS):
                m = (d >= lo) & (d < hi)
                self.dist_total[b] += int(m.sum())
                self.dist_correct[b] += int((correct & m).sum())
                self.dist_class_total[b] += np.bincount(g[m], minlength=NUM_CLASSES)
                self.dist_class_correct[b] += np.bincount(g[m & correct], minlength=NUM_CLASSES)

    def iou(self) -> np.ndarray:
        tp = np.diag(self.conf).astype(np.float64)
        fp = self.conf.sum(0) - tp
        fn = self.conf.sum(1) - tp
        denom = tp + fp + fn
        with np.errstate(invalid="ignore", divide="ignore"):
            iou = np.where(denom > 0, tp / denom, np.nan)
        return iou

    def miou(self) -> float:
        iou = self.iou()
        valid = [c for c in range(NUM_CLASSES) if c != IGNORE_INDEX]
        return float(np.nanmean(iou[valid]))

    def accuracy(self) -> float:
        return float(np.diag(self.conf).sum() / max(1, self.conf.sum()))

    def summary(self) -> dict:
        iou = self.iou()
        with np.errstate(invalid="ignore", divide="ignore"):
            acc_d = np.where(self.dist_total > 0, self.dist_correct / self.dist_total, np.nan)
            acc_dc = np.where(self.dist_class_total > 0, self.dist_class_correct / self.dist_class_total, np.nan)
        bins = [f"{lo}-{hi}" for lo, hi in DISTANCE_BINS]
        return {
            "miou": round(self.miou(), 4),
            "accuracy": round(self.accuracy(), 4),
            "iou_per_class": {CLASS_NAMES[c]: _r(iou[c]) for c in range(NUM_CLASSES) if c != IGNORE_INDEX},
            "accuracy_by_distance": {b: _r(acc_d[k]) for k, b in enumerate(bins)},
            "accuracy_by_distance_per_class": {
                b: {CLASS_NAMES[c]: _r(acc_dc[k, c]) for c in range(NUM_CLASSES) if c != IGNORE_INDEX}
                for k, b in enumerate(bins)
            },
            "points_by_distance": {b: int(self.dist_total[k]) for k, b in enumerate(bins)},
            "confusion": self.conf.tolist(),
        }


def _r(v: float) -> float | None:
    return None if np.isnan(v) else round(float(v), 4)
