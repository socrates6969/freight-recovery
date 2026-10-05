"""Ingest: turn uploaded bytes (PDF/CSV/text) into :class:`RawDocument` objects."""

from .loader import classify, ingest_bytes

__all__ = ["classify", "ingest_bytes"]
