"""SalsaNext-lite: a compact range-view segmentation U-Net.

Residual dilated context blocks in the encoder, pixel-shuffle upsampling in
the decoder, dropout for regularisation on the tiny nuScenes-mini split.
Input (B, 5, 32, 1024) -> logits (B, NUM_CLASSES, 32, 1024).
Height is only 32 so downsampling happens along width more than height.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

from ml.config import NUM_CLASSES
from ml.data.range_projection import NUM_CHANNELS


class ResContextBlock(nn.Module):
    def __init__(self, cin: int, cout: int):
        super().__init__()
        self.conv1 = nn.Conv2d(cin, cout, 1)
        self.act1 = nn.LeakyReLU(inplace=True)
        self.conv2 = nn.Conv2d(cout, cout, 3, padding=1)
        self.act2 = nn.LeakyReLU(inplace=True)
        self.bn1 = nn.BatchNorm2d(cout)
        self.conv3 = nn.Conv2d(cout, cout, 3, dilation=2, padding=2)
        self.act3 = nn.LeakyReLU(inplace=True)
        self.bn2 = nn.BatchNorm2d(cout)

    def forward(self, x):
        s = self.act1(self.conv1(x))
        x = self.bn1(self.act2(self.conv2(s)))
        x = self.bn2(self.act3(self.conv3(x)))
        return x + s


class ResBlock(nn.Module):
    def __init__(self, cin: int, cout: int, pool: tuple[int, int] | None, drop: float):
        super().__init__()
        self.conv1 = nn.Conv2d(cin, cout, 1)
        self.act1 = nn.LeakyReLU(inplace=True)
        self.conv2 = nn.Conv2d(cin, cout, 3, padding=1)
        self.act2 = nn.LeakyReLU(inplace=True)
        self.bn1 = nn.BatchNorm2d(cout)
        self.conv3 = nn.Conv2d(cout, cout, 3, dilation=2, padding=2)
        self.act3 = nn.LeakyReLU(inplace=True)
        self.bn2 = nn.BatchNorm2d(cout)
        self.conv4 = nn.Conv2d(cout, cout, (2, 2), dilation=2, padding=1)
        self.act4 = nn.LeakyReLU(inplace=True)
        self.bn3 = nn.BatchNorm2d(cout)
        self.conv5 = nn.Conv2d(cout * 3, cout, 1)
        self.act5 = nn.LeakyReLU(inplace=True)
        self.bn4 = nn.BatchNorm2d(cout)
        self.pool = nn.AvgPool2d(pool, stride=pool) if pool else None
        self.drop = nn.Dropout2d(drop)

    def forward(self, x):
        s = self.act1(self.conv1(x))
        a = self.bn1(self.act2(self.conv2(x)))
        b = self.bn2(self.act3(self.conv3(a)))
        c = self.bn3(self.act4(self.conv4(b)))
        c = c[..., : a.shape[-2], : a.shape[-1]]
        cat = torch.cat([a, b, c], dim=1)
        out = self.bn4(self.act5(self.conv5(cat))) + s
        if self.pool is not None:
            return self.pool(self.drop(out)), out
        return self.drop(out), out


class UpBlock(nn.Module):
    def __init__(self, cin: int, cout: int, skip: int, scale: tuple[int, int], drop: float):
        super().__init__()
        self.scale = scale
        self.up = nn.Upsample(scale_factor=scale, mode="bilinear", align_corners=False)
        self.drop1 = nn.Dropout2d(drop)
        self.conv1 = nn.Conv2d(cin + skip, cout, 3, padding=1)
        self.act1 = nn.LeakyReLU(inplace=True)
        self.bn1 = nn.BatchNorm2d(cout)
        self.conv2 = nn.Conv2d(cout, cout, 3, dilation=2, padding=2)
        self.act2 = nn.LeakyReLU(inplace=True)
        self.bn2 = nn.BatchNorm2d(cout)
        self.conv3 = nn.Conv2d(cout * 2, cout, 1)
        self.act3 = nn.LeakyReLU(inplace=True)
        self.bn3 = nn.BatchNorm2d(cout)
        self.drop2 = nn.Dropout2d(drop)

    def forward(self, x, skip):
        x = self.up(x)
        if x.shape[-2:] != skip.shape[-2:]:
            x = F.interpolate(x, size=skip.shape[-2:], mode="bilinear", align_corners=False)
        x = torch.cat([self.drop1(x), skip], dim=1)
        a = self.bn1(self.act1(self.conv1(x)))
        b = self.bn2(self.act2(self.conv2(a)))
        out = self.bn3(self.act3(self.conv3(torch.cat([a, b], dim=1))))
        return self.drop2(out)


class SalsaNextLite(nn.Module):
    def __init__(self, in_ch: int = NUM_CHANNELS, num_classes: int = NUM_CLASSES, base: int = 32, drop: float = 0.2):
        super().__init__()
        c1, c2, c3, c4 = base, base * 2, base * 4, base * 8
        self.ctx = nn.Sequential(ResContextBlock(in_ch, c1), ResContextBlock(c1, c1))
        # Downsample: width by 2 each stage, height by 2 only in stages 2,3 (32 -> 16 -> 8).
        self.enc1 = ResBlock(c1, c2, pool=(1, 2), drop=drop)  # 32 x 512
        self.enc2 = ResBlock(c2, c3, pool=(2, 2), drop=drop)  # 16 x 256
        self.enc3 = ResBlock(c3, c4, pool=(2, 2), drop=drop)  # 8 x 128
        self.enc4 = ResBlock(c4, c4, pool=None, drop=drop)  # 8 x 128
        self.dec3 = UpBlock(c4, c3, skip=c4, scale=(2, 2), drop=drop)
        self.dec2 = UpBlock(c3, c2, skip=c3, scale=(2, 2), drop=drop)
        self.dec1 = UpBlock(c2, c1, skip=c2, scale=(1, 2), drop=drop)
        self.head = nn.Conv2d(c1, num_classes, 1)

    def forward(self, x):
        x = self.ctx(x)
        d1, s1 = self.enc1(x)
        d2, s2 = self.enc2(d1)
        d3, s3 = self.enc3(d2)
        d4, _ = self.enc4(d3)
        u3 = self.dec3(d4, s3)
        u2 = self.dec2(u3, s2)
        u1 = self.dec1(u2, s1)
        return self.head(u1)


def count_params(m: nn.Module) -> int:
    return sum(p.numel() for p in m.parameters() if p.requires_grad)


if __name__ == "__main__":
    net = SalsaNextLite()
    x = torch.randn(2, NUM_CHANNELS, 32, 1024)
    y = net(x)
    print(y.shape, f"{count_params(net)/1e6:.2f}M params")
