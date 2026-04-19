from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class BBox(BaseModel):
    x: int
    y: int
    w: int
    h: int


class Issue(BaseModel):
    id: str
    dimension: str
    severity: Literal["low", "medium", "high"]
    title: str
    evidence: dict = Field(default_factory=dict)
    suggestion: str
    bboxes: list[BBox] = Field(default_factory=list)


class DimensionScore(BaseModel):
    dimension: str
    score: float = Field(ge=0, le=100)
    summary: str


class AnalysisResult(BaseModel):
    principle: str = "Apple Consistency"
    overall_score: float = Field(ge=0, le=100)
    clarity_score: float = Field(ge=0, le=100, default=50.0)
    consistency_score: float = Field(ge=0, le=100, default=50.0)
    dimension_scores: list[DimensionScore]
    issues: list[Issue]
    meta: dict = Field(default_factory=dict)