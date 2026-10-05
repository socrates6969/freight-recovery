# SDK and usage examples

!!! warning "No official SDK exists"
    The API is small and pre-product, so there is no generated or supported client library yet.
    The examples below use plain HTTP. If you want a typed client, generate one from
    [openapi.json](api/openapi.json) with a standard OpenAPI generator and treat it as
    unsupported until the API stabilises (see the [changelog](changelog.md)).

## Python (httpx)

```python
import os
from pathlib import Path

import httpx

BASE = os.environ.get("FR_BASE_URL", "http://127.0.0.1:8000")
HEADERS = {"X-API-Key": os.environ["FR_API_KEY"]}  # never hard-code a key

docs = Path("tests/fixtures/ld5001")
files = [("files", (n, (docs / n).read_bytes())) for n in
         ("invoice.txt", "rate_confirmation.txt", "bol.txt")]

with httpx.Client(base_url=BASE, headers=HEADERS, timeout=60) as client:
    r = client.post("/v1/analyze", data={"perspective": "shipper"}, files=files)
    if r.status_code == 503:                       # busy: retry after the server's hint
        raise RuntimeError(f"busy, retry in {r.headers.get('Retry-After', '5')}s")
    r.raise_for_status()
    body = r.json()

    result = body["packet"]["result"]
    print("analysis:", body["analysis_id"])
    print("recoverable (confirmed only):", result["recoverable_total"])
    print("pending human review:", result["pending_review_total"])
    for f in result["findings"]:
        flag = " [needs human review]" if f["needs_human_review"] else ""
        print(f'- {f["rule_id"]}: {f["amount"]}{flag}')

    # Later: fetch it again, or page through your analyses
    again = client.get(f"/v1/analyses/{body['analysis_id']}").json()
    page = client.get("/v1/analyses", params={"limit": 20, "offset": 0}).json()
    print(page["total"], "analyses")
```

Use `decimal.Decimal(result["recoverable_total"])` for arithmetic; amounts are strings on purpose.

### Inline text with JSON

```python
payload = {
    "perspective": "carrier",
    "documents": [{"filename": "invoice.txt", "content": Path("invoice.txt").read_text()}],
}
r = httpx.post(f"{BASE}/v1/analyze/text", headers=HEADERS, json=payload, timeout=60)
```

## curl

```bash
# Analyze
curl -s -H "X-API-Key: $KEY" -F perspective=shipper \
  -F files=@invoice.txt -F files=@rate_confirmation.txt -F files=@bol.txt \
  "$BASE/v1/analyze"

# Page through your analyses (limit 1-100, default 50)
curl -s -H "X-API-Key: $KEY" "$BASE/v1/analyses?limit=20&offset=0"

# Bearer form of the same key
curl -s -H "Authorization: Bearer $KEY" "$BASE/v1/analyses"
```

## Practical guidance

- **Human in the loop.** Findings flagged `needs_human_review` are not part of `recoverable_total`.
  The demand letter is a draft; the API never contacts a carrier or shipper.
- **One load per request.** Send the invoice, rate confirmation and BOL for a single load
  together (up to 10 files, 10 MiB each, 25 MiB total request).
- **Synchronous.** The call returns when the analysis is done. Set a client timeout comfortably
  above the server's parse limit (default 30 s). Asynchronous jobs and webhooks are **planned**.
- **Idempotency.** There is no idempotency key yet; retrying a successful call creates a second
  stored analysis. Retry only on `503` or on network failures where you did not get a response.
