# Authentication

!!! warning "Pre-product"
    There is no self-serve signup. Keys are issued by an operator with a command-line tool
    against a database they control. A hosted service does not exist yet.

Every route except `GET /health` needs an API key. The key identifies exactly one **tenant**;
all data you create or read is scoped to that tenant.

## Sending the key

Either header works:

```http
X-API-Key: frk_1a2b3c4d_<43-character secret>
Authorization: Bearer frk_1a2b3c4d_<43-character secret>
```

The tenant is derived **only** from the key. Passing a tenant id in a header, query string or
body has no effect.

Authentication runs **before** the request body is read, so an unauthenticated client cannot
make the server accept a large upload just to be told no.

## 401 versus 403

| Situation | Status | Body |
|---|---|---|
| No key presented | `401` (`WWW-Authenticate: Bearer`) | `{"detail":"API key required."}` |
| A key is presented but is not valid, for **any** reason | `403` | `{"detail":"Invalid API key."}` |

The `403` message is deliberately identical for every cause (malformed, unknown, wrong secret,
revoked key, deactivated tenant), so the response is not an oracle for guessing keys.

A valid key reading another tenant's resource gets `404`, indistinguishable from a resource that
does not exist.

## Key format and lifecycle

Format: `frk_<8 hex prefix>_<43-character URL-safe secret>` (about 256 bits of entropy).

1. **Issue.** An operator creates the tenant and issues a key with the admin CLI
   (`python -m freight_recovery.admin create-tenant "<name>"`, then `issue-key "<name>" --label "<note>"`).
   The raw key is printed **once**.
2. **Store it as a secret.** The server keeps only `HMAC-SHA256(pepper, key)`; the pepper lives
   outside the database. A lost key cannot be recovered, only replaced.
3. **Rotate.** Issue a new key, switch your integration to it, then revoke the old one. A tenant
   can hold several active keys, so rotation needs no downtime.
4. **Revoke.** An operator revokes a key by id (`revoke-key <key-id>`); it returns `403` from then on.
5. **Deactivate a tenant.** All of the tenant's keys return `403`.

Treat a key like a password: keep it out of source control, logs and browser code, and call the
API from your server, not from end users' browsers.

## Planned (not built)

- Self-serve key creation, scopes or read-only keys, per-key rate limits and expiry.
- Key-usage and audit export. Today there is an application-level audit log line only
  (tenant, analysis id, outcome, document hashes; never document content).
