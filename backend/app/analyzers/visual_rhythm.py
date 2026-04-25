"""
VisualRhythmAnalyzer — HOG方向熵 × 形态学分组致密度

理论依据
--------
1. 视觉各向异性（Visual Anisotropy）：排版精良的移动端界面边缘方向高度集中于
   水平（0°）与垂直（90°）正交轴，对应清晰的文字行与卡片边界；散乱的非正交元素
   会破坏界面律动感，增加扫视成本。
   参考：Miniukovich & De Angeli, "Computation of Interface Aesthetics", CHI 2014；
         "Eye of the Beholder: Towards Measuring Visualization Complexity", arXiv 2025

2. 视觉分组致密度（Visual Grouping Compactness）：基于格式塔"接近法则"，
   同一信息块内部元素应紧凑、不同块之间应有足够留白。
   通过形态学闭运算提取连通域，衡量组内紧凑 × 组间分离。
   参考：Rosenholtz et al., "Measuring Visual Clutter", Journal of Vision, 2007

算法输出
--------
rhythm_score : float  0–100  越高越好（低熵+高致密度）
hog_entropy  : float  HOG方向分布香农熵（比特），越低越规整
compactness  : float  形态学分组内部致密度（归一化0–1），越高越好
group_separation : float  组间距离归一化值（0–1），越高组间越清晰
"""

from __future__ import annotations

import hashlib
import math

import cv2
import numpy as np

from app.analyzers.base import Analyzer, AnalyzerContext
from app.models import BBox, Issue

# HOG bin数量（0°–180°均分）
_N_BINS = 18
_IDEAL_BINS = {0, 1, 17}  # 接近0°/90°/180°的bin索引（正交方向）


def _compute_hog_entropy(gray: np.ndarray) -> tuple[float, np.ndarray]:
    """
    用Sobel算子计算像素梯度方向直方图，再用香农熵衡量方向分散度。

    返回 (entropy, histogram_normalized)
    """
    gx = cv2.Sobel(gray.astype(np.float32), cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray.astype(np.float32), cv2.CV_32F, 0, 1, ksize=3)
    mag = np.sqrt(gx ** 2 + gy ** 2)
    angle = np.arctan2(np.abs(gy), np.abs(gx)) * 180.0 / math.pi  # 0–90°, then fold to 0–180

    # 只保留幅值较强的像素（避免噪声主导）
    mag_threshold = float(np.percentile(mag, 65))
    mask = mag > max(mag_threshold, 1.0)

    if mask.sum() < 100:
        return 0.0, np.ones(_N_BINS) / _N_BINS

    angles_masked = angle[mask]  # 0–90°
    # 折叠到0–180°（将90°以上镜像），实际上 arctan2(|gy|,|gx|) 已在0–90°
    # 扩展：将0–90°映射到0–180°（等比） so that horizontal=0°, vertical=90°
    angles_full = angles_masked * 2.0  # 0–180°

    hist, _ = np.histogram(angles_full, bins=_N_BINS, range=(0, 180))
    hist = hist.astype(np.float64)
    total = hist.sum()
    if total == 0:
        return 0.0, np.ones(_N_BINS) / _N_BINS

    p = hist / total
    # 香农熵（以2为底，最大值 = log2(18) ≈ 4.17）
    nonzero = p[p > 0]
    entropy = float(-np.sum(nonzero * np.log2(nonzero)))
    return entropy, p


def _compute_grouping_compactness(gray: np.ndarray) -> tuple[float, float, int]:
    """
    形态学闭运算提取连通域，计算：
    - 平均组内致密度 D_i = 有效像素数 / 外接矩形面积
    - 归一化组间最小距离（越大分组越清晰）

    返回 (compactness_mean, separation_score, n_groups)
    """
    h, w = gray.shape[:2]

    # Canny提取边缘
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 40, 120)

    # 形态学闭运算：先膨胀后腐蚀，将邻近元素合并为连通域
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)

    # 提取连通域
    num_labels, labels_map, stats, centroids = cv2.connectedComponentsWithStats(
        closed, connectivity=8
    )

    min_area = int(h * w * 0.002)   # 至少占0.2%
    max_area = int(h * w * 0.45)    # 不超过45%（排除全屏背景）

    compactness_list: list[float] = []
    cx_list: list[float] = []
    cy_list: list[float] = []

    for label in range(1, num_labels):  # 0是背景
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < min_area or area > max_area:
            continue
        bx = int(stats[label, cv2.CC_STAT_LEFT])
        by = int(stats[label, cv2.CC_STAT_TOP])
        bw = int(stats[label, cv2.CC_STAT_WIDTH])
        bh_ = int(stats[label, cv2.CC_STAT_HEIGHT])
        bbox_area = bw * bh_
        if bbox_area <= 0:
            continue
        d_i = area / bbox_area
        compactness_list.append(d_i)
        cx_list.append(float(centroids[label][0]))
        cy_list.append(float(centroids[label][1]))

    if not compactness_list:
        return 0.5, 0.5, 0

    compactness_mean = float(np.mean(compactness_list))
    n_groups = len(compactness_list)

    # 组间最小距离（归一化到屏幕对角线）
    diag = math.sqrt(w ** 2 + h ** 2)
    if n_groups >= 2:
        cx_arr = np.array(cx_list)
        cy_arr = np.array(cy_list)
        min_dists: list[float] = []
        for i in range(n_groups):
            dists = np.sqrt((cx_arr - cx_arr[i]) ** 2 + (cy_arr - cy_arr[i]) ** 2)
            dists[i] = np.inf
            min_dists.append(float(np.min(dists)))
        mean_min_dist = float(np.mean(min_dists))
        # 归一化：以屏幕对角线的5%–30%为合理区间
        sep_raw = mean_min_dist / diag
        separation = float(np.clip((sep_raw - 0.03) / (0.20 - 0.03), 0.0, 1.0))
    else:
        separation = 0.5

    return compactness_mean, separation, n_groups


class VisualRhythmAnalyzer(Analyzer):
    """
    第五维一致性分析器：视觉律动感（Visual Rhythm）

    综合评分公式：
        rhythm_score = 0.55 * (1 - hog_entropy / MAX_ENTROPY) * 100
                     + 0.30 * compactness * 100
                     + 0.15 * separation * 100

    高分含义：界面边缘方向集中（正交网格感强）+ 信息块内部紧凑 + 块间分离清晰
    """
    dimension = "VisualRhythm"

    _MAX_ENTROPY = math.log2(_N_BINS)  # ≈ 4.17 比特（完全均匀分布）

    def analyze(self, ctx: AnalyzerContext) -> tuple[list[Issue], dict]:
        rgb = ctx.image_rgb
        bgr = rgb[:, :, ::-1]
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape[:2]

        # ── HOG方向熵 ──────────────────────────────────────────────
        entropy, hist_p = _compute_hog_entropy(gray)
        entropy_norm = float(np.clip(entropy / self._MAX_ENTROPY, 0.0, 1.0))
        anisotropy_score = (1.0 - entropy_norm) * 100.0  # 越低熵越高分

        # ── 形态学分组致密度 ────────────────────────────────────────
        compactness, separation, n_groups = _compute_grouping_compactness(gray)

        # ── 综合律动感评分 ──────────────────────────────────────────
        rhythm_score = float(
            0.55 * anisotropy_score
            + 0.30 * compactness * 100.0
            + 0.15 * separation * 100.0
        )
        rhythm_score = round(max(0.0, min(100.0, rhythm_score)), 1)

        features = {
            "rhythm_score": rhythm_score,
            "hog_entropy": round(entropy, 3),
            "hog_entropy_norm": round(entropy_norm, 3),
            "anisotropy_score": round(anisotropy_score, 1),
            "grouping_compactness": round(compactness, 3),
            "group_separation": round(separation, 3),
            "n_groups": n_groups,
        }

        issues: list[Issue] = []

        # 高熵 → 非正交元素过多，布局律动感弱
        if entropy > 3.2:
            uid = hashlib.md5(f"VisualRhythm_entropy_{ctx.filename}".encode()).hexdigest()[:8]
            issues.append(Issue(
                id=f"vr_{uid}",
                dimension="VisualRhythm",
                severity="medium",
                title="界面边缘方向散乱，网格律动感弱",
                evidence={
                    "hog_entropy": round(entropy, 2),
                    "threshold": 3.2,
                    "interpretation": "边缘方向分布接近均匀，正交感弱",
                },
                suggestion="减少倾斜装饰元素；确保卡片、文字区域对齐到水平/垂直网格轴。",
                bboxes=[],
            ))

        # 低分组致密度 → 组件内部稀疏，分组不明确
        if compactness < 0.25 and n_groups >= 3:
            uid = hashlib.md5(f"VisualRhythm_compact_{ctx.filename}".encode()).hexdigest()[:8]
            issues.append(Issue(
                id=f"vr_{uid}",
                dimension="VisualRhythm",
                severity="low",
                title="信息分组致密度偏低，组件内部稀疏",
                evidence={
                    "grouping_compactness": round(compactness, 3),
                    "n_groups": n_groups,
                    "threshold": 0.25,
                },
                suggestion="收紧同一功能区内部元素间距，增大不同功能区之间的留白。",
                bboxes=[],
            ))

        return issues, features
