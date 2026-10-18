# ADR 0003: The Python core stays as the reference implementation and parity oracle

- **Status:** accepted (retroactive)
- **Decided:** 2026-10-09 to 2026-10-10 (`91743d4` "pure parsing core ... with Python parity", `d27c4a2` "port
  rules engine, letter and Markdown to @fr/shared/analysis with Python parity harness")
- **Reconstructed from:** `api/test/parity/extract.parity.test.ts`, `api/test/parity/rules.parity.test.ts`,
  `tools/parity/*.py`, `ARCHITECTURE.md` sections "Python parity: registered divergences" (D1-D8, RD1-RD13),
  `CLAUDE.md` (Python marked "Reference only", edits blocked by a hook), the owner's instruction in `BRIEF.md`

## Context

The Python service in `src/freight_recovery/` already contained the domain logic that matters most: the
detention clock, invoice checks, duplicate handling, the evidence packet and the draft letter, all in
`Decimal`, with 29 tests and regression fixtures. The TS platform needed the same logic at runtime. Two
independent implementations of money rules invite silent disagreement.

## Decision

- The TS platform runs its own port of the logic in `@fr/shared` (`analysis/` and the parsing core in
  `api/src/imports/parse/`). The API never calls Python at runtime.
- The Python code is frozen as the reference. A repository hook blocks edits to `src/freight_recovery/**`.
- Parity harnesses run the Python reference through `tools/parity/*.py` and require **exact string equality**
  with the TS output on the fixtures, the Python test inputs and a seeded generated corpus. The only allowed
  differences are registered divergences, each with a reason (D1-D8 for extraction, RD1-RD13 for rules).
- In CI a missing Python interpreter fails the parity suite; locally it is skipped with a message.

## Consequences

- A change to a money rule must either keep parity or add a registered divergence that a reviewer reads. This
  is a cheap, strong regression net for exactly the code a dispute letter quotes.
- Two runtimes stay in the repository, and the Python service still has its own API and developer portal, which
  has caused the drift described in `docs/architecture/dev-portal-drift.md`.
- Extensions written after the port (fuel check, ocean D&D, charge intelligence) have no Python counterpart;
  they rely on unit tests, acceptance suites and eval gates instead of parity.
- Rewriting the Python core is out of scope by owner decision.

## Alternatives

Calling the Python service from Node over HTTP or a subprocess at runtime would have avoided the port but added
a second deployable, a network hop and a second sandbox in the request path. The repository does not record a
formal comparison.
