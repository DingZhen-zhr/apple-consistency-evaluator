from __future__ import annotations

from pydantic import BaseModel, Field


class AiExplainRequest(BaseModel):
    principle: str = "Apple Consistency"
    goal: str = Field(default="Evaluate consistency and provide actionable improvements")
    # Frontend result.json payload (heuristics). Keep as dict for forward compatibility.
    result: dict
    # Optional: a (downscaled) image data URL for extra context in logs/UI (we do not rely on it).
    image_data_url: str | None = None


class AiExplainResponse(BaseModel):
    ok: bool = True
    markdown: str
    data: dict = Field(default_factory=dict)

