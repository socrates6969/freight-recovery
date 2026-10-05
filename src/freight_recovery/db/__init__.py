"""Persistence: SQLAlchemy 2.x models, a tenant-scoped repository, Alembic migrations.

SQLite is the zero-setup default for local runs and tests; PostgreSQL (RDS) is the
production target. The same models and migrations run on both.
"""

from .base import Base
from .repository import AnalysisRepository, TenantAdminRepository
from .session import build_engine, build_sessionmaker, session_scope

__all__ = [
    "AnalysisRepository",
    "Base",
    "TenantAdminRepository",
    "build_engine",
    "build_sessionmaker",
    "session_scope",
]
