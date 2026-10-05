"""Run Alembic migrations programmatically (no ``alembic.ini`` needed in the container).

    python -m freight_recovery.db.migrate            # upgrade to head using FR_DATABASE_URL
    python -m freight_recovery.db.migrate downgrade 0001

In deployment run this as a one-shot step *before* the new task definition takes
traffic (ECS run-task / pre-deploy job), never from every app instance at start-up.
"""

from __future__ import annotations

import sys
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine

from freight_recovery.config import Settings

from .session import build_engine

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def alembic_config() -> Config:
    """An Alembic ``Config`` pointing at the packaged migrations."""
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    return cfg


def upgrade(engine: Engine, revision: str = "head") -> None:
    """Upgrade ``engine``'s database to ``revision``."""
    with engine.begin() as connection:
        cfg = alembic_config()
        cfg.attributes["connection"] = connection
        command.upgrade(cfg, revision)


def downgrade(engine: Engine, revision: str) -> None:
    """Downgrade ``engine``'s database to ``revision`` (``base`` removes everything)."""
    with engine.begin() as connection:
        cfg = alembic_config()
        cfg.attributes["connection"] = connection
        command.downgrade(cfg, revision)


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    action = args[0] if args else "upgrade"
    engine = build_engine(Settings.from_env().database_url)
    try:
        if action == "upgrade":
            upgrade(engine, args[1] if len(args) > 1 else "head")
        elif action == "downgrade" and len(args) > 1:
            downgrade(engine, args[1])
        else:
            print("usage: python -m freight_recovery.db.migrate [upgrade [REV] | downgrade REV]")
            return 2
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
