"""Repositories: the only code that talks to the tables.

* :class:`AnalysisRepository` is **bound to one tenant at construction**. Every query it
  issues filters on that tenant, and ``tenant_id`` is never accepted as a per-call
  argument, so a caller cannot ask it for another tenant's rows by mistake.
  Looking up another tenant's id returns ``None`` (the API turns that into 404, never
  revealing that the id exists).
* :class:`TenantAdminRepository` is the unscoped administrative surface (tenant and
  API-key management, key lookup during authentication). It is not used by
  the analysis endpoints.

Repositories never commit; the caller owns the transaction (see ``session_scope``).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from decimal import ROUND_HALF_EVEN, Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from freight_recovery.keys import generate_api_key, hash_api_key, parse_api_key

from .base import utcnow
from .tables import (
    STATUS_FAILED,
    STATUS_RUNNING,
    STATUS_SUCCEEDED,
    Analysis,
    AnalysisDocument,
    ApiKey,
    Tenant,
)

_CENT = Decimal("0.01")


def to_cents(amount: Decimal | str | int) -> int:
    """Exact integer cents for a dollar amount (half-even at the cent boundary)."""
    return int((Decimal(amount).quantize(_CENT, rounding=ROUND_HALF_EVEN) * 100).to_integral_value())


def new_id() -> str:
    """A random UUID4 string, used for every primary key."""
    return str(uuid.uuid4())


@dataclass(frozen=True)
class DocumentMeta:
    """Metadata recorded for each uploaded document."""

    filename: str
    sha256: str
    size_bytes: int


class TenantAdminRepository:
    """Tenant and API-key administration (unscoped; operator/CLI use and key lookup)."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def create_tenant(self, name: str) -> Tenant:
        tenant = Tenant(id=new_id(), name=name, is_active=True)
        self.session.add(tenant)
        self.session.flush()
        return tenant

    def get_tenant_by_name(self, name: str) -> Tenant | None:
        return self.session.scalar(select(Tenant).where(Tenant.name == name))

    def list_tenants(self) -> list[Tenant]:
        return list(self.session.scalars(select(Tenant).order_by(Tenant.created_at, Tenant.name)))

    def set_tenant_active(self, tenant_id: str, active: bool) -> None:
        tenant = self.session.get(Tenant, tenant_id)
        if tenant is None:
            raise LookupError("unknown tenant")
        tenant.is_active = active

    def issue_api_key(
        self, tenant_id: str, pepper: str, label: str = "", raw_key: str | None = None
    ) -> tuple[ApiKey, str]:
        """Create a key for a tenant. Returns ``(row, raw_key)``; the raw key is not stored.

        ``raw_key`` is for tests/bootstrap only; production keys are always generated.
        """
        if self.session.get(Tenant, tenant_id) is None:
            raise LookupError("unknown tenant")
        if raw_key is None:
            prefix, raw_key = generate_api_key()
        else:
            prefix = parse_api_key(raw_key) or ""
            if not prefix:
                raise ValueError("raw_key is not a well-formed API key")
        row = ApiKey(
            id=new_id(),
            tenant_id=tenant_id,
            key_prefix=prefix,
            key_hash=hash_api_key(raw_key, pepper),
            label=label,
        )
        self.session.add(row)
        self.session.flush()
        return row, raw_key

    def revoke_api_key(self, key_id: str) -> None:
        row = self.session.get(ApiKey, key_id)
        if row is None:
            raise LookupError("unknown key")
        if row.revoked_at is None:
            row.revoked_at = utcnow()

    def list_api_keys(self, tenant_id: str) -> list[ApiKey]:
        return list(
            self.session.scalars(
                select(ApiKey).where(ApiKey.tenant_id == tenant_id).order_by(ApiKey.created_at)
            )
        )

    def find_key_with_tenant(self, prefix: str) -> tuple[ApiKey, Tenant] | None:
        """Look up a key row (and its tenant) by the non-secret prefix."""
        row = self.session.execute(
            select(ApiKey, Tenant).join(Tenant, Tenant.id == ApiKey.tenant_id).where(
                ApiKey.key_prefix == prefix
            )
        ).first()
        return (row[0], row[1]) if row else None


class AnalysisRepository:
    """Analyses (jobs + results) for exactly one tenant."""

    def __init__(self, session: Session, tenant_id: str) -> None:
        if not tenant_id:
            raise ValueError("tenant_id is required")
        self.session = session
        self.tenant_id = tenant_id

    # -- reads -----------------------------------------------------------------
    def get(self, analysis_id: str) -> Analysis | None:
        """The analysis if it belongs to this tenant, else ``None``."""
        return self.session.scalar(
            select(Analysis).where(Analysis.id == analysis_id, Analysis.tenant_id == self.tenant_id)
        )

    def list(self, limit: int = 50, offset: int = 0) -> list[Analysis]:
        """This tenant's analyses, newest first."""
        stmt = (
            select(Analysis)
            .where(Analysis.tenant_id == self.tenant_id)
            .order_by(Analysis.created_at.desc(), Analysis.id)
            .limit(limit)
            .offset(offset)
        )
        return list(self.session.scalars(stmt))

    def count(self) -> int:
        return self.session.scalar(
            select(func.count()).select_from(Analysis).where(Analysis.tenant_id == self.tenant_id)
        ) or 0

    # -- writes ----------------------------------------------------------------
    def create(self, perspective: str, documents: list[DocumentMeta]) -> Analysis:
        """Insert a ``running`` analysis with its document metadata (no storage keys yet)."""
        analysis = Analysis(
            id=new_id(), tenant_id=self.tenant_id, status=STATUS_RUNNING, perspective=perspective
        )
        for i, meta in enumerate(documents):
            analysis.documents.append(
                AnalysisDocument(
                    id=new_id(),
                    tenant_id=self.tenant_id,
                    position=i,
                    filename=meta.filename,
                    sha256=meta.sha256,
                    size_bytes=meta.size_bytes,
                )
            )
        self.session.add(analysis)
        self.session.flush()
        return analysis

    def set_storage_keys(self, analysis_id: str, keys: list[str]) -> None:
        analysis = self._require(analysis_id)
        if len(keys) != len(analysis.documents):
            raise ValueError("one storage key per document is required")
        for doc, key in zip(analysis.documents, keys):
            doc.storage_key = key

    def mark_succeeded(
        self,
        analysis_id: str,
        result: dict[str, Any],
        load_number: str | None,
        recoverable: Decimal | str,
        pending_review: Decimal | str,
    ) -> Analysis:
        analysis = self._require(analysis_id)
        analysis.status = STATUS_SUCCEEDED
        analysis.result = result
        analysis.load_number = (load_number or None) and load_number[:200]
        analysis.recoverable_cents = to_cents(recoverable)
        analysis.pending_review_cents = to_cents(pending_review)
        analysis.error_code = None
        analysis.completed_at = utcnow()
        return analysis

    def mark_failed(self, analysis_id: str, error_code: str) -> Analysis:
        analysis = self._require(analysis_id)
        analysis.status = STATUS_FAILED
        analysis.error_code = error_code[:64]
        analysis.completed_at = utcnow()
        return analysis

    def _require(self, analysis_id: str) -> Analysis:
        analysis = self.get(analysis_id)
        if analysis is None:
            raise LookupError("analysis not found for this tenant")
        return analysis
