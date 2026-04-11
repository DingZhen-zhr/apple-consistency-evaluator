from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.models import Issue


@dataclass(frozen=True)
class AnalyzerContext:
    image_rgb: np.ndarray  # HxWx3 uint8
    width: int
    height: int
    filename: str


class Analyzer:
    dimension: str

    def analyze(self, ctx: AnalyzerContext) -> list[Issue]:
        raise NotImplementedError

