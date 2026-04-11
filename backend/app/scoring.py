from __future__ import annotations

from app.models import DimensionScore, Issue


def score_dimensions(*, issues: list[Issue], expected_dimensions: list[str]) -> list[DimensionScore]:
    # Deterministic baseline scoring: start at 100 and subtract by issue severity.
    by_dim: dict[str, list[Issue]] = {}
    for it in issues:
        by_dim.setdefault(it.dimension, []).append(it)

    dim_scores: list[DimensionScore] = []
    for dim in expected_dimensions:
        dim_issues = by_dim.get(dim, [])
        penalty = 0.0
        for it in dim_issues:
            penalty += {"low": 4, "medium": 10, "high": 18}[it.severity]
        score = max(0.0, 100.0 - penalty)
        dim_scores.append(
            DimensionScore(
                dimension=dim,
                score=round(score, 1),
                summary=f"{len(dim_issues)} 个问题",
            )
        )

    return dim_scores


def score_overall(dim_scores: list[DimensionScore]) -> float:
    if not dim_scores:
        return 100.0
    return round(sum(d.score for d in dim_scores) / len(dim_scores), 1)

