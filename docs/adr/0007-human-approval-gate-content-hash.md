# ADR 0007: A human approval gate bound to a content hash; the product sends nothing

- **Status:** accepted (retroactive)
- **Decided:** 2026-10-08 (`207479a` "claims/packets/approvals", `24070f7` approvals UI); the Python service set
  the same principle on 2026-10-05 ("Human in the loop. Output is a draft packet; nothing is sent.")
- **Reconstructed from:** `api/src/claims/state-machine.ts`, `api/src/claims/content-hash.ts`,
  `api/src/claims/service.ts`, trigger `fr_packet_update_guard`, `ARCHITECTURE.md` "Approval state machine"

## Context

Our output is an argument for money. A wrong number in a demand letter costs the customer credibility with a
carrier they depend on, and an automated sender would turn a parsing error into a relationship problem.
Separately, an approval is only meaningful if the thing approved cannot change afterwards.

## Decision

- Packets move `PENDING_REVIEW` to `APPROVED` or `REJECTED`, and `APPROVED` to `SEND_READY` (terminal). Editing
  creates a new revision and supersedes the old one. Every action needs a reason and writes an append-only
  `approvals` row plus an audit event in one transaction, with the claim locked `FOR UPDATE`.
- Approve records the packet's canonical content hash (ordinals instead of UUIDs). Send recomputes it and
  requires it to equal both the approval's hash and the stored hash.
- "Send" only marks the demand send-ready. The product does not email, submit to portals or move money.
- The trigger `fr_packet_update_guard` enforces the same transitions in the database and makes every packet
  column except `status` immutable. Approving a packet with pending review findings requires an explicit
  `acknowledgePendingFindings`.

## Consequences

- The approved artefact is provably the one marked send-ready; a later edit cannot ride on an old approval.
- Everything after send-ready (sending, carrier response, credit, payment) happens outside the system and is
  not recorded. The schema therefore cannot report recovered money (see `docs/exec-dashboard-spec.md`, gaps).
- Adding real sending later is a new trust boundary that needs its own design, consent and audit events.
