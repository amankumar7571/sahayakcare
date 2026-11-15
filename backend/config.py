"""SahayakCare backend — settings.

All configuration comes from environment variables. The only secret is
JWT_SECRET_KEY: in production it MUST be set to a long random value
(e.g. `python -c "import secrets; print(secrets.token_urlsafe(32))"`).

There is NO built-in default secret: starting the app without
JWT_SECRET_KEY (and without the explicit local-dev opt-in
SAHAYAKCARE_ALLOW_DEV_SECRET=1) raises immediately, so a deployed
service can never silently issue tokens with a publicly known secret.
Local development: either set JWT_SECRET_KEY in .env, or export
SAHAYAKCARE_ALLOW_DEV_SECRET=1 (a random secret is generated per
process in that case — tokens do not survive a restart).
"""
import logging
import os
import secrets
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

logger = logging.getLogger(__name__)


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning(
            "Invalid integer for %s=%r — falling back to %d.", name, raw, default
        )
        return default


class Settings:
    def __init__(self) -> None:
        self.database_url = os.getenv(
            "DATABASE_URL", f"sqlite:///{BASE_DIR / 'sahayakcare.db'}"
        )
        secret = os.getenv("JWT_SECRET_KEY")
        if not secret:
            if os.getenv("SAHAYAKCARE_ALLOW_DEV_SECRET") == "1":
                secret = secrets.token_urlsafe(32)
                logger.warning(
                    "JWT_SECRET_KEY is not set — using a random per-process "
                    "secret (local dev only; tokens do not survive a restart)."
                )
            else:
                raise RuntimeError(
                    "JWT_SECRET_KEY is not set. Set it to a long random value "
                    "(or export SAHAYAKCARE_ALLOW_DEV_SECRET=1 for local "
                    "development only)."
                )
        if len(secret) < 16:
            raise RuntimeError(
                "JWT_SECRET_KEY must be at least 16 characters long."
            )
        self.jwt_secret_key = secret
        self.jwt_algorithm = os.getenv("JWT_ALGORITHM", "HS256")
        self.access_token_expire_minutes = _int_env(
            "ACCESS_TOKEN_EXPIRE_MINUTES", 60 * 24 * 7  # 7 days
        )
        raw_origins = os.getenv("CORS_ALLOW_ORIGINS", "*")
        self.cors_allow_origins = (
            ["*"] if raw_origins.strip() == "*" else _split_csv(raw_origins)
        )
        self.port = _int_env("PORT", 8000)
        # Production mode (Render sets SAHAYAKCARE_ENV=production): API
        # docs are disabled and auth rate limiting is on. Local dev and
        # tests run with both off.
        self.is_production = os.getenv("SAHAYAKCARE_ENV") == "production"
        self.rate_limit_enabled = self.is_production

    @property
    def using_dev_secret(self) -> bool:
        return os.getenv("SAHAYAKCARE_ALLOW_DEV_SECRET") == "1" and not os.getenv(
            "JWT_SECRET_KEY"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
