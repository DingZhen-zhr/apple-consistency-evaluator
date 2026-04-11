from __future__ import annotations

import hashlib

import cv2
import numpy as np
from sklearn.cluster import KMeans

from app.models import Issue


def _cie76_delta_e(lab1: np.ndarray, lab2: np.ndarray) -> float:
    return float(np.linalg.norm(lab1.astype(np.float32) - lab2.astype(np.float32)))


def _dominant_color_rgb(image_rgb: np.ndarray) -> np.ndarray:
    pixels = image_rgb.reshape(-1, 3)
    # sample up to 25k pixels deterministically
    if pixels.shape[0] > 25000:
        idx = np.random.default_rng(42).choice(pixels.shape[0], 25000, replace=False)
        sample = pixels[idx]
    else:
        sample = pixels
    approx_unique = int(np.unique(sample[:: max(1, sample.shape[0] // 20000)], axis=0).shape[0])
    k = max(1, min(3, approx_unique))
    if k <= 1:
        return np.median(sample.astype(np.float32), axis=0).astype(np.uint8)

    km = KMeans(n_clusters=k, n_init="auto", random_state=42)
    labels = km.fit_predict(sample)
    centers = km.cluster_centers_.astype(np.uint8)
    counts = np.bincount(labels, minlength=k)
    dom_idx = int(np.argmax(counts))
    return centers[dom_idx]


def _estimate_median_radius(image_rgb: np.ndarray) -> int | None:
    bgr = image_rgb[:, :, ::-1]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 60, 160)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    h, w = gray.shape[:2]
    max_area = int(h * w * 0.22)
    rects = []
    for c in contours:
        x, y, rw, rh = cv2.boundingRect(c)
        area = rw * rh
        if area < 1600 or area > max_area:
            continue
        ar = rw / max(1, rh)
        if ar < 0.25 or ar > 5.0:
            continue
        rects.append((x, y, rw, rh, area))

    rects.sort(key=lambda r: r[4], reverse=True)
    rects = rects[:120]

    def estimate_bg(patch: np.ndarray) -> np.ndarray:
        ph, pw = patch.shape[:2]
        border = np.concatenate(
            [
                patch[0:2, :, :].reshape(-1, 3),
                patch[-2:, :, :].reshape(-1, 3),
                patch[:, 0:2, :].reshape(-1, 3),
                patch[:, -2:, :].reshape(-1, 3),
            ],
            axis=0,
        )
        return np.median(border.astype(np.float32), axis=0).astype(np.uint8)

    def estimate_radius(patch: np.ndarray) -> int | None:
        ph, pw = patch.shape[:2]
        if ph < 18 or pw < 18:
            return None
        bg = estimate_bg(patch).astype(np.int16)
        limit = min(ph, pw, 48)

        def scan(coords):
            for i, (yy, xx) in enumerate(coords, start=1):
                px = patch[yy, xx, :].astype(np.int16)
                if int(np.linalg.norm(px - bg)) > 18:
                    return i
            return None

        tl = scan([(i, i) for i in range(0, limit)])
        tr = scan([(i, (pw - 1) - i) for i in range(0, limit)])
        bl = scan([((ph - 1) - i, i) for i in range(0, limit)])
        br = scan([((ph - 1) - i, (pw - 1) - i) for i in range(0, limit)])
        vals = [v for v in (tl, tr, bl, br) if v is not None]
        if len(vals) < 2:
            return None
        return int(np.median(vals))

    radii = []
    for x, y, rw, rh, _ in rects:
        patch = image_rgb[y : y + rh, x : x + rw, :]
        r = estimate_radius(patch)
        if r is not None:
            radii.append(r)

    if len(radii) < 5:
        return None
    return int(np.median(np.array(radii, dtype=np.int32)))


def cross_screen_issues(*, filenames: list[str], images_rgb: list[np.ndarray]) -> list[Issue]:
    if len(images_rgb) < 2:
        return []

    dom_rgbs = [_dominant_color_rgb(img) for img in images_rgb]
    dom_bgr = np.stack([c[::-1] for c in dom_rgbs], axis=0).reshape(-1, 1, 3)
    dom_lab = cv2.cvtColor(dom_bgr, cv2.COLOR_BGR2LAB).reshape(-1, 3)

    # Color drift across screens
    max_de = 0.0
    max_pair = (0, 1)
    for i in range(len(dom_lab)):
        for j in range(i + 1, len(dom_lab)):
            de = _cie76_delta_e(dom_lab[i], dom_lab[j])
            if de > max_de:
                max_de = de
                max_pair = (i, j)

    issues: list[Issue] = []
    if max_de >= 12.0:
        issue_id = hashlib.sha1(("CrossScreenConsistency:domColor:" + ",".join(filenames)).encode("utf-8")).hexdigest()[:10]
        issues.append(
            Issue(
                id=f"CrossScreenConsistency-{issue_id}",
                dimension="CrossScreenConsistency",
                severity="high" if max_de >= 20 else "medium",
                title="跨页面主色存在明显漂移（同一产品的整体视觉不够统一）",
                evidence={
                    "dominant_colors": [
                        {"file": fn, "rgb": c.tolist(), "hex": f"#{int(c[0]):02X}{int(c[1]):02X}{int(c[2]):02X}"}
                        for fn, c in zip(filenames, dom_rgbs)
                    ],
                    "max_deltaE": round(max_de, 2),
                    "max_pair": [filenames[max_pair[0]], filenames[max_pair[1]]],
                },
                suggestion="统一全局色彩 token（品牌主色/背景/文本/分割线），并确保不同页面复用同一套 token，而不是“看起来差不多”的近似值。",
                bboxes=[],
            )
        )

    # Radius drift across screens
    med_r = [_estimate_median_radius(img) for img in images_rgb]
    valid = [(fn, r) for fn, r in zip(filenames, med_r) if r is not None]
    if len(valid) >= 2:
        rs = [r for _, r in valid]
        r_range = int(max(rs) - min(rs))
        if r_range >= 5:
            issue_id = hashlib.sha1(("CrossScreenConsistency:radius:" + ",".join(filenames)).encode("utf-8")).hexdigest()[:10]
            issues.append(
                Issue(
                    id=f"CrossScreenConsistency-{issue_id}",
                    dimension="CrossScreenConsistency",
                    severity="medium",
                    title="跨页面组件圆角风格不一致（圆角 token 可能未统一）",
                    evidence={
                        "estimated_median_radius_px": [{"file": fn, "median_radius_px": r} for fn, r in valid],
                        "range_px": r_range,
                        "note": "该检测是截图启发式估计：并不保证识别到的全部都是同一类组件。",
                    },
                    suggestion="为按钮/卡片等核心组件统一圆角半径（例如统一为 8/12/16px），并保证所有页面复用同一套组件库样式。",
                    bboxes=[],
                )
            )

    return issues

