# ADR 0005: Four-eyes separation of duties on claim and document decisions

- **Status:** accepted (retroactive)
- **Decided:** 2026-10-09 (`8eb7062`, run `REQ-20261009-four-eyes`, migration `20261011000000_four_eyes`);
  extended 2026-10-11 for D&D invoice editors (`10f8941`, `47a80bb`) and 2026-10-12 for label authors (`cd596c3`,
  `c3f131b`, migrations `20261018000000_hardening`, `20261019000000_hardening_fr2`)
- **Reconstructed from:** `packages/shared/src/four-eyes.ts`, `api/src/audit/label-authors.ts`,
  `api/src/audit/dd-editors.ts`, triggers `approvals_four_eyes_guard`, `approvals_four_eyes_ext_guard`,
  `import_review_decisions_four_eyes_guard`, `ARCHITECTURE.md` "Web platform: four-eyes" and "hardening",
  threat model section 8

## Context

A demand letter asks a carrier for money. If the same person can build a packet and approve it, one mistaken or
dishonest employee can put a wrong claim in front of a carrier with the company's name on it. Finance teams
expect maker-checker controls on anything that becomes a payable or receivable.

## Decision

- **Claims.** A user who created any revision of a claim's packet (current or superseded) cannot approve or
  reject the current revision. Since step 5 the analyzer counts as the author of revision 1. Since the hardening
  run, authors of team charge labels that influenced the analysis (`label_author`) and creators or editors of the
  ocean D&D invoice behind an `OCEAN_DD` claim are excluded too.
- **Imported documents.** The uploader and every user who recorded a field `CORRECT` or `ADD` cannot accept the
  document. An API-key upload counts as an upload by the key's creator.
- The service check is the primary control and runs under the claim row lock. Database triggers refuse the
  `approvals` or `ACCEPT` insert if the service check is bypassed. A refusal is one fixed 403
  (`four_eyes_required`) for every caller and is audited (`authz.four_eyes_denied`). The UI hiding the button is
  cosmetic only.
- Policy defaults D1-D4 and H-D1, H-D2 are written down with their flip points (for example, send-ready stays
  unrestricted; when the 50-id label list may be incomplete, every tenant label author is excluded).

## Consequences

- A tenant needs at least two active users with decision rights to move any claim to approved. A one-person
  customer cannot use the approval flow as designed; that is a product constraint, not a bug.
- Auto-accepted documents have no human acceptor (residual FE-S1, open question OQ-H4).
- Each new basis needs a service check, a trigger in a new migration, a basis text in `transparency-copy.ts` and
  an order entry in `FOUR_EYES_CLAIM_BASES`.
