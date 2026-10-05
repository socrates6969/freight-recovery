"""ORM tables.

Tenancy: ``tenants`` own ``api_keys`` and ``analyses``; ``analysis_documents`` carry a
denormalised ``tenant_id`` so every table that holds customer data can be filtered (and
later protected by PostgreSQL row-level security) on its own column.

``analyses`` doubles as the job record: ``status`` moves queued -> running ->
succeeded | failed. Today the API runs the job synchronously; an async worker can
adopt the same row lifecycle without a schema change.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, BigInteger, Boolean, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, UTCDateTime, utcnow

# JSONB on PostgreSQL (indexable/queryable), plain JSON elsewhere.
PortableJSON = JSON().with_variant(JSONB(), "postgresql")

STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_SUCCEEDED = "succeeded"
STATUS_FAILED = "failed"
STATUSES = (STATUS_QUEUED, STATUS_RUNNING, STATUS_SUCCEEDED, STATUS_FAILED)


class Tenant(Base):
    """A customer organisation. All customer data is scoped to exactly one tenant."""

    __tablename__ = "tenants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class ApiKey(Base):
    """A per-tenant API key. Only a keyed hash is stored; the raw key is shown once."""

    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    # Non-secret identifier embedded in the key (``frk_<prefix>_<secret>``): used for lookup.
    key_prefix: Mapped[str] = mapped_column(String(16), unique=True)
    key_hash: Mapped[str] = mapped_column(String(64))  # HMAC-SHA256 hex digest
    label: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class Analysis(Base):
    """One analysis job and its result, owned by one tenant."""

    __tablename__ = "analyses"
    __table_args__ = (Index("ix_analyses_tenant_id_created_at", "tenant_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"))
    status: Mapped[str] = mapped_column(String(16), default=STATUS_QUEUED)
    perspective: Mapped[str] = mapped_column(String(16))
    load_number: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Money is stored as integer cents (exact, portable, aggregatable); the full
    # Decimal-precise packet lives in ``result``.
    recoverable_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    pending_review_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    result: Mapped[dict[str, Any] | None] = mapped_column(PortableJSON, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    documents: Mapped[list["AnalysisDocument"]] = relationship(
        back_populates="analysis",
        cascade="all, delete-orphan",
        order_by="AnalysisDocument.position",
    )


class AnalysisDocument(Base):
    """Metadata for one uploaded document; the raw bytes live behind ``StorageProvider``."""

    __tablename__ = "analysis_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    analysis_id: Mapped[str] = mapped_column(
        ForeignKey("analyses.id", ondelete="CASCADE"), index=True
    )
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    filename: Mapped[str] = mapped_column(String(255))
    sha256: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)

    analysis: Mapped[Analysis] = relationship(back_populates="documents")
