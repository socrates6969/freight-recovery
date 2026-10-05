"""Extraction orchestration and provider registry."""

from __future__ import annotations

from freight_recovery.models import (
    BillOfLading,
    ExtractedBundle,
    Invoice,
    RateConfirmation,
    RawDocument,
)

from .provider import ExtractionProvider
from .stub import DeterministicStubProvider


def get_provider(name: str = "stub") -> ExtractionProvider:
    """Resolve a provider by name. Only ``stub`` is implemented in the MVP."""
    if name == "stub":
        return DeterministicStubProvider()
    raise ValueError(f"Unknown or unimplemented extraction provider: {name!r}")


def extract_bundle(docs: list[RawDocument], provider: ExtractionProvider) -> ExtractedBundle:
    """Extract every document and assemble one :class:`ExtractedBundle` per load.

    If several documents of one type are supplied the first wins and a warning
    is recorded (multi-document loads are TODO).
    """
    bundle = ExtractedBundle()
    for doc in docs:
        bundle.warnings += [f"{doc.filename}: {w}" for w in doc.warnings]
        result = provider.extract(doc)
        if result is None:
            bundle.warnings.append(f"{doc.filename}: unrecognised document type; skipped")
            continue
        slot = {
            Invoice: "invoice",
            RateConfirmation: "rate_confirmation",
            BillOfLading: "bol",
        }[type(result)]
        if getattr(bundle, slot) is not None:
            bundle.warnings.append(f"{doc.filename}: duplicate {slot}; ignored")
            continue
        setattr(bundle, slot, result)
        bundle.warnings += [f"{doc.filename}: {w}" for w in result.extraction_warnings]
    loads = {
        x.load_number
        for x in (bundle.invoice, bundle.rate_confirmation, bundle.bol)
        if x is not None and x.load_number
    }
    if len(loads) > 1:
        bundle.warnings.append(f"Load numbers disagree across documents: {sorted(loads)}")
    return bundle
