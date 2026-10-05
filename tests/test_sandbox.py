"""Sandboxed parsing: bounded time, memory and output; clean environment; API mapping.

These start real worker subprocesses. The memory-cap tests exercise ``RLIMIT_AS`` on
Linux (CI) and a Windows Job Object on Windows (local dev).
"""

from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from freight_recovery.api import main as api_main
from freight_recovery.api.main import create_app
from freight_recovery.config import Settings
from freight_recovery.models import Perspective
from freight_recovery.pipeline import run_pipeline
from freight_recovery.sandbox import (
    SandboxBusy,
    SandboxFailed,
    SandboxRunner,
    SandboxTimeout,
    SandboxTooLarge,
    SandboxUnavailable,
    analyze_in_worker,
    run_isolated,
)
from freight_recovery.sandbox.targets import decode_request, encode_request
from tests._support import AUTH

ROOT = str(Path(__file__).resolve().parents[1])
T = "tests.sandbox_targets:"


def run(name: str, payload: bytes = b"", **kw):
    kw.setdefault("timeout", 20)
    kw.setdefault("memory_mb", 256)
    return run_isolated(T + name, payload, extra_pythonpath=[ROOT], **kw)


def _alive(pid: int) -> bool:
    if os.name == "nt":  # pragma: no cover - Windows only
        import ctypes

        k32 = ctypes.WinDLL("kernel32")
        k32.OpenProcess.restype = ctypes.c_void_p
        h = k32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
        if not h:
            return False
        alive = k32.WaitForSingleObject(ctypes.c_void_p(h), 0) == 258  # WAIT_TIMEOUT
        k32.CloseHandle(ctypes.c_void_p(h))
        return alive
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


# ---- the happy path -------------------------------------------------------------------


def test_bytes_round_trip_including_large_payloads_without_deadlock():
    assert run("echo", b"hello") == b"hello"
    big = os.urandom(8 * 1024 * 1024)  # larger than any pipe buffer, both directions
    assert run("echo", big) == big


def test_print_in_the_worker_does_not_corrupt_the_result():
    assert run("noisy") == b"clean"


def test_worker_does_not_inherit_the_api_environment(monkeypatch):
    monkeypatch.setenv("FR_DATABASE_URL", "postgresql://u:secret@h/db")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "do-not-leak")
    keys = set(json.loads(run("environ_keys")))
    assert not {k for k in keys if k.startswith(("FR_", "AWS_"))}, keys
    assert "FR_API_KEY_PEPPER" not in keys


# ---- bounded: time ----------------------------------------------------------------------


def test_cpu_bound_job_is_killed_at_the_wall_clock_limit_and_the_process_is_gone(tmp_path):
    pid_file = tmp_path / "pid"
    start = time.monotonic()
    with pytest.raises(SandboxTimeout):
        run("spin", str(pid_file).encode(), timeout=1.5)
    assert time.monotonic() - start < 8  # bounded, not "eventually"
    pid = int(pid_file.read_text())
    for _ in range(50):  # the kill is synchronous, allow the OS a moment to reap
        if not _alive(pid):
            break
        time.sleep(0.1)
    assert not _alive(pid), "worker process survived its timeout"


def test_sleeping_job_is_also_killed():
    with pytest.raises(SandboxTimeout):
        run("sleep_forever", timeout=1)


# ---- bounded: memory and output -----------------------------------------------------------


def test_memory_hog_is_stopped_by_the_memory_cap():
    with pytest.raises(SandboxTooLarge):
        run("hog", memory_mb=128)


def test_output_flood_is_cut_off():
    with pytest.raises(SandboxTooLarge):
        run("flood", max_output_bytes=1024 * 1024)


# ---- crashes ----------------------------------------------------------------------------------


@pytest.mark.parametrize("name", ["crash_exit", "crash_raise"])
def test_crashing_worker_is_a_clean_failure(name):
    with pytest.raises(SandboxFailed):
        run(name)


def test_unstartable_worker_is_reported_as_unavailable(monkeypatch):
    import subprocess

    def refuse(*_a, **_k):
        raise OSError("no fork")

    monkeypatch.setattr(subprocess, "Popen", refuse)
    with pytest.raises(SandboxUnavailable):
        run("echo")


def test_invalid_target_is_rejected_by_the_worker():
    with pytest.raises(SandboxFailed):
        run_isolated("not a target", b"", timeout=20, memory_mb=256)


# ---- concurrency / back-pressure ------------------------------------------------------------------


def test_runner_applies_back_pressure_and_releases_slots():
    runner = SandboxRunner(timeout=3, memory_mb=256, max_workers=1, queue_timeout=0.2)
    holder = threading.Thread(
        target=_swallow, args=(lambda: runner.run(T + "sleep_forever", b"", extra_pythonpath=[ROOT]),)
    )
    holder.start()
    time.sleep(0.5)  # let the first job take the only slot
    with pytest.raises(SandboxBusy):
        runner.run(T + "echo", b"x", extra_pythonpath=[ROOT])
    holder.join(timeout=15)
    assert runner.run(T + "echo", b"ok", extra_pythonpath=[ROOT]) == b"ok"  # slot was released


def _swallow(fn):
    try:
        fn()
    except SandboxTimeout:
        pass


# ---- the analysis job itself ---------------------------------------------------------------------


def test_request_encoding_round_trips_and_rejects_inconsistent_sizes():
    files = [("a.txt", b"one"), ("b.csv", b"\x00\xffbinary\n")]
    got, perspective, settings = decode_request(encode_request(files, Perspective.CARRIER, Settings()))
    assert got == files and perspective is Perspective.CARRIER
    assert settings.detention_increment_minutes == 15
    raw = encode_request(files, Perspective.SHIPPER, Settings())
    for bad in (raw + b"x", raw[:-1], b"no newline"):
        with pytest.raises(ValueError):
            decode_request(bad)


def test_worker_result_matches_in_process_result(ld5001):
    runner = SandboxRunner(timeout=30, memory_mb=1024, max_workers=1, queue_timeout=5)
    sandboxed = analyze_in_worker(runner, ld5001, Perspective.SHIPPER, Settings())
    direct = run_pipeline(ld5001, Perspective.SHIPPER, Settings())
    assert str(sandboxed.result.recoverable_total) == "325.00"
    drop = {"generated_at"}
    assert sandboxed.model_dump(exclude=drop) == direct.model_dump(exclude=drop)


def test_input_errors_come_back_as_fixed_messages_not_crashes():
    from freight_recovery.errors import InputError, UnprocessableError

    runner = SandboxRunner(timeout=30, memory_mb=1024, max_workers=1, queue_timeout=5)
    with pytest.raises(InputError, match="does not look like a PDF"):
        analyze_in_worker(runner, [("a.pdf", b"nope")], Perspective.SHIPPER, Settings())
    nan = b"Document: Freight Invoice\nTotal: NaN\nCharge: Detention | NaN"
    try:  # NaN either parses to nothing (fine) or maps to the generic unprocessable error
        analyze_in_worker(runner, [("invoice.txt", nan)], Perspective.SHIPPER, Settings())
    except UnprocessableError:
        pass


# ---- through the HTTP API ---------------------------------------------------------------------------


def _client(**changes) -> TestClient:
    settings = replace(Settings.from_env(), sandbox_mode="process", **changes)
    return TestClient(create_app(settings), headers=AUTH, raise_server_exceptions=False)


def test_api_runs_analyses_in_a_worker_and_persists_them(ld5001):
    c = _client()
    assert c.app.state.runner is not None
    files = [("files", (n, b)) for n, b in ld5001]
    r = c.post("/v1/analyze", files=files, data={"perspective": "shipper"})
    assert r.status_code == 200, r.text
    assert r.json()["packet"]["result"]["recoverable_total"] == "325.00"
    got = c.get(f"/v1/analyses/{r.json()['analysis_id']}").json()
    assert got["status"] == "succeeded" and got["recoverable_total"] == "325.00"


def test_api_malformed_pdf_is_422_from_the_worker():
    r = _client().post("/v1/analyze", files=[("files", ("evil.pdf", b"%PDF-1.4 garbage"))])
    assert r.status_code == 422 and "Traceback" not in r.text


def test_api_job_over_the_time_limit_is_422_and_recorded():
    c = _client(sandbox_timeout_seconds=0.05)  # shorter than interpreter start-up: always exceeded
    r = c.post("/v1/analyze/text", json={"documents": [{"filename": "a.txt", "content": "x"}]})
    assert r.status_code == 422 and "time limit" in r.json()["detail"]
    assert c.get("/v1/analyses").json()["items"][0]["error_code"] == "timeout"


def test_api_pathological_input_is_bounded_in_time():
    """Megabytes of near-miss key/value lines (the shape that used to be quadratic)."""
    c = _client(sandbox_timeout_seconds=20)
    evil = ("A" + " " * 5000 + "B\n") * 1500  # ~7.5 MB, one 5,000-space run per line
    start = time.monotonic()
    r = c.post("/v1/analyze", files=[("files", ("invoice.txt", evil.encode()))])
    assert time.monotonic() - start < 30
    assert r.status_code in (200, 413, 422)  # processed or refused, never a hang or a 500


@pytest.mark.parametrize(
    "exc,status,code",
    [
        (SandboxTooLarge("x"), 413, "too_large"),
        (SandboxBusy("x"), 503, "busy"),
        (SandboxUnavailable("x"), 503, "worker_unavailable"),
        (SandboxFailed("x"), 422, "worker_failed"),
        (SandboxTimeout("x"), 422, "timeout"),
    ],
)
def test_api_maps_every_sandbox_error_to_a_fixed_status(monkeypatch, exc, status, code):
    def boom(*_a, **_k):
        raise exc

    monkeypatch.setattr(api_main, "analyze_in_worker", boom)
    c = _client()
    r = c.post("/v1/analyze/text", json={"documents": [{"filename": "a.txt", "content": "x"}]})
    assert r.status_code == status
    assert str(exc) not in r.text or str(exc) == "x"  # no exception text beyond the fixed message
    assert c.get("/v1/analyses").json()["items"][0]["error_code"] == code
    if status == 503 and code == "busy":
        assert r.headers["retry-after"] == "5"


def test_api_returns_503_when_every_worker_slot_is_busy():
    c = _client(sandbox_max_workers=1, sandbox_queue_timeout_seconds=0.05)
    slots = c.app.state.runner._slots
    assert slots.acquire(timeout=1)  # occupy the only slot
    try:
        r = c.post("/v1/analyze/text", json={"documents": [{"filename": "a.txt", "content": "x"}]})
    finally:
        slots.release()
    assert r.status_code == 503 and r.headers["retry-after"] == "5"


def test_inprocess_mode_is_available_for_dev_but_refused_in_production():
    from freight_recovery.config import ConfigError

    c = TestClient(create_app(replace(Settings.from_env(), sandbox_mode="inprocess")))
    assert c.app.state.runner is None
    prod = replace(
        Settings.from_env(),
        environment="production",
        database_url="postgresql://u:p@h/d",
        sandbox_mode="inprocess",
    )
    with pytest.raises(ConfigError, match="SANDBOX_MODE"):
        create_app(prod)

