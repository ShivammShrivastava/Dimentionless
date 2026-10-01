"""Train SalsaNext-lite on nuScenes-mini range images.

Usage:  python -m dl.train --epochs 60 --batch 8
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # dl → root

from ml.config import CHECKPOINT_PATH, CLASS_NAMES, RESULTS_DIR  # noqa: E402
from ml.data.nuscenes_loader import NuScenesMini  # noqa: E402
from ml.eval.metrics import SegmentationMeter  # noqa: E402
from dl.dataset import RangeViewDataset  # noqa: E402
from dl.losses import SegLoss, inverse_log_frequency_weights  # noqa: E402
from dl.salsanext_lite import SalsaNextLite, count_params  # noqa: E402


@torch.no_grad()
def evaluate(model, loader, device) -> dict:
    model.eval()
    meter = SegmentationMeter()
    for img, lab, mask in loader:
        img = img.to(device, non_blocking=True)
        with torch.autocast(device_type=device.type, dtype=torch.float16, enabled=device.type == "cuda"):
            pred = model(img).argmax(1).cpu().numpy()
        lab, mask = lab.numpy(), mask.numpy()
        meter.update(pred[mask], lab[mask])
    return meter.summary()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--base", type=int, default=32)
    ap.add_argument("--workers", type=int, default=0)
    ap.add_argument("--out", type=Path, default=CHECKPOINT_PATH)
    args = ap.parse_args()

    torch.manual_seed(0)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"device: {device}")

    nusc = NuScenesMini()
    train_ds = RangeViewDataset(nusc, "train", augment=True)
    val_ds = RangeViewDataset(nusc, "val", augment=False)
    print(f"train frames {len(train_ds)}  val frames {len(val_ds)}")

    t0 = time.perf_counter()
    counts = train_ds.class_pixel_counts()
    print(f"cached train set in {time.perf_counter()-t0:.1f}s; pixel counts {dict(zip(CLASS_NAMES, counts.tolist()))}")
    weights = inverse_log_frequency_weights(counts)
    print(f"class weights {np.round(weights.numpy(), 3).tolist()}")

    train_dl = DataLoader(train_ds, batch_size=args.batch, shuffle=True, num_workers=args.workers, drop_last=True, pin_memory=True)
    val_dl = DataLoader(val_ds, batch_size=args.batch, shuffle=False, num_workers=args.workers)

    model = SalsaNextLite(base=args.base).to(device)
    print(f"params {count_params(model)/1e6:.2f}M")
    criterion = SegLoss(weights).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    steps = args.epochs * len(train_dl)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=steps, pct_start=0.1)
    scaler = torch.amp.GradScaler(enabled=device.type == "cuda")

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    best = -1.0
    history = []
    for epoch in range(1, args.epochs + 1):
        model.train()
        t_ep = time.perf_counter()
        tot, n = 0.0, 0
        for img, lab, mask in train_dl:
            img, lab, mask = img.to(device, non_blocking=True), lab.to(device), mask.to(device)
            opt.zero_grad(set_to_none=True)
            with torch.autocast(device_type=device.type, dtype=torch.float16, enabled=device.type == "cuda"):
                logits = model(img)
            loss, parts = criterion(logits, lab, mask)
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            scaler.step(opt)
            scaler.update()
            sched.step()
            tot += loss.item()
            n += 1
        val = evaluate(model, val_dl, device)
        rec = {"epoch": epoch, "train_loss": tot / max(1, n), "val_miou": val["miou"], "val_acc": val["accuracy"],
               "iou": val["iou_per_class"], "sec": time.perf_counter() - t_ep}
        history.append(rec)
        flag = ""
        if val["miou"] > best:
            best = val["miou"]
            torch.save({"model": model.state_dict(), "base": args.base, "epoch": epoch, "val": val}, args.out)
            flag = " *"
        print(f"ep {epoch:3d} loss {rec['train_loss']:.3f} val mIoU {val['miou']:.3f} acc {val['accuracy']:.3f} "
              f"iou {[round(v,2) for v in val['iou_per_class'].values()]} {rec['sec']:.0f}s{flag}")

    with open(RESULTS_DIR / "train_history.json", "w") as f:
        json.dump(history, f, indent=1)
    print(f"best val mIoU {best:.4f} -> {args.out}")


if __name__ == "__main__":
    main()
