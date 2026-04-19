"""
Typography Consistency Analyzer

Theory:
  - Apple HIG: limited type scale (Caption2/Caption1/Footnote/Body/Title3/Title2/Title1/LargeTitle)
  - Modular scale principle: adjacent tiers should have ratio ~1.1-1.3

Algorithm:
  1. Dual morphology: tophat (light-on-dark) + blackhat (dark-on-light)
  2. Adaptive thresholding + connected components
  3. Filter text blobs by aspect ratio, fill ratio, area
  4. KDE on blob heights to find tier peaks
  5. Compare tiers against Apple type scale reference
  6. Check adjacent tier ratios for modular scale harmony
  7. typo_score = f(tier_count_penalty, scale_harmony, apple_match)
"""

from __future__ import annotations

import hashlib

import cv2
import numpy as np

from app.analyzers.base import Analyzer, AnalyzerContext
from app.models import BBox, Issue

# Apple SF type scale at @3x (typical iPhone retina), approximate px heights
# Derived from Apple HIG: https://developer.apple.com/design/human-interface-guidelines/typography
_APPLE_SCALE_PX = np.array([11, 12, 13, 15, 16, 17, 20, 22, 28, 34], dtype=np.float64)


def _kde_peaks(heights: np.ndarray, bw: float = 1.5) -> list[int]:
    """Find peak heights using simple KDE."""
    if len(heights) == 0:
        return []
    lo, hi = int(np.min(heights)), int(np.max(heights))
    if hi - lo < 2:
        return [int(np.median(heights))]
    x = np.arange(lo, hi + 1, dtype=np.float64)
    density = np.zeros_like(x)
    for h in heights:
        density += np.exp(-0.5 * ((x - h) / bw) ** 2)
    peaks = []
    for i in range(1, len(density) - 1):
        if density[i] > density[i - 1] and density[i] >= density[i + 1] and density[i] > len(heights) * 0.02:
            peaks.append(int(x[i]))
    if not peaks and len(density) > 0:
        peaks.append(int(x[int(np.argmax(density))]))
    return peaks


class TypographyConsistencyAnalyzer(Analyzer):
    dimension = "TypographyConsistency"

    def __init__(
        self,
        min_blob_area: int = 30,
        max_blob_area_ratio: float = 0.025,
        min_height: int = 7,
        max_height_ratio: float = 0.15,
        max_reasonable_tiers: int = 6,
    ) -> None:
        self.min_blob_area = min_blob_area
        self.max_blob_area_ratio = max_blob_area_ratio
        self.min_height = min_height
        self.max_height_ratio = max_height_ratio
        self.max_reasonable_tiers = max_reasonable_tiers

    def analyze(self, ctx: AnalyzerContext) -> tuple[list[Issue], dict]:
        rgb = ctx.image_rgb
        h, w = rgb.shape[:2]
        bgr = rgb[:, :, ::-1]
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

        # Dual morphology to capture both dark-on-light and light-on-dark text
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (11, 11))
        blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)
        tophat = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, kernel)
        combined = cv2.add(blackhat, tophat)
        combined = cv2.GaussianBlur(combined, (3, 3), 0)

        _, th = cv2.threshold(combined, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        th = cv2.morphologyEx(th, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8), iterations=1)

        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(th, connectivity=8)
        if num_labels <= 1:
            features = {"typo_score": 80.0, "tier_count": 0, "tiers_px": [],
                        "scale_harmony": 1.0, "apple_match_ratio": 1.0}
            return [], features

        max_blob_area = int(h * w * self.max_blob_area_ratio)
        max_h = int(h * self.max_height_ratio)

        heights_all: list[int] = []
        for i in range(1, num_labels):
            bx, by, bw, bh, area = stats[i].tolist()
            if area < self.min_blob_area or area > max_blob_area:
                continue
            if bh < self.min_height or bh > max_h:
                continue
            if bw <= 2 or bh <= 2:
                continue
            # Aspect ratio filter (text blobs are wider than tall or roughly square)
            ar = bw / max(1, bh)
            if ar < 0.2 or ar > 25:
                continue
            # Fill ratio filter
            fill = area / max(1, bw * bh)
            if fill < 0.04 or fill > 0.70:
                continue
            heights_all.append(bh)

        if len(heights_all) < 15:
            features = {"typo_score": 75.0, "tier_count": 0, "tiers_px": [],
                        "scale_harmony": 1.0, "apple_match_ratio": 1.0}
            return [], features

        heights_arr = np.array(heights_all, dtype=np.float64)
        tiers = _kde_peaks(heights_arr, bw=1.5)
        tiers.sort()
        tier_count = len(tiers)

        # --- Scale harmony: check adjacent tier ratios ---
        ratios = []
        for i in range(1, len(tiers)):
            if tiers[i - 1] > 0:
                ratios.append(tiers[i] / tiers[i - 1])
        # Good ratio range: 1.05-1.45 (modular scale)
        if ratios:
            good_ratios = sum(1 for r in ratios if 1.05 <= r <= 1.45)
            scale_harmony = good_ratios / len(ratios)
        else:
            scale_harmony = 1.0

        # --- Apple scale matching ---
        if tiers:
            matched = 0
            for t in tiers:
                min_dist = float(np.min(np.abs(_APPLE_SCALE_PX - t)))
                if min_dist <= 2.0:  # within 2px of an Apple tier
                    matched += 1
            apple_match_ratio = matched / len(tiers)
        else:
            apple_match_ratio = 1.0

        # --- Final score ---
        # Tier count penalty: ideal 3-6 tiers, penalize >6
        if tier_count <= self.max_reasonable_tiers:
            tier_penalty = 0.0
        else:
            tier_penalty = min(1.0, (tier_count - self.max_reasonable_tiers) * 0.12)

        typo_score = (1.0 - tier_penalty * 0.4) * (0.4 + 0.3 * scale_harmony + 0.3 * apple_match_ratio) * 100.0
        typo_score = round(max(0.0, min(100.0, typo_score)), 1)

        features = {
            "typo_score": typo_score,
            "tier_count": tier_count,
            "tiers_px": tiers[:15],
            "scale_harmony": round(scale_harmony, 3),
            "apple_match_ratio": round(apple_match_ratio, 3),
            "tier_ratios": [round(r, 3) for r in ratios[:10]],
            "blob_count": len(heights_all),
        }

        # --- Issues ---
        issues: list[Issue] = []
        if tier_count > self.max_reasonable_tiers:
            issue_id = hashlib.sha1(f"{ctx.filename}:{self.dimension}:tooManyTiers".encode()).hexdigest()[:10]
            issues.append(
                Issue(
                    id=f"{self.dimension}-{issue_id}",
                    dimension=self.dimension,
                    severity="high" if tier_count > 10 else "medium",
                    title=f"Too many type size tiers detected: {tier_count} (recommended <= {self.max_reasonable_tiers})",
                    evidence={"tiers_px": tiers[:15], "tier_count": tier_count},
                    suggestion="Consolidate to 3-5 type tiers (e.g., Title/Body/Caption) using a modular scale.",
                    bboxes=[],
                )
            )

        if scale_harmony < 0.5 and len(ratios) >= 2:
            issue_id = hashlib.sha1(f"{ctx.filename}:{self.dimension}:badScale".encode()).hexdigest()[:10]
            issues.append(
                Issue(
                    id=f"{self.dimension}-{issue_id}",
                    dimension=self.dimension,
                    severity="medium",
                    title=f"Poor scale harmony: {scale_harmony:.0%} of tier ratios in ideal range",
                    evidence={"tier_ratios": [round(r, 3) for r in ratios], "scale_harmony": round(scale_harmony, 3)},
                    suggestion="Use a modular scale (ratio ~1.15-1.3) between adjacent type tiers.",
                    bboxes=[],
                )
            )

        return issues, features