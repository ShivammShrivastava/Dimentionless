"""Qualitative + quantitative figures for the report -> results/fig_*.png"""
from __future__ import annotations
import json, sys
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from avr_lidar.config import CLASS_COLORS_HEX, CLASS_NAMES, METRICS_PATH, RESULTS_DIR, DISTANCE_BINS
from avr_lidar.data.nuscenes_loader import NuScenesMini
from avr_lidar.pipeline.infer import Pipeline

cmap = ListedColormap(CLASS_COLORS_HEX)
nusc = NuScenesMini(); pipe = Pipeline()
RESULTS_DIR.mkdir(exist_ok=True)

# --- Figure 1: GT points | predicted points | adaptive 2.5D map (label) | height, 3 val frames
frames = [("scene-0103", 5), ("scene-0103", 25), ("scene-0916", 12)]
fig, axes = plt.subplots(len(frames), 4, figsize=(20, 5 * len(frames)), facecolor="#111")
for row, (sc, idx) in enumerate(frames):
    f = nusc.get_frame(sc, idx); out = pipe.run(f)
    R = 40
    m = (np.abs(f.xyz[:, 0]) < R) & (np.abs(f.xyz[:, 1]) < R)
    for col, (lab, title) in enumerate([(f.label, "ground truth points"), (out.pred_label, "predicted points")]):
        ax = axes[row, col]; ax.set_facecolor("#111")
        ax.scatter(-f.xyz[m, 1], f.xyz[m, 0], c=lab[m], cmap=cmap, vmin=-0.5, vmax=4.5, s=0.4, marker=".")
        ax.set_xlim(-R, R); ax.set_ylim(-R, R); ax.set_aspect("equal"); ax.set_title(f"{sc}[{idx}] {title}", color="w"); ax.axis("off")
    lab_u, z_u = pipe.grid.to_uniform(out.grid, 0.10)
    U = lab_u.shape[0]; c0, c1 = U // 2 - int(R / 0.10), U // 2 + int(R / 0.10)
    ax = axes[row, 2]; ax.imshow(lab_u[c0:c1, c0:c1][::-1, ::-1], cmap=cmap, vmin=-0.5, vmax=4.5, interpolation="nearest")
    ax.set_title("adaptive 2.5D map: class (rings 0-2 shown)", color="w"); ax.axis("off")
    for r_m, s in [(10, "5cm"), (20, "10cm"), (40, "20cm")]:
        k = int(r_m / 0.10); c = (c1 - c0) / 2
        ax.add_patch(plt.Rectangle((c - k, c - k), 2 * k, 2 * k, fill=False, ec="w", lw=0.8, ls="--"))
        ax.text(c - k + 3, c - k + 12, s, color="w", fontsize=8)
    zz = z_u[c0:c1, c0:c1].astype(float); zz[zz == -32768] = np.nan
    ax = axes[row, 3]; im = ax.imshow(zz[::-1, ::-1] / 100, cmap="viridis", vmin=-0.5, vmax=3.0, interpolation="nearest")
    ax.set_title("adaptive 2.5D map: z_max (m)", color="w"); ax.axis("off")
handles = [plt.Line2D([], [], marker="s", ls="", color=CLASS_COLORS_HEX[i], label=CLASS_NAMES[i]) for i in range(1, 5)]
fig.legend(handles=handles, loc="lower center", ncol=4, facecolor="#222", labelcolor="w", fontsize=12)
plt.tight_layout(rect=(0, 0.03, 1, 1)); fig.savefig(RESULTS_DIR / "fig_qualitative.png", dpi=110); plt.close(fig)

# --- Figure 2: accuracy by distance (overall + per class) with cell size annotations
M = json.loads(METRICS_PATH.read_text())
bins = [f"{lo}-{hi}" for lo, hi in DISTANCE_BINS]; cell = ["5 cm", "10 cm", "20 cm", "50 cm"]
fig, ax = plt.subplots(figsize=(9, 5.6))
x = np.arange(len(bins)); w = 0.16
ax.bar(x - 2 * w, [M["accuracy_by_distance"][b] for b in bins], w, color="k", label="all classes")
for k, cname in enumerate(CLASS_NAMES[1:], start=1):
    vals = [M["accuracy_by_distance_per_class"][b][cname] or 0 for b in bins]
    ax.bar(x + (k - 2) * w, vals, w, color=CLASS_COLORS_HEX[k], label=cname)
ax.set_xticks(x); ax.set_xticklabels([f"{b} m\n({c} cells)" for b, c in zip(bins, cell)])
ax.set_ylim(0, 1); ax.set_ylabel("point accuracy (val split)"); ax.set_title("Accuracy vs distance from sensor (val split)"); ax.legend(ncol=5, fontsize=9, loc="upper center", bbox_to_anchor=(0.5, -0.18), frameon=False)
ax.grid(axis="y", alpha=0.3); plt.tight_layout(); fig.savefig(RESULTS_DIR / "fig_accuracy_by_distance.png", dpi=130); plt.close(fig)

# --- Figure 3: memory comparison (log scale)
mem = M["memory"]
fig, ax = plt.subplots(figsize=(8, 4))
names = ["adaptive var-res\n(this work)", "uniform 2D\n5 cm", "uniform 3D\n5 cm voxels"]
vals = [mem["varres_bytes"], mem["uniform_2d_5cm_bytes"], mem["uniform_3d_5cm_bytes"]]
bars = ax.barh(names, vals, color=["#3b82f6", "#a3a3a3", "#ef4444"]); ax.set_xscale("log")
for b, v, txt in zip(bars, vals, ["1x", f"{mem['reduction_2d']}x more", f"{mem['reduction_3d']}x more"]):
    ax.text(v * 1.15, b.get_y() + b.get_height() / 2, f"{v/1e6:,.1f} MB  ({txt})", va="center")
ax.set_xlim(1e6, 1e10); ax.set_xlabel("bytes per frame (log)"); ax.set_title("Map memory: 200 m x 200 m coverage"); ax.invert_yaxis()
plt.tight_layout(); fig.savefig(RESULTS_DIR / "fig_memory.png", dpi=130); plt.close(fig)

# --- Figure 4: latency breakdown
lat = M["latency_ms"]
fig, ax = plt.subplots(figsize=(8, 3.2))
stages = ["range_proj", "inference", "unproject", "projection", "encode"]; vals = [lat[s]["p50"] for s in stages]
left = 0
for s, v, c in zip(stages, vals, ["#60a5fa", "#f59e0b", "#93c5fd", "#22c55e", "#a3a3a3"]):
    ax.barh(["pipeline"], [v], left=left, color=c, label=f"{s} {v:.1f} ms"); left += v
ax.set_xlabel("ms per frame (median)"); ax.set_title(f"Latency breakdown: {left:.1f} ms total -> {M['fps']['total']} FPS ({M['device']})")
ax.legend(ncol=5, fontsize=8, loc="upper center", bbox_to_anchor=(0.5, -0.35)); plt.tight_layout(); fig.savefig(RESULTS_DIR / "fig_latency.png", dpi=130); plt.close(fig)
print("figures written to", RESULTS_DIR)
