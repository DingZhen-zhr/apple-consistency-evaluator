"""
Batch analysis script.
Scans all images in photos/ directory, runs analyzers, and outputs
reference data for the scatter chart.

Usage:
    cd backend
    python batch_analyze.py

Output:
    ../frontend/reference-data.json
"""

from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

import cv2
import numpy as np

# Add parent to path so app modules can be imported
sys.path.insert(0, str(Path(__file__).parent))

from app.analyzers.base import AnalyzerContext
from app.analyzers.color_consistency import ColorConsistencyAnalyzer
from app.analyzers.component_style import ComponentStyleConsistencyAnalyzer
from app.analyzers.spacing_grid import SpacingGridConsistencyAnalyzer
from app.analyzers.typography import TypographyConsistencyAnalyzer
from app.visual_complexity import VisualComplexityAnalyzer
from app.scoring import score_from_features


PHOTOS_DIR = Path(__file__).parent / "photos"
OUTPUT_PATH = Path(__file__).parent.parent / "frontend" / "reference-data.json"

# Brand detection from filename
_BRAND_PATTERNS = {
    "apple": re.compile(r"^(apple|IMG_\d+)", re.IGNORECASE),
    "google": re.compile(r"^google", re.IGNORECASE),
    "huawei": re.compile(r"^huawei", re.IGNORECASE),
    "honor": re.compile(r"^honor", re.IGNORECASE),
    "oppo": re.compile(r"^oppo", re.IGNORECASE),
    "samsung": re.compile(r"^samsung", re.IGNORECASE),
    "vivo": re.compile(r"^vivo", re.IGNORECASE),
    "xiaomi": re.compile(r"^xiaomi", re.IGNORECASE),
}


def detect_brand(filename: str) -> str:
    for brand, pattern in _BRAND_PATTERNS.items():
        if pattern.match(filename):
            return brand
    return "unknown"


def load_image(path: Path) -> np.ndarray | None:
    data = path.read_bytes()
    arr = np.frombuffer(data, dtype=np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        return None
    return bgr[:, :, ::-1].copy()  # BGR -> RGB


def main():
    if not PHOTOS_DIR.exists():
        print(f"Photos directory not found: {PHOTOS_DIR}")
        sys.exit(1)

    extensions = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
    image_files = sorted(
        p for p in PHOTOS_DIR.iterdir()
        if p.suffix.lower() in extensions
    )
    print(f"Found {len(image_files)} images in {PHOTOS_DIR}")

    analyzers = [
        ColorConsistencyAnalyzer(),
        SpacingGridConsistencyAnalyzer(),
        TypographyConsistencyAnalyzer(),
        ComponentStyleConsistencyAnalyzer(),
    ]
    clarity_analyzer = VisualComplexityAnalyzer()

    results = []
    for i, img_path in enumerate(image_files):
        fname = img_path.name
        brand = detect_brand(fname)
        print(f"  [{i+1}/{len(image_files)}] {fname} (brand={brand}) ...", end=" ", flush=True)

        t0 = time.time()
        rgb = load_image(img_path)
        if rgb is None:
            print("SKIP (cannot decode)")
            continue

        h, w = rgb.shape[:2]
        ctx = AnalyzerContext(image_rgb=rgb, width=w, height=h, filename=fname)

        features: dict = {}
        issue_count = 0
        try:
            for a in analyzers:
                issues_a, feats_a = a.analyze(ctx)
                features.update(feats_a)
                issue_count += len(issues_a)

            issues_c, feats_c = clarity_analyzer.analyze(ctx)
            features.update(feats_c)
            issue_count += len(issues_c)
        except Exception as e:
            print(f"ERROR: {e}")
            continue

        axis = score_from_features(features)
        elapsed = time.time() - t0

        entry = {
            "filename": fname,
            "brand": brand,
            "clarity_score": axis["clarity_score"],
            "consistency_score": axis["consistency_score"],
            "color_score": axis["color_score"],
            "spacing_score": axis["spacing_score"],
            "corner_score": axis["corner_score"],
            "typo_score": axis["typo_score"],
            "issue_count": issue_count,
            "width": w,
            "height": h,
            "elapsed_ms": int(elapsed * 1000),
        }
        results.append(entry)
        print(f"clarity={axis['clarity_score']:.1f} consistency={axis['consistency_score']:.1f} ({elapsed:.1f}s)")

    # Write output
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(results, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\nWrote {len(results)} entries to {OUTPUT_PATH}")

    # Summary by brand
    by_brand: dict[str, list[dict]] = {}
    for r in results:
        by_brand.setdefault(r["brand"], []).append(r)

    print("\n=== Brand Summary ===")
    for brand in sorted(by_brand):
        entries = by_brand[brand]
        avg_x = sum(e["clarity_score"] for e in entries) / len(entries)
        avg_y = sum(e["consistency_score"] for e in entries) / len(entries)
        print(f"  {brand:10s}: n={len(entries):2d}  avg_clarity={avg_x:.1f}  avg_consistency={avg_y:.1f}")


if __name__ == "__main__":
    main()