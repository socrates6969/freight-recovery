"""Persistence: migrations, repository round-trip, per-tenant scoping."""

from __future__ import annotations

from decimal import Decimal

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, select
from sqlalchemy.exc import IntegrityError

from freight_recovery.db import (
    AnalysisRepository,
    Base,
    TenantAdminRepository,
    build_engine,
    migrate,
    session_scope,
)
from freight_recovery.db.repository import DocumentMeta, to_cents
from freight_recovery.db.tables import (
    STATUS_FAILED,
    STATUS_RUNNING,
    STATUS_SUCCEEDED,
    Analysis,
    ApiKey,
)
from freight_recovery.models import EvidencePacket, Perspective
from freight_recovery.pipeline import run_pipeline

SHA = "a" * 64


# ---- migrations --------------------------------------------------------------------


def test_migrations_upgrade_creates_all_tables_and_downgrade_removes_them():
    engine = build_engine("sqlite://")  # in-memory
    migrate.upgrade(engine)
    assert {"tenants", "api_keys", "analyses", "analysis_documents", "alembic_version"} <= set(
        inspect(engine).get_table_names()
    )
    migrate.downgrade(engine, "base")
    assert set(inspect(engine).get_table_names()) <= {"alembic_version"}


def test_migrations_match_the_orm_models():
    """Fails when someone edits db/tables.py without adding a migration."""
    engine = build_engine("sqlite://")
    migrate.upgrade(engine)
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={"compare_type": True})
        assert compare_metadata(ctx, Base.metadata) == []


# ---- helpers -----------------------------------------------------------------------


def _packet(ld5001):
    return run_pipeline(ld5001, Perspective.SHIPPER)


def _persist(repo: AnalysisRepository, packet):
    analysis = repo.create(
        "shipper", [DocumentMeta(d["filename"], d["sha256"], 10) for d in packet.documents]
    )
    repo.mark_succeeded(
        analysis.id,
        packet.model_dump(mode="json"),
        packet.load_number,
        packet.result.recoverable_total,
        packet.result.pending_review_total,
    )
    return analysis.id


# ---- round trip --------------------------------------------------------------------


def test_analysis_round_trip_preserves_the_packet_exactly(db_factory, make_tenant, ld5001):
    tenant = make_tenant("rt")
    packet = _packet(ld5001)
    with session_scope(db_factory) as s:
        aid = _persist(AnalysisRepository(s, tenant.id), packet)

    with session_scope(db_factory) as s:  # a brand-new session = a real read from the DB
        row = AnalysisRepository(s, tenant.id).get(aid)
        assert row is not None
        assert row.status == STATUS_SUCCEEDED and row.error_code is None
        assert row.load_number == "LD-5001"
        assert (row.recoverable_cents, row.pending_review_cents) == (32500, 15000)
        assert row.completed_at is not None and row.completed_at.tzinfo is not None
        # Money survives as exact decimal strings, and the whole packet validates again.
        again = EvidencePacket.model_validate(row.result)
        assert again.result.recoverable_total == Decimal("325.00")
        assert again.markdown == packet.markdown
        assert [d.filename for d in row.documents] == [d["filename"] for d in packet.documents]


def test_failed_analysis_is_recorded_without_a_result(db_factory, make_tenant):
    tenant = make_tenant("fail")
    with session_scope(db_factory) as s:
        repo = AnalysisRepository(s, tenant.id)
        a = repo.create("carrier", [DocumentMeta("x.pdf", SHA, 5)])
        assert a.status == STATUS_RUNNING
        repo.mark_failed(a.id, "unprocessable")
        aid = a.id
    with session_scope(db_factory) as s:
        row = AnalysisRepository(s, tenant.id).get(aid)
        assert (row.status, row.error_code, row.result) == (STATUS_FAILED, "unprocessable", None)


def test_list_is_paginated_and_counted(db_factory, make_tenant):
    tenant = make_tenant("list")
    with session_scope(db_factory) as s:
        repo = AnalysisRepository(s, tenant.id)
        ids = [repo.create("shipper", []).id for _ in range(5)]
    with session_scope(db_factory) as s:
        repo = AnalysisRepository(s, tenant.id)
        assert repo.count() == 5
        assert len(repo.list(limit=2, offset=0)) == 2
        assert {a.id for a in repo.list(limit=10)} == set(ids)
        assert len(repo.list(limit=10, offset=4)) == 1


def test_storage_keys_must_match_document_count(db_factory, make_tenant):
    tenant = make_tenant("keys")
    with session_scope(db_factory) as s:
        repo = AnalysisRepository(s, tenant.id)
        a = repo.create("shipper", [DocumentMeta("a.txt", SHA, 1)])
        with pytest.raises(ValueError):
            repo.set_storage_keys(a.id, ["k1", "k2"])
        repo.set_storage_keys(a.id, ["k1"])
        assert a.documents[0].storage_key == "k1"


@pytest.mark.parametrize(
    "amount,cents",
    [
        ("325.00", 32500),
        ("0", 0),
        ("0.005", 0),
        ("0.015", 2),
        ("1234567.89", 123456789),
        (Decimal("-1.25"), -125),
    ],
)
def test_to_cents_is_exact_half_even(amount, cents):
    assert to_cents(amount) == cents


# ---- tenant scoping at the repository layer ------------------------------------------


def test_repository_never_returns_another_tenants_rows(db_factory, make_tenant, ld5001):
    a, b = make_tenant("iso-a"), make_tenant("iso-b")
    packet = _packet(ld5001)
    with session_scope(db_factory) as s:
        a_id = _persist(AnalysisRepository(s, a.id), packet)
        b_id = _persist(AnalysisRepository(s, b.id), packet)

    with session_scope(db_factory) as s:
        repo_a, repo_b = AnalysisRepository(s, a.id), AnalysisRepository(s, b.id)
        assert repo_a.get(a_id) is not None and repo_a.get(b_id) is None
        assert repo_b.get(b_id) is not None and repo_b.get(a_id) is None
        assert [x.id for x in repo_a.list()] == [a_id]
        assert [x.id for x in repo_b.list()] == [b_id]
        assert repo_a.count() == repo_b.count() == 1
        with pytest.raises(LookupError):  # cannot mutate another tenant's row either
            repo_a.mark_failed(b_id, "x")
        with pytest.raises(LookupError):
            repo_a.set_storage_keys(b_id, [])
        assert all(doc.tenant_id == b.id for doc in repo_b.get(b_id).documents)


def test_repository_requires_a_tenant(db_factory):
    with session_scope(db_factory) as s, pytest.raises(ValueError):
        AnalysisRepository(s, "")


def test_database_enforces_the_tenant_foreign_key(db_factory):
    """An analysis for a tenant that does not exist is rejected by the database itself."""
    with pytest.raises(IntegrityError), session_scope(db_factory) as s:
        s.add(Analysis(id="x" * 36, tenant_id="no-such-tenant", perspective="shipper"))


def test_tenant_and_key_admin(db_factory):
    with session_scope(db_factory) as s:
        repo = TenantAdminRepository(s)
        t = repo.create_tenant("admin-test-tenant")
        row, raw = repo.issue_api_key(t.id, "pep", label="ci")
        assert raw.startswith("frk_") and row.key_prefix in raw
        assert raw not in (row.key_hash, row.key_prefix) and len(row.key_hash) == 64
        found = repo.find_key_with_tenant(row.key_prefix)
        assert found and found[0].id == row.id and found[1].id == t.id
        repo.revoke_api_key(row.id)
        assert repo.find_key_with_tenant(row.key_prefix)[0].revoked_at is not None
        repo.set_tenant_active(t.id, False)
        assert repo.find_key_with_tenant(row.key_prefix)[1].is_active is False
        with pytest.raises(LookupError):
            repo.issue_api_key("missing", "pep")
        with pytest.raises(ValueError):
            repo.issue_api_key(t.id, "pep", raw_key="not-a-key")
    with pytest.raises(IntegrityError), session_scope(db_factory) as s2:
        TenantAdminRepository(s2).create_tenant("admin-test-tenant")  # names are unique


def test_raw_key_is_never_stored(db_factory):
    with session_scope(db_factory) as s:
        repo = TenantAdminRepository(s)
        t = repo.create_tenant("no-raw-key-tenant")
        _row, raw = repo.issue_api_key(t.id, "pep")
    with session_scope(db_factory) as s:
        for r in s.scalars(select(ApiKey)):
            assert raw not in (r.key_hash, r.key_prefix, r.label)
