# Quickstart

!!! warning "Pre-product"
    There is no hosted API. This quickstart runs the service **on your machine** with synthetic
    fixture documents. Do not upload real customer documents anywhere until the security audit
    and compliance review noted in the [overview](index.md) are done.

## 1. Run the service locally

From the repository root (Python 3.11+; hash-locked install):

```bash
python -m venv .venv
source .venv/bin/activate        # Windows Git Bash: source .venv/Scripts/activate
pip install --require-hashes --no-deps -r requirements.txt

export PYTHONPATH=src FR_ENV=dev FR_DOCS_MODE=auth
export FR_API_KEY_PEPPER=dev-pepper-not-a-secret-0123456789abcdef
python -m freight_recovery.db.migrate                       # creates ./freight_recovery.db
python -m freight_recovery.admin create-tenant "Acme Logistics"
python -m freight_recovery.admin issue-key "Acme Logistics" --label quickstart   # prints the key once
uvicorn freight_recovery.api.main:app --app-dir src          # http://127.0.0.1:8000
```

Or with Docker: `docker compose up --build`, then run the two `admin` commands with
`docker compose run --rm api python -m freight_recovery.admin ...` (see the repository README).

```bash
export BASE=http://127.0.0.1:8000
export KEY=frk_...      # the key printed by issue-key
```

## 2. Check the three auth outcomes

```bash
curl -s $BASE/health                                         # 200 {"status":"ok","version":"0.1.0"}
curl -s -o /dev/null -w '%{http_code}\n' $BASE/v1/analyses   # 401: no key
curl -s -o /dev/null -w '%{http_code}\n' -H 'X-API-Key: wrong' $BASE/v1/analyses   # 403: invalid key
```

## 3. Analyze one load (multipart upload)

The repository ships synthetic documents for load `LD-5001`
(`tests/fixtures/ld5001/`). Upload the invoice, rate confirmation and BOL together:

```bash
curl -s -H "X-API-Key: $KEY" -F perspective=shipper \
  -F files=@tests/fixtures/ld5001/invoice.txt \
  -F files=@tests/fixtures/ld5001/rate_confirmation.txt \
  -F files=@tests/fixtures/ld5001/bol.txt \
  $BASE/v1/analyze
```

A real response (abridged; the full body also contains `extracted`, `markdown` and `disclaimer`):

```json
{
  "analysis_id": "8503a7b9-c21a-4e3a-96ae-7a942acb699d",
  "packet": {
    "load_number": "LD-5001",
    "perspective": "shipper",
    "documents": [
      {"filename": "invoice.txt", "doc_type": "invoice", "sha256": "702c1f0d..."},
      {"filename": "rate_confirmation.txt", "doc_type": "rate_confirmation", "sha256": "c44ed97a..."},
      {"filename": "bol.txt", "doc_type": "bol", "sha256": "b316aab6..."}
    ],
    "result": {
      "perspective": "shipper",
      "findings": [
        {"rule_id": "INV-LINEHAUL-RATE", "amount": "100.00", "confidence": 0.95,
         "needs_human_review": false,
         "explanation": "Invoice linehaul $1500.00 vs agreed $1400.00."},
        {"rule_id": "INV-ACCESSORIAL-UNAUTH", "amount": "150.00", "confidence": 0.6,
         "needs_human_review": true,
         "explanation": "'Lumper' ($150.00) is not listed as authorized on the rate confirmation. May be valid with a receipt or separate approval - verify before disputing."},
        {"rule_id": "DET-OVERBILLED", "amount": "225.00", "confidence": 0.85,
         "needs_human_review": false,
         "explanation": "Invoice billed $300.00 detention; gate times and rate-con terms support only $75.00."}
      ],
      "recoverable_total": "325.00",
      "pending_review_total": "150.00"
    },
    "demand_letter": "DRAFT - FOR HUMAN REVIEW. NOT SENT. NOT LEGAL ADVICE. ..."
  }
}
```

Read it like this: `recoverable_total` (`325.00`) counts only the two confirmed findings.
The lumper fee (`150.00`) needs human review, so it is reported separately in
`pending_review_total` and is **not** part of the claim or the demand letter. Money values are
decimal **strings**; confidence scores are unvalidated heuristics, not measured accuracy.
`confidence` and every threshold are placeholders until validated against real closed files.

## 4. Same thing with inline text (JSON)

```bash
curl -s -H "X-API-Key: $KEY" -H 'Content-Type: application/json' $BASE/v1/analyze/text -d '{
  "perspective": "shipper",
  "documents": [
    {"filename": "invoice.txt", "content": "DOCUMENT: FREIGHT INVOICE\nInvoice Number: INV-1001\nCarrier: Acme Freight LLC\nShipper: Widget Co\nLoad Number: LD-5001\nInvoice Date: 2025-03-10\nCharge: Linehaul | 1500.00\nTotal: $1,500.00"}
  ]
}'
```

## 5. List and fetch stored analyses

```bash
curl -s -H "X-API-Key: $KEY" "$BASE/v1/analyses?limit=10&offset=0"
curl -s -H "X-API-Key: $KEY" $BASE/v1/analyses/<analysis_id>
```

The list returns `{"items":[...],"total":N,"limit":10,"offset":0}`, newest first, for your tenant only.
An id that belongs to another tenant, or does not exist, returns `404`.

## 6. Get the OpenAPI document from a running server

Interactive docs are **off by default** (`FR_DOCS_MODE=off`, a `404`). With `FR_DOCS_MODE=auth`
the spec is served only with a valid key:

```bash
curl -s -H "X-API-Key: $KEY" $BASE/openapi.json
```

This portal ships a snapshot of that spec: [openapi.json](api/openapi.json).
