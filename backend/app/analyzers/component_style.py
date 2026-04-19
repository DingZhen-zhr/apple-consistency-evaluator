"""
Component Style Consistency Analyzer

Theory:
  - Apple HIG: uniform corner radii across component types (8/10/12/16/20px)
  - Visual consistency principle: same-class components should share styling

Algorithm:
  1. Canny edge detection -> find card/button-like contours
  2. For each component, extract 4 corner 12x12 patches
  3. Circle arc fitting via least-squares on edge pixels in corner patches
  4. Build radius distribution across all components
  5. Compute radius_cv (coefficient of variation = std/mean)
  6. Check if mode matches Apple standard radii
  7. corner_score = exp(-3 * radius_cv) * apple_modal_bonus
"""

from __future__ import annotations

import hashlib

import cv2
import numpy as np

from app.analyzers.base import Analyzer, AnalyzerContext
from app.models import BBox, Issue

_APPLE_STANDARD_RADII = np.array([0, 4, 6, 8, 10, 12, 14, 16, 20, 24], dtype=np.float64)


def _fit_corner_radius(gray_patch: np.ndarray) -> float | None:
    """
    Estimate corner radius by finding edge pixels in a corner patch
    and fitting a circle arc through them.
    """
    if gray_patch.shape[0] < 8 or gray_patch.shape[1] < 8:
        return None

    edges = cv2.Canny(gray_patch, 40, 120)
    pts = np.argwhere(edges > 0)  # (row, col) = (y, x)
    if len(pts) < 5:
        return None

    # Least-squares circle fit: minimize sum of (sqrt((x-a)^2 + (y-b)^2) - r)^2
    # Using algebraic fit: x^2 + y^2 + Dx + Ey + F = 0
    x = pts[:, 1].astype(np.float64)
    y = pts[:, 0].astype(np.float64)
    A = np.column_stack([x, y, np.ones_like(x)])
    b_vec = -(x**2 + y**2)

    try:
        result, _, _, _ = np.linalg.lstsq(A, b_vec, rcond=None)
    except np.linalg.LinAlgError:
        return None

    D, E, F = result
    cx = -D / 2.0
    cy = -E / 2.0
    r_sq = cx**2 + cy**2 - F
    if r_sq <= 0:
        return None
    r = float(np.sqrt(r_sq))

    # Sanity: radius should be reasonable (1-60px)
    if r < 1.0 or r > 60.0:
        return None
    return r


def _estimate_component_radius(rgb_patch: np.ndarray) -> float | None:
    """Estimate corner radius for a component by sampling 4 corners."""
    h, w = rgb_patch.shape[:2]
    if h < 20 or w < 20:
        return None

    gray = cv2.cvtColor(rgb_patch[:, :, ::-1], cv2.COLOR_BGR2GRAY)
    cs = min(h // 3, w // 3, 16)  # corner patch size

    corners = [
        gray[:cs, :cs],           # top-left
        gray[:cs, w-cs:],         # top-right
        gray[h-cs:, :cs],         # bottom-left
        gray[h-cs:, w-cs:],       # bottom-right
    ]

    radii = []
    for patch in corners:
        r = _fit_corner_radius(patch)
        if r is not None:
            radii.append(r)

    if len(radii) < 2:
        return None
    return float(np.median(radii))


class ComponentStyleConsistencyAnalyzer(Analyzer):
    dimension = "ComponentStyleConsistency"

    def __init__(
        self,
        min_area_px: int = 1200,
        max_area_ratio: float = 0.25,
        max_candidates: int = 150,
        min_samples: int = 8,
    ) -> None:
        self.min_area_px = min_area_px
        self.max_area_ratio = max_area_ratio
        self.max_candidates = max_candidates
        self.min_samples = min_samples

    def analyze(self, ctx: AnalyzerContext) -> tuple[list[Issue], dict]:
        rgb = ctx.image_rgb
        h, w = rgb.shape[:2]
        bgr = rgb[:, :, ::-1]
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blur, 50, 150)
        edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)

        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        max_area = int(h * w * self.max_area_ratio)
        rects: list[tuple[int, int, int, int, int]] = []
        for c in contours:
            x, y, rw, rh = cv2.boundingRect(c)
            area = rw * rh
            if area < self.min_area_px or area > max_area:
                continue
            ar = rw / max(1, rh)
            if ar < 0.2 or ar > 6.0:
                continue
            rects.append((x, y, rw, rh, area))

        rects.sort(key=lambda r: r[4], reverse=True)
        rects = rects[: self.max_candidates]

        # Estimate radius for each component
        samples: list[dict] = []
        for x, y, rw, rh, area in rects:
            patch = rgb[y:y+rh, x:x+rw, :]
            r = _estimate_component_radius(patch)
            if r is not None:
                samples.append({"bbox": (x, y, rw, rh), "radius_px": round(r, 1), "area": area})

        if len(samples) < self.min_samples:
            features = {"corner_score": 75.0, "radius_cv": 0.0, "radius_mean": 0.0,
                        "radius_std": 0.0, "sample_count": len(samples),
                        "apple_modal_match": True, "radius_mode": 0.0,
                        "outlier_ratio_01": 0.0}
            return [], features

        radii = np.array([s["radius_px"] for s in samples], dtype=np.float64)
        r_mean = float(np.mean(radii))
        r_std = float(np.std(radii))
        r_cv = r_std / max(1.0, r_mean)

        # Mode estimation via histogram
        r_rounded = np.round(radii).astype(int)
        if len(r_rounded) > 0:
            counts = np.bincount(r_rounded)
            r_mode = float(np.argmax(counts))
        else:
            r_mode = r_mean

        # Apple standard match
        apple_dist = float(np.min(np.abs(_APPLE_STANDARD_RADII - r_mode)))
        apple_modal_match = apple_dist <= 2.0
        apple_bonus = 1.0 if apple_modal_match else 0.85

        # Outlier detection: more than 5px from mode
        outlier_mask = np.abs(radii - r_mode) > 5.0
        outlier_count = int(np.sum(outlier_mask))
        outlier_ratio = outlier_count / max(1, len(radii))

        # Final score
        import math
        corner_score = math.exp(-3.0 * r_cv) * apple_bonus * 100.0
        # Additional penalty for high outlier ratio
        corner_score *= (1.0 - outlier_ratio * 0.3)
        corner_score = round(max(0.0, min(100.0, corner_score)), 1)

        features = {
            "corner_score": corner_score,
            "radius_cv": round(r_cv, 4),
            "radius_mean": round(r_mean, 1),
            "radius_std": round(r_std, 1),
            "radius_mode": round(r_mode, 1),
            "sample_count": len(samples),
            "apple_modal_match": apple_modal_match,
            "apple_dist_px": round(apple_dist, 1),
            "outlier_ratio_01": round(outlier_ratio, 3),
            "outlier_count": outlier_count,
        }

        # Issues
        issues: list[Issue] = []
        if r_cv > 0.35:
            outlier_examples = sorted(samples, key=lambda s: abs(s["radius_px"] - r_mode), reverse=True)[:8]
            issue_id = hashlib.sha1(f"{ctx.filename}:{self.dimension}:radiusCV".encode()).hexdigest()[:10]
            issues.append(
                Issue(
                    id=f"{self.dimension}-{issue_id}",
                    dimension=self.dimension,
                    severity="high" if r_cv > 0.6 else "medium",
                    title=f"Inconsistent corner radii (CV={r_cv:.2f}, mode={r_mode:.0f}px)",
                    evidence={
                        "radius_cv": round(r_cv, 3),
                        "radius_mode_px": round(r_mode, 1),
                        "outlier_examples": [{"radius_px": s["radius_px"]} for s in outlier_examples],
                    },
                    suggestion=f"Unify corner radius to ~{r_mode:.0f}px for same-class components.",
                    bboxes=[BBox(x=s["bbox"][0], y=s["bbox"][1], w=s["bbox"][2], h=s["bbox"][3]) for s in outlier_examples],
                )
            )

        if not apple_modal_match:
            issue_id = hashlib.sha1(f"{ctx.filename}:{self.dimension}:appleRadius".encode()).hexdigest()[:10]
            issues.append(
                Issue(
                    id=f"{self.dimension}-{issue_id}",
                    dimension=self.dimension,
                    severity="low",
                    title=f"Corner radius mode ({r_mode:.0f}px) deviates from Apple standard values",
                    evidence={"radius_mode_px": round(r_mode, 1), "apple_standards": _APPLE_STANDARD_RADII.tolist()},
                    suggestion="Consider using Apple-standard radii: 8, 10, 12, 16, or 20px.",
                    bboxes=[],
                )
            )

        return issues, features