from __future__ import annotations

import os
from dataclasses import dataclass

import httpx


@dataclass(frozen=True)
class DeepSeekConfig:
    api_key: str
    base_url: str = "https://api.deepseek.com"
    model: str = "deepseek-chat"


class DeepSeekClient:
    def __init__(self, config: DeepSeekConfig):
        self.config = config

    @staticmethod
    def from_env() -> "DeepSeekClient":
        api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("Missing env var DEEPSEEK_API_KEY")
        base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip()
        model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat").strip()
        return DeepSeekClient(DeepSeekConfig(api_key=api_key, base_url=base_url, model=model))

    async def chat_json(self, *, system: str, user: str, max_tokens: int = 1400) -> dict:
        url = f"{self.config.base_url.rstrip('/')}/chat/completions"
        headers = {"Authorization": f"Bearer {self.config.api_key}", "Content-Type": "application/json"}
        payload = {
            "model": self.config.model,
            "response_format": {"type": "json_object"},
            "temperature": 0.2,
            "max_tokens": max_tokens,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(url, headers=headers, json=payload)
            r.raise_for_status()
            data = r.json()
        content = data["choices"][0]["message"]["content"] or "{}"
        # content is guaranteed valid JSON by response_format (per docs), but keep safe:
        import json

        return json.loads(content)

