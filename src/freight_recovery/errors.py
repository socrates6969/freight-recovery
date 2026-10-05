"""Domain exceptions with fixed, client-safe messages.

The API maps :class:`InputError` to HTTP 422. Messages must never contain
document content (they are returned to the caller and may be logged).
"""

from __future__ import annotations

import decimal

from pydantic import ValidationError


class InputError(Exception):
    """The submitted documents could not be processed (maps to HTTP 4xx)."""


class IngestError(InputError):
    """A file could not be decoded/parsed (bad PDF, malformed CSV, ...)."""


class RuleInputError(InputError):
    """Extracted values are internally inconsistent (e.g. mixed timezones)."""


# Exceptions that hostile or malformed *content* can raise inside the pipeline (NaN/Infinity,
# huge exponents, schema failures, undecodable bytes). Callers map them to a fixed 422
# message; their text can contain document content and must never be returned or logged.
UNPROCESSABLE_EXCEPTIONS: tuple[type[BaseException], ...] = (
    ValidationError,
    decimal.DecimalException,
    ArithmeticError,
    UnicodeError,
)
