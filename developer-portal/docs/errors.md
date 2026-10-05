# Errors

Failures are JSON with a `detail` field. Messages are fixed strings and **never echo document
content**, so they are safe to log. A failed analysis is still recorded for your tenant with
an `error_code` (visible in `GET /v1/analyses`).

| Status | When | `detail` | Retry? |
|---|---|---|---|
| `401` | No API key | `API key required.` (`WWW-Authenticate: Bearer`) | After adding a key |
| `403` | Any invalid key (malformed, unknown, revoked, tenant deactivated) | `Invalid API key.` | No: fix or replace the key |
| `404` | Analysis id missing **or** owned by another tenant | `Analysis not found.` | No |
| `413` | A file over 10 MiB, more than 10 files, request body over 25 MiB, or parsing hit the memory/output limit | e.g. `A file exceeds 10485760 bytes.`, `At most 10 files per request.`, `Request body exceeds 26214400 bytes.`, `Processing exceeded the size/memory limit.` | No: shrink the input |
| `422` | Input could not be processed (details below) | see below | No: fix the input |
| `503` | All parsing worker slots busy, worker unavailable, or document storage unavailable | `The server is busy; retry shortly.` (with `Retry-After: 5`), `Processing is temporarily unavailable.`, `Document storage is unavailable.` | Yes, with backoff |

## 422: what it means

There are three shapes:

1. **Request validation** (missing field, bad enum, out-of-range query parameter). The body lists
   field paths and error codes only, never the submitted values:

    ```json
    {"detail": [{"loc": ["body", "perspective"], "type": "enum"}]}
    ```

2. **Documents could not be processed**: undecodable bytes, a bad PDF or malformed CSV,
   NaN/huge numbers, internally inconsistent extracted values (for example mixed timezones),
   or a worker that failed. The message is fixed and generic:

    ```json
    {"detail": "The submitted documents could not be processed."}
    ```

3. **Processing time limit exceeded** (default 30 s of wall-clock parsing):

    ```json
    {"detail": "Processing exceeded the time limit."}
    ```

!!! note "Status choice"
    A parsing *time* limit is a `422` and a parsing *memory or output* limit is a `413`. Both
    mean "this input is too expensive to process", so shrink or simplify it rather than retry.

## 503 and retries

`503` means the server declined or could not do the work, not that your input is bad. When the
body says the server is busy, the response carries `Retry-After: 5`. Back off exponentially with
jitter. Because there is no idempotency key yet, a retry after a `503` that arrived **after**
the work started could create a second stored analysis; failed analyses are recorded with an
`error_code` (`busy`, `worker_unavailable`, `storage_unavailable`, `timeout`, `too_large`,
`unprocessable`, `input_error`, `worker_failed`, `internal_error`).

## Not implemented

- `429 Too Many Requests`: there is no rate limiting yet ([planned](rate-limits.md)).
- Error-code catalogue with stable machine-readable `code` fields in response bodies:
  **planned**. Today, branch on the HTTP status.
