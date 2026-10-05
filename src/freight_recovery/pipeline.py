"""End-to-end pipeline: files -> ingest -> extract -> rules -> evidence packet."""

from __future__ import annotations

from datetime import datetime

from freight_recovery.config import Settings
from freight_recovery.evidence import build_packet
from freight_recovery.extraction import ExtractionProvider, extract_bundle, get_provider
from freight_recovery.ingest import ingest_bytes
from freight_recovery.models import EvidencePacket, Perspective
from freight_recovery.rules import apply_rules


def run_pipeline(
    files: list[tuple[str, bytes]],
    perspective: Perspective = Perspective.SHIPPER,
    settings: Settings | None = None,
    provider: ExtractionProvider | None = None,
    now: datetime | None = None,
) -> EvidencePacket:
    """Run the full pipeline on ``(filename, bytes)`` pairs for one load."""
    settings = settings or Settings.from_env()
    provider = provider or get_provider(settings.extraction_provider)
    docs = [ingest_bytes(name, data) for name, data in files]
    bundle = extract_bundle(docs, provider)
    result = apply_rules(bundle, perspective, settings)
    return build_packet(docs, bundle, result, now=now, window_days=settings.dispute_window_days)
