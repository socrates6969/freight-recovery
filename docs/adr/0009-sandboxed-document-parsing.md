# ADR 0009: Untrusted documents are parsed in a bounded child process

- **Status:** accepted (retroactive)
- **Decided:** 2026-10-05 in Python (`e2d760c` "Run parsing in a bounded worker process (timeout, memory cap,
  clean env)"); 2026-10-09 in TS (`8edf788` "parse sandbox: child-process executor, hardened worker, guard,
  hostile-worker tests")
- **Reconstructed from:** `api/src/imports/sandbox/*`, `api/src/imports/sniff.ts`, `api/src/config.ts` (parse
  limits), `ARCHITECTURE.md` "Import pipeline (data flow)", threat model section 6

## Context

Customers upload carrier invoices, rate confirmations and bills of lading as PDF, image, CSV and text files
from senders we do not control. PDF and image parsers have a long history of memory-exhaustion and code
execution bugs. Parsing inside the API process would let one hostile file take down every tenant's requests.

## Decision

- Uploads are size-checked, then type-sniffed from their bytes (`sniff.ts`); markup, binary content and type
  mismatches are refused before storage.
- Parsing runs in a separate child process per job (`sandbox/spawn.ts`, `worker-main.ts`) with a wall-clock
  timeout (20 s default, ceiling 60 s), a memory cap (256 MB default, ceiling 1024 MB), an output cap, page and
  pixel limits, a clean environment and a per-tenant concurrency gate (`KeyedGate`).
- The worker returns structured results over a checked protocol (`protocol.ts`, `guard.ts`); the parent
  validates them and records reason codes such as `parse_timeout`, `parse_memory` and `malformed_pdf`.

## Consequences

- One bad file fails one document with a reason code instead of a whole request or process.
- This is process isolation, not an operating-system sandbox. seccomp, a read-only root filesystem and no-egress
  containment are deployment controls described for ECS but not verified (threat model).
- Throughput is bounded by `PARSE_MAX_CONCURRENCY` (default 2) per API instance; there is no queue, so large
  batches wait in the request. An async job queue is a known gap.
