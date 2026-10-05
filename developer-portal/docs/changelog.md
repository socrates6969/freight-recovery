# Changelog

!!! warning "Pre-product"
    The API is `0.x` and may change without notice. Nothing here is a stability promise.
    The API version is the application version (`GET /health` and the OpenAPI `info.version`).

This changelog covers **API-visible** changes only. `developer-portal/openapi.json` is committed
and CI fails if it drifts from the code, so any API change shows up as a spec diff in review.

## 0.1.0 (pre-product, current)

Implemented:

- `GET /health` (anonymous).
- `POST /v1/analyze` (multipart upload) and `POST /v1/analyze/text` (inline JSON documents):
  extract, apply the detention and invoice-error rules, return the evidence packet and a DRAFT
  demand letter. Only confirmed findings count toward `recoverable_total`; findings needing human
  review are summed separately as `pending_review_total`.
- `GET /v1/analyses` (paged, newest first) and `GET /v1/analyses/{id}`, scoped to the caller's tenant.
- Per-tenant API keys (`X-API-Key` or `Authorization: Bearer`), `401` for no key, `403` for any
  invalid key, `404` for another tenant's resource.
- Fixed-message `422`/`413`/`503` error mapping; parsing in a bounded worker process.
- `/docs` and `/openapi.json` off by default (`FR_DOCS_MODE`).

Known gaps (also listed in the [overview](index.md)): deterministic text extraction only, no
integrations, no async jobs or webhooks, no rate limiting, no SDK, no self-serve keys, no
hosted environment.
