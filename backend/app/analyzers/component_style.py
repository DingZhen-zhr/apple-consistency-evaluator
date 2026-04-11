from __future__ import annotations

import hashlib

import cv2
import numpy as np

from app.analyzers.base import Analyzer, AnalyzerContext
from app.models import BBox, Issue


def _estimate_bg_color(patch_rgb: np.ndarray) -> np.ndarray:
    """
    Estimate background color by sampling the patch border.
    """
    h, w = patch_rgb.shape[:2]
    border = np.concatenate(
        [
            patch_rgb[0:2, :, :].reshape(-1, 3),
            patch_rgb[-2:, :, :].reshape(-1, 3),
            patch_rgb[:, 0:2, :].reshape(-1, 3),
            patch_rgb[:, -2:, :].reshape(-1, 3),
        ],
        axis=0,
    )
    return np.median(border.astype(np.float32), axis=0).astype(np.uint8)


def _estimate_corner_radius(patch_rgb: np.ndarray) -> int | None:
    """
    Heuristic radius: along each corner diagonal, find first pixel that differs from bg.
    Return median radius across 4 corners.
    """
    h, w = patch_rgb.shape[:2]
    if h < 18 or w < 18:
        return None

    bg = _estimate_bg_color(patch_rgb)
    bg_f = bg.astype(np.int16)

    def scan(diag_coords):
        for i, (y, x) in enumerate(diag_coords, start=1):
            px = patch_rgb[y, x, :].astype(np.int16)
            if int(np.linalg.norm(px - bg_f)) > 18:
                return i
        return None

    limit = min(h, w, 48)
    tl = scan([(i, i) for i in range(0, limit)])
    tr = scan([(i, (w - 1) - i) for i in range(0, limit)])
    bl = scan([((h - 1) - i, i) for i in range(0, limit)])
    br = scan([((h - 1) - i, (w - 1) - i) for i in range(0, limit)])

    vals = [v for v in (tl, tr, bl, br) if v is not None]
    if len(vals) < 2:
        return None
    return int(np.median(vals))


class ComponentStyleConsistencyAnalyzer(Analyzer):
    """
    Try to find card/button-like blocks and estimate corner radius distribution.
    Inconsistent radius across similar-size components is a common inconsistency smell.
    """

    dimension = "ComponentStyleConsistency"

    def __init__(
        self,
        min_area_px: int = 1600,
        max_area_ratio: float = 0.22,
        max_candidates: int = 120,
        radius_outlier_px: int = 3,
        min_samples: int = 10,
    ) -> None:
        self.min_area_px = min_area_px
        self.max_area_ratio = max_area_ratio
        self.max_candidates = max_candidates
        self.radius_outlier_px = radius_outlier_px
        self.min_samples = min_samples

    def analyze(self, ctx: AnalyzerContext) -> list[Issue]:
        rgb = ctx.image_rgb
        h, w = rgb.shape[:2]
        bgr = rgb[:, :, ::-1]
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blur, 60, 160)
        edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)

        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        max_area = int(h * w * self.max_area_ratio)
        rects: list[tuple[int, int, int, int, int]] = []
        for c in contours:
            x, y, rw, rh = cv2.boundingRect(c)
            area = rw * rh
            if area < self.min_area_px or area > max_area:
                continue
            # Prefer blocky components
            ar = rw / max(1, rh)
            if ar < 0.25 or ar > 5.0:
                continue
            rects.append((x, y, rw, rh, area))

        rects.sort(key=lambda r: r[4], reverse=True)
        rects = rects[: self.max_candidates]

        samples: list[dict] = []
        for x, y, rw, rh, area in rects:
            patch = rgb[y : y + rh, x : x + rw, :]
            r = _estimate_corner_radius(patch)
            if r is None:
                continue
            samples.append({"bbox": (x, y, rw, rh), "radius_px": int(r), "area": int(area)})

        if len(samples) < self.min_samples:
            return []

        radii = np.array([s["radius_px"] for s in samples], dtype=np.int32)
        median = int(np.median(radii))
        mad = int(np.median(np.abs(radii - median)))
        tol = max(self.radius_outlier_px, 2 + mad)

        out = [s for s in samples if abs(s["radius_px"] - median) >= tol]
        if not out:
            return []

        out.sort(key=lambda s: abs(s["radius_px"] - median), reverse=True)
        top = out[:12]

        issue_id = hashlib.sha1(f"{ctx.filename}:{self.dimension}:radiusOutliers".encode("utf-8")).hexdigest()[:10]
        return [
            Issue(
                id=f"{self.dimension}-{issue_id}",
                dimension=self.dimension,
                severity="medium",
                title="检测到组件圆角风格不一致（疑似存在圆角半径离群点）",
                evidence={
                    "radius_median_px": median,
                    "radius_mad_px": mad,
                    "outlier_tolerance_px": tol,
                    "sample_count": len(samples),
                    "outlier_examples": [{"radius_px": s["radius_px"]} for s in top],
                    "note": "该检测是截图启发式估计：用组件 bbox 内角落像素与背景的差异推测圆角半径。",
                },
                suggestion=(
                    f"为同一类组件统一圆角 token（例如统一到 ~{median}px），"
                    "避免同屏出现多个接近但不同的圆角半径（会破坏一致性）。"
                ),
                bboxes=[BBox(x=x, y=y, w=rw, h=rh) for x, y, rw, rh in (s['bbox'] for s in top)],
            )
        ]

