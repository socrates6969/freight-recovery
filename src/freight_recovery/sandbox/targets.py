"""The analysis job that runs inside the worker, and the parent-side wrapper around it.

Wire format (no pickle; the worker is the untrusted side):

* request:  one JSON header line, ``\\n``, then the raw bytes of every file back to back.
            Header: ``{"perspective", "settings", "files": [{"name", "size"}, ...]}``.
* response: one JSON document, ``{"ok": true, "packet": {...}}`` or
            ``{"ok": false, "kind": "input"|"unprocessable", "message": "..."}``.

The parent re-validates ``packet`` with pydantic and passes through only the fixed
messages of known error kinds.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from decimal import Decimal

from pydantic import ValidationError

from freight_recovery.config import Settings
from freight_recovery.errors import UNPROCESSABLE_EXCEPTIONS, InputError, UnprocessableError
from freight_recovery.models import EvidencePacket, Perspective
from freight_recovery.pipeline import run_pipeline

from .runner import SandboxFailed, SandboxRunner

TARGET = "freight_recovery.sandbox.targets:analyze"
_MAX_MESSAGE = 300
_PIPELINE_FIELDS = (
    "extraction_provider",
    "detention_increment_minutes",
    "amount_tolerance",
    "dispute_window_days",
)


# ---- request encoding ---------------------------------------------------------------


def encode_request(
    files: list[tuple[str, bytes]], perspective: Perspective, settings: Settings
) -> bytes:
    """Serialise one analysis request for the worker."""
    cfg = {k: v for k, v in asdict(settings).items() if k in _PIPELINE_FIELDS}
    cfg["amount_tolerance"] = str(cfg["amount_tolerance"])
    header = {
        "perspective": perspective.value,
        "settings": cfg,
        "files": [{"name": name, "size": len(data)} for name, data in files],
    }
    return json.dumps(header).encode("utf-8") + b"\n" + b"".join(data for _, data in files)


def decode_request(raw: bytes) -> tuple[list[tuple[str, bytes]], Perspective, Settings]:
    """Inverse of :func:`encode_request` (strict: sizes must account for every byte)."""
    head, sep, body = raw.partition(b"\n")
    if not sep:
        raise ValueError("malformed request")
    header = json.loads(head)
    sizes = [int(f["size"]) for f in header["files"]]
    if any(n < 0 for n in sizes) or sum(sizes) != len(body):
        raise ValueError("file sizes do not match the payload")
    files, pos = [], 0
    for meta, size in zip(header["files"], sizes):
        files.append((str(meta["name"]), body[pos : pos + size]))
        pos += size
    cfg = {k: header["settings"][k] for k in _PIPELINE_FIELDS}
    cfg["amount_tolerance"] = Decimal(cfg["amount_tolerance"])
    return files, Perspective(header["perspective"]), Settings(**cfg)


# ---- the job (runs in the worker process) ---------------------------------------------


def analyze(raw: bytes) -> bytes:
    """Worker entry point: bytes in -> JSON bytes out. Input errors are results, not crashes."""
    files, perspective, settings = decode_request(raw)
    try:
        packet = run_pipeline(files, perspective, settings)
    except InputError as exc:
        body = {"ok": False, "kind": "input", "message": str(exc)[:_MAX_MESSAGE]}
    except UNPROCESSABLE_EXCEPTIONS:
        body = {"ok": False, "kind": "unprocessable", "message": ""}
    else:
        body = {"ok": True, "packet": packet.model_dump(mode="json")}
    return json.dumps(body).encode("utf-8")


# ---- parent-side wrapper ------------------------------------------------------------


def analyze_in_worker(
    runner: SandboxRunner,
    files: list[tuple[str, bytes]],
    perspective: Perspective,
    settings: Settings,
) -> EvidencePacket:
    """Run the pipeline in a worker. Raises :class:`InputError`/``UnprocessableError`` for
    input problems and ``SandboxError`` subclasses for timeouts, limits and crashes."""
    raw = runner.run(TARGET, encode_request(files, perspective, settings))
    try:
        body = json.loads(raw)
        if body["ok"] is True:
            return EvidencePacket.model_validate(body["packet"])
        kind, message = body["kind"], str(body.get("message", ""))[:_MAX_MESSAGE]
    except (ValueError, KeyError, TypeError, ValidationError) as exc:
        raise SandboxFailed("worker returned an unusable result") from exc
    if kind == "input":
        raise InputError(message)
    raise UnprocessableError("The submitted documents could not be processed.")
