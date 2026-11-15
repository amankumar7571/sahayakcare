"""SahayakCare backend — settings.

All configuration comes from environment variables. The only secret is
JWT_SECRET_KEY: in production it MUST be set to a long random value
(e.g. `python -c "import secrets; print(secrets.token_urlsafe(32))"`).
The built-in default is for local development only and must never be
used on a deployed service — the app logs a warning if it is in use.
"""
import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

DEV_JWT_SECRET = "dev-only-change-me-in-production-sahayakcare"


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


class Settings:
    def __init__(self) -> None:
        self.database_url = os.getenv(
            "DATABASE_URL", f"sqlite:///{BASE_DIR / 'sahayakcare.db'}"
        )
        self.jwt_secret_key = os.getenv("JWT_SECRET_KEY", DEV_JWT_SECRET)
        self.jwt_algorithm = os.getenv("JWT_ALGORITHM", "HS256")
        self.access_token_expire_minutes = int(
            os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", str(60 * 24 * 7))  # 7 days
        )
        raw_origins = os.getenv("CORS_ALLOW_ORIGINS", "*")
        self.cors_allow_origins = (
            ["*"] if raw_origins.strip() == "*" else _split_csv(raw_origins)
        )
        self.port = int(os.getenv("PORT", "8000"))

    @property
    def using_dev_secret(self) -> bool:
        return self.jwt_secret_key == DEV_JWT_SECRET


@lru_cache
def get_settings() -> Settings:
    return Settings()
