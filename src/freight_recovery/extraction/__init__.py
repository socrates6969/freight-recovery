"""Extraction: documents -> typed fields, via a swappable provider interface."""

from .provider import ExtractionProvider, LLMExtractionProvider
from .service import extract_bundle, get_provider
from .stub import DeterministicStubProvider

__all__ = [
    "DeterministicStubProvider",
    "ExtractionProvider",
    "LLMExtractionProvider",
    "extract_bundle",
    "get_provider",
]
