"""Swappable extraction-provider interface.

The pipeline only depends on :class:`ExtractionProvider`. The default
:class:`~freight_recovery.extraction.stub.DeterministicStubProvider` is a
rule-based parser that works offline with no API key. A hosted-model provider
can be added by implementing the same Protocol (see ``LLMExtractionProvider``).
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from freight_recovery.models import BillOfLading, Invoice, RateConfirmation, RawDocument

Extracted = Invoice | RateConfirmation | BillOfLading


@runtime_checkable
class ExtractionProvider(Protocol):
    """Turns one :class:`RawDocument` into a typed extraction result."""

    name: str

    def extract(self, doc: RawDocument) -> Extracted | None:
        """Return the typed extraction for ``doc`` or ``None`` if the type is unsupported."""
        ...


class LLMExtractionProvider:
    """Placeholder for a hosted-LLM extraction provider (NOT implemented).

    TODO: call a model with a JSON schema derived from the pydantic models,
    validate the response with pydantic, and fall back to the stub on failure.
    Keep it behind this interface so tests stay deterministic and offline.
    """

    name = "llm"

    def extract(self, doc: RawDocument) -> Extracted | None:  # pragma: no cover
        raise NotImplementedError("LLM provider is not implemented in this MVP; use 'stub'.")
