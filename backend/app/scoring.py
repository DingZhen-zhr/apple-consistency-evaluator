"""
Scoring module - computes axis scores and dimension scores.

New dual-axis system:
  X-axis (Clarity): (1 - visual_complexity_01) * 100
  Y-axis (Consistency): weighted combination of 4 consistency analyzers
    0.30 * color_score + 0.30 * spacing_score + 0.20 * corner_score + 0.20 * typo_score
"""

from __future__ import annotations

from app.models import DimensionScore, Issue


_CONSISTENCY_WEIGHTS = {
    "ColorConsistency": 0.30,
    "SpacingAndGridConsistency": 0.30,
    "ComponentStyleConsistency": 0.20,
    "TypographyConsistency": 0.20,
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

    consistency_score = (
        0.30 * color_score +
        0.30 * spacing_score +
        0.20 * corner_score +
        0.20 * typo_score
    )
    consistency_score = round(max(0.0, min(100.0, consistency_score)), 1)

    return {
        "clarity_score": round(clarity_score, 1),
        "consistency_score": consistency_score,
        "color_score": round(color_score, 1),
        "spacing_score": round(spacing_score, 1),
        "corner_score": round(corner_score, 1),
        "typo_score": round(typo_score, 1),
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