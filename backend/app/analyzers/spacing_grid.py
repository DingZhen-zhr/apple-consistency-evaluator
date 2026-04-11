from __future__ import annotations

import hashlib

import cv2
import numpy as np

from app.analyzers.base import Analyzer, AnalyzerContext
from app.models import BBox, Issue


def _nearest_multiple(value: float, base: int) -> int:
    return int(round(value / base) * base)


class SpacingGridConsistencyAnalyzer(Analyzer):
    dimension = "SpacingAndGridConsistency"

    def __init__(
        self,
        grid_base_px: int = 8,
        max_elements: int = 250,
        min_area_px: int = 900,
        max_area_ratio: float = 0.35,
        outlier_threshold_px: int = 3,
    ) -> None:
        self.grid_base_px = grid_base_px
        self.max_elements = max_elements
        self.min_area_px = min_area_px
        self.max_area_ratio = max_area_ratio
        self.outlier_threshold_px = outlier_threshold_px

    def analyze(self, ctx: AnalyzerContext) -> list[Issue]:
        rgb = ctx.image_rgb
        h, w = rgb.shape[:2]

        bgr = rgb[:, :, ::-1]
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

        # Edge-ish map to find UI blocks; this is heuristic but deterministic.
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blur, 60, 180)
        kernel = np.ones((3, 3), np.uint8)
        edges = cv2.dilate(edges, kernel, iterations=1)

        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        rects: list[tuple[int, int, int, int, int]] = []
        max_area = int(h * w * self.max_area_ratio)
        for c in contours:
            x, y, rw, rh = cv2.boundingRect(c)
            area = rw * rh
            if area < self.min_area_px:
                continue
            if area > max_area:
                continue
            rects.append((x, y, rw, rh, area))

        rects.sort(key=lambda r: r[4], reverse=True)
        rects = rects[: self.max_elements]

        if len(rects) < 8:
            return []

        # Compute simple gap samples (horizontal & vertical) between neighboring rects.
        rects_xy = [(x, y, rw, rh) for x, y, rw, rh, _ in rects]

        gaps: list[dict] = []
        # Horizontal neighbors: group by rough y band.
        rects_by_y = sorted(rects_xy, key=lambda r: (r[1] // 24, r[0]))
        for band in range(0, (h // 24) + 1):
            row = [r for r in rects_by_y if (r[1] // 24) == band]
            row.sort(key=lambda r: r[0])
            for a, b in zip(row, row[1:]):
                ax, ay, aw, ah = a
                bx, by, bw, bh = b
                gap = bx - (ax + aw)
                if gap <= 0 or gap > 240:
                    continue
                gaps.append({"dir": "x", "gap": int(gap), "a": a, "b": b})

        # Vertical neighbors: group by rough x band.
        rects_by_x = sorted(rects_xy, key=lambda r: (r[0] // 24, r[1]))
        for band in range(0, (w // 24) + 1):
            col = [r for r in rects_by_x if (r[0] // 24) == band]
            col.sort(key=lambda r: r[1])
            for a, b in zip(col, col[1:]):
                ax, ay, aw, ah = a
                bx, by, bw, bh = b
                gap = by - (ay + ah)
                if gap <= 0 or gap > 240:
                    continue
                gaps.append({"dir": "y", "gap": int(gap), "a": a, "b": b})

        if len(gaps) < 10:
            return []

        # Score outliers: distance to nearest multiple of grid_base_px
        outliers: list[dict] = []
        for g in gaps:
            gap = g["gap"]
            nearest = _nearest_multiple(gap, self.grid_base_px)
            diff = abs(gap - nearest)
            if diff >= self.outlier_threshold_px:
                outliers.append({**g, "nearest": int(nearest), "diff": int(diff)})

        if not outliers:
            return []

        # Keep top-N worst diffs
        outliers.sort(key=lambda o: o["diff"], reverse=True)
        top = outliers[:12]

        issue_id = hashlib.sha1(f"{ctx.filename}:{self.dimension}:gridOutliers".encode("utf-8")).hexdigest()[:10]

        bboxes: list[BBox] = []
        for o in top:
            ax, ay, aw, ah = o["a"]
            bx, by, bw, bh = o["b"]
            # Union bbox for the pair
            x1 = min(ax, bx)
            y1 = min(ay, by)
            x2 = max(ax + aw, bx + bw)
            y2 = max(ay + ah, by + bh)
            bboxes.append(BBox(x=int(x1), y=int(y1), w=int(x2 - x1), h=int(y2 - y1)))

        evidence = {
            "grid_base_px": self.grid_base_px,
            "outlier_samples": [
                {
                    "dir": o["dir"],
                    "gap_px": o["gap"],
                    "nearest_grid_px": o["nearest"],
                    "diff_px": o["diff"],
                }
                for o in top
            ],
            "note": "该检测是图像启发式推断（不依赖 UI 结构文件），用于发现明显的间距离群点。",
        }

        suggestion = (
            f"将离群间距对齐到 {self.grid_base_px}px 网格（例如把 {top[0]['gap']}px 调整为 {top[0]['nearest']}px），"
            "并尽量让同类模块的水平/垂直间距复用同一组 spacing token（8/16/24/32 等）。"
        )

        return [
            Issue(
                id=f"{self.dimension}-{issue_id}",
                dimension=self.dimension,
                severity="high" if len(outliers) >= 20 else "medium",
                title="检测到间距/网格一致性离群点（偏离 8pt 网格）",
                evidence=evidence,
                suggestion=suggestion,
                bboxes=bboxes,
            )
        ]

