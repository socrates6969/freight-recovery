"""Alembic environment.

Connection resolution order:
1. ``config.attributes["connection"]`` - an open connection handed in by
   ``freight_recovery.db.migrate`` (used by tests and the programmatic API);
2. ``FR_DATABASE_URL`` (via Settings) - used by the ``alembic`` CLI and the container's
   ``python -m freight_recovery.db.migrate`` entrypoint.
"""

from __future__ import annotations

from alembic import context
from sqlalchemy import pool

from freight_recovery.config import Settings
from freight_recovery.db import tables  # noqa: F401  (registers the tables on Base.metadata)
from freight_recovery.db.base import Base
from freight_recovery.db.session import build_engine

config = context.config
target_metadata = Base.metadata


def _configure(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        # SQLite cannot ALTER most things in place; batch mode rebuilds the table instead.
        render_as_batch=connection.dialect.name == "sqlite",
    )


def run_migrations_offline() -> None:
    """Emit SQL to stdout without a DB connection (``alembic upgrade head --sql``)."""
    url = Settings.from_env().database_url
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:
        _configure(connection)
        with context.begin_transaction():
            context.run_migrations()
        return
    engine = build_engine(Settings.from_env().database_url)
    with engine.connect() as conn:
        _configure(conn)
        with context.begin_transaction():
            context.run_migrations()
        conn.commit()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
