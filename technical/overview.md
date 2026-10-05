# Freight Recovery - Technical Overview

> **Status: pre-product MVP scaffold.** `src/freight_recovery/` contains an offline, deterministic skeleton of the pipeline (about 1,100 lines, 29 tests, FastAPI + CLI). It has never run on real customer documents. Section 0 says exactly what exists; the rest of this file describes the target architecture and marks what is **not built yet**. Nothing here has been measured.

## 0. What the code does today (verified by reading the source)

| Stage | Module | Implemented | Not implemented (TODO in code or this doc) |
|---|---|---|---|
| Ingest | `ingest/loader.py` | Classifies and normalizes text, CSV, and PDF text into `RawDocument` | OCR for scans/photos, email parsing, EDI 210/214 |
| Extract | `extraction/` (`provider.py`, `stub.py`, `service.py`) | Swappable `ExtractionProvider` interface; default is a **rule-based, offline stub** that parses `Key: Value` lines into Invoice / RateConfirmation / BillOfLading models | `LLMExtractionProvider` is a placeholder that raises `NotImplementedError`; no layout-aware parsing; no per-field source pointers yet |
| Rules | `rules/` (`detention.py`, `invoice_checks.py`, `engine.py`) | Deterministic Decimal arithmetic: detention (clock starts at later of appointment/arrival, free time, 15-min round-down, optional cap) and invoice checks (rate, fuel, unauthorized accessorials via keyword match, duplicates, totals), shipper and carrier perspectives | Carrier-specific charge codes, tariff/contract lookup, multi-stop, weekend/holiday terms, timezone-aware timestamps |
| Evidence | `evidence/` (`packet.py`, `letter.py`) | Markdown evidence packet and demand-letter draft; dispute window set to 90 days (configurable constant) | Independent verifier, citation spans checked against sources, carrier/contract-specific deadlines |
| Output | `api/main.py`, `cli.py`, `pipeline.py` | `POST /v1/analyze`, `POST /v1/analyze/text`, `/health`; CLI prints the packet | Case tracking, reminders, dispute status, human approval workflow, immutable audit trail |

Also absent: the pass^k eval harness and gold set (described in section 2 as the plan). The existing tests use small synthetic fixtures (`tests/fixtures/ld5001`, `ld5002`) and prove the arithmetic and plumbing, not real-world accuracy.

## 1. The pipeline in plain language

A claim moves through five stages. Each stage has one job, a defined input and output, and its own tests.

```
 ingest  ->  extract  ->  rules  ->  evidence  ->  output
 (files)    (facts)     (entitlement) (proof pack)  (demand + tracking)
                                 \________ human approval gate ________/
```

1. **Ingest.** Accept rate confirmations, BOL/POD, accessorial invoices, and emailed documents (PDF, image, email, later EDI 210/214 and API feeds). Normalize to text/structured pages; keep the original file and a content hash so every later citation points to a real page.
2. **Extract.** Turn documents into structured facts: parties, load ID, appointment window, arrival and departure times, free time, rate, accessorial line items, and the contract clause text. Uses OCR plus an LLM for messy documents. Every extracted value carries a **source pointer** (document, page, span). Low-confidence extractions are flagged for human review rather than guessed.
3. **Rules.** A deterministic rules engine decides entitlement and amount: free time elapsed, rate per hour, caps, notice requirements, claim deadlines. The LLM does **not** compute money. Rules are versioned, readable, and testable; contract-language extraction proposes rules that a person reviews.
4. **Evidence.** Assemble the proof packet: a timeline of timestamps with citations, the governing clause, the calculation, and exhibits. A separate **verifier** step checks every sentence in the packet against the cited source and rejects uncited or contradicted claims.
5. **Output.** Produce a ready-to-send demand/invoice and a case record with deadlines, follow-up reminders, dispute status, and outcome. **A human approves before anything is sent** and an immutable audit trail records inputs, versions, and decisions.

### Design principles
- **LLM for reading, code for deciding.** Language models extract and draft; arithmetic and entitlement are deterministic.
- **No citation, no claim.** The verifier blocks any statement that cannot be traced to a source span.
- **Human in the loop** for send/escalate, with configurable thresholds.
- **No money movement** in v1.
- **Data minimization.** Driver location and personal data are handled under CCPA/GDPR assumptions; confirm with counsel (open item).

## 2. Verification and eval approach (pass^k)

Eval-first: the gold set is built **before** the pipeline.

- **Gold set.** 100+ cases (start from a design partner's closed files, redacted; supplement with synthetic cases for edge conditions) with ground-truth fields, entitlement, and amount. Split dev/holdout; never tune on holdout.
- **Stage metrics.** Extraction field accuracy; rules correctness (exact amount match); citation validity (every cited span supports its sentence); packet completeness; false-claim rate.
- **pass^k.** For each case, run the whole pipeline k times (k = 5 as a starting value, ASSUMPTION). A case "passes^k" only if **all k runs** produce a correct, fully-cited result. Report the share of cases that pass^k, not just single-run accuracy. This penalizes flakiness: if per-run success is p and runs are independent, pass^k is roughly p^k, so 95% per-run becomes ~77% at k=5. That is the figure that matters when customers rely on it.
- **Independent verifier.** The verifier is separate from the drafter (different prompt and, where practical, different model) so one failure mode does not pass both.
- **Bars set in advance.** Example (ASSUMPTION, to be fixed before measurement): zero hallucinated citations on holdout, pass^5 above an agreed percentage on money-bearing fields, and a defined human-review rate. If the bar is not met, the product is not shown to customers.
- **Regression + red team.** Prompt-injection in inbound documents (emails/PDFs are untrusted input), adversarial and ambiguous contracts, and tampered timestamps.
- **Production monitoring.** Track recovery rate, human override rate, and dispute outcomes as ongoing evals; feed outcomes back to the rules and the gold set.

## 3. Integration roadmap

| Phase | Integration | Why | Notes |
|---|---|---|---|
| 0 | Manual upload (PDF/image/email forward), CSV | Fastest path to design-partner data | No integration dependency |
| 1 | EDI 210 (invoice) / 214 (status) and AP/email inbox parsing | Shipper-side audit, carrier invoice streams | Common formats; vendor-by-vendor quirks |
| 2 | ELD/telematics APIs (e.g., Motive, Samsara) | Timestamp proof for carrier-side detention | Customer-authorized access; privacy review required |
| 3 | TMS integrations (e.g., MercuryGate, others) | Load, rate, and appointment data without uploads | Largest onboarding friction reducer |
| 4 | Visibility platforms (e.g., project44, FourKites) | Arrival/departure timestamps at scale | Partnership first; they are also potential competitors |
| 5 | Dock-scheduling and accounting systems | Appointment evidence; closing the loop on payment | After core is proven |

Named vendors are targets under consideration, not agreements. Integration feasibility and terms are unverified.

## 3b. Forecasting (roadmap)

Optional, off by default, not in the core recovery flow. `freight_recovery.forecast` defines a `Forecaster` interface (`fit` / `predict`, single or multi-series) with a stdlib-only `SeasonalBaselineForecaster` (seasonal-naive / moving average; deterministic; runs in CI). `NeuralForecastForecaster` (NHITS via neuralforecast) is scaffolding behind the `forecast` pip extra (`neuralforecast`, `torch`), imported lazily: without the extra the module still imports and only constructing it raises an "install the [forecast] extra" error. The extra is not hash-locked and not in the Docker image. It is unvalidated; it needs real multi-series history and often only ties the baseline, so any use must be benchmarked against the baseline first. Use: recovery prioritization only.

## 4. Security and privacy (baseline)
Encrypted storage and transit, per-customer data isolation, role-based access, audit logging, retention limits, redaction of personal data in eval sets, and treatment of all inbound documents as untrusted. SOC 2 is a later milestone driven by customer demand.

## 5. Open technical questions
1. What fraction of documents arrive as clean PDFs versus scans and photos?
2. Which timestamps are legally and commercially accepted as proof (gate logs, ELD, geofence, visibility), and for which counterparties?
3. How much human review per claim is needed to meet the quality bar (drives gross margin)?
4. Build versus buy for OCR and EDI parsing.
