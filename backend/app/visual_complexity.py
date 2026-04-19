"""
Visual Complexity Analyzer (Clarity axis)

Theory:
  - Sha et al. (2025), MDPI Electronics 14(5):942
    gamma = 0.014*X1 + 0.003*X2 + 0.071*X3 + 0.278*X4 - 0.090
  - Apple HIG "Clarity" principle: interfaces should be visually clean
  - Miniukovich & De Angeli (2014): visual complexity quantification

Variables:
  X1 = icon count (compact contours, area 16-2500px^2, aspect ratio ~1)
  X2 = text element count (morphology-based text blob detection)
  X3 = image region count (large non-icon non-text areas)
  X4 = RGB entropy (H(R) + H(G) + H(B), each channel 256 bins)

Output:
  raw_gamma: raw complexity value from the formula
  complexity_01: normalized 0-1 (higher = more complex)
  clarity_score: (1 - complexity_01) * 100 for the X-axis
"""

from __future__ import annotations

import cv2
import numpy as np

from app.analyzers.base import Analyzer, AnalyzerContext
from app.models import Issue


def _channel_entropy(channel: np.ndarray) -> float:
    """Shannon entropy of a single-channel image (256 bins)."""
    hist = cv2.calcHist([channel], [0], None, [256], [0, 256]).flatten()
    hist = hist / max(1.0, hist.sum())
    hist = hist[hist > 0]
    return float(-np.sum(hist * np.log2(hist)))


class VisualComplexityAnalyzer(Analyzer):
    """
    Computes visual complexity gamma and derived clarity score.
    Returns (issues, features) where features contains clarity_score for X-axis.
    """

    dimension = "VisualComplexity"

    def analyze(self, ctx: AnalyzerContext) -> tuple[list[Issue], dict]:
        rgb = ctx.image_rgb
        h, w = rgb.shape[:2]
        total_pixels = h * w
        bgr = rgb[:, :, ::-1]
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

        # --- X1: Icon count ---
        blur = cv2.GaussianBlur(gray, (3, 3), 0)
        edges = cv2.Canny(blur, 50, 150)
        # close small gaps
        kernel_close = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel_close)

        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        icon_count = 0
        for c in contours:
            x, y, cw, ch = cv2.boundingRect(c)
            area = cw * ch
            if area < 16 or area > 2500:
                continue
            ar = cw / max(1, ch)
            if 0.5 <= ar <= 2.0:  # roughly square = icon-like
                icon_count += 1

        # --- X2: Text element count ---
        kernel_morph = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
        blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel_morph)
        tophat = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, kernel_morph)
        text_map = cv2.add(blackhat, tophat)
        _, text_bin = cv2.threshold(text_map, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        text_bin = cv2.morphologyEx(text_bin, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))

        num_labels, _, stats, _ = cv2.connectedComponentsWithStats(text_bin, connectivity=8)
        text_count = 0
        for i in range(1, num_labels):
            bx, by, bw, bh, area = stats[i].tolist()
            if area < 20 or area > total_pixels * 0.02:
                continue
            if bh < 6 or bh > h * 0.12:
                continue
            ar = bw / max(1, bh)
            if ar < 0.3 or ar > 30:
                continue
            text_count += 1

        # --- X3: Image region count ---
        # Large regions that are neither icon-sized nor text-like
        blur2 = cv2.GaussianBlur(gray, (7, 7), 0)
        edges2 = cv2.Canny(blur2, 30, 100)
        kernel_big = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
        closed2 = cv2.morphologyEx(edges2, cv2.MORPH_CLOSE, kernel_big, iterations=2)
        contours2, _ = cv2.findContours(closed2, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        image_count = 0
        for c in contours2:
            area = cv2.contourArea(c)
            if area < 2500 or area > total_pixels * 0.5:
                continue
            x, y, cw, ch = cv2.boundingRect(c)
            # Image regions are larger and not extremely elongated
            if cw > 30 and ch > 30:
                image_count += 1

        # --- X4: RGB entropy ---
        r_entropy = _channel_entropy(rgb[:, :, 0])
        g_entropy = _channel_entropy(rgb[:, :, 1])
        b_entropy = _channel_entropy(rgb[:, :, 2])
        rgb_entropy = r_entropy + g_entropy + b_entropy
        # Normalize: max possible = 8*3 = 24, typical range 12-22
        rgb_entropy_norm = rgb_entropy / 24.0

        # --- Gamma formula (Sha et al. 2025, adapted with log-scaling) ---
        # Raw counts on phone screenshots are very large (100+ icons, 200+ text blobs),
        # so we use log(1 + count) to compress the dynamic range as the original
        # formula was calibrated for web pages with much fewer elements.
        import math
        log_icon = math.log(1 + icon_count)
        log_text = math.log(1 + text_count)
        log_image = math.log(1 + image_count)

        raw_gamma = 0.014 * log_icon + 0.003 * log_text + 0.071 * log_image + 0.278 * rgb_entropy_norm - 0.090

        # Normalize gamma to 0-1 range
        # With log-scaled counts, typical range is:
        #   Clean Apple UI: gamma ~ 0.15-0.30
        #   Complex/cluttered UI: gamma ~ 0.35-0.55
        gamma_min, gamma_max = 0.10, 0.55
        complexity_01 = max(0.0, min(1.0, (raw_gamma - gamma_min) / (gamma_max - gamma_min)))

        # Clarity score for X-axis: higher = cleaner
        clarity_score = round((1.0 - complexity_01) * 100.0, 1)

        features = {
            "clarity_score": clarity_score,
            "raw_gamma": round(raw_gamma, 4),
            "complexity_01": round(complexity_01, 4),
            "icon_count": icon_count,
            "text_count": text_count,
            "image_count": image_count,
            "rgb_entropy": round(rgb_entropy, 3),
            "rgb_entropy_norm": round(rgb_entropy_norm, 4),
            "r_entropy": round(r_entropy, 3),
            "g_entropy": round(g_entropy, 3),
            "b_entropy": round(b_entropy, 3),
        }

        # Issues
        issues: list[Issue] = []
        if complexity_01 > 0.65:
            issues.append(
                Issue(
                    id=f"{self.dimension}-high",
                    dimension=self.dimension,
                    severity="high" if complexity_01 > 0.8 else "medium",
                    title=f"High visual complexity (gamma={raw_gamma:.3f}, clarity={clarity_score})",
                    evidence=features,
                    suggestion="Reduce visual elements: consolidate icons, simplify color palette, increase white space.",
                    bboxes=[],
                )
            )

        return issues, features