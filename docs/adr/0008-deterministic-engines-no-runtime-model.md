# ADR 0008: Deterministic, explainable engines; no trained model or LLM call at runtime

- **Status:** accepted (retroactive)
- **Decided:** 2026-10-05 for the Python core ("Provider interface, deterministic default"); 2026-10-09 to
  2026-10-11 for the TS intelligence features (`1ce0e52` priority-v1 and similar-v1, `959aa36` charge-knn-v1,
  `9625edd` evaluation tool, `53096a5` leave-one-carrier-out CI gate)
- **Reconstructed from:** `ARCHITECTURE.md` ("There is no trained model and no LLM call"), `api/src/intelligence/priority.ts`,
  `packages/shared/src/charge-intel/`, `api/src/eval/*`, `CLAUDE.md` hard rule 10, `technical/overview.md`

## Context

Every amount in a packet must survive a carrier's dispute team asking "how did you get this number". A
generative model that produces amounts cannot answer that question the same way twice. At the same time the
project has no real documents to train or evaluate a model on, only synthetic fixtures.

## Decision

- All money arithmetic runs in deterministic rule code (`@fr/shared/analysis`, `fuel/`, `ocean-dd/`). Each
  finding carries a rule id, an amount, a step-by-step calculation and a `needs_human_review` flag.
- "Intelligence" features are fixed, documented formulas: `priority-v1` (a weighted sum of stored amounts),
  `similar-v1`, and `charge-knn-v1`, which compares a charge name with labelled examples. Learned suggestions only
  ever add review items; they never change a rule's money output and never appear in the draft letter.
- Extraction sits behind a provider interface (`provider_name`, `provider_version` recorded per document). The
  only provider is deterministic. The Python `LLMExtractionProvider` is a placeholder that raises.
- Evaluation CLIs (`npm run eval`, `eval:charges`, `eval:outlook`) gate CI on synthetic sets and record pass^k
  statistics. They are regression checks, not accuracy measures, and the docs say so.

## Consequences

- Outputs are reproducible and auditable, and parity with the Python reference is testable (ADR 0003).
- Real carrier PDFs with complex layouts, scans and photos will extract poorly until a layout-aware or OCR
  provider exists. That is the largest functional gap between the codebase and a paying customer.
- Any future model must enter through the provider interface, be recorded per document, and pass the same eval
  gates; it may not produce amounts directly.
