"""End-to-end pipeline: Frame -> range image -> SalsaNext-lite -> labels -> VarResGrid.

Every stage is timed with CUDA synchronisation so latency numbers are honest.
`use_gt=True` bypasses the model (ground-truth labels), which is what the
grid engine demo used before the model existed and what the benchmark uses
to isolate projection cost.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import torch

from ml.config import CHECKPOINT_PATH
from ml.data.nuscenes_loader import Frame
from ml.data.range_projection import project as range_project, unproject
from ml.grid.varres_grid import GridFrame, VarResGrid
from dl.salsanext_lite import SalsaNextLite


@dataclass
class PipelineOutput:
    frame: Frame
    pred_label: np.ndarray  # (N,) uint8
    grid: GridFrame
    latency_ms: dict[str, float] = field(default_factory=dict)


class Pipeline:
    def __init__(
        self,
        checkpoint: Path | str | None = CHECKPOINT_PATH,
        grid: VarResGrid | None = None,
        device: str | None = None,
        use_gt: bool = False,
    ):
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        self.grid = grid or VarResGrid()
        self.use_gt = use_gt
        self.model: SalsaNextLite | None = None
        if not use_gt:
            ckpt_path = Path(checkpoint) if checkpoint else CHECKPOINT_PATH
            if not ckpt_path.exists():
                raise FileNotFoundError(f"checkpoint not found: {ckpt_path} (train first or pass use_gt=True)")
            ckpt = torch.load(ckpt_path, map_location=self.device, weights_only=False)
            self.model = SalsaNextLite(base=ckpt.get("base", 32)).to(self.device).eval()
            self.model.load_state_dict(ckpt["model"])
            self.checkpoint_info = {"epoch": ckpt.get("epoch"), "val": ckpt.get("val")}
            self._warmup()

    def _sync(self) -> None:
        if self.device.type == "cuda":
            torch.cuda.synchronize()

    @torch.no_grad()
    def _warmup(self) -> None:
        x = torch.zeros(1, 5, 32, 1024, device=self.device)
        with torch.autocast(device_type=self.device.type, dtype=torch.float16, enabled=self.device.type == "cuda"):
            for _ in range(3):
                self.model(x)
        self._sync()

    @torch.no_grad()
    def segment(self, frame: Frame) -> tuple[np.ndarray, dict[str, float]]:
        t = {}
        t0 = time.perf_counter()
        ri = range_project(frame.xyz, frame.intensity, frame.ring)
        t1 = time.perf_counter()
        t["range_proj"] = (t1 - t0) * 1000

        x = torch.from_numpy(ri.image).unsqueeze(0).to(self.device, non_blocking=True)
        with torch.autocast(device_type=self.device.type, dtype=torch.float16, enabled=self.device.type == "cuda"):
            pred = self.model(x).argmax(1)[0]
        pred = pred.to(torch.uint8).cpu().numpy()
        self._sync()
        t2 = time.perf_counter()
        t["inference"] = (t2 - t1) * 1000

        labels = unproject(pred, ri.rows, ri.cols)
        t["unproject"] = (time.perf_counter() - t2) * 1000
        return labels, t

    def run(self, frame: Frame) -> PipelineOutput:
        t_start = time.perf_counter()
        if self.use_gt:
            labels, t = frame.label, {"range_proj": 0.0, "inference": 0.0, "unproject": 0.0}
        else:
            labels, t = self.segment(frame)
        t0 = time.perf_counter()
        grid = self.grid.project(frame.xyz, labels)
        t["projection"] = (time.perf_counter() - t0) * 1000
        t["total"] = (time.perf_counter() - t_start) * 1000
        return PipelineOutput(frame=frame, pred_label=labels, grid=grid, latency_ms=t)
