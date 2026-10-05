"""API-key format, generation and hashing (pure functions; no web framework).

Key format: ``frk_<8 hex prefix>_<43-char url-safe secret>`` (about 256 bits of entropy).

* The **prefix** is a non-secret identifier used to find the row (indexed, unique).
* The **secret** is never stored. We store ``HMAC-SHA256(pepper, full_key)``.

Why a fast keyed hash and not bcrypt/argon2: these are machine-generated 256-bit
secrets, not human passwords, so there is nothing to brute-force and a slow hash only
adds per-request latency. The HMAC *pepper* (kept in Secrets Manager, not in the
database) means a database-only leak cannot be used to verify guessed keys. Rotating
the pepper invalidates every key, so rotate by issuing new keys first.
"""

from __future__ import annotations

import hmac
import re
import secrets
from hashlib import sha256

KEY_TAG = "frk"
_KEY_RE = re.compile(r"^frk_([0-9a-f]{8})_([A-Za-z0-9_-]{43})$")
MAX_KEY_LENGTH = 64  # len("frk_") + 8 + 1 + 43 = 56; anything longer is rejected before parsing


def generate_api_key() -> tuple[str, str]:
    """Return ``(prefix, raw_key)``. The raw key must be shown to the caller exactly once."""
    prefix = secrets.token_hex(4)
    return prefix, f"{KEY_TAG}_{prefix}_{secrets.token_urlsafe(32)}"


def parse_api_key(raw: str) -> str | None:
    """Return the key's prefix if ``raw`` is well-formed, else ``None``."""
    if not raw or len(raw) > MAX_KEY_LENGTH:
        return None
    match = _KEY_RE.match(raw)
    return match.group(1) if match else None


def hash_api_key(raw: str, pepper: str) -> str:
    """Keyed hash (hex) of a raw API key."""
    return hmac.new(pepper.encode("utf-8"), raw.encode("utf-8"), sha256).hexdigest()


def verify_api_key(raw: str, pepper: str, stored_hash: str) -> bool:
    """Constant-time comparison of ``raw`` against a stored hash."""
    return hmac.compare_digest(hash_api_key(raw, pepper), stored_hash)
