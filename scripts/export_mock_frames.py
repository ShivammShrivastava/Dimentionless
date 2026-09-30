"""Export frames + metadata for offline frontend development (FRONTEND_PROMPT.md section 4).

Writes:
  <out>/scenes.json
  <out>/classes.json
  <out>/metrics.json           (copied if results/metrics.json exists, else a placeholder)
  <out>/frames/<scene>/<idx>.msgpack

Usage: python scripts/export_mock_frames.py --scenes scene-0061 scene-0103 --stride 4 --gt
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from avr_lidar.config import CHECKPOINT_PATH, CLASS_COLORS_HEX, CLASS_NAMES, METRICS_PATH, PROJECT_ROOT  # noqa: E402
from avr_lidar.data.nuscenes_loader import NuScenesMini  # noqa: E402
from avr_lidar.pipeline.infer import Pipeline  # noqa: E402
from avr_lidar.server.codec import encode  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=PROJECT_ROOT / "mock_frames")
    ap.add_argument("--scenes", nargs="*", default=["scene-0061", "scene-0103"])
    ap.add_argument("--stride", type=int, default=1)
    ap.add_argument("--gt", action="store_true", help="use ground-truth labels instead of the model")
    args = ap.parse_args()

    nusc = NuScenesMini()
    pipe = Pipeline(use_gt=args.gt or not CHECKPOINT_PATH.exists())
    args.out.mkdir(parents=True, exist_ok=True)

    info = [s for s in nusc.scene_info() if s["name"] in args.scenes]
    for s in info:
        s["exported_indices"] = list(range(0, s["num_frames"], args.stride))
    (args.out / "scenes.json").write_text(json.dumps({"scenes": info}, indent=1))
    (args.out / "classes.json").write_text(json.dumps({"names": CLASS_NAMES, "colors": CLASS_COLORS_HEX}, indent=1))
    if METRICS_PATH.exists():
        shutil.copy(METRICS_PATH, args.out / "metrics.json")
    (args.out / "health.json").write_text(json.dumps({"mode": "gt" if pipe.use_gt else "model", "rings": pipe.grid.spec()}, indent=1))

    total = 0
    for s in info:
        d = args.out / "frames" / s["name"]
        d.mkdir(parents=True, exist_ok=True)
        for idx in s["exported_indices"]:
            buf = encode(pipe.run(nusc.get_frame(s["name"], idx)))
            (d / f"{idx}.msgpack").write_bytes(buf)
            total += len(buf)
        print(f"{s['name']}: {len(s['exported_indices'])} frames")
    print(f"wrote {args.out}  ({total/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
