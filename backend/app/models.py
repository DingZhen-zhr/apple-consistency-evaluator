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


class SubMetric(BaseModel):
    """单个子指标的完整可追溯记录：原始值、公式、归一化分数与解释。"""
    key: str
    raw_value: float
    unit: str = ""
    normalized_score: float = Field(ge=0, le=100)
    formula: str = ""
    interpretation: str = ""


class DimensionScore(BaseModel):
    dimension: str
    score: float = Field(ge=0, le=100)
    summary: str
    judgment: str = ""
    evidence: list[str] = Field(default_factory=list)
    suggestion: str = ""
    metrics: list[SubMetric] = Field(default_factory=list)


class DetectionSummary(BaseModel):
    """检测元数据，用于计算置信度与可追溯性。"""
    image_width: int = 0
    image_height: int = 0
    detected_icons: int = 0
    detected_text_elements: int = 0
    detected_image_regions: int = 0
    color_clusters: int = 0
    corner_components: int = 0


class AnalysisResult(BaseModel):
    principle: str = "Apple Consistency"
    overall_score: float = Field(ge=0, le=100)
    clarity_score: float = Field(ge=0, le=100, default=50.0)
    consistency_score: float = Field(ge=0, le=100, default=50.0)
    confidence: Literal["low", "medium", "high"] = "medium"
    detection_summary: DetectionSummary = Field(default_factory=DetectionSummary)
    dimension_scores: list[DimensionScore]
    issues: list[Issue]
    overall_summary: str = ""
    priority_improvements: list[str] = Field(default_factory=list)
    meta: dict = Field(default_factory=dict)