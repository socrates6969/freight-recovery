"""Constants shared by conftest and test modules (no side effects on import)."""

from __future__ import annotations

# A well-formed, deterministic API key for the default test tenant.
# Format: frk_<8 hex>_<43 url-safe chars>. Never used outside tests.
TEST_API_KEY = "frk_0a1b2c3d_" + "T" * 43
TEST_TENANT_NAME = "test-tenant"
TEST_PEPPER = "test-pepper-0123456789abcdef0123456789abcdef"

AUTH = {"X-API-Key": TEST_API_KEY}
