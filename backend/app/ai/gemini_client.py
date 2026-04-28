from __future__ import annotations

import json
import os
from dataclasses import dataclass

import httpx

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"


@dataclass(frozen=True)
class GeminiConfig:
    api_key: str
    model: str = "gemini-2.0-flash"


class GeminiClient:
    def __init__(self, config: GeminiConfig):
        self.config = config

    @staticmethod
    def from_env() -> "GeminiClient":
        api_key = os.getenv("GOOGLE_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("Missing env var GOOGLE_API_KEY")
        model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash").strip()
        return GeminiClient(GeminiConfig(api_key=api_key, model=model))

    async def generate_json(
        self,
        *,
        system: str,
        user_text: str,
        image_data_url: str | None = None,
        max_tokens: int = 2000,
    ) -> dict:
        parts: list[dict] = []

        # Attach image first if provided
        if image_data_url and "," in image_data_url:
            header, b64data = image_data_url.split(",", 1)
            mime = "image/jpeg"
            if ":" in header and ";" in header:
                mime = header.split(":")[1].split(";")[0]
            parts.append({"inline_data": {"mime_type": mime, "data": b64data}})

        parts.append({"text": user_text})

        url = f"{GEMINI_BASE}/{self.config.model}:generateContent?key={self.config.api_key}"
        payload = {
            "system_instruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "maxOutputTokens": max_tokens,
                "temperature": 0.2,
            },
        }

        async with httpx.AsyncClient(timeout=90) as client:
            r = await client.post(url, json=payload)
            r.raise_for_status()
            data = r.json()

        text = data["candidates"][0]["content"]["parts"][0]["text"]
        return json.loads(text)
