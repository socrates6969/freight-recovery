"""Raw-document storage behind a small interface.

``LocalFilesystemStorage`` is the default (dev, tests, single-node). ``S3Storage`` is a
**stub** behind two explicit flags (``FR_STORAGE_BACKEND=s3`` *and*
``FR_STORAGE_S3_ENABLED=true``): it has never been run against real AWS, no test makes a
cloud call, and ``boto3`` is deliberately not a dependency of this repo (install it in
the deployment image when the stub is promoted to a real provider).

Keys are generated here from validated identifiers only (tenant UUID, analysis UUID,
position, SHA-256). A client-supplied filename never becomes part of a path or key, and
every ``get``/``delete`` re-checks that the key lives under the caller's tenant prefix.
"""

from __future__ import annotations

import os
import re
import tempfile
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

from freight_recovery.config import ConfigError, Settings

_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
_KEY_RE = re.compile(rf"^({_UUID})/({_UUID})/(\d{{3}})-([0-9a-f]{{64}})$")
_SHA_RE = re.compile(r"^[0-9a-f]{64}$")
_UUID_RE = re.compile(rf"^{_UUID}$")


class StorageError(Exception):
    """A storage operation failed (maps to HTTP 503; never contains document content)."""


def make_key(tenant_id: str, analysis_id: str, position: int, sha256: str) -> str:
    """Build a storage key from validated identifiers (raises ``ValueError`` otherwise)."""
    if not (_UUID_RE.match(tenant_id) and _UUID_RE.match(analysis_id) and _SHA_RE.match(sha256)):
        raise ValueError("invalid storage key component")
    if not 0 <= position <= 999:
        raise ValueError("invalid document position")
    return f"{tenant_id}/{analysis_id}/{position:03d}-{sha256}"


def _check_key(tenant_id: str, key: str) -> None:
    match = _KEY_RE.match(key)
    if not match or match.group(1) != tenant_id:
        raise StorageError("storage key is invalid or belongs to another tenant")


class StorageProvider(ABC):
    """Where raw uploaded documents live. Implementations must be safe to call from threads."""

    @abstractmethod
    def put(self, tenant_id: str, analysis_id: str, position: int, sha256: str, data: bytes) -> str:
        """Store ``data`` and return its opaque key."""

    @abstractmethod
    def get(self, tenant_id: str, key: str) -> bytes:
        """Return the bytes for ``key`` (which must belong to ``tenant_id``)."""

    @abstractmethod
    def delete(self, tenant_id: str, key: str) -> None:
        """Remove ``key`` (idempotent)."""


class LocalFilesystemStorage(StorageProvider):
    """Files under ``root/<tenant>/<analysis>/<nnn>-<sha256>`` (0600 files, 0700 dirs)."""

    def __init__(self, root: str | os.PathLike[str]) -> None:
        self.root = Path(root).resolve()

    def _path(self, tenant_id: str, key: str) -> Path:
        _check_key(tenant_id, key)
        path = (self.root / key).resolve()
        if self.root not in path.parents:  # defence in depth; the regex already forbids ".."
            raise StorageError("storage key escapes the storage root")
        return path

    def put(self, tenant_id: str, analysis_id: str, position: int, sha256: str, data: bytes) -> str:
        key = make_key(tenant_id, analysis_id, position, sha256)
        path = self._path(tenant_id, key)
        try:
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
            try:
                with os.fdopen(fd, "wb") as fh:
                    fh.write(data)
                os.chmod(tmp, 0o600)
                os.replace(tmp, path)  # atomic: readers never see a partial file
            except BaseException:
                Path(tmp).unlink(missing_ok=True)
                raise
        except OSError as exc:
            raise StorageError("could not write document") from exc
        return key

    def get(self, tenant_id: str, key: str) -> bytes:
        try:
            return self._path(tenant_id, key).read_bytes()
        except OSError as exc:
            raise StorageError("could not read document") from exc

    def delete(self, tenant_id: str, key: str) -> None:
        try:
            self._path(tenant_id, key).unlink(missing_ok=True)
        except OSError as exc:
            raise StorageError("could not delete document") from exc


class S3Storage(StorageProvider):
    """STUB: S3 provider (SSE-KMS). Never exercised against real AWS by this repo.

    ``client`` is injectable so tests can pass a fake; when omitted, ``boto3`` is imported
    lazily on first use and credentials come from the task role (never from this repo).
    """

    def __init__(
        self, bucket: str, prefix: str = "", kms_key_id: str = "", client: Any | None = None
    ) -> None:
        if not bucket:
            raise ConfigError("FR_STORAGE_S3_BUCKET is required for the S3 provider")
        self.bucket = bucket
        self.prefix = prefix.strip("/") + "/" if prefix.strip("/") else ""
        self.kms_key_id = kms_key_id
        self._client = client

    @property
    def client(self) -> Any:
        if self._client is None:
            try:
                import boto3  # type: ignore[import-not-found]  # not a dependency of this repo
            except ImportError as exc:
                raise StorageError("boto3 is not installed in this image") from exc
            self._client = boto3.client("s3")
        return self._client

    def put(self, tenant_id: str, analysis_id: str, position: int, sha256: str, data: bytes) -> str:
        key = make_key(tenant_id, analysis_id, position, sha256)
        extra: dict[str, Any] = {"ServerSideEncryption": "aws:kms"}
        if self.kms_key_id:
            extra["SSEKMSKeyId"] = self.kms_key_id
        try:
            self.client.put_object(
                Bucket=self.bucket,
                Key=self.prefix + key,
                Body=data,
                ContentType="application/octet-stream",
                **extra,
            )
        except StorageError:
            raise
        except Exception as exc:  # botocore raises many types
            raise StorageError("could not write document") from exc
        return key

    def get(self, tenant_id: str, key: str) -> bytes:
        _check_key(tenant_id, key)
        try:
            return self.client.get_object(Bucket=self.bucket, Key=self.prefix + key)["Body"].read()
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError("could not read document") from exc

    def delete(self, tenant_id: str, key: str) -> None:
        _check_key(tenant_id, key)
        try:
            self.client.delete_object(Bucket=self.bucket, Key=self.prefix + key)
        except StorageError:
            raise
        except Exception as exc:
            raise StorageError("could not delete document") from exc


def build_storage(settings: Settings) -> StorageProvider:
    """Factory driven by settings. S3 requires the explicit opt-in flag."""
    if settings.storage_backend == "local":
        return LocalFilesystemStorage(settings.storage_local_dir)
    if not settings.storage_s3_enabled:
        raise ConfigError(
            "FR_STORAGE_BACKEND=s3 is a stub; set FR_STORAGE_S3_ENABLED=true to opt in explicitly"
        )
    return S3Storage(
        settings.storage_s3_bucket, settings.storage_s3_prefix, settings.storage_s3_kms_key_id
    )


__all__ = [
    "LocalFilesystemStorage",
    "S3Storage",
    "StorageError",
    "StorageProvider",
    "build_storage",
    "make_key",
]
