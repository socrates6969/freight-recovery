"""Authentication, tenant isolation and API-level persistence."""

from __future__ import annotations

import logging
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from freight_recovery.api.main import app, create_app
from freight_recovery.config import ConfigError, Settings
from freight_recovery.db import TenantAdminRepository, session_scope
from freight_recovery.keys import generate_api_key
from tests._support import AUTH, TEST_API_KEY, TEST_PEPPER

anon = TestClient(app)  # no key
GOOD_BODY = {
    "documents": [
        {
            "filename": "invoice.txt",
            "content": "Document: Freight Invoice\nInvoice Number: I1\nLoad Number: L1\n"
            "Charge: Linehaul | 1000\nTotal: 1000",
        }
    ]
}
PROTECTED = [
    ("POST", "/v1/analyze/text", {"json": GOOD_BODY}),
    ("POST", "/v1/analyze", {"files": [("files", ("a.txt", b"x"))]}),
    ("GET", "/v1/analyses", {}),
    ("GET", "/v1/analyses/00000000-0000-0000-0000-000000000000", {}),
]


def _post(client, body=GOOD_BODY):
    r = client.post("/v1/analyze/text", json=body)
    assert r.status_code == 200, r.text
    return r.json()["analysis_id"]


# ---- 401 / 403 ---------------------------------------------------------------------


def test_health_is_the_only_anonymous_route():
    assert anon.get("/health").status_code == 200


@pytest.mark.parametrize("method,path,kw", PROTECTED)
def test_missing_key_is_401(method, path, kw):
    r = anon.request(method, path, **kw)
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == "Bearer"
    assert r.json() == {"detail": "API key required."}


def _wrong_keys(make_tenant, db_factory):
    _prefix, unknown = generate_api_key()
    other = make_tenant("wrong")
    # right prefix, wrong secret
    tampered = other.api_key[:-1] + ("A" if other.api_key[-1] != "A" else "B")
    revoked = make_tenant("revoked")
    deactivated = make_tenant("deactivated")
    with session_scope(db_factory) as s:
        repo = TenantAdminRepository(s)
        row = repo.list_api_keys(revoked.id)[0]
        repo.revoke_api_key(row.id)
        repo.set_tenant_active(deactivated.id, False)
    return {
        "unknown": unknown,
        "wrong-secret": tampered,
        "malformed": "not-a-key",
        "too-long": "frk_" + "a" * 500,
        "revoked": revoked.api_key,
        "deactivated-tenant": deactivated.api_key,
    }


@pytest.mark.parametrize("method,path,kw", PROTECTED)
def test_wrong_keys_are_403_with_one_indistinguishable_message(
    make_tenant, db_factory, method, path, kw
):
    for label, key in _wrong_keys(make_tenant, db_factory).items():
        r = anon.request(method, path, headers={"X-API-Key": key}, **kw)
        assert r.status_code == 403, label
        assert r.json() == {"detail": "Invalid API key."}, label


def test_bearer_and_x_api_key_both_work():
    assert anon.get("/v1/analyses", headers={"Authorization": f"Bearer {TEST_API_KEY}"}).status_code == 200
    assert anon.get("/v1/analyses", headers=AUTH).status_code == 200
    assert anon.get("/v1/analyses", headers={"Authorization": "Basic abc"}).status_code == 401


def test_auth_happens_before_the_body_is_parsed():
    """An anonymous, malformed multipart request is 401 (not 422): nothing was parsed."""
    r = anon.post("/v1/analyze", content=b"garbage", headers={"content-type": "multipart/form-data"})
    assert r.status_code == 401


def test_a_valid_key_is_required_even_when_the_body_is_invalid():
    r = anon.post("/v1/analyze/text", json={"documents": []}, headers={"X-API-Key": "bad"})
    assert r.status_code == 403


# ---- tenant isolation ----------------------------------------------------------------


def test_tenant_a_cannot_read_tenant_bs_data(make_tenant):
    a, b = make_tenant("a"), make_tenant("b")
    ca, cb = TestClient(app, headers=a.headers), TestClient(app, headers=b.headers)
    a_id, b_id = _post(ca), _post(cb)

    # each tenant reads its own
    assert ca.get(f"/v1/analyses/{a_id}").status_code == 200
    assert cb.get(f"/v1/analyses/{b_id}").status_code == 200
    # ... and gets an indistinguishable 404 for the other tenant's id (and for a made-up id)
    cross = ca.get(f"/v1/analyses/{b_id}")
    missing = ca.get("/v1/analyses/00000000-0000-0000-0000-000000000000")
    assert cross.status_code == 404 and cross.json() == missing.json()
    assert cb.get(f"/v1/analyses/{a_id}").status_code == 404
    # lists are disjoint
    assert [x["id"] for x in ca.get("/v1/analyses").json()["items"]] == [a_id]
    assert [x["id"] for x in cb.get("/v1/analyses").json()["items"]] == [b_id]
    assert ca.get("/v1/analyses").json()["total"] == 1


def test_tenant_cannot_be_chosen_by_the_caller(make_tenant):
    a, b = make_tenant("a2"), make_tenant("b2")
    ca, cb = TestClient(app, headers=a.headers), TestClient(app, headers=b.headers)
    b_id = _post(cb)
    spoof = {**a.headers, "X-Tenant-Id": b.id, "X-Forwarded-For": "10.0.0.1"}
    r = ca.get(f"/v1/analyses/{b_id}", headers=spoof, params={"tenant_id": b.id})
    assert r.status_code == 404
    assert ca.get("/v1/analyses", headers=spoof, params={"tenant_id": b.id}).json()["total"] == 0
    # a tenant_id smuggled in the JSON body is ignored (unknown fields do not pick the tenant)
    body = {**GOOD_BODY, "tenant_id": b.id}
    new_id = ca.post("/v1/analyze/text", json=body).json()["analysis_id"]
    assert ca.get(f"/v1/analyses/{new_id}").status_code == 200
    assert cb.get(f"/v1/analyses/{new_id}").status_code == 404


def test_revoking_a_key_cuts_access_immediately(make_tenant, db_factory):
    t = make_tenant("revoke")
    client = TestClient(app, headers=t.headers)
    assert client.get("/v1/analyses").status_code == 200
    with session_scope(db_factory) as s:
        repo = TenantAdminRepository(s)
        repo.revoke_api_key(repo.list_api_keys(t.id)[0].id)
    assert client.get("/v1/analyses").status_code == 403


def test_raw_documents_are_stored_under_the_callers_tenant_prefix(make_tenant):
    t = make_tenant("store")
    c = TestClient(app, headers=t.headers)
    aid = _post(c)
    storage = app.state.storage
    # the stored key is tenant-scoped, readable by that tenant, refused for another
    from freight_recovery.storage import StorageError
    from freight_recovery.db import AnalysisRepository

    with session_scope(app.state.sessionmaker) as s:
        doc = AnalysisRepository(s, t.id).get(aid).documents[0]
        assert doc.storage_key.startswith(f"{t.id}/{aid}/")
        assert b"Linehaul" in storage.get(t.id, doc.storage_key)
        with pytest.raises(StorageError):
            storage.get("00000000-0000-0000-0000-000000000000", doc.storage_key)


# ---- API-level persistence -------------------------------------------------------------


def test_analyze_persists_and_get_returns_the_same_packet(make_tenant, ld5001):
    t = make_tenant("persist")
    c = TestClient(app, headers=t.headers)
    body = {
        "perspective": "shipper",
        "documents": [{"filename": n, "content": b.decode()} for n, b in ld5001],
    }
    posted = c.post("/v1/analyze/text", json=body).json()
    got = c.get(f"/v1/analyses/{posted['analysis_id']}").json()
    assert got["status"] == "succeeded" and got["load_number"] == "LD-5001"
    assert got["recoverable_total"] == "325.00" and got["pending_review_total"] == "150.00"
    assert got["packet"]["markdown"] == posted["packet"]["markdown"]
    assert [d["filename"] for d in got["documents"]] == [n for n, _ in ld5001]
    assert all(len(d["sha256"]) == 64 and d["size_bytes"] > 0 for d in got["documents"])
    listing = c.get("/v1/analyses?limit=1").json()
    assert listing["total"] == 1 and listing["items"][0]["document_count"] == 3
    assert "packet" not in listing["items"][0]


def test_failed_analyses_are_recorded_without_leaking_content(make_tenant):
    t = make_tenant("failed")
    c = TestClient(app, headers=t.headers)
    r = c.post("/v1/analyze", files=[("files", ("evil.pdf", b"not really a pdf"))])
    assert r.status_code == 422
    row = c.get("/v1/analyses").json()["items"][0]
    assert row["status"] == "failed" and row["error_code"] == "input_error"
    assert c.get(f"/v1/analyses/{row['id']}").json()["packet"] is None


def test_pagination_bounds_are_validated(make_tenant):
    c = TestClient(app, headers=make_tenant("page").headers)
    assert c.get("/v1/analyses?limit=0").status_code == 422
    assert c.get("/v1/analyses?limit=101").status_code == 422
    assert c.get("/v1/analyses?offset=-1").status_code == 422


def test_audit_log_has_ids_but_never_document_content(make_tenant, caplog):
    t = make_tenant("audit")
    c = TestClient(app, headers=t.headers)
    with caplog.at_level(logging.INFO, logger="freight_recovery.audit"):
        aid = _post(c)
    text = caplog.text
    assert t.id in text and aid in text
    assert "Linehaul" not in text and "Charge" not in text and t.api_key not in text


# ---- /docs and /openapi.json ---------------------------------------------------------------


def _app_with(**changes):
    return TestClient(create_app(replace(Settings.from_env(), **changes)))


def test_docs_are_disabled_by_default():
    for path in ("/docs", "/openapi.json", "/redoc"):
        assert anon.get(path).status_code == 404
        assert anon.get(path, headers=AUTH).status_code == 404  # off means off, even with a key


def test_docs_mode_auth_requires_a_valid_key():
    c = _app_with(docs_mode="auth")
    for path in ("/docs", "/openapi.json"):
        assert c.get(path).status_code == 401
        assert c.get(path, headers={"X-API-Key": "frk_00000000_" + "x" * 43}).status_code == 403
        assert c.get(path, headers=AUTH).status_code == 200
    spec = c.get("/openapi.json", headers=AUTH).json()
    assert {"ApiKeyAuth", "BearerAuth"} <= set(spec["components"]["securitySchemes"])
    assert "/docs" not in spec["paths"]
    assert c.get("/health").status_code == 200


def test_docs_mode_open_is_anonymous_for_local_dev_only():
    c = _app_with(docs_mode="open")
    assert c.get("/openapi.json").status_code == 200 and c.get("/docs").status_code == 200
    assert c.get("/v1/analyses").status_code == 401  # the API itself is still protected


# ---- production guard-rails ---------------------------------------------------------------------


def test_production_refuses_insecure_settings():
    base = Settings.from_env()
    prod = replace(
        base,
        environment="production",
        database_url="postgresql+psycopg://u:p@h/db",
        api_key_pepper=TEST_PEPPER,
        docs_mode="off",
        sandbox_mode="process",
    )
    prod.validate_for_production()  # a safe combination passes
    for bad, needle in [
        ({"api_key_pepper": "short"}, "PEPPER"),
        ({"docs_mode": "open"}, "DOCS_MODE"),
        ({"sandbox_mode": "inprocess"}, "SANDBOX_MODE"),
        ({"database_url": "sqlite:///x.db"}, "DATABASE_URL"),
    ]:
        with pytest.raises(ConfigError, match=needle):
            create_app(replace(prod, **bad))


def test_secrets_are_not_in_settings_repr():
    s = Settings(api_key_pepper="super-secret-pepper", database_url="postgresql://u:hunter2@h/db")
    assert "super-secret-pepper" not in repr(s) and "hunter2" not in repr(s)


def test_settings_from_env_parsing(monkeypatch):
    monkeypatch.setenv("FR_SANDBOX_TIMEOUT_SECONDS", "2.5")
    monkeypatch.setenv("FR_STORAGE_S3_ENABLED", "true")
    monkeypatch.setenv("FR_DOCS_MODE", "auth")
    s = Settings.from_env()
    assert (s.sandbox_timeout_seconds, s.storage_s3_enabled, s.docs_mode) == (2.5, True, "auth")
    monkeypatch.setenv("FR_DOCS_MODE", "everyone")
    with pytest.raises(ValueError, match="docs_mode"):
        Settings.from_env()
    monkeypatch.setenv("FR_DOCS_MODE", "off")
    monkeypatch.setenv("FR_STORAGE_S3_ENABLED", "maybe")
    with pytest.raises(ValueError, match="boolean"):
        Settings.from_env()


# ---- operator CLI -------------------------------------------------------------------------------


def test_admin_cli_issues_a_working_key_and_can_revoke_it(capsys):
    from freight_recovery import admin

    name = "cli-tenant-" + generate_api_key()[0]
    assert admin.main(["create-tenant", name]) == 0
    assert admin.main(["issue-key", name, "--label", "cli"]) == 0
    out = capsys.readouterr()
    raw = out.out.strip().splitlines()[-1]
    key_id = out.err.split("key id:")[1].split()[0]
    assert raw.startswith("frk_")
    assert anon.get("/v1/analyses", headers={"X-API-Key": raw}).status_code == 200
    assert admin.main(["list-keys", name]) == 0
    assert raw not in capsys.readouterr().out  # the listing never shows the secret
    assert admin.main(["revoke-key", key_id]) == 0
    assert anon.get("/v1/analyses", headers={"X-API-Key": raw}).status_code == 403
    assert admin.main(["issue-key", "no-such-tenant"]) == 1
