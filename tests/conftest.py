"""Shared test helpers/fixtures.

Environment is configured BEFORE the application is imported so the module-level
``app`` (what uvicorn would serve) points at a throw-away database and storage dir:

* database: a temp SQLite file, or ``FR_TEST_DATABASE_URL`` (CI points this at a
  PostgreSQL service so the whole suite also runs against Postgres);
* sandbox: ``inprocess`` for speed (``FR_TEST_SANDBOX=process`` runs the whole suite
  through real worker subprocesses; dedicated sandbox tests always use real workers).
"""

from __future__ import annotations

import os
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path

import pytest

from tests._support import TEST_API_KEY, TEST_PEPPER, TEST_TENANT_NAME

_TMP = tempfile.TemporaryDirectory(prefix="fr-tests-", ignore_cleanup_errors=True)
DB_URL = os.environ.get("FR_TEST_DATABASE_URL") or f"sqlite:///{Path(_TMP.name, 'test.db').as_posix()}"
os.environ.update(
    {
        "FR_ENV": "dev",
        "FR_DATABASE_URL": DB_URL,
        "FR_API_KEY_PEPPER": TEST_PEPPER,
        "FR_DOCS_MODE": "off",
        "FR_STORAGE_BACKEND": "local",
        "FR_STORAGE_LOCAL_DIR": str(Path(_TMP.name, "documents")),
        "FR_SANDBOX_MODE": os.environ.get("FR_TEST_SANDBOX", "inprocess"),
    }
)

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


# ---- database / tenants ------------------------------------------------------------


@pytest.fixture(scope="session", autouse=True)
def _migrated_database():
    """Create the schema with the real Alembic migrations and provision the default tenant."""
    from freight_recovery.db import TenantAdminRepository, build_engine, build_sessionmaker
    from freight_recovery.db import migrate, session_scope

    engine = build_engine(DB_URL)
    migrate.upgrade(engine)
    factory = build_sessionmaker(engine)
    with session_scope(factory) as s:
        repo = TenantAdminRepository(s)
        tenant = repo.get_tenant_by_name(TEST_TENANT_NAME) or repo.create_tenant(TEST_TENANT_NAME)
        keys = repo.list_api_keys(tenant.id)
        if not keys:
            repo.issue_api_key(tenant.id, TEST_PEPPER, label="tests", raw_key=TEST_API_KEY)
    yield engine
    engine.dispose()


@dataclass(frozen=True)
class TenantInfo:
    """A freshly provisioned tenant and its raw API key."""

    id: str
    name: str
    api_key: str

    @property
    def headers(self) -> dict[str, str]:
        return {"X-API-Key": self.api_key}


@pytest.fixture
def make_tenant(_migrated_database):
    """Factory: provision a new tenant (+ one API key) in the shared test database."""
    from freight_recovery.db import TenantAdminRepository, build_sessionmaker, session_scope

    factory = build_sessionmaker(_migrated_database)

    def _make(prefix: str = "tenant") -> TenantInfo:
        with session_scope(factory) as s:
            repo = TenantAdminRepository(s)
            tenant = repo.create_tenant(f"{prefix}-{uuid.uuid4().hex[:8]}")
            _row, raw = repo.issue_api_key(tenant.id, TEST_PEPPER, label="tests")
            return TenantInfo(id=tenant.id, name=tenant.name, api_key=raw)

    return _make


@pytest.fixture
def db_factory(_migrated_database):
    """A sessionmaker bound to the shared test database."""
    from freight_recovery.db import build_sessionmaker

    return build_sessionmaker(_migrated_database)
