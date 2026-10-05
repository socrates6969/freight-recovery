"""Shared test helpers/fixtures."""

from __future__ import annotations

from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


def load_dir(name: str) -> list[tuple[str, bytes]]:
    """Read every fixture file in ``tests/fixtures/<name>`` as (filename, bytes)."""
    return [(p.name, p.read_bytes()) for p in sorted((FIXTURES / name).iterdir())]


@pytest.fixture
def ld5001() -> list[tuple[str, bytes]]:
    """Shipper-side scenario: overbilled linehaul + detention + unauthorized lumper."""
    return load_dir("ld5001")


@pytest.fixture
def ld5002() -> list[tuple[str, bytes]]:
    """Carrier-side scenario (CSV inputs): detention earned but never billed."""
    return load_dir("ld5002")
