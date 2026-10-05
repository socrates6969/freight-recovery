"""Worker process entry point: ``python -m freight_recovery.sandbox.worker TARGET MEM_MB CPU_S``.

Reads all of stdin, calls ``TARGET`` (``"package.module:function"``, ``bytes -> bytes``),
writes the returned bytes to stdout. Started only by ``runner.run_isolated`` with a
minimal environment. Limits are applied *after* the target module is imported (so
start-up imports are not charged) and *before* any input is read.

Exit codes: 0 ok; 75 MemoryError; 70 self-destruct timer; 1 anything else.
stderr is discarded by the parent, so nothing printed here can leak.
"""

from __future__ import annotations

import importlib
import os
import re
import sys
import threading

EXIT_MEMORY = 75
EXIT_WATCHDOG = 70
_TARGET_RE = re.compile(r"^[A-Za-z_][\w.]*:[A-Za-z_]\w*$")


def _vm_size_bytes() -> int | None:
    """Current virtual size (Linux ``/proc``); ``None`` where unavailable."""
    try:
        with open("/proc/self/status", encoding="ascii") as fh:
            for line in fh:
                if line.startswith("VmSize:"):
                    return int(line.split()[1]) * 1024
    except (OSError, ValueError):
        pass
    return None


def apply_posix_limits(memory_mb: int, cpu_seconds: int) -> None:
    """Apply ``RLIMIT_*`` caps (no-op on platforms without ``resource``)."""
    try:
        import resource
    except ImportError:  # Windows: the parent's Job Object enforces the memory cap
        return
    base = _vm_size_bytes()
    if base is not None:  # RLIMIT_AS = what we already map + the allowed growth
        cap = base + memory_mb * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (cap, cap))
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 1))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (1 << 20, 1 << 20))  # the worker writes no files
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))


def _start_watchdog(seconds: int) -> None:
    """Backstop if the parent vanishes: end the process after ``seconds`` of wall-clock."""
    timer = threading.Timer(seconds, lambda: os._exit(EXIT_WATCHDOG))
    timer.daemon = True
    timer.start()


def main(argv: list[str]) -> int:
    if len(argv) != 4 or not _TARGET_RE.match(argv[1]):
        return 2
    target, memory_mb, cpu_seconds = argv[1], int(argv[2]), int(argv[3])
    module_name, _, func_name = target.partition(":")
    func = getattr(importlib.import_module(module_name), func_name)

    out = sys.stdout.buffer
    sys.stdout = sys.stderr  # stray prints must not corrupt the result stream
    _start_watchdog(cpu_seconds)
    apply_posix_limits(memory_mb, cpu_seconds)
    try:
        data = sys.stdin.buffer.read()
        result = func(data)
        out.write(result)
        out.flush()
    except MemoryError:
        os._exit(EXIT_MEMORY)
    return 0


if __name__ == "__main__":
    try:
        code = main(sys.argv)
    except MemoryError:
        os._exit(EXIT_MEMORY)
    except BaseException:  # noqa: BLE001 - report as a generic crash; stderr is discarded
        os._exit(1)
    sys.stdout.flush()
    os._exit(code)  # skip interpreter teardown: faster and cannot hang on a wedged thread
