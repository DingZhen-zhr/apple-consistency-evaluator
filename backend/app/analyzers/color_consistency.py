from __future__ import annotations

import hashlib

import cv2
import numpy as np
from sklearn.cluster import KMeans

from app.analyzers.base import Analyzer, AnalyzerContext
from app.models import BBox, Issue


def _rgb_to_hex(rgb: np.ndarray) -> str:
    r, g, b = [int(x) for x in rgb.tolist()]
    return f"#{r:02X}{g:02X}{b:02X}"


def _cie76_delta_e(lab1: np.ndarray, lab2: np.ndarray) -> float:
    return float(np.linalg.norm(lab1.astype(np.float32) - lab2.astype(np.float32)))


class ColorConsistencyAnalyzer(Analyzer):
    dimension = "ColorConsistency"

    def __init__(
        self,
        sample_pixels: int = 30000,
        k: int = 7,
        near_duplicate_delta_e: float = 8.0,
        min_cluster_proportion: float = 0.02,
    ) -> None:
        self.sample_pixels = sample_pixels
        self.k = k
        self.near_duplicate_delta_e = near_duplicate_delta_e
        self.min_cluster_proportion = min_cluster_proportion

    def analyze(self, ctx: AnalyzerContext) -> list[Issue]:
        img = ctx.image_rgb
        h, w = img.shape[:2]

        pixels = img.reshape(-1, 3)
        if pixels.shape[0] > self.sample_pixels:
            idx = np.random.default_rng(42).choice(pixels.shape[0], self.sample_pixels, replace=False)
            sample = pixels[idx]
        else:
            sample = pixels

        # If the image is near-uniform, KMeans will create duplicated centers.
        # Cap K by approximate unique colors in the sample (cheap heuristic).
        approx_unique = int(np.unique(sample[:: max(1, sample.shape[0] // 20000)], axis=0).shape[0])
        k = max(1, min(self.k, approx_unique))
        if k <= 1:
            return []

        km = KMeans(n_clusters=k, n_init="auto", random_state=42)
        labels = km.fit_predict(sample)
        centers = km.cluster_centers_.astype(np.uint8)

        # Estimate cluster proportions (on the sample)
        counts = np.bincount(labels, minlength=k).astype(np.float32)
        proportions = (counts / max(1.0, counts.sum())).tolist()

        # Compare cluster centers in Lab space to find near-duplicates (tiny drift)
        centers_bgr = centers[:, ::-1]  # RGB->BGR for OpenCV
        centers_bgr_img = centers_bgr.reshape(-1, 1, 3)
        centers_lab = cv2.cvtColor(centers_bgr_img, cv2.COLOR_BGR2LAB).reshape(-1, 3)

        near_pairs: list[tuple[int, int, float]] = []
        for i in range(k):
            if proportions[i] < self.min_cluster_proportion:
                continue
            for j in range(i + 1, k):
                if proportions[j] < self.min_cluster_proportion:
                    continue
                de = _cie76_delta_e(centers_lab[i], centers_lab[j])
                if de <= self.near_duplicate_delta_e:
                    near_pairs.append((i, j, de))

        issues: list[Issue] = []
        if near_pairs:
            # If there are near-duplicate palette entries, it often implies inconsistent usage
            # of extremely similar greys/blues etc.
            palette = [
                {"rgb": centers[i].tolist(), "hex": _rgb_to_hex(centers[i]), "p": proportions[i]}
                for i in range(k)
            ]
            pairs = [
                {
                    "a": {"idx": i, "hex": _rgb_to_hex(centers[i]), "p": proportions[i]},
                    "b": {"idx": j, "hex": _rgb_to_hex(centers[j]), "p": proportions[j]},
                    "deltaE": round(de, 2),
                }
                for i, j, de in sorted(near_pairs, key=lambda t: t[2])
            ]

            issue_id = hashlib.sha1(f"{ctx.filename}:{self.dimension}:nearPalette".encode("utf-8")).hexdigest()[:10]
            issues.append(
                Issue(
                    id=f"{self.dimension}-{issue_id}",
                    dimension=self.dimension,
                    severity="medium",
                    title="检测到近似色漂移（调色板中存在非常接近的颜色）",
                    evidence={
                        "palette": palette,
                        "near_pairs": pairs,
                        "min_cluster_proportion": self.min_cluster_proportion,
                        "note": "近似色漂移常导致同类控件在不同位置看起来“不完全一致”。",
                    },
                    suggestion=(
                        "将这些近似色合并为更少的设计 token（例如统一成 1 个文本灰/分割线灰），"
                        "并在同类控件上强制复用同一个颜色值。"
                    ),
                    bboxes=[BBox(x=0, y=0, w=w, h=h)],
                )
            )

        return issues

