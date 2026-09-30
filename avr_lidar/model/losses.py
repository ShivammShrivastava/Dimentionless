"""Weighted cross-entropy + Lovász-softmax for range-view segmentation."""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

from avr_lidar.config import IGNORE_INDEX, NUM_CLASSES


def lovasz_grad(gt_sorted: torch.Tensor) -> torch.Tensor:
    p = gt_sorted.numel()
    gts = gt_sorted.sum()
    intersection = gts - gt_sorted.cumsum(0)
    union = gts + (1 - gt_sorted).cumsum(0)
    jaccard = 1.0 - intersection / union
    if p > 1:
        jaccard[1:p] = jaccard[1:p] - jaccard[0:-1]
    return jaccard


def lovasz_softmax_flat(probas: torch.Tensor, labels: torch.Tensor, classes: list[int]) -> torch.Tensor:
    """probas (P, C) softmax probabilities of valid pixels, labels (P,)."""
    if probas.numel() == 0:
        return probas.sum() * 0.0
    losses = []
    for c in classes:
        fg = (labels == c).float()
        if fg.sum() == 0:
            continue
        errors = (fg - probas[:, c]).abs()
        errors_sorted, perm = torch.sort(errors, 0, descending=True)
        losses.append(torch.dot(errors_sorted, lovasz_grad(fg[perm])))
    if not losses:
        return probas.sum() * 0.0
    return torch.stack(losses).mean()


class SegLoss(nn.Module):
    def __init__(self, class_weights: torch.Tensor | None, lovasz_weight: float = 1.0):
        super().__init__()
        self.register_buffer("w", class_weights if class_weights is not None else torch.ones(NUM_CLASSES))
        self.lovasz_weight = lovasz_weight
        self.valid_classes = [c for c in range(NUM_CLASSES) if c != IGNORE_INDEX]

    def forward(self, logits: torch.Tensor, target: torch.Tensor, mask: torch.Tensor) -> tuple[torch.Tensor, dict]:
        """logits (B,C,H,W), target (B,H,W) long, mask (B,H,W) bool of pixels with points."""
        valid = mask & (target != IGNORE_INDEX)
        ce_map = F.cross_entropy(logits.float(), target, weight=self.w.float(), reduction="none", ignore_index=IGNORE_INDEX)
        ce = (ce_map * valid).sum() / valid.sum().clamp(min=1)

        probas = F.softmax(logits.float(), dim=1).permute(0, 2, 3, 1)[valid]  # (P, C)
        lov = lovasz_softmax_flat(probas, target[valid], self.valid_classes)
        total = ce + self.lovasz_weight * lov
        return total, {"ce": ce.detach(), "lovasz": lov.detach()}


def inverse_log_frequency_weights(counts: torch.Tensor, eps: float = 1e-3) -> torch.Tensor:
    freq = counts.float() / counts.float().sum().clamp(min=1)
    w = 1.0 / torch.log(1.02 + freq.clamp(min=eps))
    w[IGNORE_INDEX] = 0.0
    return w
