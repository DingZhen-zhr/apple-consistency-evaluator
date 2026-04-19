"""
ColorConsistency Analyzer

Theory:
  - Apple HIG: consistent color token usage
  - Tractinsky et al. (2000): aesthetics-usability relationship

Algorithm:
  1. K-means(k=8) in Lab color space
  2. palette_compactness = mean intra-cluster delta-E
  3. semantic_gap = weighted inter-cluster delta-E
  4. near_pair_penalty for delta-E <= 10 pairs
  5. color_score = sigmoid(semantic_gap / compactness) * (1 - near_penalty)
"""

from __future__ import annotations

import hashlib
import math

import cv2
import numpy as np
from sklearn.cluster import KMeans

from app.analyzers.base import Analyzer, AnalyzerContext
from app.models import BBox, Issue


def _rgb_to_hex(rgb: np.ndarray) -> str:
    r, g, b = [int(x) for x in rgb.tolist()]
    return f"#{r:02X}{g:02X}{b:02X}"


def _cie76_delta_e(lab1: np.ndarray, lab2: np.ndarray) -> float:
    return float(np.linalg.norm(lab1.astype(np.float64) - lab2.astype(np.float64)))


def _sigmoid_map(x: float, midpoint: float = 3.0, steepness: float = 1.2) -> float:
    return 1.0 / (1.0 + math.exp(-steepness * (x - midpoint)))


class ColorConsistencyAnalyzer(Analyzer):
    dimension = "ColorConsistency"

    def __init__(
        self,
        sample_pixels: int = 40000,
        k: int = 8,
        near_duplicate_delta_e: float = 10.0,
        min_cluster_proportion: float = 0.015,
    ) -> None:
        self.sample_pixels = sample_pixels
        self.k = k
        self.near_duplicate_delta_e = near_duplicate_delta_e
        self.min_cluster_proportion = min_cluster_proportion

    def analyze(self, ctx: AnalyzerContext) -> tuple[list[Issue], dict]:
        img = ctx.image_rgb
        h, w = img.shape[:2]

        pixels = img.reshape(-1, 3)
        rng = np.random.default_rng(42)
        if pixels.shape[0] > self.sample_pixels:
            idx = rng.choice(pixels.shape[0], self.sample_pixels, replace=False)
            sample_rgb = pixels[idx]
        else:
            sample_rgb = pixels

        sample_bgr = sample_rgb[:, ::-1].reshape(-1, 1, 3).astype(np.uint8)
        sample_lab = cv2.cvtColor(sample_bgr, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float64)

        approx_unique = int(np.unique(sample_rgb[:: max(1, sample_rgb.shape[0] // 15000)], axis=0).shape[0])
        k = max(2, min(self.k, approx_unique))

        km = KMeans(n_clusters=k, n_init="auto", random_state=42, max_iter=300)
        labels = km.fit_predict(sample_lab)
        centers_lab = km.cluster_centers_

        counts = np.bincount(labels, minlength=k).astype(np.float64)
        proportions = counts / max(1.0, counts.sum())

        centers_lab_u8 = np.clip(centers_lab, 0, 255).astype(np.uint8).reshape(-1, 1, 3)
        centers_bgr = cv2.cvtColor(centers_lab_u8, cv2.COLOR_LAB2BGR).reshape(-1, 3)
        centers_rgb = centers_bgr[:, ::-1]

        # palette_compactness
        intra_de_sum = 0.0
        valid_count = 0
        for ci in range(k):
            if proportions[ci] < self.min_cluster_proportion:
                continue
            mask = labels == ci
            cluster_pixels = sample_lab[mask]
            dists = np.linalg.norm(cluster_pixels - centers_lab[ci], axis=1)
            intra_de_sum += float(np.mean(dists))
            valid_count += 1
        palette_compactness = intra_de_sum / max(1, valid_count)

        # semantic_gap
        sig_clusters = [i for i in range(k) if proportions[i] >= self.min_cluster_proportion]
        inter_de_sum = 0.0
        inter_weight = 0.0
        for ii, i in enumerate(sig_clusters):
            for j in sig_clusters[ii + 1:]:
                de = _cie76_delta_e(centers_lab[i], centers_lab[j])
                w_ij = proportions[i] * proportions[j]
                inter_de_sum += de * w_ij
                inter_weight += w_ij
        semantic_gap = inter_de_sum / max(1e-9, inter_weight)

        # near-duplicate pairs
        near_pairs: list[tuple[int, int, float]] = []
        for ii, i in enumerate(sig_clusters):
            for j in sig_clusters[ii + 1:]:
                de = _cie76_delta_e(centers_lab[i], centers_lab[j])
                if de <= self.near_duplicate_delta_e:
                    near_pairs.append((i, j, de))

        # final score
        ratio = semantic_gap / max(1.0, palette_compactness)
        base_score = _sigmoid_map(ratio, midpoint=3.5, steepness=1.0)
        near_penalty = min(1.0, len(near_pairs) * 0.12)
        color_score = max(0.0, base_score * (1.0 - near_penalty)) * 100.0
        color_score = round(min(100.0, color_score), 1)

        palette = [
            {"rgb": centers_rgb[i].tolist(), "hex": _rgb_to_hex(centers_rgb[i]),
             "proportion": round(float(proportions[i]), 4)}
            for i in range(k)
            if proportions[i] >= self.min_cluster_proportion
        ]

        features = {
            "color_score": color_score,
            "palette_compactness": round(palette_compactness, 2),
            "semantic_gap": round(semantic_gap, 2),
            "ratio": round(ratio, 2),
            "near_color_pairs": len(near_pairs),
            "significant_clusters": len(sig_clusters),
            "palette": palette,
        }

        issues: list[Issue] = []
        if near_pairs:
            pairs_evidence = [
                {
                    "a": {"hex": _rgb_to_hex(centers_rgb[i]), "p": round(float(proportions[i]), 3)},
                    "b": {"hex": _rgb_to_hex(centers_rgb[j]), "p": round(float(proportions[j]), 3)},
                    "deltaE": round(de, 2),
                }
                for i, j, de in sorted(near_pairs, key=lambda t: t[2])
            ]
            issue_id = hashlib.sha1(f"{ctx.filename}:{self.dimension}:nearPalette".encode()).hexdigest()[:10]
            sev = "high" if len(near_pairs) >= 4 else ("medium" if len(near_pairs) >= 2 else "low")
            issues.append(
                Issue(
                    id=f"{self.dimension}-{issue_id}",
                    dimension=self.dimension,
                    severity=sev,
                    title=f"Detected {len(near_pairs)} near-duplicate color pairs (deltaE <= {self.near_duplicate_delta_e})",
                    evidence={"near_pairs": pairs_evidence, "palette": palette},
                    suggestion="Merge near-duplicate colors into unified design tokens.",
                    bboxes=[BBox(x=0, y=0, w=w, h=h)],
                )
            )

        if palette_compactness > 18.0:
            issue_id = hashlib.sha1(f"{ctx.filename}:{self.dimension}:highCompact".encode()).hexdigest()[:10]
            issues.append(
                Issue(
                    id=f"{self.dimension}-{issue_id}",
                    dimension=self.dimension,
                    severity="medium" if palette_compactness > 25 else "low",
                    title="High intra-cluster variance in color palette",
                    evidence={"palette_compactness": round(palette_compactness, 2)},
                    suggestion="Reduce color micro-variations within semantic regions.",
                    bboxes=[BBox(x=0, y=0, w=w, h=h)],
                )
            )

        return issues, features