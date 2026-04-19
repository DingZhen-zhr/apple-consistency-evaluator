"""
SpacingAndGrid Analyzer

Theory:
  - Apple HIG: 4pt/8pt grid system for consistent spacing
  - Nielsen (1994): consistency heuristic

Algorithm:
  1. Canny + morphological closing -> extract UI block bounding boxes
  2. Compute horizontal/vertical gaps between neighboring blocks
  3. KDE to find dominant gap modes
  4. Check alignment to 4pt multiples (4,8,12,16,20,24,32,40,48)
  5. Measure left/right margin consistency
  6. spacing_score = alignment_quality * margin_consistency
"""

from __future__ import annotations

import hashlib

import cv2
import numpy as np

from app.analyzers.base import Analyzer, AnalyzerContext
from app.models import BBox, Issue

# Valid 4pt grid values up to 64px
_GRID_4PT = np.array([4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64], dtype=np.float64)


def _nearest_4pt(value: float) -> float:
    idx = int(np.argmin(np.abs(_GRID_4PT - value)))
    return float(_GRID_4PT[idx])


def _kde_modes(values: np.ndarray, bw: float = 3.0) -> list[float]:
    """Simple 1D KDE on integer domain to find gap modes."""
    if len(values) == 0:
        return []
    lo, hi = int(np.min(values)), int(np.max(values))
    if hi - lo < 2:
        return [float(np.mean(values))]
    x = np.arange(lo, hi + 1, dtype=np.float64)
    density = np.zeros_like(x)
    for v in values:
        density += np.exp(-0.5 * ((x - v) / bw) ** 2)
    # find local maxima
    modes = []
    for i in range(1, len(density) - 1):
        if density[i] > density[i - 1] and density[i] >= density[i + 1]:
            modes.append(float(x[i]))
    if not modes and len(density) > 0:
        modes.append(float(x[int(np.argmax(density))]))
    return modes


class SpacingGridConsistencyAnalyzer(Analyzer):
    dimension = "SpacingAndGridConsistency"

    def __init__(
        self,
        max_elements: int = 300,
        min_area_px: int = 600,
        max_area_ratio: float = 0.40,
    ) -> None:
        self.max_elements = max_elements
        self.min_area_px = min_area_px
        self.max_area_ratio = max_area_ratio

    def analyze(self, ctx: AnalyzerContext) -> tuple[list[Issue], dict]:
        rgb = ctx.image_rgb
        h, w = rgb.shape[:2]

        bgr = rgb[:, :, ::-1]
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

        # Edge detection + morphological closing to connect nearby edges
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blur, 50, 150)
        kernel_close = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel_close, iterations=1)
        kernel_dilate = np.ones((3, 3), np.uint8)
        closed = cv2.dilate(closed, kernel_dilate, iterations=1)

        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        max_area = int(h * w * self.max_area_ratio)
        rects: list[tuple[int, int, int, int]] = []
        for c in contours:
            x, y, rw, rh = cv2.boundingRect(c)
            area = rw * rh
            if area < self.min_area_px or area > max_area:
                continue
            rects.append((x, y, rw, rh))

        rects.sort(key=lambda r: r[2] * r[3], reverse=True)
        rects = rects[: self.max_elements]

        if len(rects) < 6:
            features = {"spacing_score": 80.0, "gap_count": 0, "grid_alignment_ratio": 1.0,
                        "margin_std": 0.0, "outlier_ratio_01": 0.0}
            return [], features

        # --- Compute gaps ---
        h_gaps: list[float] = []
        v_gaps: list[float] = []

        # Horizontal: group by Y band
        band_h = max(1, h // 30)
        rects_sorted_y = sorted(rects, key=lambda r: (r[1] // band_h, r[0]))
        for band_idx in range(0, (h // band_h) + 1):
            row = [r for r in rects_sorted_y if (r[1] // band_h) == band_idx]
            row.sort(key=lambda r: r[0])
            for a, b in zip(row, row[1:]):
                gap = b[0] - (a[0] + a[2])
                if 2 <= gap <= 200:
                    h_gaps.append(float(gap))

        # Vertical: group by X band
        band_w = max(1, w // 20)
        rects_sorted_x = sorted(rects, key=lambda r: (r[0] // band_w, r[1]))
        for band_idx in range(0, (w // band_w) + 1):
            col = [r for r in rects_sorted_x if (r[0] // band_w) == band_idx]
            col.sort(key=lambda r: r[1])
            for a, b in zip(col, col[1:]):
                gap = b[1] - (a[1] + a[3])
                if 2 <= gap <= 200:
                    v_gaps.append(float(gap))

        all_gaps = np.array(h_gaps + v_gaps, dtype=np.float64)
        if len(all_gaps) < 5:
            features = {"spacing_score": 75.0, "gap_count": len(all_gaps),
                        "grid_alignment_ratio": 1.0, "margin_std": 0.0, "outlier_ratio_01": 0.0}
            return [], features

        # --- Grid alignment score ---
        deviations = np.array([abs(g - _nearest_4pt(g)) for g in all_gaps])
        aligned_mask = deviations <= 2.0  # within 2px of a 4pt value
        grid_alignment_ratio = float(np.mean(aligned_mask))
        mean_deviation = float(np.mean(deviations))

        # --- Margin consistency ---
        left_margins = [r[0] for r in rects if r[0] < w * 0.3]
        right_margins = [w - (r[0] + r[2]) for r in rects if (r[0] + r[2]) > w * 0.7]
        margin_std = 0.0
        if len(left_margins) >= 3:
            margin_std += float(np.std(left_margins))
        if len(right_margins) >= 3:
            margin_std += float(np.std(right_margins))
        margin_std /= 2.0

        # --- KDE modes ---
        gap_modes = _kde_modes(all_gaps, bw=3.0)
        modes_on_grid = sum(1 for m in gap_modes if abs(m - _nearest_4pt(m)) <= 2.0)
        mode_grid_ratio = modes_on_grid / max(1, len(gap_modes))

        # --- Outlier detection ---
        outlier_threshold = 3.0  # px from nearest 4pt
        outlier_count = int(np.sum(deviations >= outlier_threshold))
        outlier_ratio = outlier_count / max(1, len(all_gaps))

        # --- Final score ---
        # Weighted combination: alignment (0.5) + margin consistency (0.25) + mode grid (0.25)
        alignment_component = grid_alignment_ratio  # 0-1
        margin_component = max(0.0, 1.0 - margin_std / 30.0)  # margin_std > 30 = bad
        mode_component = mode_grid_ratio  # 0-1

        spacing_score = (0.50 * alignment_component + 0.25 * margin_component + 0.25 * mode_component) * 100.0
        spacing_score = round(max(0.0, min(100.0, spacing_score)), 1)

        features = {
            "spacing_score": spacing_score,
            "gap_count": len(all_gaps),
            "grid_alignment_ratio": round(grid_alignment_ratio, 3),
            "mean_deviation_px": round(mean_deviation, 2),
            "margin_std_px": round(margin_std, 2),
            "gap_modes": [round(m, 1) for m in gap_modes[:8]],
            "mode_grid_ratio": round(mode_grid_ratio, 3),
            "outlier_ratio_01": round(outlier_ratio, 3),
            "outlier_count": outlier_count,
            "total_gaps": len(all_gaps),
        }

        # --- Issues ---
        issues: list[Issue] = []

        if outlier_ratio > 0.15:
            # Collect worst outlier bboxes
            gap_data = []
            for g_val, dev in zip(all_gaps, deviations):
                if dev >= outlier_threshold:
                    gap_data.append({"gap_px": round(float(g_val), 1),
                                     "nearest_4pt": round(_nearest_4pt(float(g_val)), 0),
                                     "diff_px": round(float(dev), 1)})
            gap_data.sort(key=lambda d: d["diff_px"], reverse=True)

            issue_id = hashlib.sha1(f"{ctx.filename}:{self.dimension}:gridOutliers".encode()).hexdigest()[:10]
            sev = "high" if outlier_ratio > 0.35 else "medium"
            issues.append(
                Issue(
                    id=f"{self.dimension}-{issue_id}",
                    dimension=self.dimension,
                    severity=sev,
                    title=f"Grid outliers: {outlier_count}/{len(all_gaps)} gaps deviate from 4pt grid",
                    evidence={
                        "outlier_ratio": round(outlier_ratio, 3),
                        "worst_gaps": gap_data[:10],
                        "gap_modes": features["gap_modes"],
                    },
                    suggestion=f"Align spacing to 4pt grid multiples (4/8/12/16/24/32px). Mean deviation: {mean_deviation:.1f}px.",
                    bboxes=[],
                )
            )

        if margin_std > 15.0:
            issue_id = hashlib.sha1(f"{ctx.filename}:{self.dimension}:marginInconsistent".encode()).hexdigest()[:10]
            issues.append(
                Issue(
                    id=f"{self.dimension}-{issue_id}",
                    dimension=self.dimension,
                    severity="medium" if margin_std > 25 else "low",
                    title=f"Inconsistent page margins (std={margin_std:.1f}px)",
                    evidence={"margin_std_px": round(margin_std, 2),
                              "left_margin_count": len(left_margins),
                              "right_margin_count": len(right_margins)},
                    suggestion="Unify left/right page margins to a single consistent value.",
                    bboxes=[],
                )
            )

        return issues, features