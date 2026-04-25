"""
Scoring module - computes axis scores and dimension scores.

Dual-axis system:
  X-axis (Clarity): (1 - visual_complexity_01) * 100
  Y-axis (Consistency): weighted combination of 5 consistency analyzers
    0.25 * color_score + 0.25 * spacing_score + 0.20 * corner_score
    + 0.15 * typo_score  + 0.15 * rhythm_score

Grade thresholds (overall_score = avg of Clarity + Consistency):
  S ≥85 | A ≥70 | B ≥55 | C ≥40 | D < 40
"""

from __future__ import annotations
from typing import Literal

from app.models import DimensionScore, DetectionSummary, Issue, SubMetric


_CONSISTENCY_WEIGHTS = {
    "ColorConsistency": 0.25,
    "SpacingAndGridConsistency": 0.25,
    "ComponentStyleConsistency": 0.20,
    "TypographyConsistency": 0.15,
    "VisualRhythm": 0.15,
}


def score_from_features(features: dict) -> dict:
    """
    Compute axis scores directly from analyzer features (continuous values).
    Returns dict with clarity_score (X), consistency_score (Y), and per-dimension scores.
    """
    clarity_score = features.get("clarity_score", 70.0)

    color_score = features.get("color_score", 70.0)
    spacing_score = features.get("spacing_score", 70.0)
    corner_score = features.get("corner_score", 70.0)
    typo_score = features.get("typo_score", 70.0)
    rhythm_score = features.get("rhythm_score", 70.0)

    consistency_score = (
        0.25 * color_score +
        0.25 * spacing_score +
        0.20 * corner_score +
        0.15 * typo_score +
        0.15 * rhythm_score
    )
    consistency_score = round(max(0.0, min(100.0, consistency_score)), 1)

    return {
        "clarity_score": round(clarity_score, 1),
        "consistency_score": consistency_score,
        "color_score": round(color_score, 1),
        "spacing_score": round(spacing_score, 1),
        "corner_score": round(corner_score, 1),
        "typo_score": round(typo_score, 1),
        "rhythm_score": round(rhythm_score, 1),
    }


def score_dimensions(*, issues: list[Issue], expected_dimensions: list[str],
                     features: dict | None = None) -> list[DimensionScore]:
    _feature_keys = {
        "ColorConsistency": "color_score",
        "SpacingAndGridConsistency": "spacing_score",
        "ComponentStyleConsistency": "corner_score",
        "TypographyConsistency": "typo_score",
        "VisualComplexity": "clarity_score",
    }

    by_dim: dict[str, list[Issue]] = {}
    for it in issues:
        by_dim.setdefault(it.dimension, []).append(it)

    dim_scores: list[DimensionScore] = []
    for dim in expected_dimensions:
        dim_issues = by_dim.get(dim, [])

        if features and dim in _feature_keys:
            score = features.get(_feature_keys[dim], 70.0)
        else:
            penalty = 0.0
            for it in dim_issues:
                penalty += {"low": 4, "medium": 10, "high": 18}[it.severity]
            score = max(0.0, 100.0 - penalty)

        dim_scores.append(
            DimensionScore(
                dimension=dim,
                score=round(score, 1),
                summary=f"{len(dim_issues)} issues",
            )
        )

    return dim_scores


def score_overall(dim_scores: list[DimensionScore]) -> float:
    if not dim_scores:
        return 100.0
    return round(sum(d.score for d in dim_scores) / len(dim_scores), 1)


# ─────────────────────────────────────────────────────────────────────────────
# 维度名称中文映射
# ─────────────────────────────────────────────────────────────────────────────

_DIM_NAME_CN = {
    "ColorConsistency": "色彩一致性",
    "SpacingAndGridConsistency": "间距与网格一致性",
    "ComponentStyleConsistency": "组件样式一致性",
    "TypographyConsistency": "字体排版一致性",
    "VisualComplexity": "视觉清晰度",
    "VisualRhythm": "视觉律动感",
    "CrossScreenConsistency": "跨屏一致性",
}


def _dim_cn(dim: str) -> str:
    return _DIM_NAME_CN.get(dim, dim)


# ─────────────────────────────────────────────────────────────────────────────
# 子指标规格定义：(key, unit, formula, lo, hi, higher_is_better)
# ─────────────────────────────────────────────────────────────────────────────

_SUBMETRIC_SPEC: dict[str, list[dict]] = {
    "VisualComplexity": [
        {"key": "icon_count", "unit": "个", "lo": 0, "hi": 150, "hib": False,
         "formula": "Canny边缘+轮廓过滤（面积16–2500px²，宽高比0.5–2.0）",
         "interp_hi": "图标数量多，视觉元素密集", "interp_lo": "图标数量少，界面简洁"},
        {"key": "text_count", "unit": "块", "lo": 0, "hi": 400, "hib": False,
         "formula": "形态学Blackhat+Tophat → 连通域 → 文本块筛选",
         "interp_hi": "文本元素密集，信息量大", "interp_lo": "文本元素稀疏，阅读负担低"},
        {"key": "image_count", "unit": "块", "lo": 0, "hi": 30, "hib": False,
         "formula": "Canny闭运算 → 大轮廓过滤（面积>2500px²）",
         "interp_hi": "图片区块多，视觉复杂度高", "interp_lo": "图片区块少，视觉负担轻"},
        {"key": "rgb_entropy", "unit": "比特", "lo": 10, "hi": 24, "hib": False,
         "formula": "H(R)+H(G)+H(B)，各通道256bin直方图香农熵",
         "interp_hi": "色彩分布复杂，视觉噪声高", "interp_lo": "色彩分布集中，视觉克制"},
        {"key": "raw_gamma", "unit": "无量纲", "lo": 0.10, "hi": 0.55, "hib": False,
         "formula": "γ=0.014·ln(1+X₁)+0.003·ln(1+X₂)+0.071·ln(1+X₃)+0.278·X₄−0.090 (Sha 2025)",
         "interp_hi": "综合复杂度高，清晰度低", "interp_lo": "综合复杂度低，清晰度高"},
    ],
    "ColorConsistency": [
        {"key": "semantic_gap", "unit": "ΔE", "lo": 0, "hi": 80, "hib": True,
         "formula": "跨聚类加权平均CIE76色差（K=8，Lab空间K-means）",
         "interp_hi": "颜色语义对比强，层级清晰", "interp_lo": "颜色语义区分弱，层级模糊"},
        {"key": "palette_compactness", "unit": "ΔE", "lo": 0, "hi": 30, "hib": False,
         "formula": "每聚类内像素到中心的平均CIE76距离",
         "interp_hi": "色板内部分散，颜色噪声大", "interp_lo": "色板内部紧凑，用色精准"},
        {"key": "ratio", "unit": "无量纲", "lo": 0, "hi": 8, "hib": True,
         "formula": "semantic_gap / palette_compactness（越大越好）",
         "interp_hi": "语义对比/内聚比高，色彩层级好", "interp_lo": "语义对比/内聚比低，色彩层级弱"},
        {"key": "near_color_pairs", "unit": "对", "lo": 0, "hi": 8, "hib": False,
         "formula": "色差ΔE≤10的色板配对数",
         "interp_hi": "存在近似色对，视觉混淆风险高", "interp_lo": "无近似色对，色彩辨识度高"},
    ],
    "SpacingAndGridConsistency": [
        {"key": "grid_alignment_ratio", "unit": "比例", "lo": 0, "hi": 1, "hib": True,
         "formula": "对齐到4pt网格的间距数 / 总间距数",
         "interp_hi": "间距与4pt网格高度吻合", "interp_lo": "间距偏离4pt网格，排列不规则"},
        {"key": "mean_deviation_px", "unit": "px", "lo": 0, "hi": 20, "hib": False,
         "formula": "每个间距到最近4pt倍数的平均偏差（px）",
         "interp_hi": "平均偏差大，网格对齐差", "interp_lo": "平均偏差小，网格对齐好"},
        {"key": "margin_std_px", "unit": "px", "lo": 0, "hi": 30, "hib": False,
         "formula": "左右页边距的标准差（页面边缘一致性）",
         "interp_hi": "页边距不一致，布局浮动", "interp_lo": "页边距一致，布局稳定"},
        {"key": "mode_grid_ratio", "unit": "比例", "lo": 0, "hi": 1, "hib": True,
         "formula": "主导间距模式对齐到最近4pt倍数的吻合度",
         "interp_hi": "主间距模式符合网格", "interp_lo": "主间距模式不符合网格"},
    ],
    "TypographyConsistency": [
        {"key": "scale_harmony", "unit": "比例", "lo": 0, "hi": 1, "hib": True,
         "formula": "相邻字号层级比落在[1.1, 1.3]区间的比例",
         "interp_hi": "字号比例协调，模块化排版", "interp_lo": "字号比例不协调，跳跃感强"},
        {"key": "apple_match_ratio", "unit": "比例", "lo": 0, "hi": 1, "hib": True,
         "formula": "检测到的字号层级与Apple SF字型系统匹配的比例",
         "interp_hi": "与Apple字型规范高度吻合", "interp_lo": "偏离Apple字型规范"},
        {"key": "tier_count", "unit": "层", "lo": 1, "hi": 8, "hib": None,
         "formula": "KDE峰值检测出的文本高度层数（理想值3–5层）",
         "interp_hi": "字号层级过多，字型系统过复杂", "interp_lo": "字号层级过少，层次感弱"},
    ],
    "ComponentStyleConsistency": [
        {"key": "radius_cv", "unit": "无量纲", "lo": 0, "hi": 1, "hib": False,
         "formula": "所有组件圆角半径的变异系数 CV=std/mean",
         "interp_hi": "圆角半径差异大，组件风格不统一", "interp_lo": "圆角半径一致，组件风格统一"},
        {"key": "apple_dist_px", "unit": "px", "lo": 0, "hi": 8, "hib": False,
         "formula": "主要圆角半径到最近Apple标准值{0,4,6,8,10,12,14,16,20,24}的距离",
         "interp_hi": "圆角偏离Apple HIG标准较大", "interp_lo": "圆角接近Apple HIG标准"},
        {"key": "outlier_ratio_01", "unit": "比例", "lo": 0, "hi": 1, "hib": False,
         "formula": "圆角偏离模式值超过阈值的组件占比",
         "interp_hi": "不规则圆角比例高，风格不稳定", "interp_lo": "不规则圆角比例低，风格稳定"},
        {"key": "radius_mean", "unit": "px", "lo": 0, "hi": 30, "hib": None,
         "formula": "所有检测组件圆角半径的均值（仅供参考）",
         "interp_hi": "大圆角，偏向圆润风格", "interp_lo": "小圆角，偏向方正风格"},
    ],
    "VisualRhythm": [
        {"key": "hog_entropy", "unit": "bit", "lo": 1.5, "hi": 4.17, "hib": False,
         "formula": "Sobel梯度方向分布香农熵 H = -Σpᵢlog₂(pᵢ)，18-bin HOG，取强度前35%像素",
         "interp_hi": "边缘方向散乱，非正交元素多，布局律动感弱",
         "interp_lo": "边缘集中于水平/垂直方向，网格正交感强"},
        {"key": "anisotropy_score", "unit": "分", "lo": 0, "hi": 100, "hib": True,
         "formula": "anisotropy_score = (1 - hog_entropy / log₂18) × 100",
         "interp_hi": "视觉方向高度规整，排版律动感强",
         "interp_lo": "视觉方向分散，排版缺乏方向引导"},
        {"key": "grouping_compactness", "unit": "比例", "lo": 0.1, "hi": 0.8, "hib": True,
         "formula": "形态学闭运算连通域内有效像素数 / 外接矩形面积（均值）",
         "interp_hi": "信息块内部元素紧凑，分组感强",
         "interp_lo": "信息块内部稀疏，分组感弱"},
        {"key": "group_separation", "unit": "比例", "lo": 0.0, "hi": 1.0, "hib": True,
         "formula": "连通域质心间最小距离均值归一化（对角线3%–20%区间映射到0–1）",
         "interp_hi": "不同信息区块之间分离清晰",
         "interp_lo": "信息区块间距过密，视觉粘连风险"},
    ],
}


# ─────────────────────────────────────────────────────────────────────────────
# 评级系统（Grade）
# ─────────────────────────────────────────────────────────────────────────────

def compute_grade(overall_score: float) -> str:
    """
    借鉴视觉律动同类系统的评级思路，将综合分映射到 S/A/B/C/D 五档：
      S（≥85）：优秀，高度符合 Apple HIG 一致性规范
      A（≥70）：良好，整体表现不错，有少量改进空间
      B（≥55）：中等，存在明显一致性问题，建议针对性优化
      C（≥40）：待改进，多维度不足，需系统性整改
      D（<40） ：较差，一致性问题严重
    """
    if overall_score >= 85:
        return "S"
    elif overall_score >= 70:
        return "A"
    elif overall_score >= 55:
        return "B"
    elif overall_score >= 40:
        return "C"
    else:
        return "D"


def _normalize_sub(raw: float, lo: float, hi: float, hib) -> float:
    """将原始值归一化到0–100。hib=True时越高越好，False时越低越好，None为信息字段返50。"""
    if hib is None:
        return 50.0
    span = hi - lo
    if span <= 0:
        return 50.0
    ratio = max(0.0, min(1.0, (raw - lo) / span))
    if hib:
        return round(ratio * 100.0, 1)
    else:
        return round((1.0 - ratio) * 100.0, 1)


def _gen_sub_metrics(dim: str, features: dict) -> list[SubMetric]:
    specs = _SUBMETRIC_SPEC.get(dim, [])
    result = []
    for sp in specs:
        key = sp["key"]
        if key not in features:
            continue
        raw = float(features[key])
        norm = _normalize_sub(raw, sp["lo"], sp["hi"], sp["hib"])
        hib = sp["hib"]
        if hib is True:
            interp = sp["interp_hi"] if raw >= (sp["lo"] + sp["hi"]) / 2 else sp["interp_lo"]
        elif hib is False:
            interp = sp["interp_hi"] if raw >= (sp["lo"] + sp["hi"]) / 2 else sp["interp_lo"]
        else:
            interp = sp["interp_lo"] if raw < 3 else sp["interp_hi"]
        result.append(SubMetric(
            key=key,
            raw_value=round(raw, 3),
            unit=sp["unit"],
            normalized_score=norm,
            formula=sp["formula"],
            interpretation=interp,
        ))
    return result


def _gen_judgment(dim: str, score: float, features: dict) -> str:
    name = _dim_cn(dim)
    if score >= 80:
        level = "优秀"
        note = "符合Apple设计规范，一致性良好"
    elif score >= 60:
        level = "中等"
        note = "部分指标有改进空间"
    else:
        level = "不足"
        note = "存在明显问题，建议优先修复"
    return f"{name}得分{score:.0f}分，整体表现{level}：{note}。"


def _gen_evidence_list(dim: str, score: float, features: dict) -> list[str]:
    evs = []
    if dim == "VisualComplexity":
        evs.append(f"视觉复杂度γ={features.get('raw_gamma', 0):.4f}，"
                   f"对应clarity={features.get('clarity_score', 0):.1f}分")
        evs.append(f"检测到图标{features.get('icon_count', 0)}个、"
                   f"文本块{features.get('text_count', 0)}块、"
                   f"图片区域{features.get('image_count', 0)}块")
        evs.append(f"RGB熵={features.get('rgb_entropy', 0):.2f}比特（越低视觉越简洁）")
    elif dim == "ColorConsistency":
        evs.append(f"跨聚类色差(semantic_gap)={features.get('semantic_gap', 0):.1f}ΔE，"
                   f"聚类内紧凑度(compactness)={features.get('palette_compactness', 0):.1f}ΔE")
        evs.append(f"色彩层级比(ratio)={features.get('ratio', 0):.2f}，"
                   f"近似色对={features.get('near_color_pairs', 0)}对")
        evs.append(f"有效色彩聚类数={features.get('significant_clusters', 0)}")
    elif dim == "SpacingAndGridConsistency":
        evs.append(f"4pt网格对齐率={features.get('grid_alignment_ratio', 0):.1%}，"
                   f"平均偏差={features.get('mean_deviation_px', 0):.1f}px")
        evs.append(f"页边距标准差={features.get('margin_std_px', 0):.1f}px，"
                   f"检测间距={features.get('total_gaps', features.get('gap_count', 0))}个")
        modes = features.get('gap_modes', [])
        if modes:
            evs.append(f"主要间距模式：{', '.join(f'{m:.0f}px' for m in modes[:4])}")
    elif dim == "TypographyConsistency":
        evs.append(f"检测到{features.get('tier_count', 0)}层字号层级，"
                   f"模块化比例={features.get('scale_harmony', 0):.1%}")
        evs.append(f"Apple字型匹配率={features.get('apple_match_ratio', 0):.1%}")
        tiers = features.get('tiers_px', [])
        if tiers:
            evs.append(f"字号层级(px)：{tiers[:6]}")
    elif dim == "ComponentStyleConsistency":
        evs.append(f"圆角变异系数CV={features.get('radius_cv', 0):.3f}，"
                   f"均值={features.get('radius_mean', 0):.1f}px")
        evs.append(f"Apple标准距离={features.get('apple_dist_px', 0):.1f}px，"
                   f"不规则占比={features.get('outlier_ratio_01', 0):.1%}")
        match = features.get('apple_modal_match', False)
        evs.append(f"主要圆角{'匹配' if match else '不匹配'}Apple HIG标准集合")
    return evs


def _gen_suggestion_text(dim: str, score: float, features: dict) -> str:
    if score >= 80:
        return "当前指标良好，保持现有设计规范即可。"
    if dim == "VisualComplexity":
        gamma = features.get('raw_gamma', 0.3)
        if gamma > 0.40:
            return f"视觉复杂度γ={gamma:.3f}偏高，建议减少图标数量至50以内、合并相似色彩、增加留白以降低RGB熵。"
        return "适当减少UI元素密度，提高视觉呼吸感。"
    if dim == "ColorConsistency":
        pairs = features.get('near_color_pairs', 0)
        if pairs > 0:
            return f"存在{pairs}对近似色（ΔE≤10），建议合并为统一的设计令牌，并将semantic_gap提升至30ΔE以上。"
        return "增大跨层级颜色差异（semantic_gap目标>30ΔE），减少颜色噪声。"
    if dim == "SpacingAndGridConsistency":
        ratio = features.get('grid_alignment_ratio', 0)
        dev = features.get('mean_deviation_px', 0)
        return f"4pt网格对齐率仅{ratio:.0%}，平均偏差{dev:.1f}px，建议所有间距对齐到4/8/12/16/24/32px。"
    if dim == "TypographyConsistency":
        tiers = features.get('tier_count', 0)
        harmony = features.get('scale_harmony', 0)
        if tiers > 6:
            return f"检测到{tiers}层字号，建议合并至3–5层（如Title/Body/Caption），相邻层比控制在1.1–1.3之间。"
        return f"字号层级比和谐度{harmony:.0%}，建议采用模块化字型比例（1.125或1.25倍）。"
    if dim == "ComponentStyleConsistency":
        cv = features.get('radius_cv', 0)
        mean = features.get('radius_mean', 0)
        return f"圆角CV={cv:.2f}过高，建议统一圆角半径为{mean:.0f}px附近的Apple标准值（如8/12/16px）。"
    return "请参考问题列表中的具体改进建议。"


def enrich_dim_scores(dim_scores: list[DimensionScore], features: dict) -> list[DimensionScore]:
    """为每个 DimensionScore 补充 judgment、evidence、suggestion 和 sub-metrics。"""
    enriched = []
    for ds in dim_scores:
        metrics = _gen_sub_metrics(ds.dimension, features)
        judgment = _gen_judgment(ds.dimension, ds.score, features)
        evidence = _gen_evidence_list(ds.dimension, ds.score, features)
        suggestion = _gen_suggestion_text(ds.dimension, ds.score, features)
        enriched.append(DimensionScore(
            dimension=ds.dimension,
            score=ds.score,
            summary=ds.summary,
            judgment=judgment,
            evidence=evidence,
            suggestion=suggestion,
            metrics=metrics,
        ))
    return enriched


def generate_overall_summary(
    clarity_score: float,
    consistency_score: float,
    dim_scores: list[DimensionScore],
) -> str:
    overall = (clarity_score + consistency_score) / 2
    level = "较强" if overall >= 75 else ("中等" if overall >= 55 else "较弱")
    sorted_dims = sorted(dim_scores, key=lambda d: d.score, reverse=True)
    best = " / ".join(_dim_cn(d.dimension) for d in sorted_dims[:2])
    worst = _dim_cn(sorted_dims[-1].dimension) if sorted_dims else "—"
    return (
        f"当前界面整体一致性处于{level}水平"
        f"（Clarity={clarity_score:.1f}，Consistency={consistency_score:.1f}）。"
        f"表现较好的维度为：{best}；"
        f"当前最主要的短板维度为：{worst}，建议优先改进。"
    )


def generate_priority_improvements(dim_scores: list[DimensionScore]) -> list[str]:
    """从得分最低的维度中提取最多3条不重复的优先改进建议。"""
    sorted_by_score = sorted(dim_scores, key=lambda d: d.score)
    improvements = []
    seen: set[str] = set()
    for ds in sorted_by_score:
        if ds.suggestion and ds.suggestion not in seen and "良好" not in ds.suggestion:
            improvements.append(f"【{_dim_cn(ds.dimension)}】{ds.suggestion}")
            seen.add(ds.suggestion)
        if len(improvements) >= 3:
            break
    return improvements


def compute_confidence(features: dict) -> Literal["low", "medium", "high"]:
    """根据检测到的元素数量评估分析置信度。"""
    icons = features.get("icon_count", 0)
    texts = features.get("text_count", 0)
    corners = features.get("sample_count", 0)
    gaps = features.get("total_gaps", features.get("gap_count", 0))
    total = icons + texts + corners + gaps
    if total >= 80:
        return "high"
    elif total >= 25:
        return "medium"
    else:
        return "low"