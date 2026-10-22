/**
 * Reviewer agent: verifies every flagged overcharge before it is reported, to keep false positives out of
 * claims. The deterministic pass re-derives each finding independently of the check that produced it
 * (arithmetic identity, cited lines and clauses exist, rule preconditions still hold, no line claimed
 * twice, claim window open). An optional LLM second opinion may at most move a CONFIRMED finding to
 * needs_review (a person then decides); it can never reject or remove a finding. The model sees only
 * neutral facts (rule id, line indices, amounts, schedule codes, booleans), never carrier-written text.
 */
import { z } from 'zod';

import { Dec, add, compare, div, gt, mul, q2, sub } from '../analysis/py-decimal.js';
import { normText } from '../analysis/py-text.js';

import { askJson, fence, type LlmClient } from './llm.js';
import { plain } from '../text-sanitize.js';

import { type AppliedTerms, type AuditFinding, type NormalizedInvoice, type ReviewVerdict, type ShipmentEvidence } from './types.js';

export interface ReviewInput {
  invoice: NormalizedInvoice;
  evidence: ShipmentEvidence;
  terms: AppliedTerms;
  history: readonly NormalizedInvoice[];
  findings: readonly AuditFinding[];
  asOf: string;
  tolerance?: string;
}

/** Findings below this confidence are never auto-confirmed. */
export const CONFIRM_MIN_CONFIDENCE = 0.7;

const D = (s: string): Dec => Dec.parse(s);

/** Rule-specific re-derivation. Returns reasons to reject (empty: the precondition holds). */
function preconditions(f: AuditFinding, r: ReviewInput): string[] {
  const { invoice: inv, evidence: ev, terms } = r;
  const out: string[] = [];
  switch (f.ruleId) {
    case 'AUD-DUP-INVOICE': {
      const prior = r.history.find((h) => f.citations.some((c) => c.startsWith(`prior invoice ${h.invoiceNumber} `)));
      if (prior === undefined) out.push('cited prior invoice is not in the history');
      else if (normText(prior.carrier) !== normText(inv.carrier)) out.push('prior invoice is from another carrier');
      break;
    }
    case 'AUD-REWEIGH':
      if (ev.reweighCertificate !== null) out.push('a reweigh certificate is on file');
      if (ev.bolWeightLbs === null || inv.billedWeightLbs === null || !gt(D(inv.billedWeightLbs), D(ev.bolWeightLbs))) out.push('billed weight does not exceed the BOL weight');
      if (!terms.reweighRequiresCertificate) out.push('contract does not require a reweigh certificate');
      break;
    case 'AUD-ACC-UNAUTH': {
      const code = terms.lineCodes.find((c) => c.line === f.lines[0])?.code ?? null;
      if (code === null || ev.authorizedAccessorials.some((a) => normText(a) === normText(code))) out.push('the accessorial is approved for this load');
      break;
    }
    case 'AUD-LINE-MATH': {
      const ln = inv.lines[f.lines[0] ?? -1];
      if (ln === undefined || ln.quantity === null || ln.rate === null) out.push('line has no printed quantity and rate');
      else if (f.expected === null || compare(q2(mul(D(ln.quantity), D(ln.rate))), D(f.expected)) !== 0) out.push('quantity x rate does not reproduce the expected amount');
      break;
    }
    case 'INV-LINEHAUL-RATE': {
      const lh = terms.lane?.linehaul ?? null;
      if (lh === null || f.expected === null || compare(D(lh), D(f.expected)) !== 0) out.push('expected linehaul is not the contract lane rate');
      break;
    }
    case 'AUD-FSC-BASE':
    case 'AUD-FSC-ON-OVERCHARGE':
      if (terms.fuel.type === 'percent' && terms.lane?.mode === 'TL' && terms.lane.linehaul !== null && f.expected !== null) {
        const exp = q2(div(mul(D(terms.fuel.percent), D(terms.lane.linehaul)), Dec.fromInt(100)));
        if (compare(exp, D(f.expected)) !== 0) out.push('expected fuel is not contract percent x contract linehaul');
      }
      break;
    case 'DET-OVERBILLED':
      if (ev.arrivalTime === null || ev.departureTime === null || terms.detention === null) out.push('detention finding without gate times or detention terms');
      break;
    default:
      break;
  }
  return out;
}

const LLM_SYSTEM = [
  'You are the reviewer agent of a freight-invoice audit team. A deterministic check flagged an overcharge.',
  'Decide whether a person should look at it before it is sent to the carrier. The facts are numbers and identifiers only.',
  'Answer with JSON only: {"status": "confirmed"|"needs_review", "reason": "..."}.',
].join(' ');

/** A model may answer anything; whatever it says, it can only keep or soften a confirmation. */
const SecondOpinion = z.strictObject({ status: z.enum(['confirmed', 'needs_review', 'rejected']), reason: z.string().max(400) });
const REASON_MAX = 200;

/**
 * Facts for the model: identifiers and numbers the shipper's side produced. No line descriptions, no carrier
 * names, no invoice/PRO numbers, no titles or explanations (they quote carrier text).
 */
export function neutralFacts(f: AuditFinding, r: ReviewInput): Record<string, unknown> {
  const code = (i: number): string | null => {
    const lc = r.terms.lineCodes.find((c) => c.line === i);
    return lc === undefined || lc.by === 'llm' ? null : lc.code;
  };
  return {
    ruleId: f.ruleId,
    amount: f.amount,
    billed: f.billed,
    expected: f.expected,
    confidence: f.confidence,
    lines: f.lines.map((i) => ({ index: i, amount: r.invoice.lines[i]?.amount ?? null, quantity: r.invoice.lines[i]?.quantity ?? null, rate: r.invoice.lines[i]?.rate ?? null, scheduleCode: code(i) })),
    evidence: {
      bolWeightLbs: r.evidence.bolWeightLbs,
      billedWeightLbs: r.invoice.billedWeightLbs,
      reweighCertificateOnFile: r.evidence.reweighCertificate !== null,
      gateTimesOnFile: r.evidence.arrivalTime !== null && r.evidence.departureTime !== null,
      approvedScheduleCodes: r.evidence.authorizedAccessorials.filter((a) => r.terms.accessorials.some((t) => t.code === a)),
    },
  };
}

/** Run the reviewer agent on all findings of one invoice. */
export async function runReviewerAgent(r: ReviewInput, llm: LlmClient | null = null): Promise<ReviewVerdict[]> {
  const tol = D(r.tolerance ?? '0.01');
  const lineCap = new Map<number, Dec>();
  const verdicts: ReviewVerdict[] = [];
  for (const f of r.findings) {
    const reasons: string[] = [];
    let status: ReviewVerdict['status'] = 'confirmed';
    const amount = D(f.amount);
    if (!gt(amount, tol)) reasons.push('amount is within tolerance');
    if (f.billed !== null && f.expected !== null && compare(q2(sub(D(f.billed), D(f.expected))), q2(amount)) !== 0) reasons.push('billed - expected does not equal the amount');
    if (f.lines.length === 0 || f.lines.some((i) => r.invoice.lines[i] === undefined)) reasons.push('cites a line that is not on the invoice');
    if (f.citations.length === 0) reasons.push('no citation');
    reasons.push(...preconditions(f, r));
    if (reasons.length > 0) status = 'rejected';
    if (status !== 'rejected' && r.asOf > r.terms.claimDeadline) {
      status = 'rejected';
      reasons.push(`claim window closed on ${r.terms.claimDeadline}`);
    }
    // Single-line findings may not claim more than the line's billed amount in total.
    if (status !== 'rejected' && f.lines.length === 1 && f.ruleId !== 'AUD-DUP-INVOICE') {
      const i = f.lines[0] ?? 0;
      const used = add(lineCap.get(i) ?? Dec.fromInt(0), amount);
      const ln = r.invoice.lines[i];
      if (ln !== undefined && gt(used, D(ln.amount))) {
        status = 'needs_review';
        reasons.push(`line ${i + 1} would be claimed above its billed amount by several findings`);
      } else lineCap.set(i, used);
    }
    if (status === 'confirmed' && f.needsHumanReview) {
      status = 'needs_review';
      reasons.push('the check marks this finding for human review');
    }
    if (status === 'confirmed' && f.confidence < CONFIRM_MIN_CONFIDENCE) {
      status = 'needs_review';
      reasons.push(`confidence ${f.confidence} below ${CONFIRM_MIN_CONFIDENCE}`);
    }
    let by: ReviewVerdict['by'] = 'deterministic';
    // Only a confirmed finding is put to the model, and the most it can do is send it to a person.
    if (status === 'confirmed') {
      const second = await askJson(llm, { agent: 'reviewer', system: LLM_SYSTEM, user: fence('FINDING', JSON.stringify(neutralFacts(f, r))) }, SecondOpinion);
      if (second !== null && second.status !== 'confirmed') {
        status = 'needs_review';
        by = 'llm';
        reasons.push(`LLM reviewer asked for human review: ${plain(second.reason, REASON_MAX)}`);
      }
    }
    verdicts.push({ findingId: f.id, status, reasons, by });
  }
  return verdicts;
}