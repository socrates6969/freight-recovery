/**
 * Evidence and claim agent. Before review it attaches the document trail to every finding; after review
 * it drafts one dispute per invoice from the CONFIRMED findings only, with the claim deadline from the
 * contract. The letter is a deterministic template. An optional LLM may only pick the opening paragraph from a
 * fixed set (`CLAIM_OPENINGS`) by id; it never writes letter text and never sees carrier-written text.
 */
import { z } from 'zod';

import { DRAFT_BANNER } from '../analysis/letter.js';
import { Dec, add, q2 } from '../analysis/py-decimal.js';
import { plain } from '../text-sanitize.js';

import { askJson, type LlmClient } from './llm.js';
import type { AppliedTerms, AuditFinding, ClaimDraft, NormalizedInvoice, ReviewVerdict, ShipmentEvidence } from './types.js';

/** Attach the document trail (invoice, contract, BOL) to each finding's citations. */
export function attachEvidence(inv: NormalizedInvoice, ev: ShipmentEvidence, terms: AppliedTerms, findings: readonly AuditFinding[]): AuditFinding[] {
  const docs = [`invoice ${inv.invoiceNumber} (${inv.source}, dated ${inv.invoiceDate})`, `contract ${terms.contractId}`];
  if (ev.bolNumber !== null) docs.push(`BOL ${ev.bolNumber}`);
  return findings.map((f) => ({ ...f, citations: [...new Set([...f.citations, ...docs])] }));
}

const ORDER = { confirmed: 2, needs_review: 1, rejected: 0 } as const;

/** The only opening paragraphs a claim letter can carry. The model chooses an id; it writes no text. */
export const CLAIM_OPENINGS = Object.freeze({
  standard:
    'We have audited the invoice below against our transportation agreement and the shipment documents, and we dispute the charges listed. Please issue a credit or a corrected invoice.',
  brief: 'We dispute the charges listed below under our transportation agreement. Please issue a credit or a corrected invoice.',
  relationship:
    'We value our work together and have reviewed the invoice below against our transportation agreement. The charges listed do not match the agreed terms; please issue a credit or a corrected invoice.',
} as const);
export type ClaimOpeningId = keyof typeof CLAIM_OPENINGS;
const OPENING_IDS = Object.keys(CLAIM_OPENINGS) as [ClaimOpeningId, ...ClaimOpeningId[]];

const OPENING_SYSTEM = [
  'You are the evidence and claim agent of a freight-invoice audit team.',
  `Choose the opening paragraph for a billing dispute. Answer with JSON only: {"template": one of ${OPENING_IDS.map((k) => `"${k}"`).join(', ')}}.`,
].join(' ');
/** Draft the claim for one invoice from the reviewed findings. */
export async function draftClaim(
  inv: NormalizedInvoice,
  terms: AppliedTerms,
  findings: readonly AuditFinding[],
  verdicts: readonly ReviewVerdict[],
  asOf: string,
  llm: LlmClient | null = null,
): Promise<ClaimDraft> {
  const status = new Map(verdicts.map((v) => [v.findingId, v.status]));
  const confirmed = findings.filter((f) => status.get(f.id) === 'confirmed');
  const pending = findings.filter((f) => status.get(f.id) === 'needs_review');
  const sum = (fs: readonly AuditFinding[]): string => q2(fs.reduce((a, f) => add(a, Dec.parse(f.amount)), Dec.fromInt(0))).toString();
  const windowOpen = asOf <= terms.claimDeadline;
  // No carrier-controlled text goes into the prompt: only counts and our own rule ids.
  const choice = await askJson(
    llm,
    { agent: 'claim', system: OPENING_SYSTEM, user: `Confirmed findings: ${confirmed.length}. Rule ids: ${[...new Set(confirmed.map((f) => f.ruleId))].join( ) || 'none'}. Claim window open: ${windowOpen}.` },
    z.strictObject({ template: z.enum(OPENING_IDS) }),
  );
  const opening = CLAIM_OPENINGS[choice?.template ?? 'standard'];
  const lines = [
    DRAFT_BANNER,
    '',
    `To: ${plain(inv.carrier)}`,
    `Re: Invoice ${plain(inv.invoiceNumber)}${inv.proNumber === null ? '' : ` / PRO ${plain(inv.proNumber)}`} - overcharge claim under contract ${plain(terms.contractId)}`,
    `File by: ${terms.claimDeadline}${windowOpen ? '' : ' (WINDOW CLOSED - do not send without legal review)'}`,
    '',
    opening,
    '',
  ];
  confirmed.forEach((f, i) => {
    lines.push(`${i + 1}. ${plain(f.title)}: $${f.amount} (billed $${f.billed ?? '?'}, contract supports $${f.expected ?? '?'})`);
    lines.push(`   Basis: ${f.citations.slice(0, 4).map((c) => plain(c, 120)).join('; ')}`);
  });
  lines.push('', `Total claimed: $${sum(confirmed)}`);
  if (pending.length > 0) lines.push(`Not claimed (awaiting internal review): ${pending.length} item(s), $${sum(pending)}.`);
  return {
    invoiceNumber: inv.invoiceNumber,
    carrier: inv.carrier,
    claimDeadline: terms.claimDeadline,
    windowOpen,
    confirmedTotal: sum(confirmed),
    pendingReviewTotal: sum(pending),
    findingIds: confirmed.map((f) => f.id),
    letter: lines.join('\n'),
  };
}

/** Stricter of two statuses (the LLM reviewer can only move a finding down). */
export function stricter(a: ReviewVerdict['status'], b: ReviewVerdict['status']): ReviewVerdict['status'] {
  return ORDER[a] <= ORDER[b] ? a : b;
}