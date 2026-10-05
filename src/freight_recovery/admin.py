"""Operator CLI: tenants and API keys. Not exposed over HTTP.

    python -m freight_recovery.admin create-tenant "Acme Logistics"
    python -m freight_recovery.admin issue-key "Acme Logistics" --label "prod integration"
    python -m freight_recovery.admin list-keys "Acme Logistics"
    python -m freight_recovery.admin revoke-key <key-id>
    python -m freight_recovery.admin deactivate-tenant "Acme Logistics"
    python -m freight_recovery.admin list-tenants

Uses ``FR_DATABASE_URL`` and ``FR_API_KEY_PEPPER`` exactly like the API (it must be the
same pepper, or the keys it issues will not verify). ``issue-key`` prints the raw key
once, to stdout; it is never stored and cannot be recovered, only replaced.
In AWS run it as a one-off ECS task with the task's own secrets, not from a laptop.
"""

from __future__ import annotations

import argparse
import sys

from freight_recovery.config import Settings
from freight_recovery.db import TenantAdminRepository, build_engine, build_sessionmaker, session_scope


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="freight_recovery.admin", description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list-tenants")
    for name in ("create-tenant", "deactivate-tenant", "list-keys"):
        sub.add_parser(name).add_argument("tenant")
    ik = sub.add_parser("issue-key")
    ik.add_argument("tenant")
    ik.add_argument("--label", default="")
    sub.add_parser("revoke-key").add_argument("key_id")
    args = p.parse_args(argv)

    settings = Settings.from_env()
    if args.cmd == "issue-key" and len(settings.api_key_pepper) < 32:
        if settings.environment == "production":
            print("error: FR_API_KEY_PEPPER (>= 32 chars) is required", file=sys.stderr)
            return 2
        print("warning: FR_API_KEY_PEPPER is short/empty (dev only)", file=sys.stderr)

    engine = build_engine(settings.database_url)
    try:
        with session_scope(build_sessionmaker(engine)) as s:
            repo = TenantAdminRepository(s)
            if args.cmd == "list-tenants":
                for t in repo.list_tenants():
                    print(f"{t.id}  {'active' if t.is_active else 'INACTIVE'}  {t.name}")
                return 0
            if args.cmd == "revoke-key":
                repo.revoke_api_key(args.key_id)
                print("revoked")
                return 0
            if args.cmd == "create-tenant":
                t = repo.create_tenant(args.tenant)
                print(f"{t.id}  {t.name}")
                return 0
            tenant = repo.get_tenant_by_name(args.tenant)
            if tenant is None:
                print("error: no such tenant", file=sys.stderr)
                return 1
            if args.cmd == "deactivate-tenant":
                repo.set_tenant_active(tenant.id, False)
                print("deactivated")
            elif args.cmd == "list-keys":
                for k in repo.list_api_keys(tenant.id):
                    state = "REVOKED" if k.revoked_at else "active"
                    print(f"{k.id}  frk_{k.key_prefix}_...  {state}  {k.label}")
            elif args.cmd == "issue-key":
                row, raw = repo.issue_api_key(tenant.id, settings.api_key_pepper, args.label)
                print(f"key id: {row.id}", file=sys.stderr)
                print(raw)
        return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
