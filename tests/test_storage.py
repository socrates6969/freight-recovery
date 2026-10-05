"""StorageProvider: local filesystem default, S3 stub behind flags (no cloud calls)."""

from __future__ import annotations

import uuid

import pytest

from freight_recovery.config import ConfigError, Settings
from freight_recovery.storage import (
    LocalFilesystemStorage,
    S3Storage,
    StorageError,
    build_storage,
    make_key,
)

SHA = "b" * 64


def _ids():
    return str(uuid.uuid4()), str(uuid.uuid4())


def test_local_round_trip_and_delete(tmp_path):
    store = LocalFilesystemStorage(tmp_path)
    tenant, analysis = _ids()
    key = store.put(tenant, analysis, 0, SHA, b"hello")
    assert key == f"{tenant}/{analysis}/000-{SHA}"
    assert store.get(tenant, key) == b"hello"
    store.delete(tenant, key)
    store.delete(tenant, key)  # idempotent
    with pytest.raises(StorageError):
        store.get(tenant, key)


def test_local_storage_never_uses_filenames_and_stays_in_root(tmp_path):
    store = LocalFilesystemStorage(tmp_path / "docs")
    tenant, analysis = _ids()
    store.put(tenant, analysis, 1, SHA, b"x")
    files = [p for p in (tmp_path / "docs").rglob("*") if p.is_file()]
    assert [p.name for p in files] == [f"001-{SHA}"]  # no temp files left behind
    assert all((tmp_path / "docs") in p.parents for p in files)


@pytest.mark.parametrize(
    "bad",
    ["../../etc/passwd", "a/b/c", "", f"{'x' * 36}/{'y' * 36}/000-{SHA}", "..\\..\\x"],
)
def test_local_storage_rejects_malformed_keys(tmp_path, bad):
    store = LocalFilesystemStorage(tmp_path)
    tenant, _ = _ids()
    with pytest.raises(StorageError):
        store.get(tenant, bad)
    with pytest.raises(StorageError):
        store.delete(tenant, bad)


def test_key_components_are_validated():
    tenant, analysis = _ids()
    for args in [("../x", analysis, 0, SHA), (tenant, "..", 0, SHA), (tenant, analysis, 0, "zz"),
                 (tenant, analysis, 1000, SHA), (tenant, analysis, -1, SHA)]:
        with pytest.raises(ValueError):
            make_key(*args)


def test_one_tenant_cannot_read_or_delete_another_tenants_object(tmp_path):
    store = LocalFilesystemStorage(tmp_path)
    (a, analysis), (b, _) = _ids(), _ids()
    key = store.put(a, analysis, 0, SHA, b"secret")
    with pytest.raises(StorageError):
        store.get(b, key)
    with pytest.raises(StorageError):
        store.delete(b, key)
    assert store.get(a, key) == b"secret"  # untouched


# ---- S3 stub (fake client only; there is no boto3 here and no network) --------------


class FakeS3:
    def __init__(self):
        self.objects: dict[tuple[str, str], bytes] = {}
        self.calls: list[tuple[str, dict]] = []

    def put_object(self, **kw):
        self.calls.append(("put", kw))
        self.objects[(kw["Bucket"], kw["Key"])] = kw["Body"]

    def get_object(self, Bucket, Key):
        self.calls.append(("get", {"Bucket": Bucket, "Key": Key}))
        import io

        return {"Body": io.BytesIO(self.objects[(Bucket, Key)])}

    def delete_object(self, Bucket, Key):
        self.calls.append(("delete", {"Bucket": Bucket, "Key": Key}))
        self.objects.pop((Bucket, Key), None)


def test_s3_stub_uses_tenant_prefixed_keys_and_sse_kms():
    fake = FakeS3()
    store = S3Storage("bkt", prefix="/docs/", kms_key_id="alias/fr", client=fake)
    tenant, analysis = _ids()
    key = store.put(tenant, analysis, 2, SHA, b"data")
    (op, kw), = fake.calls
    assert op == "put" and kw["Bucket"] == "bkt"
    assert kw["Key"] == f"docs/{tenant}/{analysis}/002-{SHA}"
    assert kw["ServerSideEncryption"] == "aws:kms" and kw["SSEKMSKeyId"] == "alias/fr"
    assert store.get(tenant, key) == b"data"
    store.delete(tenant, key)
    assert fake.objects == {}


def test_s3_stub_enforces_tenant_prefix_and_wraps_errors():
    fake = FakeS3()
    store = S3Storage("bkt", client=fake)
    (a, analysis), (b, _) = _ids(), _ids()
    key = store.put(a, analysis, 0, SHA, b"x")
    with pytest.raises(StorageError):
        store.get(b, key)
    with pytest.raises(StorageError):  # missing object -> wrapped, no raw botocore error leaks
        store.get(a, make_key(a, analysis, 5, SHA))


def test_s3_stub_without_boto3_fails_cleanly_and_makes_no_calls():
    store = S3Storage("bkt")  # no injected client
    tenant, analysis = _ids()
    try:
        import boto3  # noqa: F401

        pytest.skip("boto3 is installed in this environment")
    except ImportError:
        pass
    with pytest.raises(StorageError, match="boto3"):
        store.put(tenant, analysis, 0, SHA, b"x")


def test_build_storage_defaults_to_local_and_gates_s3_behind_a_flag(tmp_path):
    assert isinstance(build_storage(Settings(storage_local_dir=str(tmp_path))), LocalFilesystemStorage)
    with pytest.raises(ConfigError, match="FR_STORAGE_S3_ENABLED"):
        build_storage(Settings(storage_backend="s3", storage_s3_bucket="b"))
    with pytest.raises(ConfigError, match="BUCKET"):
        build_storage(Settings(storage_backend="s3", storage_s3_enabled=True))
    s3 = build_storage(Settings(storage_backend="s3", storage_s3_enabled=True, storage_s3_bucket="b"))
    assert isinstance(s3, S3Storage)  # constructed lazily: still no boto3 import, no network
