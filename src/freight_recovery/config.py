"""Runtime configuration from environment variables (no secrets required for the MVP)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class Settings:
    """Settings with safe offline defaults."""

    extraction_provider: str = "stub"
    detention_increment_minutes: int = 15
    amount_tolerance: Decimal = Decimal("0.01")
    dispute_window_days: int = 90  # TODO: make carrier/contract specific

    @classmethod
    def from_env(cls) -> "Settings":
        """Build settings from ``FR_*`` environment variables."""
        return cls(
            extraction_provider=os.getenv("FR_EXTRACTION_PROVIDER", "stub"),
            detention_increment_minutes=int(os.getenv("FR_DETENTION_INCREMENT_MINUTES", "15")),
        )
