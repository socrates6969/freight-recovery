"""Bounded, out-of-process parsing. See :mod:`freight_recovery.sandbox.runner` for the
guarantees (and the honest limits: this is process isolation, not an OS sandbox)."""

from .runner import (
    SandboxBusy,
    SandboxError,
    SandboxFailed,
    SandboxRunner,
    SandboxTimeout,
    SandboxTooLarge,
    SandboxUnavailable,
    run_isolated,
)
from .targets import analyze_in_worker

__all__ = [
    "SandboxBusy",
    "SandboxError",
    "SandboxFailed",
    "SandboxRunner",
    "SandboxTimeout",
    "SandboxTooLarge",
    "SandboxUnavailable",
    "analyze_in_worker",
    "run_isolated",
]
