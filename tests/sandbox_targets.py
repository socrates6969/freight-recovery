"""Hostile jobs for the sandbox tests. Each is ``bytes -> bytes`` and runs in a worker."""

from __future__ import annotations

import json
import os
import time


def echo(data: bytes) -> bytes:
    return data


def spin(data: bytes) -> bytes:
    """Burn CPU forever (a pathological parser)."""
    if data:  # optional pid file so the test can prove the process is really gone
        with open(data.decode(), "w") as fh:
            fh.write(str(os.getpid()))
    while True:
        pass


def sleep_forever(data: bytes) -> bytes:
    time.sleep(3600)
    return b""


def hog(data: bytes) -> bytes:
    """Ask for far more memory than the cap allows (a decompression bomb)."""
    blob = bytearray(1_200_000_000)
    return b"allocated %d" % len(blob)


def flood(data: bytes) -> bytes:
    return b"x" * (20 * 1024 * 1024)


def crash_exit(data: bytes) -> bytes:
    os._exit(3)


def crash_raise(data: bytes) -> bytes:
    raise RuntimeError("boom")


def environ_keys(data: bytes) -> bytes:
    return json.dumps(sorted(os.environ)).encode()


def noisy(data: bytes) -> bytes:
    print("this must not corrupt the result stream")
    return b"clean"
