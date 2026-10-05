# Freight Recovery API

!!! warning "Pre-product software"
    This documents the **real, current** API of a pre-product codebase. Nothing here has been
    validated on real customer data, no customer is using it, and no hosted service exists yet
    (there is no public base URL). Rules and thresholds are illustrative and unmeasured. Treat
    every dollar figure as an unreviewed estimate that a person must check before any dispute
    is sent. Anything not described as "implemented" below is **planned, not built**.

## What the API does today

You send the documents for **one freight load** (carrier invoice, rate confirmation, bill of
lading / gate record) and a perspective, `shipper` or `carrier`. The API returns:

- the values it extracted from each document,
- rule findings with the arithmetic shown (detention clock, linehaul and fuel above the rate
  confirmation, accessorials not authorized, repeated lines, invoice total above the sum of lines),
- `recoverable_total`: the sum of **confirmed** findings only,
- `pending_review_total`: findings that need a human (listed, **not** claimed),
- an evidence packet (Markdown) and a **DRAFT** demand letter. Nothing is ever sent for you.

Every analysis is stored per tenant and can be listed and fetched again.

## What is implemented vs planned

| Area | Status |
|---|---|
| Per-tenant API keys, tenant isolation, 401/403/404 semantics | Implemented ([Authentication](authentication.md)) |
| `POST /v1/analyze`, `POST /v1/analyze/text`, `GET /v1/analyses`, `GET /v1/analyses/{id}` | Implemented ([Reference](api/reference.md)) |
| Parsing in a bounded worker process (timeout, memory cap) | Implemented; process isolation, not a security sandbox |
| Extraction | Deterministic `Key: Value` text parser. Real carrier PDFs need layout-aware parsing/OCR: **planned** |
| TMS, carrier-portal, EDI (204/210/214) integrations | **Planned, not built** |
| Dispute filing, email/portal submission, deadline tracking, payments/credit-memo reconciliation | **Planned, not built** |
| Asynchronous jobs and webhooks | **Planned**; analyses are synchronous today |
| Rate limiting (`429`) | **Planned** ([Rate limits](rate-limits.md)) |
| Official SDKs | **None exist** (see [examples](sdk.md) using plain HTTP) |
| Self-serve signup / key management | **None**; keys are issued by an operator with a CLI |
| Uptime or latency commitments, SLA, hosted environment | **None** |
| Security audit and compliance sign-off | **Not done**; required before real customer data |

## Where to start

1. [Authentication](authentication.md): how a key is issued, sent, rotated and what 401 vs 403 mean.
2. [Quickstart](quickstart.md): run the service locally and `curl` the real endpoints.
3. [API reference](api/reference.md) (generated from the application's OpenAPI document; also
   [Redoc](api/redoc.html)).
4. [Errors](errors.md), [Rate limits](rate-limits.md), [Changelog](changelog.md).

## Perspective

- **shipper**: recovers *overcharges* (billed more than the rate confirmation or the supported detention).
- **carrier**: recovers detention and accessorials *earned but unbilled or under-billed*.

Rules are one-directional per perspective today (linehaul, fuel and total only flag
overcharges), so a carrier run does not find under-billed linehaul.
