from __future__ import annotations

import hashlib

import cv2
import numpy as np

from app.analyzers.base import Analyzer, AnalyzerContext
from app.models import BBox, Issue


class TypographyConsistencyAnalyzer(Analyzer):
    """
    Heuristic, fully local (no OCR engine required):
    - Use blackhat morphology to highlight dark text on light background
    - Find connected components as "text blobs"
    - Use blob height as a proxy for font-size tier
    """

    dimension = "TypographyConsistency"

    def __init__(
        self,
        min_blob_area: int = 40,
        max_blob_area_ratio: float = 0.02,
        min_height: int = 8,
        max_height_ratio: float = 0.18,
        tier_merge_px: int = 2,
        max_reasonable_tiers: int = 6,
    ) -> None:
        self.min_blob_area = min_blob_area
        self.max_blob_area_ratio = max_blob_area_ratio
        self.min_height = min_height
        self.max_height_ratio = max_height_ratio
        self.tier_merge_px = tier_merge_px
        self.max_reasonable_tiers = max_reasonable_tiers

    def analyze(self, ctx: AnalyzerContext) -> list[Issue]:
        rgb = ctx.image_rgb
        h, w = rgb.shape[:2]
        bgr = rgb[:, :, ::-1]
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

        # Blackhat highlights dark-on-light structures (often text strokes)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (11, 11))
        bh = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)
        bh = cv2.GaussianBlur(bh, (3, 3), 0)

        _, th = cv2.threshold(bh, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        th = cv2.morphologyEx(th, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8), iterations=1)

        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(th, connectivity=8)
        if num_labels <= 1:
            return []

        max_blob_area = int(h * w * self.max_blob_area_ratio)
        max_h = int(h * self.max_height_ratio)

        blobs: list[tuple[int, int, int, int, int]] = []
        for i in range(1, num_labels):
            x, y, bw, bhh, area = stats[i].tolist()
            if area < self.min_blob_area or area > max_blob_area:
                continue
            if bhh < self.min_height or bhh > max_h:
                continue
            # Remove very thin noise
            if bw <= 2 or bhh <= 2:
                continue
            blobs.append((x, y, bw, bhh, area))

        if len(blobs) < 25:
            return []

        heights = sorted([b[3] for b in blobs])

        # Merge heights into tiers (simple 1D clustering with tolerance)
        tiers: list[int] = []
        for hh in heights:
            if not tiers or abs(hh - tiers[-1]) > self.tier_merge_px:
                tiers.append(hh)

        if len(tiers) <= self.max_reasonable_tiers:
            return []

        # Build outlier candidates: blobs whose height is far from nearest common tier
        tiers_np = np.array(tiers, dtype=np.int32)
        diffs = []
        for x, y, bw, bhh, area in blobs:
            nearest = int(tiers_np[np.argmin(np.abs(tiers_np - bhh))])
            diffs.append((abs(bhh - nearest), x, y, bw, bhh))

        diffs.sort(key=lambda t: t[0], reverse=True)
        top = diffs[:12]

        issue_id = hashlib.sha1(f"{ctx.filename}:{self.dimension}:tooManyTiers".encode("utf-8")).hexdigest()[:10]
        return [
            Issue(
                id=f"{self.dimension}-{issue_id}",
                dimension=self.dimension,
                severity="medium",
                title="检测到过多的字号层级（截图中疑似存在过多不同的文本高度）",
                evidence={
                    "estimated_size_tiers_px": tiers[:20],
                    "tier_count": len(tiers),
                    "note": "该检测不依赖 OCR，仅用“文本笔画形态 + 连通域高度”估计字号层级；可能把图标/细线误判为文本。",
                },
                suggestion=(
                    "把文本层级收敛到更少的 token（例如 Title/Body/Caption 等 3-5 档），"
                    "并确保同语义文本在不同模块复用同一字号/字重组合。"
                ),
                bboxes=[BBox(x=int(x), y=int(y), w=int(bw), h=int(bhh)) for _, x, y, bw, bhh in top],
            )
        ]

