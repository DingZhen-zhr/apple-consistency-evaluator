import os


class Settings:
    """
    Optional LLM settings. The tool works without LLM by default.
    """

    LLM_API_KEY: str | None = os.getenv("LLM_API_KEY")
    LLM_BASE_URL: str | None = os.getenv("LLM_BASE_URL")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "gpt-4o")

    ENABLE_LLM: bool = os.getenv("ENABLE_LLM", "0") in ("1", "true", "True")


settings = Settings()

