"""API-key authentication and tenant resolution.

Every route except ``/health`` is mounted on :class:`AuthenticatedRoute`, which resolves
the caller's tenant **before** FastAPI reads or parses the request body, so an
unauthenticated client cannot make the server spool a multi-megabyte upload just to be
told 401.

Semantics:

* no key presented                          -> 401 (``WWW-Authenticate: Bearer``)
* key presented but not valid               -> 403 (one message for every cause: malformed,
  unknown, wrong secret, revoked key, deactivated tenant, so the response is not an oracle)
* key valid                                 -> the request runs as that key's tenant; the tenant
  id comes **only** from the key, never from a header, query or body field.

A key is accepted as ``X-API-Key: <key>`` or ``Authorization: Bearer <key>``.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from fastapi import HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.routing import APIRoute
from fastapi.security import APIKeyHeader, HTTPBearer
from sqlalchemy.orm import Session, sessionmaker

from freight_recovery.db.repository import TenantAdminRepository
from freight_recovery.keys import parse_api_key, verify_api_key

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False, scheme_name="ApiKeyAuth")
bearer_scheme = HTTPBearer(auto_error=False, scheme_name="BearerAuth")

_DUMMY_HASH = "0" * 64


@dataclass(frozen=True)
class TenantContext:
    """The authenticated caller. ``tenant_id`` scopes every query and storage key."""

    tenant_id: str
    tenant_name: str
    key_id: str


def _unauthorized() -> HTTPException:
    return HTTPException(401, "API key required.", headers={"WWW-Authenticate": "Bearer"})


def _forbidden() -> HTTPException:
    return HTTPException(403, "Invalid API key.")


def extract_key(request: Request) -> str | None:
    """The raw key from ``X-API-Key`` or ``Authorization: Bearer``, if any."""
    key = request.headers.get("x-api-key")
    if key:
        return key.strip()
    auth = request.headers.get("authorization", "")
    scheme, _, value = auth.partition(" ")
    if scheme.lower() == "bearer" and value.strip():
        return value.strip()
    return None


def authenticate_key(
    raw_key: str | None, factory: sessionmaker[Session], pepper: str
) -> TenantContext:
    """Resolve a raw key to a tenant (blocking; run in a thread). Raises 401/403."""
    if not raw_key:
        raise _unauthorized()
    prefix = parse_api_key(raw_key)
    found = None
    if prefix:
        with factory() as session:
            found = TenantAdminRepository(session).find_key_with_tenant(prefix)
    # Always compute one keyed hash + constant-time compare, even for unknown keys, so
    # response time does not reveal whether a prefix exists.
    stored = found[0].key_hash if found else _DUMMY_HASH
    ok = verify_api_key(raw_key, pepper, stored)
    if not (found and ok):
        raise _forbidden()
    key, tenant = found
    if key.revoked_at is not None or not tenant.is_active:
        raise _forbidden()
    return TenantContext(tenant_id=tenant.id, tenant_name=tenant.name, key_id=key.id)


class AuthenticatedRoute(APIRoute):
    """An ``APIRoute`` that authenticates before the request body is read."""

    def get_route_handler(self) -> Callable[[Request], Awaitable[Response]]:
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            state = request.app.state
            request.state.tenant = await run_in_threadpool(
                authenticate_key, extract_key(request), state.sessionmaker, state.settings.api_key_pepper
            )
            return await original(request)

        return handler


def current_tenant(request: Request) -> TenantContext:
    """Dependency: the tenant resolved by :class:`AuthenticatedRoute`."""
    tenant = getattr(request.state, "tenant", None)
    if tenant is None:  # a route was mounted without AuthenticatedRoute: fail closed
        raise _forbidden()
    return tenant
