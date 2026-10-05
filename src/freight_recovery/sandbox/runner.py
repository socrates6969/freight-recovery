"""Run untrusted-input work in a separate, resource-limited worker process.

Why: parsing hostile PDFs/CSVs/text is CPU- and memory-hungry and can hit parser bugs in
native code (pdfminer, pypdfium2, Pillow). In the API process that can stall every other
request or take the container down. Here each job gets its own short-lived interpreter:

* **Hard wall-clock timeout** enforced by the parent, which kills the worker.
* **Memory cap**: ``RLIMIT_AS`` set by the worker itself (Linux; baseline + cap), and a
  Job Object ``ProcessMemoryLimit`` on Windows (approximate, dev convenience).
* **CPU-time limit** (``RLIMIT_CPU``), a worker-side wall-clock self-destruct timer, and
  no core dumps / tiny max file size (POSIX); at most one process on Windows.
* **Output cap**: the parent kills a worker that floods stdout.
* **Clean environment**: the worker does not inherit the API's environment, so it never
  sees ``FR_DATABASE_URL``, the key pepper or AWS credentials. It has no database or
  storage handle: bytes in, bytes out.
* **No pickle**: input and output are plain bytes (the analysis target uses JSON, and
  the parent re-validates the result with pydantic).

What this is NOT: it is process-level isolation, not a security sandbox. The worker
still runs as the same OS user with the same network and filesystem view. Real
containment (seccomp profile, read-only root filesystem, no egress, dropped
capabilities, per-task CPU/memory limits) is a deployment-layer concern: see
``deploy/aws.md`` (ECS task definition / separate task for parsing).
"""

from __future__ import annotations

import ctypes
import os
import signal
import site
import subprocess
import sys
import tempfile
import threading
from collections.abc import Sequence
from pathlib import Path

EXIT_MEMORY = 75  # worker caught MemoryError
EXIT_WATCHDOG = 70  # worker's own wall-clock timer fired
_IS_WINDOWS = os.name == "nt"
_SIGXCPU = getattr(signal, "SIGXCPU", None)  # POSIX: delivered when RLIMIT_CPU is exceeded
DEFAULT_MAX_OUTPUT = 64 * 1024 * 1024


class SandboxError(Exception):
    """Base class. Messages are fixed and never contain document content."""


class SandboxTimeout(SandboxError):
    """The worker exceeded its wall-clock (or CPU) limit and was killed."""


class SandboxTooLarge(SandboxError):
    """The worker exceeded its memory or output limit."""


class SandboxFailed(SandboxError):
    """The worker crashed or produced an unusable result."""


class SandboxBusy(SandboxError):
    """No worker slot became free in time (back-pressure; maps to 503)."""


class SandboxUnavailable(SandboxError):
    """The worker process could not be started."""


def _package_root() -> str:
    return str(Path(__file__).resolve().parents[2])  # the directory containing freight_recovery/


def _python_and_paths(extra: Sequence[str]) -> tuple[str, list[str]]:
    """Interpreter to launch and the PYTHONPATH entries it needs."""
    paths = [_package_root(), *extra]
    exe = sys.executable
    if _IS_WINDOWS and sys.prefix != getattr(sys, "base_prefix", sys.prefix):
        # A venv's python.exe is a launcher that starts the real interpreter as a *child*;
        # killing the launcher would orphan it. Start the real interpreter directly and
        # give it the venv's site-packages explicitly.
        exe = getattr(sys, "_base_executable", exe)
        paths += [p for p in sys.path if p.endswith("site-packages")] + site.getsitepackages()
    return exe, list(dict.fromkeys(paths))


def _child_env(paths: Sequence[str]) -> dict[str, str]:
    env = {
        "PYTHONPATH": os.pathsep.join(paths),
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONUTF8": "1",
    }
    for name in ("SYSTEMROOT", "SYSTEMDRIVE", "LD_LIBRARY_PATH"):  # needed to start Python
        if name in os.environ:
            env[name] = os.environ[name]
    return env


# ---- Windows: Job Object (memory cap + kill-on-close + single process) ---------------


def _windows_job(proc: subprocess.Popen, memory_bytes: int):  # pragma: no cover - Windows only
    """Best-effort Job Object; returns its handle (caller must close) or ``None``."""
    from ctypes import wintypes

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [(n, ctypes.c_ulonglong) for n in ("a", "b", "c", "d", "e", "f")]

    class BASIC(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_longlong),
            ("PerJobUserTimeLimit", ctypes.c_longlong),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class EXTENDED(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", BASIC),
            ("IoInfo", IO_COUNTERS),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateJobObjectW.restype = wintypes.HANDLE
    k32.CreateJobObjectW.argtypes = [wintypes.LPVOID, wintypes.LPCWSTR]
    k32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD]
    k32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    k32.CloseHandle.argtypes = [wintypes.HANDLE]

    job = k32.CreateJobObjectW(None, None)
    if not job:
        return None
    info = EXTENDED()
    # PROCESS_MEMORY (0x100) | ACTIVE_PROCESS (0x8) | KILL_ON_JOB_CLOSE (0x2000)
    info.BasicLimitInformation.LimitFlags = 0x100 | 0x8 | 0x2000
    info.BasicLimitInformation.ActiveProcessLimit = 1
    info.ProcessMemoryLimit = memory_bytes
    ok = k32.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info))
    ok = ok and k32.AssignProcessToJobObject(job, wintypes.HANDLE(int(proc._handle)))  # noqa: SLF001
    if not ok:
        k32.CloseHandle(job)
        return None
    return job


def _close_windows_job(job) -> None:  # pragma: no cover - Windows only
    if job:
        ctypes.WinDLL("kernel32").CloseHandle(ctypes.c_void_p(job))


# ---- the parent-side runner ----------------------------------------------------------


def run_isolated(
    target: str,
    payload: bytes,
    *,
    timeout: float,
    memory_mb: int,
    max_output_bytes: int = DEFAULT_MAX_OUTPUT,
    extra_pythonpath: Sequence[str] = (),
) -> bytes:
    """Run ``target`` (``"package.module:function"``, ``bytes -> bytes``) in a worker process.

    Raises a :class:`SandboxError` subclass on timeout, over-limit, crash or spawn failure.
    """
    exe, paths = _python_and_paths(extra_pythonpath)
    cmd = [exe, "-B", "-P", "-m", "freight_recovery.sandbox.worker", target, str(memory_mb), str(int(timeout) + 2)]
    kwargs: dict = {}
    if _IS_WINDOWS:
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    try:
        proc = subprocess.Popen(  # noqa: S603 - fixed argv, no shell
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=_child_env(paths),
            cwd=tempfile.gettempdir(),
            close_fds=True,
            **kwargs,
        )
    except OSError as exc:
        raise SandboxUnavailable("worker process could not be started") from exc

    job = _windows_job(proc, (memory_mb + 256) * 1024 * 1024) if _IS_WINDOWS else None
    out = bytearray()
    overflow = threading.Event()

    def pump_out() -> None:
        assert proc.stdout is not None
        while chunk := proc.stdout.read(65536):
            out.extend(chunk)
            if len(out) > max_output_bytes:
                overflow.set()
                proc.kill()
                return

    def pump_in() -> None:
        assert proc.stdin is not None
        try:
            proc.stdin.write(payload)
            proc.stdin.close()
        except (BrokenPipeError, OSError):
            pass  # worker died or was killed; its exit status tells the story

    readers = [threading.Thread(target=pump_out, daemon=True), threading.Thread(target=pump_in, daemon=True)]
    for t in readers:
        t.start()
    timed_out = False
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        proc.kill()
        proc.wait()
    finally:
        for t in readers:
            t.join(timeout=5)
        for stream in (proc.stdout, proc.stdin):
            try:
                if stream:
                    stream.close()
            except OSError:
                pass
        if job:
            _close_windows_job(job)

    if timed_out:
        raise SandboxTimeout("worker exceeded the wall-clock limit")
    if overflow.is_set():
        raise SandboxTooLarge("worker output exceeded the limit")
    code = proc.returncode
    if code == 0:
        return bytes(out)
    if code == EXIT_MEMORY:
        raise SandboxTooLarge("worker exceeded the memory limit")
    if code == EXIT_WATCHDOG or (_SIGXCPU is not None and code == -_SIGXCPU):
        raise SandboxTimeout("worker exceeded the CPU/wall-clock limit")
    raise SandboxFailed(f"worker exited abnormally (code {code})")


class SandboxRunner:
    """Bounded concurrency in front of :func:`run_isolated` (back-pressure instead of overload)."""

    def __init__(
        self, *, timeout: float, memory_mb: int, max_workers: int, queue_timeout: float
    ) -> None:
        self.timeout = timeout
        self.memory_mb = memory_mb
        self.queue_timeout = queue_timeout
        self._slots = threading.BoundedSemaphore(max_workers)

    def run(self, target: str, payload: bytes, **kwargs) -> bytes:
        """Run one job; waits up to ``queue_timeout`` for a free slot, else :class:`SandboxBusy`."""
        if not self._slots.acquire(timeout=self.queue_timeout):
            raise SandboxBusy("all worker slots are busy")
        try:
            return run_isolated(
                target, payload, timeout=self.timeout, memory_mb=self.memory_mb, **kwargs
            )
        finally:
            self._slots.release()
