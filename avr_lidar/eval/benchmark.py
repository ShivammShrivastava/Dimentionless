"""Full benchmark over nuScenes-mini -> results/metrics.json.

Accuracy metrics are computed on the val split (the model never saw it);
latency and memory metrics over every frame.

Usage: python -m avr_lidar.eval.benchmark [--split val|all]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from avr_lidar.config import CLASS_NAMES, METRICS_PATH, RESULTS_DIR  # noqa: E402
from avr_lidar.data.nuscenes_loader import NuScenesMini  # noqa: E402
from avr_lidar.eval.metrics import SegmentationMeter  # noqa: E402
from avr_lidar.grid.varres_grid import VarResGrid  # noqa: E402
from avr_lidar.pipeline.infer import Pipeline  # noqa: E402
from avr_lidar.server.codec import encode  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="val", choices=["val", "train", "all"])
    ap.add_argument("--out", type=Path, default=METRICS_PATH)
    args = ap.parse_args()

    nusc = NuScenesMini()
    grid = VarResGrid()
    pipe = Pipeline(grid=grid)
    ids = nusc.all_frame_ids(None if args.split == "all" else args.split)
    print(f"benchmarking {len(ids)} frames ({args.split}) on {pipe.device}; checkpoint epoch {pipe.checkpoint_info['epoch']}")

    meter = SegmentationMeter()
    cell_meter = SegmentationMeter()  # accuracy of the majority-vote CELL labels vs GT-projected cells
    lat = {k: [] for k in ["range_proj", "inference", "unproject", "projection", "encode", "total"]}
    mem, occ, npts, dropped = [], [], [], []
    obstacle_retained = []  # fraction of GT obstacle cells (<=10 m) preserved by the model's grid

    for k, (scene, idx) in enumerate(ids):
        f = nusc.get_frame(scene, idx)
        out = pipe.run(f)
        t0 = time.perf_counter()
        buf = encode(out)
        enc = (time.perf_counter() - t0) * 1000
        for key in ["range_proj", "inference", "unproject", "projection"]:
            lat[key].append(out.latency_ms[key])
        lat["encode"].append(enc)
        lat["total"].append(out.latency_ms["total"] + enc)

        meter.update(out.pred_label, f.label, f.xyz[:, :2])
        gt_grid = grid.project(f.xyz, f.label)
        for r_pred, r_gt in zip(out.grid.rings, gt_grid.rings):
            m = r_gt.count > 0
            cell_meter.update(r_pred.label[m], r_gt.label[m])
        g0, p0 = gt_grid.rings[0], out.grid.rings[0]
        obs = (g0.label == 3) | (g0.label == 4)
        if obs.any():
            obstacle_retained.append(float(((p0.label == 3) | (p0.label == 4))[obs].mean()))

        mem.append(out.grid.storage_bytes())
        occ.append(out.grid.occupied_cells())
        npts.append(f.num_points)
        dropped.append(out.grid.points_dropped)
        if (k + 1) % 20 == 0:
            print(f"  {k+1}/{len(ids)}  running mIoU {meter.miou():.3f}  median total {np.median(lat['total']):.1f} ms")

    def stats(v):
        a = np.asarray(v)
        return {"mean": round(float(a.mean()), 3), "p50": round(float(np.median(a)), 3), "p95": round(float(np.percentile(a, 95)), 3)}

    seg = meter.summary()
    total_p50 = np.median(lat["total"])
    metrics = {
        "split": args.split,
        "num_frames": len(ids),
        "checkpoint_epoch": pipe.checkpoint_info["epoch"],
        "device": str(pipe.device),
        "fps": {
            "total": round(1000.0 / total_p50, 1),
            "inference": round(1000.0 / np.median(lat["inference"]), 1),
            "projection": round(1000.0 / np.median(lat["projection"]), 1),
            "encode": round(1000.0 / np.median(lat["encode"]), 1),
        },
        "latency_ms": {**{k: stats(v) for k, v in lat.items()}, "p50": round(float(total_p50), 2),
                       "p95": round(float(np.percentile(lat["total"], 95)), 2)},
        "miou": seg["miou"],
        "point_accuracy": seg["accuracy"],
        "iou_per_class": seg["iou_per_class"],
        "accuracy_by_distance": seg["accuracy_by_distance"],
        "accuracy_by_distance_per_class": seg["accuracy_by_distance_per_class"],
        "points_by_distance": seg["points_by_distance"],
        "cell_label_accuracy": cell_meter.accuracy(),
        "cell_iou_per_class": cell_meter.summary()["iou_per_class"],
        "obstacle_cells_retained_within_10m": round(float(np.mean(obstacle_retained)), 4) if obstacle_retained else None,
        "memory": {
            "varres_bytes": int(np.mean(mem)),
            "uniform_2d_5cm_bytes": grid.uniform_2d_bytes(),
            "uniform_3d_5cm_bytes": grid.uniform_3d_bytes(),
            "reduction_2d": round(grid.uniform_2d_bytes() / np.mean(mem), 1),
            "reduction_3d": round(grid.uniform_3d_bytes() / np.mean(mem), 1),
            "wire_bytes_msgpack": len(buf),
        },
        "cells": {"varres": grid.total_cells(), "uniform_2d_5cm": grid.uniform_2d_cells(),
                  "occupied_mean": int(np.mean(occ))},
        "points": {"mean_per_frame": int(np.mean(npts)), "dropped_beyond_100m_mean": round(float(np.mean(dropped)), 2)},
        "rings": grid.spec(),
        "class_names": CLASS_NAMES,
        "confusion": seg["confusion"],
    }
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(metrics, indent=1))
    print(json.dumps({k: metrics[k] for k in ["fps", "miou", "iou_per_class", "accuracy_by_distance", "memory"]}, indent=1))
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
