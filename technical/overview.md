# Freight Recovery - Technical Overview

> **Status: pre-product. As of this writing the repository contains documentation only; there is no source code to match.** This overview describes the *intended* architecture so that code can be written to it. When code lands, update this file so each stage maps to a module and each claim to a test. Nothing here has been measured.

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

## 4. Security and privacy (baseline)
Encrypted storage and transit, per-customer data isolation, role-based access, audit logging, retention limits, redaction of personal data in eval sets, and treatment of all inbound documents as untrusted. SOC 2 is a later milestone driven by customer demand.

## 5. Open technical questions
1. What fraction of documents arrive as clean PDFs versus scans and photos?
2. Which timestamps are legally and commercially accepted as proof (gate logs, ELD, geofence, visibility), and for which counterparties?
3. How much human review per claim is needed to meet the quality bar (drives gross margin)?
4. Build versus buy for OCR and EDI parsing.
