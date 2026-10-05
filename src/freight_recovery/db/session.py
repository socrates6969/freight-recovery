"""Engine / session factories (SQLite for local+tests, PostgreSQL for production)."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool


def build_engine(url: str) -> Engine:
    """Create an engine for ``url`` with backend-appropriate settings."""
    parsed = make_url(url)
    if parsed.get_backend_name() == "sqlite":
        kwargs: dict = {"connect_args": {"check_same_thread": False}}
        if parsed.database in (None, "", ":memory:"):
            kwargs["poolclass"] = StaticPool  # one shared connection so the schema persists
        engine = create_engine(url, **kwargs)

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_conn, _record):  # pragma: no cover - trivial
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")  # SQLite ignores FKs unless asked
            cur.close()

        return engine
    # PostgreSQL etc.: validate pooled connections (RDS failover / idle timeouts).
    return create_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=5)


def build_sessionmaker(engine: Engine) -> sessionmaker[Session]:
    """Session factory. ``expire_on_commit=False`` keeps returned objects readable."""
    return sessionmaker(engine, expire_on_commit=False)


@contextmanager
def session_scope(factory: sessionmaker[Session]) -> Iterator[Session]:
    """Transactional scope: commit on success, roll back on error, always close."""
    session = factory()
    try:
        yield session
        session.commit()
    except BaseException:
        session.rollback()
        raise
    finally:
        session.close()
