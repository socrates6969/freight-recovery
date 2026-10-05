"""Runtime configuration from ``FR_*`` environment variables.

Safe offline defaults: the defaults give a local developer setup (SQLite file,
local-filesystem document storage, API docs disabled, parsing in a sandboxed
worker process). ``FR_ENV=production`` turns on :meth:`Settings.validate_for_production`,
which refuses to start with an insecure combination (see below).

Secret-bearing fields (``database_url``, ``api_key_pepper``) are excluded from
``repr`` so they cannot leak into logs or tracebacks.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from decimal import Decimal

DOCS_MODES = ("off", "auth", "open")
SANDBOX_MODES = ("process", "inprocess")
STORAGE_BACKENDS = ("local", "s3")
ENVIRONMENTS = ("dev", "production")


class ConfigError(ValueError):
    """The configuration is invalid or insecure for the selected environment."""


@dataclass(frozen=True)
class Settings:
    """Settings with safe offline defaults."""

    # --- pipeline (domain) -------------------------------------------------
    extraction_provider: str = "stub"
    detention_increment_minutes: int = 15
    amount_tolerance: Decimal = Decimal("0.01")
    dispute_window_days: int = 90  # TODO: make carrier/contract specific

    # --- platform ----------------------------------------------------------
    environment: str = "dev"  # "dev" | "production"
    # Default is a local SQLite file; production uses PostgreSQL, e.g.
    # postgresql+psycopg://user:pass@host:5432/freight (from Secrets Manager).
    database_url: str = field(default="sqlite:///./freight_recovery.db", repr=False)
    # HMAC pepper applied when hashing API keys. Keep it in Secrets Manager, not in the DB.
    api_key_pepper: str = field(default="", repr=False)
    # "off": /docs and /openapi.json do not exist (404). "auth": served only with a valid
    # API key. "open": anonymous (local development only; refused in production).
    docs_mode: str = "off"

    # --- raw-document storage ---------------------------------------------
    storage_backend: str = "local"  # "local" | "s3"
    storage_local_dir: str = "./var/documents"
    storage_s3_enabled: bool = False  # second, explicit flag: s3 is a stub, off by default
    storage_s3_bucket: str = ""
    storage_s3_prefix: str = ""
    storage_s3_kms_key_id: str = ""

    # --- sandboxed parsing -------------------------------------------------
    sandbox_mode: str = "process"  # "process" (worker subprocess) | "inprocess" (dev/tests)
    sandbox_timeout_seconds: float = 30.0  # hard wall-clock limit per request
    sandbox_memory_mb: int = 1024  # worker memory cap (beyond its start-up footprint)
    sandbox_max_workers: int = 4  # concurrent worker processes
    sandbox_queue_timeout_seconds: float = 10.0  # wait for a free worker slot, then 503

    def __post_init__(self) -> None:
        if not 1 <= self.detention_increment_minutes <= 240:
            raise ValueError("detention_increment_minutes must be between 1 and 240")
        _choice("environment", self.environment, ENVIRONMENTS)
        _choice("docs_mode", self.docs_mode, DOCS_MODES)
        _choice("sandbox_mode", self.sandbox_mode, SANDBOX_MODES)
        _choice("storage_backend", self.storage_backend, STORAGE_BACKENDS)
        if self.sandbox_timeout_seconds <= 0:
            raise ValueError("sandbox_timeout_seconds must be positive")
        if self.sandbox_memory_mb < 64:
            raise ValueError("sandbox_memory_mb must be at least 64")
        if self.sandbox_max_workers < 1:
            raise ValueError("sandbox_max_workers must be at least 1")

    def validate_for_production(self) -> None:
        """Raise :class:`ConfigError` for settings that are unsafe with real data."""
        problems: list[str] = []
        if len(self.api_key_pepper) < 32:
            problems.append("FR_API_KEY_PEPPER must be set (>= 32 characters)")
        if self.docs_mode == "open":
            problems.append("FR_DOCS_MODE=open is not allowed in production")
        if self.sandbox_mode != "process":
            problems.append("FR_SANDBOX_MODE must be 'process' in production")
        if self.database_url.startswith("sqlite"):
            problems.append("FR_DATABASE_URL must point at PostgreSQL in production")
        if problems:
            raise ConfigError("; ".join(problems))

    @classmethod
    def from_env(cls) -> "Settings":
        """Build settings from ``FR_*`` environment variables (invalid values raise ValueError)."""
        env = os.environ.get
        d = cls()  # defaults
        return cls(
            extraction_provider=env("FR_EXTRACTION_PROVIDER", d.extraction_provider),
            detention_increment_minutes=_num(
                "FR_DETENTION_INCREMENT_MINUTES", int, d.detention_increment_minutes, "an integer"
            ),
            environment=env("FR_ENV", d.environment),
            database_url=env("FR_DATABASE_URL", d.database_url),
            api_key_pepper=env("FR_API_KEY_PEPPER", d.api_key_pepper),
            docs_mode=env("FR_DOCS_MODE", d.docs_mode),
            storage_backend=env("FR_STORAGE_BACKEND", d.storage_backend),
            storage_local_dir=env("FR_STORAGE_LOCAL_DIR", d.storage_local_dir),
            storage_s3_enabled=_flag("FR_STORAGE_S3_ENABLED", d.storage_s3_enabled),
            storage_s3_bucket=env("FR_STORAGE_S3_BUCKET", d.storage_s3_bucket),
            storage_s3_prefix=env("FR_STORAGE_S3_PREFIX", d.storage_s3_prefix),
            storage_s3_kms_key_id=env("FR_STORAGE_S3_KMS_KEY_ID", d.storage_s3_kms_key_id),
            sandbox_mode=env("FR_SANDBOX_MODE", d.sandbox_mode),
            sandbox_timeout_seconds=_num(
                "FR_SANDBOX_TIMEOUT_SECONDS", float, d.sandbox_timeout_seconds, "a number"
            ),
            sandbox_memory_mb=_num("FR_SANDBOX_MEMORY_MB", int, d.sandbox_memory_mb, "an integer"),
            sandbox_max_workers=_num(
                "FR_SANDBOX_MAX_WORKERS", int, d.sandbox_max_workers, "an integer"
            ),
            sandbox_queue_timeout_seconds=_num(
                "FR_SANDBOX_QUEUE_TIMEOUT_SECONDS", float, d.sandbox_queue_timeout_seconds, "a number"
            ),
        )


def _choice(name: str, value: str, allowed: tuple[str, ...]) -> None:
    if value not in allowed:
        raise ValueError(f"{name} must be one of {', '.join(allowed)}")


def _num(var: str, cast, default, what: str):
    raw = os.environ.get(var)
    if raw is None:
        return default
    try:
        return cast(raw)
    except ValueError as exc:
        raise ValueError(f"{var} must be {what}") from exc


def _flag(var: str, default: bool) -> bool:
    raw = os.environ.get(var)
    if raw is None:
        return default
    if raw.strip().lower() in {"1", "true", "yes", "on"}:
        return True
    if raw.strip().lower() in {"0", "false", "no", "off", ""}:
        return False
    raise ValueError(f"{var} must be a boolean (true/false)")
