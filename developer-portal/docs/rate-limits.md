# Rate limits

!!! warning "Planned, not implemented"
    The API has **no rate limiting today** and never returns `429`. This page records what exists
    and what is planned so integrators can design for it.

## What exists today (concurrency and size bounds, not rate limits)

| Bound | Value | Behaviour when exceeded |
|---|---|---|
| Files per request | 10 | `413` |
| Size per file | 10 MiB | `413` |
| Whole request body | 25 MiB | `413` |
| Inline document text | 1,000,000 characters each | `422` |
| Parsing wall-clock time | 30 s default (operator-configurable) | `422` |
| Parsing memory | 1024 MB default worker cap (operator-configurable) | `413` |
| Concurrent parsing workers | 4 default (operator-configurable) | wait up to 10 s, then `503` with `Retry-After: 5` |
| `GET /v1/analyses` page size | `limit` 1 to 100 (default 50) | `422` |

The concurrency bound is **server-wide**, not per tenant: one busy tenant can cause `503` for
others. These defaults are configuration (`FR_SANDBOX_*`), not contractual limits.

## Planned

- Per-tenant and per-key request-rate limits with `429` and `Retry-After`.
- Per-tenant concurrency fairness so one tenant cannot starve the worker pool.
- Published limits per plan, and standard `RateLimit-*` response headers.
- WAF / edge rate limiting in front of the service (a deployment-layer item; see the repository's
  `deploy/aws.md`).

Until then, keep your own client-side concurrency low (a handful of in-flight requests) and
honour `Retry-After` on `503`.
