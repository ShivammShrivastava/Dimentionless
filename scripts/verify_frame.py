"""Phase 0/1 exit check: load one frame, print stats, project to the grid, save a PNG."""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ml.config import CLASS_COLORS_HEX, CLASS_NAMES, RESULTS_DIR  # noqa: E402
from ml.data.nuscenes_loader import NuScenesMini  # noqa: E402
from ml.data.range_projection import project as range_project, unproject  # noqa: E402
from ml.grid.varres_grid import VarResGrid  # noqa: E402


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[k : k + 2], 16) for k in (0, 2, 4))  # type: ignore[return-value]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scene", default="scene-0061")
    ap.add_argument("--idx", type=int, default=0)
    args = ap.parse_args()

    t0 = time.perf_counter()
    nusc = NuScenesMini()
    print(f"metadata loaded in {time.perf_counter() - t0:.2f}s; scenes={len(nusc.scene_names())}, "
          f"frames={len(nusc.all_frame_ids())}, train={len(nusc.all_frame_ids('train'))}, val={len(nusc.all_frame_ids('val'))}")

    f = nusc.get_frame(args.scene, args.idx)
    print(f"frame {f.scene}[{f.idx}] token={f.token} points={f.num_points}")
    print(f"  xy extent |x|<={np.abs(f.xyz[:,0]).max():.1f} |y|<={np.abs(f.xyz[:,1]).max():.1f} "
          f"z in [{f.xyz[:,2].min():.2f}, {f.xyz[:,2].max():.2f}]")
    hist = np.bincount(f.label, minlength=len(CLASS_NAMES))
    for cid, n in enumerate(hist):
        print(f"  {cid} {CLASS_NAMES[cid]:<20} {n:>7} ({100*n/f.num_points:5.1f}%)")

    # range image round trip
    ri = range_project(f.xyz, f.intensity, f.ring, f.label)
    back = unproject(ri.label, ri.rows, ri.cols)
    agree = (back == f.label).mean()
    print(f"range image occupancy {ri.mask.mean()*100:.1f}%  unproject label agreement {agree*100:.2f}% "
          f"(loss is from pixel collisions only)")

    # grid projection
    grid = VarResGrid()
    t1 = time.perf_counter()
    gf = grid.project(f.xyz, f.label)
    dt = (time.perf_counter() - t1) * 1000
    print(f"grid projection {dt:.1f} ms; occupied cells {gf.occupied_cells()} / {gf.total_cells()}; dropped {gf.points_dropped}")
    print(f"  storage {gf.storage_bytes()/1e6:.2f} MB vs uniform 2D 5cm {grid.uniform_2d_bytes()/1e6:.0f} MB "
          f"(x{grid.uniform_2d_bytes()/gf.storage_bytes():.1f}) vs uniform 3D 5cm {grid.uniform_3d_bytes()/1e9:.2f} GB "
          f"(x{grid.uniform_3d_bytes()/gf.storage_bytes():.0f})")

    # PNG: resample to 25 cm for a quick top-down look, and full-res inner ring
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    palette = np.array([hex_to_rgb(c) for c in CLASS_COLORS_HEX], dtype=np.uint8)
    lab_u, z_u = grid.to_uniform(gf, 0.25)
    img = palette[lab_u]
    from PIL import Image

    Image.fromarray(img[::-1, ::-1]).save(RESULTS_DIR / "verify_topdown_25cm.png")
    inner = palette[gf.rings[0].label]
    Image.fromarray(inner[::-1, ::-1]).save(RESULTS_DIR / "verify_ring0_5cm.png")
    print(f"saved {RESULTS_DIR / 'verify_topdown_25cm.png'} and verify_ring0_5cm.png")


if __name__ == "__main__":
    main()
